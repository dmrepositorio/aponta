#!/usr/bin/env python3
"""Fecha as issues entregues por PRs que já estão em produção.

Roda no CD, depois do deploy com smoke verde. Para cada PR integrado na main cujo commit está no
histórico do commit publicado (`--sha`), lê a linha `Entrega: #N, #M` do corpo do PR e fecha cada
issue ainda aberta, com um comentário com o PR, o commit e o run. Depois, se a issue tem pai (a SPEC)
e todas as sub-issues do pai já fecharam, fecha o pai também.

Só `Entrega:` fecha issue. `Refs` é referência e nunca fecha. É idempotente: issue já fechada é
pulada, e rodar de novo no mesmo commit não faz nada.

    GH_TOKEN=... python3 scripts/close_delivered_issues.py --sha <commit> [--run-url URL] [--dry-run]
"""
import argparse
import json
import os
import re
import subprocess
import sys

LINE = re.compile(r"^\s*Entrega\s*:\s*(.+)$", re.I | re.M)


class GhError(RuntimeError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Gh:
    """Chama a API do GitHub pela CLI `gh` (já autenticada por GH_TOKEN)."""

    def api(self, path, method="GET", fields=None):
        cmd = ["gh", "api", "-X", method, path]
        for k, v in (fields or {}).items():
            cmd += ["-f", "%s=%s" % (k, v)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            m = re.search(r"HTTP (\d{3})", r.stderr)
            raise GhError(int(m.group(1)) if m else 0, r.stderr.strip()[:300])
        return json.loads(r.stdout) if r.stdout.strip() else None


TOKEN = re.compile(r"(?:https://github\.com/([\w.-]+/[\w.-]+)/issues/|([\w.-]+/[\w.-]+)#|(?<![\w/])#)(\d+)")


def issues_in(body, repo):
    """Números de issue da linha `Entrega:`. Referência a outro repositório é ignorada."""
    found = []
    for line in LINE.findall(body or ""):
        for m in TOKEN.finditer(line):
            other = m.group(1) or m.group(2)
            if other and other.lower() != repo.lower():
                continue
            n = int(m.group(3))
            if n not in found:
                found.append(n)
    return found


def delivered_prs(gh, repo, sha, limit):
    """PRs integrados na main cujo commit de merge está no histórico de `sha`."""
    out = []
    prs = gh.api("repos/%s/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=%d" % (repo, limit)) or []
    for pr in prs:
        mc = pr.get("merge_commit_sha")
        if not pr.get("merged_at") or not mc:
            continue
        status = (gh.api("repos/%s/compare/%s...%s" % (repo, mc, sha)) or {}).get("status")
        if status in ("ahead", "identical"):
            out.append(pr)
    return out


def close(gh, repo, number, comment, dry):
    issue = gh.api("repos/%s/issues/%d" % (repo, number))
    if "pull_request" in issue:
        return "pulado (é um PR)"
    if issue.get("state") == "closed":
        return "já fechada"
    if dry:
        return "fecharia"
    gh.api("repos/%s/issues/%d/comments" % (repo, number), "POST", {"body": comment})
    gh.api("repos/%s/issues/%d" % (repo, number), "PATCH", {"state": "closed", "state_reason": "completed"})
    return "fechada"


def close_parent_if_done(gh, repo, number, comment, dry):
    try:
        parent = gh.api("repos/%s/issues/%d/parent" % (repo, number))
    except GhError as e:
        if e.status == 404:
            return None
        raise
    if not parent or parent.get("state") == "closed":
        return None
    subs = gh.api("repos/%s/issues/%d/sub_issues?per_page=100" % (repo, parent["number"])) or []
    if subs and all(s.get("state") == "closed" or s["number"] == number for s in subs):
        return parent["number"], close(gh, repo, parent["number"], comment, dry)
    return None


def run(gh, repo, sha, run_url, dry, limit=50, out=print):
    failures = 0
    short = sha[:7]
    for pr in delivered_prs(gh, repo, sha, limit):
        for n in issues_in(pr.get("body"), repo):
            where = "Entregue em produção: PR #%d, commit `%s`%s." % (pr["number"], short, ", run " + run_url if run_url else "")
            try:
                res = close(gh, repo, n, where, dry)
                out("PR #%d -> issue #%d: %s" % (pr["number"], n, res))
                parent = close_parent_if_done(gh, repo, n, "Todas as tarefas desta SPEC foram entregues em produção (último commit `%s`)." % short, dry)
                if parent:
                    out("  SPEC #%d: %s (todas as sub-issues fechadas)" % parent)
            except GhError as e:
                failures += 1
                out("PR #%d -> issue #%d: ERRO %s" % (pr["number"], n, e))
    return failures


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sha", required=True, help="commit publicado em produção")
    p.add_argument("--run-url", default="")
    p.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    p.add_argument("--limit", type=int, default=50, help="quantos PRs fechados recentes olhar")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    if not a.repo:
        sys.exit("informe --repo ou GITHUB_REPOSITORY")
    return 1 if run(Gh(), a.repo, a.sha, a.run_url, a.dry_run, a.limit) else 0


if __name__ == "__main__":
    sys.exit(main())
