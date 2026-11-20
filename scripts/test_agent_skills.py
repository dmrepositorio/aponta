import json
from pathlib import Path
import shutil
import tempfile
import unittest

from check_agent_skills import validate_workflow


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        repo = Path(__file__).resolve().parents[1]
        shutil.copytree(repo / 'tools/dev-pipeline', self.root, dirs_exist_ok=True)

    def test_actual_workflow(self):
        self.assertEqual([], validate_workflow(self.root))

    def test_missing_role(self):
        path = self.root / 'catalog.json'
        manifest = json.loads(path.read_text())
        del manifest['roles']['dev_pipeline_qa']
        path.write_text(json.dumps(manifest))
        self.assertTrue(validate_workflow(self.root))

    def test_modified_shared_reference(self):
        (self.root / 'references/testing-patterns.md').write_text('modified')
        self.assertTrue(validate_workflow(self.root))

    def test_extra_role(self):
        path = self.root / 'catalog.json'
        manifest = json.loads(path.read_text())
        manifest['roles']['dev_pipeline_extra'] = ['interview-me']
        path.write_text(json.dumps(manifest))
        self.assertTrue(validate_workflow(self.root))

    def test_invalid_revision(self):
        path = self.root / 'catalog.json'
        manifest = json.loads(path.read_text())
        manifest['revision'] = 'not-a-valid-revision'
        path.write_text(json.dumps(manifest))
        self.assertTrue(validate_workflow(self.root))

    def test_lock_revision_mismatch(self):
        path = self.root / 'skills-lock.json'
        lock = json.loads(path.read_text())
        lock['skills']['interview-me']['revision'] = 'f' * 40
        path.write_text(json.dumps(lock))
        self.assertTrue(validate_workflow(self.root))

    def test_skill_assigned_without_lock_entry(self):
        path = self.root / 'catalog.json'
        manifest = json.loads(path.read_text())
        manifest['roles']['dev_pipeline_qa'] = ['nonexistent-skill']
        path.write_text(json.dumps(manifest))
        self.assertTrue(validate_workflow(self.root))

    def test_empty_role_skill_list(self):
        path = self.root / 'catalog.json'
        manifest = json.loads(path.read_text())
        manifest['roles']['dev_pipeline_qa'] = []
        path.write_text(json.dumps(manifest))
        self.assertTrue(validate_workflow(self.root))
