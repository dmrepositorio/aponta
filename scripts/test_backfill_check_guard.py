"""GH-370 T2: o check do backfill escreve e apaga linhas de Ticket; recusa banco que não seja local."""
import os
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / 'scripts' / 'backfill_description_text_check.mjs'
SECRET = 'senha-sintetica-xyz'


def run_check(url, **extra_env):
    env = {key: value for key, value in os.environ.items() if key != 'BACKFILL_CHECK_ALLOW_DESTRUCTIVE'}
    env['DATABASE_URL'] = url
    env.update(extra_env)
    return subprocess.run(
        ['node', str(SCRIPT)], cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60,
    )


class BackfillCheckGuardTest(unittest.TestCase):
    def test_refuses_remote_host_before_any_write_and_hides_credentials(self):
        done = run_check('postgresql://app:%s@db.exemplo.com:5432/aponta?schema=public' % SECRET)
        output = done.stdout + done.stderr
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('recusado', output)
        self.assertIn('BACKFILL_CHECK_ALLOW_DESTRUCTIVE', output)
        self.assertNotIn(SECRET, output)
        self.assertNotIn('postgresql://', output)

    def test_refuses_a_host_that_only_looks_local(self):
        done = run_check('postgresql://app:%s@localhost.exemplo.com:5432/aponta' % SECRET)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('recusado', done.stdout + done.stderr)

    def test_refuses_unparseable_url_without_echoing_it(self):
        done = run_check('isto-nao-e-uma-url-%s' % SECRET)
        output = done.stdout + done.stderr
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('recusado', output)
        self.assertNotIn(SECRET, output)

    def test_local_hosts_pass_the_guard(self):
        # Passa da guarda (127.0.0.1 e localhost são o CI e o e2e_isolated); depois
        # falha por outro motivo (sem banco/artefato), mas nunca pela recusa.
        for host in ('127.0.0.1', 'localhost', '[::1]'):
            done = run_check('postgresql://postgres:postgres@%s:1/aponta' % host)
            self.assertNotIn('recusado', done.stdout + done.stderr, host)


if __name__ == '__main__':
    unittest.main()
