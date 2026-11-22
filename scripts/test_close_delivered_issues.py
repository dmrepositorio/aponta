"""Testes do close_delivered_issues.py com uma API do GitHub falsa."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import close_delivered_issues as cd  # noqa: E402

REPO = "o/r"
SHA = "f" * 40


class FakeGh:
    def __init__(self, prs, issues, parents=None, subs=None, compare=None):
        self.prs, self.issues = prs, issues
        self.parents, self.subs = parents or {}, subs or {}
        self.compare = compare or {}
        self.writes = []

    def api(self, path, method="GET", fields=None):
        if method != "GET":
            self.writes.append((method, path, fields))
            if method == "PATCH":
                n = int(path.rsplit("/", 1)[1])
                self.issues[n]["state"] = "closed"
            return {}
        if "/pulls?" in path:
            return self.prs
        if "/compare/" in path:
            mc = path.split("/compare/")[1].split("...")[0]
            return {"status": self.compare.get(mc, "diverged")}
        if path.endswith("/parent"):
            n = int(path.split("/")[-2])
            if n not in self.parents:
                raise cd.GhError(404, "Not Found")
            return self.issues[self.parents[n]]
        if "/sub_issues" in path:
            n = int(path.split("/issues/")[1].split("/")[0])
            return [self.issues[i] for i in self.subs[n]]
        n = int(path.rsplit("/", 1)[1])
        if n not in self.issues:
            raise cd.GhError(500, "erro de API")
        return self.issues[n]


def pr(number, body, mc, merged=True):
    return {"number": number, "body": body, "merge_commit_sha": mc, "merged_at": "2026-11-20T00:00:00Z" if merged else None}


def issue(number, state="open", is_pr=False):
    d = {"number": number, "state": state}
    if is_pr:
        d["pull_request"] = {}
    return d


class IssuesInTests(unittest.TestCase):
    def test_le_so_a_linha_entrega_e_ignora_refs_e_closes(self):
        body = "Refs #310\nCloses #5\nEntrega: #324, o/r#325 e https://github.com/o/r/issues/326"
        self.assertEqual(cd.issues_in(body, REPO), [324, 325, 326])

    def test_ignora_outro_repositorio_e_repetidos(self):
        self.assertEqual(cd.issues_in("Entrega: x/y#9 #4 #4", REPO), [4])

    def test_sem_linha_nao_fecha_nada(self):
        self.assertEqual(cd.issues_in("Refs #1", REPO), [])
        self.assertEqual(cd.issues_in(None, REPO), [])


class RunTests(unittest.TestCase):
    def run_it(self, gh, dry=False):
        lines = []
        failures = cd.run(gh, REPO, SHA, "https://run", dry, out=lines.append)
        return failures, lines

    def test_fecha_o_ticket_do_pr_que_esta_em_producao_com_comentario(self):
        gh = FakeGh([pr(1, "Entrega: #10", "m1")], {10: issue(10)}, compare={"m1": "ahead"})
        failures, _ = self.run_it(gh)
        self.assertEqual(failures, 0)
        self.assertEqual(gh.issues[10]["state"], "closed")
        comment = [w for w in gh.writes if w[0] == "POST"][0]
        self.assertIn(SHA[:7], comment[2]["body"])
        self.assertIn("https://run", comment[2]["body"])
        patch = [w for w in gh.writes if w[0] == "PATCH"][0]
        self.assertEqual(patch[2]["state_reason"], "completed")

    def test_pr_fora_do_historico_publicado_nao_fecha(self):
        gh = FakeGh([pr(1, "Entrega: #10", "m1")], {10: issue(10)}, compare={"m1": "diverged"})
        self.run_it(gh)
        self.assertEqual(gh.writes, [])

    def test_pr_nao_integrado_ou_sem_commit_e_ignorado(self):
        gh = FakeGh([pr(1, "Entrega: #10", "m1", merged=False), pr(2, "Entrega: #10", None)], {10: issue(10)})
        self.run_it(gh)
        self.assertEqual(gh.writes, [])

    def test_idempotente_issue_ja_fechada_e_pr_nao_sao_tocados(self):
        gh = FakeGh([pr(1, "Entrega: #10, #11", "m1")], {10: issue(10, "closed"), 11: issue(11, is_pr=True)}, compare={"m1": "identical"})
        self.run_it(gh)
        self.assertEqual(gh.writes, [])

    def test_dry_run_nao_escreve(self):
        gh = FakeGh([pr(1, "Entrega: #10", "m1")], {10: issue(10)}, compare={"m1": "ahead"})
        _, lines = self.run_it(gh, dry=True)
        self.assertEqual(gh.writes, [])
        self.assertTrue(any("fecharia" in line for line in lines))

    def test_refs_nunca_fecha(self):
        gh = FakeGh([pr(1, "Refs #10\nCloses #10", "m1")], {10: issue(10)}, compare={"m1": "ahead"})
        self.run_it(gh)
        self.assertEqual(gh.writes, [])

    def test_spec_pai_fecha_quando_todas_as_sub_issues_fecharam(self):
        issues = {10: issue(10), 11: issue(11, "closed"), 310: issue(310)}
        gh = FakeGh([pr(1, "Entrega: #10", "m1")], issues, parents={10: 310}, subs={310: [10, 11]}, compare={"m1": "ahead"})
        self.run_it(gh)
        self.assertEqual(issues[310]["state"], "closed")

    def test_spec_pai_fica_aberta_se_sobra_sub_issue(self):
        issues = {10: issue(10), 11: issue(11), 310: issue(310)}
        gh = FakeGh([pr(1, "Entrega: #10", "m1")], issues, parents={10: 310}, subs={310: [10, 11]}, compare={"m1": "ahead"})
        self.run_it(gh)
        self.assertEqual(issues[310]["state"], "open")
        self.assertEqual(issues[10]["state"], "closed")

    def test_erro_de_api_conta_como_falha_e_segue_para_a_proxima(self):
        gh = FakeGh([pr(1, "Entrega: #99, #10", "m1")], {10: issue(10)}, compare={"m1": "ahead"})
        failures, lines = self.run_it(gh)
        self.assertEqual(failures, 1)
        self.assertEqual(gh.issues[10]["state"], "closed")
        self.assertTrue(any("ERRO" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
