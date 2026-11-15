# Tickets: paleta semântica de status e prioridade e fundo dos cartões do Kanban

Identidade: DMTE-525, issue dmrepositorio/aponta#257, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1dff7-5c38-78ae-a423-e3ef84d37565`. Origem: auditoria DMTE-517 (itens 1 e 2), aprovada por Alfredo, que pediu corrigir na ordem sugerida (itens 1 e 2 juntos).

## Situação atual (código observado)

- `apps/web/src/components/tickets/TicketCard.tsx` mapeia status e prioridade para o mesmo conjunto de variantes de `EzTag`. Resultado: `Média` e `Aberto` (`ocean`), `Alta`, `Em Andamento` e `Aguardando Cliente` (`yellow`), `Crítica` e `Escalonado` (`red`) e `Baixa` e `Fechado` (`gray`) têm o mesmo estilo; Aguardando Terceiros, Sankhya e Aprovação são `petroleum`. `Aberto` (`ocean`, verde da marca) e `Resolvido` (`green`) são verdes próximos.
- `TicketKanbanCard.tsx` pinta o fundo do cartão pela prioridade (`priorityCardClasses`, DMTE-461): Baixa fica `petroleum-100` (#c8ccd3), o fundo mais pesado do quadro; Média fica quase branco. A tag `Aguardando Aprovação` (`petroleum-100`) some no cartão Baixa (1,00:1), o texto `brand-700` da tag `Aberto` fica a 3,08:1 e o chip de SLA vencido (`red-100`) some no cartão Crítico.
- `TicketShortcuts.tsx` usa `bg-red-600` no contador de Autorizações; `TicketKanban.tsx` usa `text-red-600` em "Limpar ordenação". O vermelho passa a significar vencido, crítico e escalado e mais quatro coisas.
- A prioridade só aparece no cartão pela cor do fundo (a tag do cartão é o status, salvo `tagField="priority"`).
- `EzTag` fica como está (`ds/EzTag.tsx`): já tem `variant="outline"` e `leftIcon`.

## Decisões (proposta do planejamento dentro do pedido aprovado; o "ou" da auditoria resolvido)

A auditoria aprovada deu duas saídas para o cartão (borda esquerda de 3 a 4 px "ou o glifo do item 1"). Escolhido o **glifo**: uma borda lateral grossa é o padrão "cartão com faixa colorida" que o guia de design recusa, e o glifo já resolve o item 1.

1. **Prioridade é um eixo próprio, com glifo de barras** (1 a 4 barras ascendentes, nível LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4; barras não preenchidas em `gray-200`). Baixa e Média: pílula `outline` neutra, barras `gray-400`. Alta: pílula `yellow` (`yellow-100`/`yellow-800`), barras `yellow-800`. Crítica: pílula `red`, barras `red-600`. Só Alta e Crítica têm cor forte.
2. **Status é neutro, com um ponto por família**: pílula `outline` (`gray-700` sobre transparente) e um ponto à esquerda. Famílias: Aberto = anel `petroleum-500`; Em Andamento = ponto cheio `brand-600`; Aguardando Cliente, Terceiros, Sankhya e Aprovação = ponto cheio `yellow-800` (mesma família; o rótulo distingue); Escalonado = ponto cheio `red-600`, texto `red-800` e borda `red-300`; Resolvido = ícone de check `green-600` (o `green` do DS fica para sucesso e não colide com o `brand` de Em Andamento por forma e cor); Fechado = ponto cheio `gray-400`.
3. **Vermelho só em vencido, crítico e escalado.** O contador de Autorizações passa a `yellow-100`/`yellow-800` (item pendente de ação, mesma família de "aguardando"). "Limpar ordenação" passa a texto neutro (`gray-700`, hover `brand-700`), como os botões vizinhos. Ações destrutivas ("Remover", exclusão) e mensagens de erro (por exemplo o ícone "Erro ao vincular" do ticket pai) continuam vermelhas: fora do escopo e fora da regra, que fala de significado de estado do ticket.
4. **Cartão do Kanban sempre `bg-white`**, borda `gray-200`, sem tinta por prioridade. A prioridade aparece pelo glifo ao lado do número do protocolo, com nome acessível ("Prioridade Alta"); quando `tagField="priority"` a pílula de prioridade já está no cartão e o glifo isolado não é repetido. Tags e chips de SLA assentam em branco.
5. **Dois componentes de domínio** em `apps/web/src/components/tickets/TicketTags.tsx`: `TicketStatusTag({ status })` e `TicketPriorityTag({ priority })`, sobre `EzTag`. Substituem `statusTagVariants`/`priorityTagVariants` em todos os pontos de uso (Lista, Kanban, Detalhe, Formulário, Ticket pai/subtickets, busca de ticket da agenda). `TicketPriorityGlyph({ priority })` é exportado para o cartão. `statusLabels` e `priorityLabels` ficam em `TicketCard.tsx`.
6. Sem API, schema, regra de negócio ou componente de DS novo. Só tokens que o `@theme` já define (ADR 0001, `scripts/check_tickets_palette.py`). A mudança vale para Lista, Kanban, Detalhe e atalhos.

Tensão registrada: a DMTE-461 (#164, pedido anterior do próprio usuário) pediu o cartão colorido pela prioridade. Esta entrega o substitui conforme a auditoria aprovada; a urgência continua visível no glifo e na pílula de Alta e Crítica.

## Acceptance criteria

- AC-01: nenhum par (status, prioridade) renderiza a mesma tag: o conjunto de classes e o ícone de `TicketStatusTag` de cada status diferem dos de `TicketPriorityTag` de cada prioridade; e status de famílias diferentes têm ícone ou cor de ponto diferentes (os quatro "aguardando" compartilham a família).
- AC-02: Média/Aberto, Alta/Em Andamento, Crítica/Escalonado e Baixa/Fechado (os pares que hoje coincidem) ficam distintos, e Escalonado é o único status com texto/borda vermelhos.
- AC-03: todo par texto/fundo das tags de status e de prioridade e do contador de Autorizações tem contraste mínimo de 4,5:1 (tokens lidos de `styles.css`), inclusive sobre o fundo real do cartão (`gray-70`/branco), e os glifos (ponto, anel, check, barras) têm no mínimo 3:1 contra o branco (`yellow-700` ficava em 2,97:1, por isso o âmbar dos glifos é `yellow-800`).
- AC-04: `TicketKanbanCard` usa `bg-white` em todas as prioridades (nenhuma classe `bg-red-100|bg-yellow-100|bg-green-100|bg-petroleum-100` no `li`), com o glifo de prioridade e o nome acessível "Prioridade <nome>"; chips de SLA e tag de status ficam sobre fundo branco.
- AC-05: vermelho só em vencido, crítico e escalado: o contador de Autorizações não usa `red-*` e "Limpar ordenação" não usa `red-*`; Resolvido usa o `green` do DS e nenhum status usa `brand` e `green` como o mesmo tom.
- AC-06: Lista, Kanban, Detalhe, Formulário, Ticket pai e busca da agenda mostram a nova tag (sem `statusTagVariants`/`priorityTagVariants` no código), e `check_tickets_palette.py` continua passando.
- AC-07: sem mudança de API, schema ou regra; rótulos (`statusLabels`, `priorityLabels`) idênticos.

## Testes (seams confirmadas com o pedido: componentes de tag e cartão, nível de teste do projeto — vitest + Testing Library)

- AC-01, AC-02, AC-03: `apps/web/src/components/tickets/TicketTags.test.tsx` (renderiza as 9 tags de status e as 4 de prioridade; compara assinaturas; mede contraste dos pares de `ticketTagTokenPairs` com os tokens de `apps/web/src/styles.css`).
- AC-04: `apps/web/src/components/tickets/TicketKanbanCard.test.tsx` (substitui o caso "tints the card by priority" por "keeps the card white and shows the priority glyph").
- AC-05: `apps/web/src/components/tickets/TicketKanban.test.tsx` (Limpar ordenação) e `apps/web/src/components/tickets/TicketShortcuts.test.tsx` (contador de Autorizações), mais o caso de Resolvido em `TicketTags.test.tsx`.
- AC-06: testes existentes de Lista, Detalhe, Formulário, Ticket pai e busca da agenda continuam verdes (ajustados só se citam a variante antiga) e `python3 scripts/check_tickets_palette.py`.
- AC-07: `git diff` do PR sem arquivo de `apps/api` e sem alteração em `statusLabels`/`priorityLabels`.

## Evidência visual e aceite

Capturas Lista e Kanban a 1440 px antes e depois, anexadas ao PR, como evidência técnica. Aceite visual é de Alfredo (screenshot não substitui a decisão humana). Stories de `EzTag` já existem; os novos componentes de domínio não entram no Storybook do DS (ficam em `components/tickets`).

## Riscos

- A decisão de família de cada status (item 2) e o âmbar no contador são escolhas visuais novas; se Alfredo preferir outra, é troca de uma linha em `TicketTags.tsx`.
- Quem se acostumou a ler a prioridade pelo fundo do cartão passa a lê-la pelo glifo e, em Alta e Crítica, também pela pílula.
- Sem impacto em RBAC, tenant ou API: só apresentação.
