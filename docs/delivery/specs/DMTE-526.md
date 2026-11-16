# Lista de Tickets: abrir linha por teclado e nova aba, e estado da ordenação

Identidade: DMTE-526, issue dmrepositorio/aponta#263, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1dff7-60f5-70a8-9468-7b7315b0a2ba`. Origem: auditoria DMTE-517 (item 3), aprovada por Alfredo, que pediu corrigir na ordem sugerida (itens 1 e 2, depois 3, 4 e 5). Itens 1 e 2 integrados na DMTE-525 (#257/#259).

## Situação atual (código observado)

- `apps/web/src/components/tickets/TicketList.tsx`, `renderRow`: `<tr onClick={openInTab(...)}>` sem `tabindex`, `role` nem link. O `tbody` não tem elemento focável (evidência medida na auditoria: 0 focáveis); Ctrl, Meta, Shift e clique do meio não abrem nova aba. WCAG 2.1.1 e 4.1.2.
- Cabeçalho: cada coluna ordenável é um `<button>` dentro do `<th>`, sem `aria-sort` e sem ícone de direção; o estado (`sort.field`, `sort.dir`) existe no componente, inicializado de `sortBy`/`sortDir`, mas não aparece para ninguém.
- Hover da linha: `hover:bg-gray-80`, o mesmo tom do cabeçalho da tabela e dos cabeçalhos de grupo. O token `--color-grid-row-hover` (`#e4eaf1`, `styles.css`) existe e só o `EzEntityGrid` o usa (`hover:bg-grid-row-hover`).
- O cartão do Kanban (`TicketKanbanCard.tsx`) já é um `Link` (react-router) com `handleClick`: Ctrl, Meta, Shift ou botão diferente de 0 passam para o navegador; clique simples faz `preventDefault` e `openInTab(path, tabTitle)` (`useOpenInTab`, `TabsContext.tsx`). Anel de foco: `focus-visible:ring-2 focus-visible:ring-brand-500`.

## Decisões (proposta do planejamento dentro do pedido aprovado)

1. **A célula Número vira um `Link`** para `/tickets/<id>`, com o mesmo `handleClick` do Kanban, mantendo `font-mono`, `whitespace-nowrap` e o texto do protocolo. É o único tab stop da linha: Enter ativa; Ctrl/Meta/Shift/clique do meio abrem nova aba do navegador pelo `href` real. Nome acessível = o protocolo (sem `aria-label` que o substitua).
2. **A linha continua clicável** (`onClick` no `<tr>` com o mesmo `openInTab`), para quem usa o mouse em qualquer célula. O clique que nasce no link não é tratado duas vezes: o `onClick` da linha ignora eventos cujo `target` está dentro de um `<a>` ou de um `<button>`. A linha **não** ganha `role="link"`, `tabindex` nem `onKeyDown`: teclado e leitor de tela usam o link da célula (um tab stop por linha, sem ruído de 50 linhas focáveis duplicadas).
3. **Cabeçalho ordenável**: o `<th>` da coluna ordenada ganha `aria-sort="ascending"|"descending"`; as demais colunas ordenáveis ficam sem `aria-sort`; colunas sem `sortField` também. Ao lado do rótulo, uma seta `ArrowUp`/`ArrowDown` (lucide, já usada na tela), `aria-hidden`, só na coluna ativa. O nome do botão continua sendo o rótulo (`Título`, `Número`...), então o teste e o uso atuais não mudam. Foco visível no botão: `focus-visible:ring-2 focus-visible:ring-brand-500`.
4. **Hover e foco da linha** com o token `grid-row-hover`: `hover:bg-grid-row-hover` no lugar de `hover:bg-gray-80`, e `focus-within:bg-grid-row-hover` para a linha acompanhar o foco do link.
5. Sem API, schema, regra, componente de DS novo nem token novo; só `lucide-react`, `react-router-dom` e tokens do `@theme` (ADR 0001, `scripts/check_tickets_palette.py`). Sem Carbon nem Next.js. Identidade da tela preservada (verde Ocean, cartões de 8 a 16 px, tags em pílula).

## Acceptance criteria

- AC-01: cada linha da lista renderiza a célula Número como `link` com o protocolo como nome e `href` = `/tickets/<id>`; o link é focável por Tab (primeiro tab stop do `tbody`) e Enter nele abre o ticket na aba interna (`openInTab`, uma única vez).
- AC-02: clique simples no link abre o ticket na aba interna uma única vez (o `onClick` da linha não repete); Ctrl, Meta, Shift ou botão diferente de 0 no link não são interceptados (`openInTab` não é chamado e o evento não tem `defaultPrevented`), então o navegador abre nova aba pelo `href`.
- AC-03: clicar em qualquer outra célula da linha continua abrindo o ticket na aba interna (comportamento atual preservado); clicar no botão de grupo (`aria-expanded`) ou no cabeçalho de grupo não abre ticket.
- AC-04: o `<th>` da coluna ordenada tem `aria-sort="ascending"` ou `"descending"` conforme `sortBy`/`sortDir` (inicial) e conforme os cliques seguintes; nenhuma outra coluna tem `aria-sort`; a coluna ativa mostra a seta de direção (`aria-hidden`) e a troca de direção troca a seta; sem `sortBy`, nenhum `<th>` tem `aria-sort`.
- AC-05: a linha usa `hover:bg-grid-row-hover` e `focus-within:bg-grid-row-hover` e não usa `hover:bg-gray-80`; o link e o botão de ordenação têm anel de foco visível (`focus-visible:ring-2 focus-visible:ring-brand-500`).
- AC-06: o texto do link do protocolo tem contraste mínimo de 4,5:1 sobre o branco e sobre `grid-row-hover` (tokens lidos de `styles.css`).
- AC-07: sem mudança de API, schema ou regra; colunas, agrupamento, persistência de configuração e `onSortChange` inalterados (testes existentes de `TicketList.test.tsx` seguem verdes; o botão de ordenação mantém o nome acessível do rótulo).

## Testes (seam confirmada com o pedido: o componente `TicketList`, nível de teste do projeto — vitest + Testing Library + user-event)

- AC-01, AC-02, AC-03, AC-05: `apps/web/src/components/tickets/TicketList.test.tsx`. Para observar a navegação, renderizar dentro de `TabsProvider` e de um `Routes` com um marcador da rota atual (padrão do `TabsContext.test.tsx`/`TabBar.test.tsx`); Tab para o primeiro foco, `user.keyboard('{Enter}')`, `user.click` com `{ctrlKey}`/`{metaKey}`/`{shiftKey}` via `fireEvent.click` quando preciso (confere `defaultPrevented`).
- AC-04: mesmo arquivo, ao lado do teste de ordenação existente (`clicking a sortable column header...`).
- AC-06: mesmo arquivo, medindo contraste com os tokens de `apps/web/src/styles.css` como em `TicketTags.test.tsx`.
- AC-07: testes existentes do arquivo + `git diff` do PR sem `apps/api`.
- `python3 scripts/check_tickets_palette.py` continua passando.

## Evidência visual e aceite

Capturas da Lista a 1440 px antes e depois (foco por teclado visível e seta de ordenação), com dados sintéticos, anexadas ao PR como evidência técnica. Aceite visual é de Alfredo.

## Riscos

- O `onClick` da linha e o do link coexistem: sem o filtro de `target`, o clique simples navegaria duas vezes. Coberto por AC-02.
- A coluna "Número" pode ser ocultada em "Exibir colunas": nesse caso a linha fica clicável só pelo mouse. Registrado como lacuna conhecida; a alternativa (link na primeira coluna visível) é mudança maior, fora do pedido da auditoria.
- `TicketList` guarda o estado de ordenação em estado local, inicializado das props; se a página mudar `sortBy` por fora, a seta não acompanha. Hoje nenhuma ação da `TicketsPage` faz isso (a limpeza de filtros preserva `sortBy`/`sortDir`); fora do escopo.
- Sem impacto em RBAC, tenant ou API: só apresentação.
