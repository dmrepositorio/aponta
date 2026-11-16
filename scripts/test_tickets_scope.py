import tempfile
import unittest
from pathlib import Path

from tickets_scope import find_tickets_files, run_check


class RunCheckTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'apps/web/src/pages').mkdir(parents=True)
        (self.root / 'apps/web/src/components/tickets').mkdir(parents=True)

    def write(self, rel_path, content):
        (self.root / rel_path).write_text(content)

    def test_returns_zero_and_prints_ok_when_no_violations(self):
        self.write('apps/web/src/pages/TicketDetailPage.tsx', 'clean')
        exit_code = run_check(self.root, lambda text: [], ok_message='OK', fail_message='FAIL')
        self.assertEqual(0, exit_code)

    def test_returns_one_when_a_file_has_a_violation(self):
        self.write('apps/web/src/pages/TicketDetailPage.tsx', 'dirty')
        exit_code = run_check(self.root, lambda text: ['found it'], ok_message='OK', fail_message='FAIL')
        self.assertEqual(1, exit_code)


class FindTicketsFilesTest(unittest.TestCase):
    """DMTE-529 AC-01: a Dashboard e o EzLineChart entram no escopo das checagens."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'apps/web/src/pages').mkdir(parents=True)
        (self.root / 'apps/web/src/components/ds').mkdir(parents=True)

    def touch(self, rel_path):
        (self.root / rel_path).write_text('')

    def test_includes_dashboard_page_and_line_chart(self):
        self.touch('apps/web/src/pages/DashboardPage.tsx')
        self.touch('apps/web/src/components/ds/EzLineChart.tsx')
        found = {path.relative_to(self.root).as_posix() for path in find_tickets_files(self.root)}
        self.assertEqual(
            {'apps/web/src/pages/DashboardPage.tsx', 'apps/web/src/components/ds/EzLineChart.tsx'},
            found,
        )

    def test_ignores_tests_and_stories_of_the_new_files(self):
        self.touch('apps/web/src/pages/DashboardPage.test.tsx')
        self.touch('apps/web/src/components/ds/EzLineChart.test.tsx')
        self.touch('apps/web/src/components/ds/EzLineChart.stories.tsx')
        self.assertEqual([], find_tickets_files(self.root))

    def test_leaves_other_ds_components_out(self):
        self.touch('apps/web/src/components/ds/EzChart.tsx')
        self.assertEqual([], find_tickets_files(self.root))


if __name__ == '__main__':
    unittest.main()
