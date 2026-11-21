---
name: aponta-flow
description: Coordenar ou executar o fluxo /spec → /plan → /build → /review → /ship do Squad Agent Skills no Aponta, com papéis, status do workflow Multica e gates de CI.
---

# Fluxo Aponta

Leia [references/engineering-workflow.md](references/engineering-workflow.md) antes de planejar ou executar uma etapa: ele mapeia comando → skill → agente e fixa as regras comuns. As skills usadas estão fixadas em `skills-lock.json`. Gates, estados da entrega e deploy estão em `docs/delivery/WORKFLOW.md` e `docs/delivery/RELEASE.md`.

## Orquestração Multica

Squad Agent Skills, workflow `Agent Skills Flow`: `dm_lider` (`/spec`, `/plan`, `/ship`), `skills_executor` (`/build` + `/test`) e `skills_qa` (`/review`). Cada status do pai acorda o agente da etapa: `todo` → `planejamento` → `desenvolvimento` → `auditoria_qa` → `entrega` → `done`. Rejeição do QA volta a `desenvolvimento`.

No comentário de cada etapa registre: o que foi feito, fontes e decisões, SPEC e tickets, base e SHA, comandos e evidências, pendências e próximo responsável. Teste não executado é declarado. O parecer do QA diz de forma inequívoca se está aprovado, rejeitado ou bloqueado e cita o SHA de 40 caracteres revisado. BLOQUEADO identifica pergunta, responsável e evento de retomada.

Após duas rejeições pela mesma causa, ou dois erros idênticos de ambiente, devolva diagnóstico ao humano. Não crie polling nem contorne o limite nativo de retomadas.

Os gates são o CI (`Typecheck, unit tests, build` e `E2E (Playwright, full stack)`), a revisão do QA no SHA exato, a fila de merge e a aprovação do environment `production`. O usuário coloca o PR na fila; nenhum agente aciona o `CD (Produção)` nem roda deploy à mão. Commit novo que muda código, critérios ou SPEC invalida o parecer. Declare só o estado que a evidência prova (Implementado, Revisado, Apto para integração, Integrado, Publicado em produção); o aceite é do usuário.
