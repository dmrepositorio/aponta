# Issue Tracker

GitHub Issues em dmrepositorio/aponta, via gh CLI. Configuração do setup preservada: cinco labels canônicas; domínio single-context; PRs não são superfície de triagem.

## Identidade e publicação

Uma entrega tem uma issue GitHub principal e um pai Multica, identificados pela issue GitHub e pelo nome da entrega (DMTE-N); `.delivery/` guarda só o histórico anterior. spec-driven-development publica a SPEC na issue principal existente quando houver; criação nova só quando não existir uma origem canônica. O espelho docs/delivery/specs/DMTE-N.md contém o mesmo corpo, como cópia versionada.

planning-and-task-breakdown publica UMA issue GitHub por ticket aprovado. Cada ticket é sub-issue da SPEC e herda a identidade da entrega; isso substitui a antiga proibição de outras issues técnicas para estes tickets de implementação. As etapas /spec, /plan, /build, /review e /ship são status do pai Multica, sem issue GitHub nem issue Multica por fase ou por ticket. O líder (`/plan`) publica os tickets no planning-and-task-breakdown, como sub-issues GitHub, antes de encerrar o planejamento; a etapa `/build` recebe o próximo ticket elegível, ou vários sequenciais. O briefing lista IDs reais de tickets e dependências; não criar um pai Multica de entrega nem uma issue filha Multica por ticket, nem triá-los novamente.

- Criar/listar/comentar: gh issue create/list/comment -R dmrepositorio/aponta, com título/corpo/labels explícitos. Para textos grandes usar --body-file.
- Ler corpo e comentários: gh issue view <N> -R dmrepositorio/aponta --json number,title,body,comments,labels,state,url.
- Sub-issue: obter database ID com gh api repos/dmrepositorio/aponta/issues/<N> --jq .id; vincular usando gh api --method POST repos/dmrepositorio/aponta/issues/<SPEC>/sub_issues -F sub_issue_id=<DATABASE_ID>. Conferir vínculo por GET do mesmo recurso. Número da issue e database ID são valores distintos.
- Dependências: preferir relações nativas quando disponíveis na versão/API instalada; enquanto indisponíveis, registrar Blocked by com links reais no corpo de CADA ticket, nunca inventar uma relação nativa aplicada. Um ticket só é elegível após todos os bloqueadores satisfazerem a entrega necessária à integração.

## Fechamento e PR

O PR leva `Entrega: #N, #M` (tickets entregues, fecham sozinhos) e `Refs #SPEC` (referência, nunca fecha). Registre a issue principal e as subtarefas de implementação no pai Multica. Na etapa de entrega, confira o repositório, o PR, o SHA e os critérios de cada issue.

O fechamento é do CD: depois do deploy em produção com smoke verde, o job `close-issues` (`scripts/close_delivered_issues.py`) fecha cada issue da linha `Entrega:` dos PRs publicados, com comentário de PR, commit e run, e fecha a SPEC pai quando todas as sub-issues fecharam. Não use `Closes`/`Fixes` (fecham no merge, antes do deploy) e não feche à mão o que o CD fecha. Depois do deploy, confira com `gh issue view N -R dmrepositorio/aponta --json state,stateReason` e registre no card o que fechou. Se uma issue ficou aberta (PR sem a linha `Entrega:`, deploy que falhou ou issue de outro repositório), registre o número e o motivo. Retirada explícita de escopo continua manual: `gh issue close N -R dmrepositorio/aponta --reason "not planned"`, com a decisão registrada. Recusa de entrega: o usuário reabre a issue.

## Triage

Apenas entradas externas brutas; tickets gerados por planning-and-task-breakdown já são ready-for-agent. Categorias, labels, recomendação/confirmação e disclaimer dos comentários seguem docs/agents/triage-labels.md. Não fechar uma issue por wontfix sem a decisão prevista no método. PRs externos não são superfície de triagem por padrão.
