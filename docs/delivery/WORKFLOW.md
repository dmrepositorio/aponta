# Fluxo de entrega Aponta

Fluxo enxuto do Squad DM: `/spec` → `/plan` → `/build` + `/test` → `/review` → `/ship`. GitHub registra produto (issue, PR, CI); o Multica registra a execução, no workflow `Agent Skills Flow`. O mapa comando → skill → agente está em `docs/agents/engineering-workflow.md`; integração e deploy em `docs/delivery/RELEASE.md`.

## Etapas

| Comando | Status Multica | Agente | Saída |
|---|---|---|---|
| `/spec` | `todo` | `dm_triagem` | SPEC com critérios `AC-NN` na issue principal, espelhada em `docs/delivery/specs/DMTE-N.md` |
| `/plan` | `planejamento` | `dm_arquiteto` | tarefas como sub-issues da SPEC, com dependências; divisão aprovada pelo humano |
| `/build` + `/test` | `desenvolvimento` | `dm_developer` | commits por fatia, PR em draft com `Refs`, SHA final |
| `/review` | `auditoria_qa` | `dm_qualidade` | revisão no SHA final, como comentário no PR |
| `/ship` | `entrega` | `dm_entrega` | checks verdes, PR pronto, PR na fila de merge, deploy acompanhado |

Uma entrega tem uma issue GitHub principal e um pai Multica. Cada status acorda o agente da etapa; o resultado vai como comentário no fio. Tickets de implementação são sub-issues da SPEC e herdam a identidade da entrega (`docs/agents/issue-tracker.md`).

## Gates

Só o que prova que o software funciona bloqueia a integração:

1. **CI** (`.github/workflows/ci.yml`): `Typecheck, unit tests, build` e `E2E (Playwright, full stack)`. Rodam no PR, no candidato da fila de merge e na `main`.
2. **Revisão independente do QA**: o `dm_qualidade` revisa o diff exato do SHA final (todos os commits), reproduz os testes e confere contrato, tenant/RBAC e DS. O parecer é um comentário no PR com o resultado (aprovado, rejeitado ou bloqueado) e o SHA revisado. Rejeição devolve o status a `desenvolvimento`; o QA nunca corrige o próprio achado. Commit novo que muda código invalida o parecer.
3. **Fila de merge** (ruleset `main`): monta `main` + PR, re-roda o CI e integra um PR por vez. Quem coloca o PR na fila é o `dm_entrega`, em `/ship`, e só com os gates provados: o PR não está em draft; o parecer do `dm_qualidade` é aprovado para o SHA exato do head, sem commit depois; `Typecheck, unit tests, build` e `E2E (Playwright, full stack)` estão verdes no head; o título começa com `DMTE-N` e o corpo tem `Entrega:` e `Refs`, sem `Closes`/`Fixes`. O comando é `gh pr merge N --squash`, que entra na fila nativa. Nunca `--admin`, bypass, merge fora da fila, nem PR com gate pendente. Se o candidato da fila falhar, o PR sai dela: o `dm_entrega` devolve a `desenvolvimento` com o diagnóstico, e o `dm_lider` destrava se travar.
4. **Aprovação do deploy**: o environment `production` exige revisor (a única decisão que continua sendo do usuário) (`docs/delivery/RELEASE.md`).

Não há manifest, atestado de status nem etapa de staging.

## Regras

- WIP 1 entrega; até dois tickets liberados da mesma entrega podem andar em paralelo, cada um em worktree novo, exclusivo e limpo. Branch curta e PR; retome a branch existente; nunca force push na `main`, nunca reset/stash/limpeza de trabalho alheio.
- Prática de TDD (`test-driven-development`): o teste que descreve o comportamento falha por asserção antes da implementação, e passa depois. Erro de import/setup não é RED: crie um stub importável e neutro primeiro. Registre no PR qual teste falhou e qual comando o provou. Nunca enfraqueça, pule ou apague teste para ficar verde.
- Mudança de comportamento com efeito externo entra atrás de feature flag registrada (`apps/api/src/feature-flags`) com dono, padrão e data de remoção.
- Reuse o DS (`apps/web/src/components/ds`) e os tokens; componente reutilizável novo ou alterado ganha story. Não introduza Carbon nem Next.js.
- No código alterado, o QA verifica autorização no backend, isolamento entre tenants e validação de entrada. Testes usam dados sintéticos e banco de teste; E2E local por `scripts/e2e_isolated.sh`.
- Duas rejeições pela mesma causa, ou dois erros iguais de ambiente, devolvem diagnóstico ao humano em vez de repetir.
- Nunca Docker, `aponta_release.py` ou CD fora do fluxo de `docs/delivery/RELEASE.md`; nunca merge fora da fila; nunca credenciais em logs ou fixtures.

## Estados da entrega

Declare só o estado que a evidência prova.

| Estado | Evidência |
|---|---|
| **Implementado** | commits na branch, teste que falhou e passou, PR em draft com `Refs` |
| **Revisado** | comentário do QA no SHA final com resultado aprovado |
| **Apto para integração** | `Typecheck, unit tests, build` e `E2E` verdes no head do PR, sem commit depois da revisão |
| **Integrado** | commit de merge na `main` e CI do push verde |
| **Publicado em produção** | run `CD (Produção)` aprovado e concluído; `/api/version` e `/version.json` devolvem o commit |

Aceite é um sexto fato, declarado só pelo usuário, depois de Publicado: a issue fecha sozinha ao publicar, e ele a reabre se recusar a entrega. Funcionalidade atrás de flag desligada está publicada, mas não exposta.

### Quando a evidência perde a validade

- **Revisão do QA**: vale para um SHA. Commit novo que muda código, critérios ou SPEC exige nova revisão; commit que só mexe em documentação mantém o parecer.
- **Checks do PR**: valem para o head; qualquer push os refaz.
- **Validação da combinação**: vale para o candidato da fila; a `main` andar cria outro candidato.
- **Publicação**: vale até o próximo deploy. O que está no ar se lê em `/api/version`, não em relatório.

## Fechamento

O PR leva a linha `Entrega: #N, #M` com os tickets que entrega e `Refs #SPEC` para a SPEC pai. Nenhum fecha no merge. Depois que o deploy em produção termina com o smoke verde, o job `close-issues` do CD fecha os tickets citados nos PRs publicados, com um comentário com o PR, o commit e o run, e fecha a SPEC pai quando todas as sub-issues dela estiverem fechadas. `Refs` nunca fecha, e `Closes`/`Fixes` não se usam (fechariam antes do deploy). Issue fechada quer dizer publicada em produção; se o usuário recusar a entrega, ele reabre a issue. No card em `entrega`, o agente registra o pedido, o que foi entregue, o PR, o SHA e como conferir, e depois do deploy confere que as issues fecharam. Não fecha à mão o que o CD fecha. A sequência está em [Issue Tracker](../agents/issue-tracker.md#fechamento-e-pr).

## Medição

Medir por entrega: tempo até produção, espera, aprovação de primeira revisão, rodadas, falhas de ambiente, custo e tokens por agente. É piloto, não promessa de capacidade.
