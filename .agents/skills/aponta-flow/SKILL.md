---
name: aponta-flow
description: Coordenar ou executar o fluxo /spec → /plan → /build → /review → /ship do Squad Agent Skills no Aponta, com papéis, status do workflow Multica e evidências do projeto.
---

# Fluxo Aponta

Leia [references/engineering-workflow.md](references/engineering-workflow.md) antes de planejar ou executar uma etapa: ele mapeia comando → skill → agente e fixa as regras comuns. As skills usadas estão fixadas em `skills-lock.json`.

## Orquestração Multica

Squad Agent Skills, workflow `Agent Skills Flow`: `skills_lider` (`/spec`, `/plan`, `/ship`), `skills_executor` (`/build` + `/test`) e `skills_qa` (`/review`). Cada status do pai acorda o agente da etapa: `todo` → `planejamento` → `desenvolvimento` → `auditoria_qa` → `entrega` → `done`. Rejeição volta a `desenvolvimento`. Detalhes de gates, estados da entrega e CD em `docs/delivery/WORKFLOW.md`.

O ciclo é automático: `python3 scripts/aponta_delivery.py init` grava o ciclo vigente no manifest da entrega, sem perguntar ao humano e sem bloquear etapa por isso. `.delivery/registry.json` não é editado por PR.

No comentário de cada etapa registre: o que foi feito, fontes e decisões, SPEC e tickets, base e SHA, comandos e evidências, pendências e próximo responsável. Teste não executado é declarado. Só o parecer do QA exige a linha `RESULTADO=APROVADO|REJEITADO|BLOQUEADO` com `SHA=` de 40 caracteres, uma por comentário. BLOQUEADO identifica pergunta, responsável e evento de retomada.

Após duas rejeições pela mesma causa, ou dois erros idênticos de ambiente, devolva diagnóstico ao humano. Não crie polling nem contorne o limite nativo de retomadas.

Independent QA é publicado somente por `scripts/publicar_qa.py` do checkout, com delivery e SHA40; nunca crie status manual. Commit novo que muda código, critérios ou SPEC exige nova revisão. O usuário coloca o PR na merge queue (gate); nenhum agente aciona o `CD (Produção)` nem roda deploy à mão. A entrega passa por seis estados com evidência própria (Implementado, Revisado, Apto para integração, Integrado, Validado em staging, Publicado em produção); declare só o que a evidência prova. Aceite é do usuário.
