# Kanban de Tickets: alvos, foco e legenda do SLA

Identidade: DMTE-528, issue dmrepositorio/aponta#295, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1dff7-6c9d-7aa6-9ef5-55f5b876aedd`. Origem: item 5 da auditoria DMTE-517, aprovada por Alfredo, que pediu a correção na ordem sugerida (itens 1 e 2, depois 3, 4 e 5). Este é o último dos quatro.

## Situação atual (código observado; a medição do item 1 vem da auditoria)

Base `a3866b3`:

- `TicketKanbanCard.tsx:113-121`: `EzDropdown` com `trigger={<MoreVertical className="h-4 w-4" />}` e nenhuma classe no botão. O alvo mede 16×16 px (medido na auditoria). WCAG 2.5.8 (nível AA) pede 24×24 px.
- `TicketKanban.tsx`, dois pontos (colunas por estágio e por status): `<button title="Recolher coluna">` com `ChevronLeft` de 14 px e sem `aria-label`; o alvo é o ícone. O botão "Expandir coluna" da faixa recolhida já tem `aria-label` e `focus-visible:ring-2 focus-visible:ring-brand-500`.
- `TicketKanban.tsx:615-634` (`agentAvatarRow`): botões de avatar de 28 px, sobrepostos em 6 px (`-space-x-1.5`), com `ring-2 ring-white` e sem estilo de foco. O alvo já passa de 24 px; falta o foco visível (WCAG 2.4.7) e o avatar focado fica parcialmente coberto pelo vizinho seguinte.
- `ds/EzSlaChip.tsx`: ícone de 12 px e o tempo (`-1h00`, `-0min`). Sem prazo, só o ícone. O nome do prazo ("Resposta"/"Resolução") está no `aria-label` e no `title`, e só se vê com o mouse parado em cima.

## Decisões (proposta do planejamento dentro do pedido aprovado na auditoria)

1. **Menu "Mais ações": alvo de 32×32 px** (`h-8 w-8`), margem negativa (`-my-1.5 -mr-1.5`) para o cabeçalho do cartão não crescer. Densidade da DMTE-527 preservada; o foco já é do `EzDropdown` (`focus-visible:ring-2`).
2. **Recolher coluna: alvo de 32×32 px**, `aria-label="Recolher coluna <nome>"` (mesma forma do "Expandir coluna <nome>"), `focus-visible:ring-2 focus-visible:ring-brand-500` como no botão de expandir, ícone de 14 px mantido. Margem negativa para a linha do cabeçalho manter a altura.
3. **Avatares do filtro: foco visível e sem sobreposição quando focado.** `focus-visible:z-10 focus-visible:outline-none focus-visible:ring-brand-600` sobre o `ring-2` existente (o anel muda de branco para a cor da marca e o avatar vai para a frente). Alvo de 28 px mantido. Quando o avatar está selecionado, o anel `brand-500` atual continua.
4. **Chip de SLA: palavra curta antes do tempo.** "Resp." para resposta e "Solução" para resolução (as palavras do pedido da auditoria): `Resp. 17h18`, `Solução -1h00`. Sem prazo, só a palavra. `aria-label` e `title` mantêm o texto completo de hoje; o ícone fica, `aria-hidden`. Não altera props nem tokens de cor.
5. Sem mudança de API, schema, tokens, tamanho do cartão além do que o chip ganha em largura (as duas pílulas já quebram linha com `flex-wrap`), nem de outro componente do DS.

## Acceptance criteria

- AC-01: o botão "Mais ações" de cada cartão tem alvo mínimo de 32×32 px (`h-8 w-8`), e continua abrindo o menu com "Abrir ticket" e "Abrir em nova aba interna".
- AC-02: o botão de recolher coluna, nas colunas por estágio e nas por status, tem `aria-label` "Recolher coluna <nome>", alvo mínimo de 32×32 px e anel de foco visível por teclado; ativar recolhe a coluna e o botão "Expandir coluna <nome>" aparece.
- AC-03: cada botão de avatar do filtro de responsável tem anel de foco visível por teclado (`focus-visible`), vai para a frente (`z-10`) ao receber foco, mantém `aria-pressed` e o nome "Filtrar por <nome>", e o alvo de 28 px.
- AC-04: o chip de SLA mostra "Resp." (resposta) ou "Solução" (resolução) antes do tempo; sem prazo mostra só a palavra; `aria-label` e `title` continuam "Resposta: …" e "Resolução: …" como antes.
- AC-05: o comportamento existente continua: os testes anteriores de `TicketKanban`, `TicketKanbanCard` e `EzSlaChip` passam, exceto a asserção de chip sem prazo "só ícone" (`textContent` vazio), que muda para a palavra curta por decisão deste AC-04.
- AC-06: nenhum arquivo de `apps/api` nem de `apps/web-e2e` é alterado e nenhum token novo é criado.
- AC-07: no navegador (Chromium, 1440×900 e 390×844, dados fictícios), os alvos medidos de "Mais ações" e de recolher coluna são de pelo menos 24×24 px (esperado 32×32), o foco por Tab mostra anel nos três botões e o chip mostra a palavra curta antes do tempo sem estourar o cartão.

## Testes (seam: componentes renderizados com Testing Library; vitest; o padrão dos arquivos existentes)

- AC-01: `TicketKanbanCard.test.tsx`, classes `h-8 w-8` no botão `Mais ações` e abertura do menu.
- AC-02, AC-03: `TicketKanban.test.tsx`, por consulta de papel/nome ("Recolher coluna Aberto") e por classes (jsdom não aplica CSS, então o teste confere a classe, que é o contrato do Tailwind); ativação por teclado com `userEvent.keyboard`.
- AC-04: `EzSlaChip.test.tsx`; e um caso no cartão com os dois chips.
- AC-05: testes existentes dos três arquivos.
- AC-06: `git diff` do PR.
- AC-07: medição em Chromium por script, no padrão dos `scripts/*_responsive_check.mjs`, resultado no PR (evidência técnica, não gate).
- Limite honesto: o teste de classe prova que o contrato está aplicado, não a renderização; a renderização é o AC-07.

## Parecer de design (Operate, Kanban de Tickets)

- impeccable (modo Operate, `critique`): `impeccable context` rodou e devolveu `NO_PRODUCT_MD` com implementação visual existente; vale o refinamento estreito sobre o código incumbente, sem bloquear. A mudança preserva identidade (verde Ocean, cartões de 8 a 16 px, tags em pílula). Em Operate, alvo e foco são estado de componente (default, hover, focus), não decoração. O foco reaproveita o anel `brand-500` do próprio Kanban. O detector mecânico roda no fim, sobre os arquivos alterados.
- web-design-guidelines (regras buscadas em `raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`): "Interactive elements need visible focus: focus-visible:ring-*"; "Use :focus-visible over :focus"; "Icon-only buttons need aria-label". Não há regra de tamanho de alvo nem de abreviação; o alvo vem da WCAG 2.5.8.
- Aceite visual: da Alfredo, na tela.

## Riscos

- Largura do chip: duas pílulas com palavra podem passar da largura de um cartão estreito; `flex-wrap` já existe e o AC-07 mede a 390 px.
- Margem negativa no botão aumenta a área clicável por cima de um vizinho: no cartão é o espaço do cabeçalho, sem controle ao lado; na coluna é só o título, que não é clicável.
- "Solução" para resolução é abreviação de produto; "Resolução" por extenso ocuparia mais. Se Alfredo preferir outro rótulo, é uma constante.
- Sem impacto em RBAC, tenant ou API: só apresentação no cliente.
