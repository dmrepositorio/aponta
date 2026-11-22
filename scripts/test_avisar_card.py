import contextlib
import io
import json
import unittest
import urllib.error

from avisar_card import LEADER, build_body, delivery_of, notify, outcome

SHA = 'a' * 40
PREVIOUS = 'd' * 40
C1, C2 = '1' * 40, '2' * 40
RUN = 'https://github.com/dmrepositorio/aponta/actions/runs/777'
WORKSPACE = 'dabf7eb3-4a03-4e26-8eb0-0773f65cfff4'
TOKEN = 'mul_secret_token'
CARDS = {'DMTE-900': 'card-900', 'DMTE-901': 'card-901', 'DMTE-902': 'card-902'}


def pull(number, title, ref='feat/x'):
    return {'number': number, 'title': title, 'head': {'ref': ref}, 'html_url': 'https://github.com/dmrepositorio/aponta/pull/' + str(number)}


PR = pull(12, 'DMTE-900: algo entregue')


class Response:
    def __init__(self, text):
        self.text = text

    def read(self):
        return self.text.encode()


class Http:
    """Stands in for urlopen: answers the card lookup, the production version probes and records the comments."""

    def __init__(self, commit=SHA, post_error=None, probe_error=None, cards=None):
        self.requests, self.commit, self.post_error, self.probe_error = [], commit, post_error, probe_error
        self.cards = CARDS if cards is None else cards

    def __call__(self, request, timeout=10):
        self.requests.append(request)
        url = request.full_url
        if request.get_method() == 'POST':
            if self.post_error:
                raise self.post_error
            return Response('{}')
        if '/api/issues/' in url:
            name = url.rsplit('/', 1)[1]
            if name not in self.cards:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return Response(json.dumps({'id': self.cards[name], 'identifier': name}))
        if self.probe_error:
            raise self.probe_error
        return Response(json.dumps({'commit': self.commit}))

    def posts(self):
        return [r for r in self.requests if r.get_method() == 'POST']


class Compare:
    def __init__(self, commits, status='ahead', total=None, error=None):
        self.commits, self.status, self.total, self.error, self.calls = commits, status, total, error, []

    def __call__(self, previous, sha):
        self.calls.append((previous, sha))
        if self.error:
            raise self.error
        return {'status': self.status, 'total_commits': self.total or len(self.commits), 'commits': [{'sha': c} for c in self.commits]}


class OutcomeTests(unittest.TestCase):
    def test_production_success_is_ok(self):
        self.assertEqual(outcome('success'), (True, 'CD (Produção) concluído'))

    def test_production_failure_is_reported(self):
        self.assertEqual(outcome('failure'), (False, 'CD falhou em produção'))

    def test_cancelled_or_skipped_shows_its_own_result(self):
        self.assertEqual(outcome('cancelled'), (False, 'CD falhou em produção (cancelled)'))
        self.assertEqual(outcome('skipped'), (False, 'CD falhou em produção (skipped)'))


class DeliveryTests(unittest.TestCase):
    def test_title_names_the_delivery(self):
        self.assertEqual(delivery_of([PR]), ('DMTE-900', PR))
        self.assertEqual(delivery_of([pull(1, 'DMTE-551 r4: logos')])[0], 'DMTE-551')

    def test_branch_names_the_delivery_when_the_title_does_not(self):
        self.assertEqual(delivery_of([pull(1, 'ajuste', 'feat/DMTE-777')])[0], 'DMTE-777')

    def test_no_name_or_two_distinct_names_name_nothing(self):
        self.assertIsNone(delivery_of([pull(1, 'chore: sem entrega')]))
        self.assertIsNone(delivery_of([]))
        self.assertIsNone(delivery_of([PR, pull(13, 'DMTE-901: outra')]))


class CommentBodyTests(unittest.TestCase):
    def test_starts_with_the_leader_mention_and_carries_sha_pr_run_and_version(self):
        body = build_body('CD (Produção) concluído', SHA, PR, RUN, {'/api/version': SHA, '/version.json': SHA}, SHA)
        self.assertTrue(body.startswith(LEADER + ' **CD (Produção) concluído**'))
        for part in (SHA, '#12', RUN, 'coincide com o commit implantado'):
            self.assertIn(part, body)

    def test_version_that_differs_is_said_so_and_failed_probe_is_not_verified(self):
        self.assertIn('diferente do commit implantado', build_body('x', SHA, PR, RUN, {'/api/version': C1}, SHA))
        self.assertIn('não verificado contra o commit implantado', build_body('x', SHA, PR, RUN, {'/api/version': None}, SHA))

    def test_leader_is_dm_lider(self):
        self.assertIn('@dm_lider', LEADER)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.env = {'SHA': SHA, 'PRODUCTION_RESULT': 'success', 'MULTICA_TOKEN': TOKEN,
                    'GITHUB_REPOSITORY': 'dmrepositorio/aponta', 'GITHUB_SERVER_URL': 'https://github.com', 'GITHUB_RUN_ID': '777'}

    def run_notify(self, prs=(PR,), http=None, env=None, github=None, compare=None):
        http = http or Http()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = notify(env or self.env, github or (lambda sha: list(prs)), http, compare)
        return code, http, out.getvalue()


class NotifyTests(Fixture):
    def test_posts_on_the_card_with_workspace_and_bearer_headers(self):
        code, http, _ = self.run_notify()
        self.assertEqual(code, 0)
        [post] = http.posts()
        self.assertEqual(post.full_url, 'https://multica.aponta.cloud/api/issues/card-900/comments')
        self.assertEqual(post.get_header('Authorization'), 'Bearer ' + TOKEN)
        self.assertEqual(post.get_header('X-workspace-id'), WORKSPACE)
        content = json.loads(post.data)['content']
        self.assertTrue(content.startswith(LEADER))
        self.assertIn(RUN, content)
        self.assertIn('coincide com o commit implantado', content)

    def test_production_failure_comments_without_probing_production(self):
        code, http, _ = self.run_notify(env={**self.env, 'PRODUCTION_RESULT': 'failure'})
        self.assertEqual(code, 0)
        content = json.loads(http.posts()[0].data)['content']
        self.assertIn('CD falhou em produção', content)
        self.assertNotIn('Produção:', content)
        self.assertEqual([r for r in http.requests if r.full_url.endswith('/api/version')], [])

    def test_delivery_without_a_card_does_not_comment_nor_fail(self):
        code, http, out = self.run_notify(prs=[pull(14, 'DMTE-999: sem card')])
        self.assertEqual(code, 0)
        self.assertEqual(http.posts(), [])
        self.assertIn('sem card no Multica', out)

    def test_pr_without_a_delivery_name_does_not_comment(self):
        code, http, out = self.run_notify(prs=[pull(15, 'chore: sem entrega')])
        self.assertEqual((code, http.posts()), (0, []))
        self.assertIn('sem aviso ao card', out)

    def test_two_distinct_deliveries_on_one_commit_do_not_comment(self):
        code, http, _ = self.run_notify(prs=[PR, pull(13, 'DMTE-901: outra')])
        self.assertEqual((code, http.posts()), (0, []))

    def test_github_lookup_failure_does_not_fail_the_deploy(self):
        def boom(sha):
            raise RuntimeError('api fora')
        code, http, out = self.run_notify(github=boom)
        self.assertEqual((code, http.posts()), (0, []))
        self.assertIn('falhou', out)

    def test_missing_token_does_not_comment_nor_fail(self):
        env = {k: v for k, v in self.env.items() if k != 'MULTICA_TOKEN'}
        code, http, out = self.run_notify(env=env)
        self.assertEqual((code, http.requests), (0, []))
        self.assertIn('MULTICA_TOKEN ausente', out)

    def test_http_and_network_errors_never_fail_the_deploy(self):
        for error in (urllib.error.HTTPError('u', 500, 'x', {}, None), urllib.error.URLError('rede caiu')):
            code, _, _ = self.run_notify(http=Http(post_error=error))
            self.assertEqual(code, 0)

    def test_token_is_redacted_from_logged_errors(self):
        code, _, out = self.run_notify(http=Http(post_error=RuntimeError('falhou com ' + TOKEN)))
        self.assertEqual(code, 0)
        self.assertNotIn(TOKEN, out)

    def test_unreachable_production_is_posted_as_not_verified(self):
        _, http, _ = self.run_notify(http=Http(probe_error=urllib.error.URLError('x')))
        self.assertIn('não verificado', json.loads(http.posts()[0].data)['content'])


class RangeTests(Fixture):
    """A deploy publishes everything between the commit in production and the tip of main."""

    def setUp(self):
        super().setUp()
        self.env['PREVIOUS_SHA'] = PREVIOUS
        self.prs = {C1: [pull(31, 'DMTE-900: um')], C2: [pull(32, 'DMTE-901: dois')], SHA: [pull(33, 'DMTE-902: três')]}

    def run_range(self, commits=(C1, C2, SHA), env=None, **kwargs):
        compare = Compare(list(commits), **kwargs)
        code, http, out = self.run_notify(env=env, github=lambda c: list(self.prs.get(c, [])), compare=compare)
        self.compare = compare
        return code, http, out

    def comments(self, http):
        return {r.full_url.split('/issues/')[1].split('/')[0]: json.loads(r.data)['content'] for r in http.posts()}

    def test_each_delivery_of_the_range_gets_its_own_comment_with_mention(self):
        code, http, _ = self.run_range()
        self.assertEqual(code, 0)
        comments = self.comments(http)
        self.assertEqual(set(comments), {'card-900', 'card-901', 'card-902'})
        for text in comments.values():
            self.assertTrue(text.startswith(LEADER))
        self.assertIn('DMTE-901 (PR #32)', comments['card-900'])
        self.assertEqual(self.compare.calls, [(PREVIOUS, SHA)])

    def test_failure_comments_every_card_of_the_range(self):
        _, http, _ = self.run_range(env={**self.env, 'PRODUCTION_RESULT': 'failure'})
        self.assertEqual(len(http.posts()), 3)
        for text in self.comments(http).values():
            self.assertIn('CD falhou em produção', text)

    def test_production_is_probed_once_for_all_the_cards(self):
        _, http, _ = self.run_range()
        probes = [r for r in http.requests if r.full_url == 'https://dm.aponta.cloud/api/version']
        self.assertEqual(len(probes), 1)

    def test_empty_or_invalid_or_equal_previous_sha_falls_back_to_the_published_commit(self):
        for previous in ('', 'nao-e-sha', SHA):
            env = {**self.env, 'PREVIOUS_SHA': previous}
            _, http, _ = self.run_range(env=env)
            self.assertEqual(set(self.comments(http)), {'card-902'}, previous)

    def test_rollback_range_truncated_range_and_compare_failure_fall_back(self):
        for kwargs in ({'status': 'behind'}, {'total': 500}, {'error': RuntimeError('api')}):
            _, http, out = self.run_range(**kwargs)
            self.assertEqual(set(self.comments(http)), {'card-902'}, kwargs)
            self.assertIn('Aviso só do commit publicado', out)

    def test_deliveries_with_several_commits_get_one_comment(self):
        self.prs[C2] = [pull(31, 'DMTE-900: um')]
        _, http, _ = self.run_range()
        self.assertEqual(len(self.comments(http)), 2)


if __name__ == '__main__':
    unittest.main()
