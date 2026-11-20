"""Verify the workflow roles, locally available Addy Osmani methods and shared references."""
import hashlib
import json
from pathlib import Path
import re

ROLES = {'dev_triagem', 'dev_arquiteto', 'dev_executor', 'dev_qa', 'dev_entrega'}


def validate_workflow(root: Path) -> list[str]:
    errors = []
    try:
        manifest = json.loads((root / 'docs/agents/agent-skills.json').read_text())
        lock = json.loads((root / 'skills-lock.json').read_text())['skills']
        roles = manifest['roles']
        files = manifest['files']
        if set(roles) != ROLES or any(not names for names in roles.values()):
            errors.append('Expected a skill assignment for every Dev Pipeline role')
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
            content = (root / '.agents' / rel).read_text()
            required.update(re.findall(r'\.\./\.\./(references/[\w.-]+\.md)', content))
        if set(files) != required:
            errors.append('Pinned files differ from the required skills and references')
        for name in required:
            path = (root / '.agents' / name).resolve()
            if not path.is_relative_to((root / '.agents').resolve()) or not path.is_file():
                errors.append(f'Missing or unsafe file: {name}')
            elif hashlib.sha256(path.read_bytes()).hexdigest() != files.get(name):
                errors.append(f'Pinned source hash mismatch: {name}')
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append(f'Invalid Agent Skills workflow: {error}')
    return errors
