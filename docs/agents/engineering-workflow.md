# Fluxo de engenharia: Squad DM

O método de trabalho é o pacote `addyosmani/agent-skills`, instalado em `.agents/skills/` e fixado em `skills-lock.json` (fonte, revisão e hash de cada skill). No Claude Code, o plugin upstream fornece os comandos de especificação, planejamento, implementação, testes, revisão e entrega. No Multica, o status aciona o agente e as skills vinculadas. O clone do projeto contém o catálogo em `.agents/skills/`; os seis arquivos de comandos do Claude pertencem ao plugin. A entrega segue as permissões e o processo deste repositório. As regras do Aponta (SPEC e TDD) estão na seção "Critérios do Aponta" abaixo; não substituem o método. Para atualizar o pacote: `npx skills update` e revisar o diff do lock.

## Comando → skill → agente

| Comando | Status Multica | Agente | Skills |
|---|---|---|---|
| `/spec` | `todo` | `dm_triagem` | `interview-me`, `spec-driven-development`, `documentation-and-adrs` |
| `/plan` | `planejamento` | `dm_arquiteto` | `planning-and-task-breakdown`, `api-and-interface-design` |
| `/build` + `/test` | `desenvolvimento` | `dm_developer` | `incremental-implementation`, `test-driven-development`, `debugging-and-error-recovery`, `frontend-ui-engineering` |
| `/review` | `auditoria_qa` | `dm_qualidade` | `code-review-and-quality`, `security-and-hardening`, `accessibility-engineering` |
| `/ship` | `entrega` | `dm_entrega` | `shipping-and-launch`, `git-workflow-and-versioning` |

Transversais: `using-agent-skills`, `context-engineering`, `source-driven-development`, `performance-optimization`, `code-simplification`, `constraint-driven-development`, `doubt-driven-development`, `deprecation-and-migration`, `observability-and-instrumentation`, `browser-testing-with-devtools`, `ci-cd-and-automation`, `idea-refine`.

## Fluxo

**`/spec`** — O `dm_triagem` confirma checkout e base e classifica a entrada bruta com `docs/agents/triage-labels.md`. `interview-me` pergunta por rodadas até a intenção real; decisão já confirmada é referenciada, sem repetir o questionário. A SPEC (formato de `spec-driven-development`, mais as seções de "Critérios do Aponta": ACs numerados, tenant/RBAC, contratos, riscos, matriz AC → teste) é publicada na issue principal e espelhada em `docs/delivery/specs/DMTE-N.md`; contradição se reconcilia na mesma SPEC. Termos vão para `GLOSSARY.md` e decisões para ADRs só quando apropriado (`documentation-and-adrs`).

**`/plan`** — `planning-and-task-breakdown` divide em tarefas finas, ordenadas e com dependências; cada uma vira sub-issue da SPEC (`Blocked by` como fallback). O humano aprova a divisão antes da publicação. Funcionalidade nova ou grande refatoração sempre passa por `/spec` e `/plan` completos, qualquer que seja o Tier; bug pequeno com critérios confirmados pode usar os critérios da issue.

**`/build` + `/test`** — O `dm_developer` trabalha um ticket por vez, em contexto novo, só com bloqueadores concluídos. `incremental-implementation`: fatias finas, um commit por fatia. `test-driven-development` com os critérios de TDD do Aponta: o teste que descreve o comportamento falha por asserção antes da implementação e passa depois; o PR registra qual teste falhou primeiro e o comando que provou. Bug difícil usa `debugging-and-error-recovery` antes de editar. WIP 1 entrega; até dois tickets liberados da mesma entrega podem andar em paralelo, cada um em worktree novo, exclusivo e limpo. Integração é branch de trabalho, nunca `main`. O PR abre em draft com `Refs`; a entrega ao QA é o SHA final de 40 caracteres.

**`/review`** — O QA é independente: revisa o diff exato de todos os commits (`code-review-and-quality`, `security-and-hardening`), reproduz os testes, audita o TDD e confere contrato, tenant e DS. O parecer é um comentário no PR, com resultado inequívoco (aprovado, rejeitado ou bloqueado) e o SHA revisado. Rejeitado: volta a `desenvolvimento`, uma única vez por entrega (a segunda rejeição vai ao humano); o QA nunca corrige o próprio achado. Commit novo que muda código, critérios ou SPEC invalida o parecer.

**`/ship`** — O `dm_entrega` confere os checks do CI no head exato e o parecer do QA no mesmo SHA e declara só o estado que a evidência prova (Implementado, Revisado, Apto para integração, Integrado, Publicado em produção; ver `docs/delivery/WORKFLOW.md`). Com os gates provados (parecer aprovado no SHA exato, os dois checks verdes no head, PR pronto, título `DMTE-N`, `Entrega:` e `Refs`), o `dm_entrega` coloca o PR na fila de merge com `gh pr merge N --squash` (nunca `--admin` nem bypass) e acompanha a fila até integrar; o deploy em produção sobe sozinho depois da fila, sem aprovação manual, e o `dm_entrega` o acompanha. O PR leva `Entrega: #N` (tickets) e `Refs #SPEC`; as issues fecham sozinhas depois do deploy em produção (job `close-issues` do CD), nunca por `Closes`/`Fixes` no merge. Depois do deploy, o `dm_entrega` confere o fechamento.

## Regras comuns

- Cada status acorda o agente da etapa; o resultado vai como comentário no fio da issue, com fontes e decisões, SHA, comandos, pendências e próximo responsável. Fonte humana ausente bloqueia só a ação dependente; silêncio nunca vale como aprovação.
- Devolução a `desenvolvimento` (rejeição do QA ou falha do candidato na fila): no máximo 1 vez por entrega. A segunda não volta ao agente: o `dm_qualidade` ou o `dm_entrega` registra o diagnóstico, move para `blocked` e pede a decisão do humano no card, para não gastar tokens em ciclos repetidos. Dois erros iguais de ambiente continuam indo ao `dm_lider`.
- Nunca Docker, CD ou `aponta_release.py` contra produção; nunca merge fora da fila; nunca credenciais em logs ou fixtures.
- Perda de contexto entre sessões é declarada, nunca tratada como continuidade comprovada.

## UI, memória e passagem

UI UX Pro Max pesquisa padrões; Frontend Design e `frontend-ui-engineering` propõem direção; Impeccable audita e refina; Web Design Guidelines e `accessibility-engineering` revisam regras técnicas. Use DS, tokens e Storybook existentes. Validação comportamental, baseline aprovada e aceite visual humano são evidências distintas; screenshot ou build verde não substituem decisão humana.

O Multica registra atividade, status e evidência; o ai-memory guarda conhecimento (workspace=default/project=alfredo-maia-aponta, quando confirmado). A passagem normal é o resultado técnico no fio da issue; para troca de sessão, um resumo portátil com pointers às fontes e segredos redigidos.

## Critérios do Aponta

**SPEC.** Acrescente ao formato de `spec-driven-development`, na mesma SPEC: ACs numerados (`AC-01`…), perfis/tenant/RBAC, contratos reais, riscos e migração quando couber, e a matriz AC → teste/verificação → evidência esperada. Para UI, componente/story e referência visual confirmados; o DS, os tokens e o Storybook existentes são contexto obrigatório. A SPEC publicada na issue do GitHub é canônica; `docs/delivery/specs/DMTE-N.md` espelha o corpo dela e as duas se atualizam juntas. Critério aberto volta ao humano e bloqueia só a ação dependente. Não invente benchmark nem exponha credenciais. Consulte `docs/architecture/01-rbac-and-workflows.md` e `03-sankhya-ds-parity.md`.

**TDD.** Para mudança de comportamento, o teste que descreve o comportamento falha por asserção antes da implementação e passa depois. Erro de sintaxe, import, dependência ou setup não é RED: se o módulo não existe, crie só um stub importável e neutro, confirme que o runner executou o teste e que ele falhou na asserção, e só então conte o RED. Nunca fabrique RED removendo código pronto. Implemente o mínimo para o GREEN, com o mesmo teste. Use Jest/Nest no backend, Vitest/Testing Library no front e Playwright para jornadas. Bug reproduzível ganha teste de regressão antes da correção, e a correção cobre a classe do defeito. Implemente o item aprovado e nada além: sem refatoração de carona, abstração futura, código morto ou TODO. Teste existente não se enfraquece, pula ou apaga para chegar ao GREEN. O PR registra, por AC, o arquivo/teste, o comando e o resultado antes e depois, com o SHA final. O QA confere isso; sem evidência comportamental, o resultado é `TDD não comprovado`. Documentação e mudança puramente mecânica podem declarar `TDD não aplicável`.

## Limite da implantação

Configurar agentes e verificar bundles (`scripts/check_engineering_skills.py`) não comprova uma entrevista, implementação ou revisão real. A primeira demanda autorizada precisa exercitar o fluxo e registrar decisões e evidências. O CI verifica os contratos configurados, não a qualidade do alinhamento.
