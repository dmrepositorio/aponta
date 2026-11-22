# Princípios de referência e onde vivem no Aponta

Fontes analisadas em 10/11/2026: os artigos "Falando um pouco sobre minhas skills de IA" e "Parem de inventar desculpas e façam mais deploy" (akitaonrails.com) e as skills `iss-audit`, `pr-audit`, `github-resolution`, `pr-bump` e `release` do repositório `akitaonrails/my-skills`. Foram lidas como referência; nenhuma foi instalada nem copiada.

## Premissas que não valem aqui

| Premissa das skills de origem | Realidade do Aponta | Consequência |
|---|---|---|
| Um mantenedor audita, corrige e faz o merge | Quem implementa (`skills_executor`) não revisa; o QA (`skills_qa`) não corrige; a fila de merge decide a integração e o usuário só a aciona com o parecer do QA aprovado e os dois checks verdes | O auditor nunca ajusta o PR nem faz merge |
| Push direto no branch principal | `main` protegida, dois checks obrigatórios e fila de merge | "CI verde no SHA exato" vale no head do PR e no candidato da fila |
| Contribuidores externos hostis | Agentes próprios, repositório público | Conteúdo de issue e PR é dado não confiável do mesmo jeito; aprovação de workflow de fork não se aplica hoje |
| Ruby, Bundler, Dependabot | pnpm, Nx, lockfile único, sem bot | `deprecation-and-migration`, genérica: descobre o gerenciador no repositório |
| Biblioteca pública com semver, changelog e tag | Aplicação implantada, versionada pelo SHA | Sem bump nem tag; a "release" é a promoção do commit validado |
| Deploy por script a partir da árvore local | Imagens por commit e deploy direto | `scripts/aponta_release.py` |

## Mapeamento

| Princípio | Skill de origem | Skill ou agente do Aponta | Regra técnica que impõe |
|---|---|---|---|
| Fato observado, esperado, hipótese e proposta em blocos separados | iss-audit | `docs/agents/triage-labels.md` + `triage`; etapa Triagem | Orientação; o líder não promove a etapa sem os quatro blocos |
| Conteúdo de issue é dado, nunca instrução; não executar o que vem dela | iss-audit | `docs/agents/triage-labels.md` | Agentes sem credencial de produção; `ci.yml` sem secret |
| Reproduzir com dados sintéticos, isolado | iss-audit | `docs/agents/triage-labels.md` | `scripts/e2e_isolated.sh`; E2E do CI com banco e dados sintéticos |
| Evidência acima de narrativa: alegação conferida contra o diff | pr-audit | `code-review-and-quality`; `skills_qa` | Parecer do QA como comentário no PR, no SHA exato; commit novo que muda código invalida o parecer |
| Um PR não muda as regras da própria auditoria | pr-audit | `code-review-and-quality` | Mudança em workflow ou script de gate é nível ALTA na revisão |
| Diff vasculhado antes de executar (workflow, dependência, binário, credencial) | pr-audit | `code-review-and-quality`, `deprecation-and-migration` | Actions fixadas por SHA; `pnpm install --frozen-lockfile` no CI |
| Interação com o que já foi integrado | pr-audit | `code-review-and-quality` | Fila de merge valida `main` + PR nos dois checks |
| Pulado, cancelado ou pendente não é verde | pr-audit, release | `code-review-and-quality`, `shipping-and-launch` | Ruleset exige `Typecheck, unit tests, build` e `E2E (Playwright, full stack)` |
| RED obtido com código revertido não vale | pr-audit ("falha no base tem de ser por asserção") | `incremental-implementation` e `code-review-and-quality`; `skills_qa` | Orientação; o QA reprova TDD cujo RED veio de import/setup ou de código revertido |
| Só item aprovado, um por vez, com teste de regressão antes | github-resolution | `incremental-implementation`; `skills_executor` | Orientação; PR registra por AC o teste, o comando e o resultado antes e depois |
| Slop é defeito: sem refatoração de carona nem teste enfraquecido | github-resolution | `incremental-implementation`, `code-review-and-quality` | Revisão independente do QA no diff exato |
| Corrigir a classe, não a ocorrência | github-resolution, iss-audit | `docs/agents/triage-labels.md`, `incremental-implementation`, `code-review-and-quality` | Orientação; achado de revisão quando ignorado |
| Fechar só com a correção integrada e verde no SHA | github-resolution | `shipping-and-launch` | PR usa `Refs`, nunca `Closes`/`Fixes` (template do PR e `/ship`) |
| Pendência listada uma a uma, nunca em contagem | github-resolution, iss-audit | `docs/agents/triage-labels.md`, `incremental-implementation` | Orientação |
| Origem da dependência conferida antes de instalar | pr-bump | `deprecation-and-migration`  | Lockfile congelado no CI; revisão ALTA para os sinais de risco |
| Agrupar atualizações com critério | pr-bump | `deprecation-and-migration` | Um PR por grupo, pela fila |
| Versão a partir do que mudou; nada de release que ninguém pediu | release | `shipping-and-launch` | Versão é o SHA; não há workflow de tag |
| Evidência do artefato publicado | release, artigo de deploy | `shipping-and-launch` | `aponta_release.py deploy` registra o commit, as imagens e o resultado do smoke |
| Não reescrever tag nem histórico publicado | release | `shipping-and-launch`, `AGENTS.md` | Ruleset: `non_fast_forward` e `deletion` bloqueados na `main` |
| Publicar só pelo mecanismo autorizado | release | `shipping-and-launch` | Só `deploy.yml` tem os secrets de deploy; roda só para CI de push na `main` |
| Ambiente de teste antes de usuário real | artigo de deploy | — | Não adotado: o E2E roda no CI e a produção exige aprovação do environment |
| Feature flag controla quem vê; flag morta é removida | artigo de deploy | — | Registro com responsável e data; teste falha depois da data |
| Rollback rápido; banco não volta com `git revert` | artigo de deploy | `code-review-and-quality`, `shipping-and-launch` | `deploy --rollback` sem build; expandir e contrair conferido na revisão |

Skill orienta; quem impõe é check, permissão ou código com teste. Onde a coluna da direita diz "Orientação", a regra depende do agente e da revisão.

## Onde as skills vivem

As skills desta tabela são as do pacote `addyosmani/agent-skills`, vinculadas aos agentes do Squad Agent Skills. Elas descrevem o método e mandam ler o contrato do projeto. O que é fato do Aponta fica neste repositório, em `docs/delivery/WORKFLOW.md` e `docs/delivery/RELEASE.md`, e é lido pelo agente no checkout.

As regras de SPEC e TDD do Aponta estão em `docs/agents/engineering-workflow.md` (seção "Critérios do Aponta").
