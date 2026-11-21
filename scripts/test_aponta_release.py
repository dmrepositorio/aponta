"""Behavioral tests for the direct-to-production release tool."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import ExitStack, nullcontext
from unittest import mock

import aponta_release as release

SHA = 'a' * 40
IMAGES = {'api': 'sha256:1', 'web': 'sha256:2', 'storybook': 'sha256:3'}


def passed_record(**changes):
    return {'version': 2, 'sha': SHA, 'images': dict(IMAGES),
            'production': {'result': 'passed', 'checks': []}, **changes}


class OrderingTests(unittest.TestCase):
    """An older commit never replaces a newer one, except in an explicit rollback."""
    ENV = {'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-q', '-b', 'main')
        self.old, self.new = self.commit('one'), self.commit('two')
        self.git('checkout', '-q', '-b', 'side', self.old)
        self.side = self.commit('side')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True, text=True,
                              env={**os.environ, **self.ENV}).stdout.strip()

    def commit(self, message):
        self.git('commit', '-q', '--allow-empty', '-m', message)
        return self.git('rev-parse', 'HEAD')

    def test_first_deploy_is_accepted(self):
        self.assertEqual(release.ordering_errors(self.root, None, self.new), [])

    def test_newer_commit_replaces_older(self):
        self.assertEqual(release.ordering_errors(self.root, self.old, self.new), [])

    def test_older_commit_does_not_replace_newer(self):
        self.assertIn('Commit is older than the one deployed; use --rollback to go back on purpose.',
                      release.ordering_errors(self.root, self.new, self.old))

    def test_commit_outside_the_deployed_history_is_refused(self):
        self.assertIn('Commit does not contain the one deployed.',
                      release.ordering_errors(self.root, self.new, self.side))

    def test_rollback_accepts_only_an_ancestor_of_the_deployed_commit(self):
        self.assertEqual(release.ordering_errors(self.root, self.new, self.old, rollback=True), [])
        self.assertIn('Rollback target is not an ancestor of the deployed commit.',
                      release.ordering_errors(self.root, self.new, self.side, rollback=True))


class EnvironmentTests(unittest.TestCase):
    """Production has a single compose project and its own env file."""

    def test_env_file_values_are_read_without_comments(self):
        self.assertEqual(release.env_values('# c\nWEB_PORT=8190\n\nA="x y"\n'), {'WEB_PORT': '8190', 'A': 'x y'})

    def test_compose_command_uses_the_production_project_and_env_file(self):
        home, config = Path('/srv/deploy'), Path('/srv/config')
        production = release.compose_command('production', SHA, home, config)
        self.assertEqual(production[production.index('-p') + 1], 'aponta-prod')
        self.assertIn(str(config / '.env.prod'), production)
        self.assertIn(str(home / 'releases' / SHA / 'docker-compose.yml'), production)

    def test_staging_no_longer_exists(self):
        with self.assertRaises(ValueError):
            release.compose_command('staging', SHA, Path('/a'), Path('/b'))

    def test_unknown_environment_is_refused(self):
        with self.assertRaises(ValueError):
            release.compose_command('prod', SHA, Path('/a'), Path('/b'))


class SmokeTests(unittest.TestCase):
    """The smoke test proves which commit is answering, not only that something answers."""

    def fetch(self, commit=SHA, health='ok', web_commit=None):
        pages = {'/': (200, '<html>'), '/api/health': (200, json.dumps({'status': health})),
                 '/api/version': (200, json.dumps({'commit': commit})),
                 '/version.json': (200, json.dumps({'commit': web_commit or commit}))}
        return lambda path: pages[path]

    def failed(self, checks):
        return [check['name'] for check in checks if not check['ok']]

    def test_matching_commit_and_health_pass(self):
        checks = release.smoke(SHA, self.fetch())
        self.assertEqual(len(checks), 4)
        self.assertEqual(self.failed(checks), [])

    def test_api_answering_from_another_commit_fails(self):
        self.assertEqual(self.failed(release.smoke(SHA, self.fetch(commit='b' * 40))), ['api commit', 'web commit'])

    def test_web_bundle_from_another_commit_fails(self):
        self.assertEqual(self.failed(release.smoke(SHA, self.fetch(web_commit='c' * 40))), ['web commit'])

    def test_unhealthy_api_fails(self):
        self.assertEqual(self.failed(release.smoke(SHA, self.fetch(health='error'))), ['api health'])

    def test_unreachable_page_is_a_failed_check_not_a_crash(self):
        def fetch(path):
            raise OSError('connection refused')
        self.assertEqual(len(self.failed(release.smoke(SHA, fetch))), 4)


class DeployTests(unittest.TestCase):
    """deploy builds once, brings production up and only records a deployed commit when smoke passes."""

    def run_deploy(self, smoke_ok=True, built_images=None):
        done = subprocess.CompletedProcess([], 0, '', '')
        images = iter([built_images or {name: None for name in IMAGES}, dict(IMAGES)])
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            home, config = Path(tmp) / 'home', Path(tmp) / 'config'
            config.mkdir()
            (config / '.env.prod').write_text('WEB_PORT=8090\n')
            patch = lambda name, **kw: stack.enter_context(mock.patch.object(release, name, **kw))
            patch('locked', new=lambda *a: nullcontext())
            patch('export_release')
            patch('deployed', return_value=None)
            patch('ordering_errors', return_value=[])
            patch('image_ids', side_effect=lambda sha: next(images))
            run = patch('run', return_value=done)
            up = patch('up')
            patch('wait_and_smoke', return_value=[{'name': 'x', 'ok': smoke_ok}])
            mark = patch('mark_deployed')
            patch('prune')
            code = release.deploy(Path('/repo'), home, config, SHA, False)
            record = release.load_record(home, SHA)
            return code, record, run, up, mark

    def test_successful_deploy_builds_records_and_marks_the_commit(self):
        code, record, run, up, mark = self.run_deploy()
        self.assertEqual(code, 0)
        self.assertEqual(record['production']['result'], 'passed')
        self.assertEqual(record['images'], IMAGES)
        self.assertIn('build', run.call_args.args)
        up.assert_called_once()
        mark.assert_called_once()

    def test_images_already_built_are_not_rebuilt(self):
        code, _, run, _, _ = self.run_deploy(built_images=dict(IMAGES))
        self.assertEqual(code, 0)
        run.assert_not_called()

    def test_failed_smoke_fails_and_does_not_mark_the_commit(self):
        code, record, _, _, mark = self.run_deploy(smoke_ok=False)
        self.assertEqual(code, 1)
        self.assertEqual(record['production']['result'], 'failed')
        mark.assert_not_called()

    def test_older_commit_is_refused_before_anything_runs(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            for name, kw in (('export_release', {}), ('deployed', {'return_value': 'b' * 40}),
                             ('ordering_errors', {'return_value': ['Commit is older']})):
                stack.enter_context(mock.patch.object(release, name, **kw))
            stack.enter_context(mock.patch.object(release, 'locked', new=lambda *a: nullcontext()))
            up = stack.enter_context(mock.patch.object(release, 'up'))
            self.assertEqual(release.deploy(Path('/repo'), Path(tmp), Path(tmp), SHA, False), 1)
            up.assert_not_called()


class RecordTests(unittest.TestCase):
    def test_record_is_stored_per_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            release.save_record(Path(tmp), passed_record())
            self.assertEqual(release.load_record(Path(tmp), SHA)['images'], IMAGES)
            self.assertIsNone(release.load_record(Path(tmp), 'b' * 40))


if __name__ == '__main__':
    unittest.main()
