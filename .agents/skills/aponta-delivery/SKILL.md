---
name: aponta-delivery
description: Verificar e registrar a entrega do Aponta por estado (integrado, publicado em produção), com a evidência do commit e do deploy de cada um.
---

# Entrega verificável

Receba o SHA revisado pelo QA, o PR e o CI, e confirme que todos se referem ao mesmo commit. Consulte `docs/delivery/WORKFLOW.md` e `docs/delivery/RELEASE.md`.

Integrado e publicado em produção são fatos diferentes, cada um com a sua evidência; nunca declare um pelo outro.

- **Integrado**: o commit de merge está na `main` e o CI de push dele passou. Evidência: SHA do merge e o run do CI.
- **Publicado em produção**: o run de `CD (Produção)` do commit foi aprovado e concluído com sucesso, o registro `~/deploy/aponta/records/<SHA>.json` na VPS tem `production.result = passed`, e `GET /api/version` e `/version.json` em produção devolvem aquele commit. Evidência: o run, o registro e a resposta das duas URLs.

Quem publica é o workflow `CD (Produção)`, disparado pelo CI da `main`, depois da aprovação do environment `production`. Agente nunca o aciona, nunca roda `aponta_release.py` nem Docker contra produção. O workflow publica a ponta da `main`; se outro commit foi implantado por cima, o que está no ar é o que `/api/version` devolve.

Deploy que falhou não é publicação parcial: a produção segue na versão anterior, a menos que o smoke tenha falhado depois da troca. Nesse caso informe ao usuário, com o resultado do run, e não tente rollback sem pedido explícito (`docs/delivery/RELEASE.md`, Recuperação).

Funcionalidade atrás de feature flag desligada está publicada, mas não exposta; diga o estado da flag. Para mudança só de documentação, registre que a publicação não altera o comportamento. O aceite é do usuário, depois de Publicado.
