"""Post the result of the CD run on the Multica card of every delivery it shipped.

Runs as the last job of .github/workflows/deploy.yml, success or failure. A deploy ships the tip of main, which can carry
several merges: the commits from the one in production (PREVIOUS_SHA) up to the tip. Commit -> PR -> delivery name
`DMTE-N` (in the PR title or branch) -> Multica card (the issue with that identifier), one comment per delivery.
A failure here is logged and never fails the deploy.
"""
import json
import os
import re
import subprocess
import urllib.request

LEADER = '[@dm_lider](mention://agent/22484e3d-c0a4-4f2d-8638-87ea490c69fb)'
SERVER = 'https://multica.aponta.cloud'
WORKSPACE = 'dabf7eb3-4a03-4e26-8eb0-0773f65cfff4'
PRODUCTION = 'https://dm.aponta.cloud'
VERSION_PATHS = ('/api/version', '/version.json')
DELIVERY = re.compile(r'\bDMTE-\d+\b')
COMMIT = re.compile(r'[0-9a-f]{40}')


def outcome(production):
    """(ok, headline) from the `result` of the production job."""
    if production == 'success':
        return True, 'CD (Produção) concluído'
    return False, 'CD falhou em produção' + ('' if production == 'failure' else ' (' + production + ')')


def name_of(pr):
    """The `DMTE-N` of a PR: its title first, then its branch."""
    for text in (pr.get('title') or '', (pr.get('head') or {}).get('ref') or ''):
        match = DELIVERY.search(text)
        if match:
            return match.group(0)
    return None


def delivery_of(prs):
    """(delivery, pr) when the PRs of the commit name exactly one delivery; otherwise None."""
    named = [(name_of(pr), pr) for pr in prs]
    named = [(name, pr) for name, pr in named if name]
    return named[0] if len({delivery for delivery, _ in named}) == 1 else None


def card_of(delivery, env, http):
    """Id of the Multica card of a delivery: the issue whose identifier is the delivery name."""
    request = urllib.request.Request(
        env.get('MULTICA_SERVER_URL', SERVER) + '/api/issues/' + delivery,
        headers={'Authorization': 'Bearer ' + env['MULTICA_TOKEN'], 'X-Workspace-ID': env.get('MULTICA_WORKSPACE_ID', WORKSPACE)})
    return json.loads(http(request, timeout=20).read())['id']


def build_body(label, sha, pr, run_url, version=None, published=None, together=()):
    """`sha` is the delivery's own commit; `published` is the tip the deploy shipped, when it differs."""
    lines = [LEADER + ' **' + label + '**', '', '- Commit: `' + sha + '`']
    if published and published != sha:
        lines.append('- Publicado no commit: `' + published + '`')
    lines += ['- PR: #' + str(pr['number']) + ' (' + pr['html_url'] + ')', '- Run: ' + run_url]
    if together:
        lines.append('- Publicado junto com: ' + ', '.join(together))
    if version:
        shown = ', '.join('`' + path + '` → ' + ('`' + commit + '`' if commit else 'indisponível') for path, commit in version.items())
        verdict = ('não verificado contra o' if None in version.values()
                   else 'coincide com o' if set(version.values()) == {published or sha} else 'diferente do')
        lines.append('- Produção: ' + shown + ' (' + verdict + ' commit implantado)')
    return '\n'.join(lines)


def production_version(base, http):
    version = {}
    for path in VERSION_PATHS:
        try:
            version[path] = json.loads(http(urllib.request.Request(base + path), timeout=10).read())['commit']
        except Exception:
            version[path] = None  # probe failed: reported as unavailable, not as a different commit
    return version


def github_pulls(sha):
    out = subprocess.run(['gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY'] + '/commits/' + sha + '/pulls'],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def github_compare(previous, sha):
    out = subprocess.run(['gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY'] + '/compare/' + previous + '...' + sha + '?per_page=100'],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def published_commits(previous, sha, compare):
    """Commits the deploy shipped, oldest first. Only `sha` when the range cannot be trusted (rollback, no previous, API error)."""
    try:
        if not previous:
            reason = 'PREVIOUS_SHA vazio'
        elif not COMMIT.fullmatch(previous):
            reason = 'PREVIOUS_SHA inválido'
        elif previous == sha:
            reason = 'PREVIOUS_SHA igual ao commit publicado'
        else:
            diff = compare(previous, sha)
            if diff['status'] != 'ahead':
                reason = 'status ' + diff['status'] + ' (não é ancestral do publicado)'
            elif diff['total_commits'] > len(diff['commits']):
                reason = 'intervalo truncado (' + str(diff['total_commits']) + ' commits)'
            else:
                return [commit['sha'] for commit in diff['commits']]
    except Exception as error:
        reason = 'consulta do intervalo falhou (' + type(error).__name__ + '): ' + str(error)
    print('Intervalo ' + (previous or '-') + '...' + sha + ' não usado: ' + reason + '. Aviso só do commit publicado.')
    return [sha]


def deliveries_of(commits, github):
    """{delivery: (commit, pr)} in range order; of a delivery with several commits the newest one stays."""
    found = {}
    for commit in commits:
        try:
            prs = github(commit)
        except Exception as error:
            print('Consulta dos PRs do commit ' + commit + ' falhou (' + type(error).__name__ + '): ' + str(error))
            continue
        entry = delivery_of(prs)
        if not entry:
            named = sorted({name for name in map(name_of, prs) if name})
            print('Commit ' + commit + ' sem PR que nomeie uma única entrega DMTE-N (' + str(len(prs)) + ' PR, entregas: '
                  + (', '.join(named) or 'nenhuma') + '): sem aviso ao card.')
            continue
        found.pop(entry[0], None)
        found[entry[0]] = (commit, entry[1])
    return found


def notify(env, github=github_pulls, http=urllib.request.urlopen, compare=github_compare):
    """Always 0: the notice must never change the result of a deploy that already happened."""
    token = env.get('MULTICA_TOKEN', '')
    if not token:
        print('MULTICA_TOKEN ausente: sem aviso ao card.')
        return 0
    try:
        sha = env['SHA']
        cards = []
        for delivery, (commit, pr) in deliveries_of(published_commits(env.get('PREVIOUS_SHA', ''), sha, compare), github).items():
            try:
                cards.append((delivery, commit, pr, card_of(delivery, env, http)))
            except Exception as error:
                print(delivery + ' sem card no Multica (' + type(error).__name__ + '): ' + str(error).replace(token, '***') + ': sem aviso ao card.')
        if not cards:
            return 0
        ok, label = outcome(env['PRODUCTION_RESULT'])
        run_url = '/'.join([env['GITHUB_SERVER_URL'], env['GITHUB_REPOSITORY'], 'actions/runs', env['GITHUB_RUN_ID']])
        version = production_version(env.get('PRODUCTION_URL', PRODUCTION), http) if ok else None
        for delivery, commit, pr, parent in cards:
            together = [other + ' (PR #' + str(other_pr['number']) + ')' for other, _, other_pr, _ in cards if other != delivery]
            try:
                request = urllib.request.Request(
                    env.get('MULTICA_SERVER_URL', SERVER) + '/api/issues/' + parent + '/comments',
                    data=json.dumps({'content': build_body(label, commit, pr, run_url, version, sha, together)}).encode(), method='POST',
                    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                             'X-Workspace-ID': env.get('MULTICA_WORKSPACE_ID', WORKSPACE)})
                http(request, timeout=20).read()
                print('Aviso publicado no card de ' + delivery + ' (' + label + ').')
            except Exception as error:
                print('Aviso ao Multica de ' + delivery + ' falhou (' + type(error).__name__ + '): ' + str(error).replace(token, '***'))
    except Exception as error:
        print('Aviso ao Multica falhou (' + type(error).__name__ + '): ' + str(error).replace(token, '***'))
    return 0


if __name__ == '__main__':
    raise SystemExit(notify(os.environ))
