# Issue Tracker

GitHub Issues em alfredo-maia/aponta, via gh CLI. Configuração do setup preservada: cinco labels canônicas; domínio single-context; PRs não são superfície de triagem.

## Identidade e publicação

Uma entrega tem uma issue GitHub principal e um pai Multica em .delivery/registry.json. spec-driven-development publica a SPEC na issue principal existente quando houver; criação nova só quando não existir uma origem canônica. O espelho docs/delivery/specs/DMTE-N.md contém o mesmo corpo, como cópia versionada.

planning-and-task-breakdown publica UMA issue GitHub por ticket aprovado. Cada ticket é sub-issue da SPEC e herda a identidade da entrega; isso substitui a antiga proibição de outras issues técnicas para estes tickets de implementação. As etapas /spec, /plan, /build, /review e /ship são status do pai Multica, sem issue GitHub nem issue Multica por fase ou por ticket. O líder (`/plan`) publica os tickets no planning-and-task-breakdown, como sub-issues GitHub, antes de encerrar o planejamento; a etapa `/build` recebe o próximo ticket elegível, ou vários sequenciais. O briefing lista IDs reais de tickets e dependências; não criar um pai Multica de entrega nem uma issue filha Multica por ticket, nem triá-los novamente.

- Criar/listar/comentar: gh issue create/list/comment -R alfredo-maia/aponta, com título/corpo/labels explícitos. Para textos grandes usar --body-file.
- Ler corpo e comentários: gh issue view <N> -R alfredo-maia/aponta --json number,title,body,comments,labels,state,url.
- Sub-issue: obter database ID com gh api repos/alfredo-maia/aponta/issues/<N> --jq .id; vincular usando gh api --method POST repos/alfredo-maia/aponta/issues/<SPEC>/sub_issues -F sub_issue_id=<DATABASE_ID>. Conferir vínculo por GET do mesmo recurso. Número da issue e database ID são valores distintos.
- Dependências: preferir relações nativas quando disponíveis na versão/API instalada; enquanto indisponíveis, registrar Blocked by com links reais no corpo de CADA ticket, nunca inventar uma relação nativa aplicada. Um ticket só é elegível após todos os bloqueadores satisfazerem a entrega necessária à integração.

## Fechamento e PR

Este tracker NÃO fecha trabalho automaticamente por PR. Manter Aponta-Delivery: DMTE-N e Refs alfredo-maia/aponta#N; usar Refs também nos tickets. Não usar Closes/Fixes. incremental-implementation abre o draft PR após a primeira fatia integrada e o torna pronto após a revisão; QA e Delivery continuam verificações adicionais. Implementado, integrado, publicado e aceito são estados distintos. Delivery fecha produto/tickets por gh issue close apenas após entrega comprovada/aceite aplicável; o Tech Lead consolida o pai Multica. Cancelamentos e exclusões explícitos do usuário prevalecem.

## Triage

Apenas entradas externas brutas; tickets gerados por planning-and-task-breakdown já são ready-for-agent. Categorias, labels, recomendação/confirmação e disclaimer dos comentários seguem docs/agents/triage-labels.md. Não fechar uma issue por wontfix sem a decisão prevista no método. PRs externos não são superfície de triagem por padrão.
