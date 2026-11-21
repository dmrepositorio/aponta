"""Verify the workflow roles, locally available Addy Osmani methods and shared references."""
import hashlib
import json
from pathlib import Path
import re

PRIMARY_METHODS = {
    'dev_pipeline_triagem': 'spec-driven-development',
    'dev_pipeline_arquiteto': 'planning-and-task-breakdown',
    'dev_pipeline_executor': 'incremental-implementation',
    'dev_pipeline_qa': 'code-review-and-quality',
    'dev_pipeline_entrega': 'git-workflow-and-versioning',
}


def validate_workflow(root: Path) -> list[str]:
    errors = []
    try:
        manifest = json.loads((root / 'catalog.json').read_text())
        lock = json.loads((root / 'skills-lock.json').read_text())['skills']
        roles = manifest['roles']
        files = manifest['files']
        if set(roles) != set(PRIMARY_METHODS) or any(not names for names in roles.values()):
            errors.append('Expected a skill assignment for every Dev Pipeline role')
        for role, method in PRIMARY_METHODS.items():
            if method not in roles.get(role, []):
                errors.append(f'{role}: expected its primary method {method}')
        if manifest['source'] != 'addyosmani/agent-skills' or not re.fullmatch('[0-9a-f]{40}', manifest['revision']):
            errors.append('Invalid upstream or revision')
        required = {'LICENSE'}
        for name in {name for names in roles.values() for name in names}:
            if not re.fullmatch('[a-z0-9-]+', name):
                raise ValueError(f'Invalid skill name: {name}')
            rel = f'skills/{name}/SKILL.md'
            entry = lock[name]
            if (entry['source'], entry['revision'], entry['skillPath'], entry['computedHash']) != (
                manifest['source'], manifest['revision'], rel, files[rel]
            ):
                errors.append(f'{name}: lock differs from the workflow manifest')
            required.add(rel)
            content = (root / rel).read_text()
            required.update(re.findall(r'\.\./\.\./(references/[\w.-]+\.md)', content))
        if set(files) != required:
            errors.append('Pinned files differ from the required skills and references')
        for name in required:
            path = (root / name).resolve()
            if not path.is_relative_to(root.resolve()) or not path.is_file():
                errors.append(f'Missing or unsafe file: {name}')
            elif hashlib.sha256(path.read_bytes()).hexdigest() != files.get(name):
                errors.append(f'Pinned source hash mismatch: {name}')
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append(f'Invalid Agent Skills workflow: {error}')
    return errors


if __name__ == '__main__':
    errors = validate_workflow(Path('tools/dev-pipeline'))
    for error in errors:
        print(error)
    raise SystemExit(bool(errors))
