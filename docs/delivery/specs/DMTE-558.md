# Detalhe do ticket: descrição renderizada como conteúdo rico, sem tags HTML visíveis

Identidade: DMTE-558, Tier 1 (recomendado), origem item 2 (P1) da auditoria DMTE-549, aprovado pelo Alfredo ("Vamos implementar"). Issue GitHub: a criar (ainda não existe). Base: `origin/main` @ 2070784. Status da SPEC: decisões D1 a D5 tomadas pelo Alfredo; pronta para /plan.

## Objetivo
No detalhe do ticket, a descrição criada pelo formulário (editor rico) aparece com as tags escapadas, ex.: `<p>Erro no emissão da TOP 1100 </p>` literal. Passa a ser exibida como conteúdo formatado, igual a comentários e apontamentos. Usuário: qualquer perfil que abre o detalhe (cliente, atendente, admin). Sucesso: nenhuma tag HTML literal visível; descrição legada em texto puro continua legível com suas quebras de linha; nada executável entra na página.

## Situação atual (código observado)
- Impressão: `apps/web/src/components/tickets/TicketDetail.tsx:178-180` faz `<p className="whitespace-pre-wrap text-sm text-gray-900">{ticket.description}</p>`; React escapa o HTML, daí as tags visíveis.
- Origem do HTML: o formulário de abertura usa `EzRichText` (Tiptap) para a descrição (`apps/web/src/components/tickets/TicketForm.tsx:254-265`, `apps/web/src/components/ds/EzRichText.tsx`), que emite HTML (`<p>…</p>`). A API grava a string como veio: `description!: string` com `@IsString() @IsNotEmpty()` (`apps/api/src/tickets/dto/create-ticket.dto.ts:23-26`) e `tx.ticket.create({ data: { description: dto.description, … } })` (`apps/api/src/tickets/tickets.service.ts:446-449`); update repassa igual (`:891-892`). Não há sanitização no ticket (só artigos têm: `apps/api/src/articles/sanitize-article-content.ts`). Criação por API/token pode mandar texto puro; só há este ponto de criação de ticket (`tickets.service.ts:446`).
- Sanitização do renderizador: `apps/web/src/components/tickets/RichContentView.tsx`. Se o conteúdo casa `HTML_TAG_RE` (linha 3; p, div, span, br, strong, b, em, i, u, ul, ol, li, a, img, h1-h3, blockquote) usa `HtmlContent` (linhas 131-134): `new DOMParser().parseFromString(html, 'text/html')` (documento inerte, sem executar script nem `onerror`) e reconstrói a árvore com React (`renderNode`, linhas 69-129). Descarta `script`, `style`, `iframe`, `object` (81-83); copia só `href`, `src`, `alt` (nenhum atributo `on*`, `style` ou `class` do autor passa); `img` e `a` passam por `isSafeMediaUrl` (linhas 38-48: só `/…` relativo e `http(s)://`; bloqueia `javascript:`, `data:`, `vbscript:`, `//`); tag fora da lista (`ALLOWED_TAGS`, 6-25) vira `<span>` com os filhos. Links abrem com `target="_blank" rel="noreferrer"`. Cobertura atual: `RichContentView.test.tsx` (script, `javascript:` em img, link seguro, tag desconhecida).
- Texto puro: sem tag casada e sem `![`, `RichContentView` devolve `<span className="whitespace-pre-wrap">` (linha 185), logo `\n` do dado legado é preservado como hoje. Com `![alt](url)` usa `MarkdownContent` (136-170), também `whitespace-pre-wrap`.
- Uso do padrão: `TicketComments.tsx:80-82` e `TicketWorklogs.tsx:76` embrulham em `<div className="text-sm text-gray-900">` + `<RichContentView content=…/>`; `<p>` interno ganha `text-gray-800 leading-relaxed whitespace-pre-wrap` (linha 119).
- Outras telas com a descrição do ticket: Kanban, lista e cartões não imprimem `description` (grep em `apps/web/src`). E-mails de notificação não incluem descrição (`apps/api/src/mail/listeners/ticket-events.listener.ts`, só título e protocolo). Defeitos paralelos: `apps/web/src/components/schedule/AppointmentModal.tsx:128-131` copia `ticket.description` cru (HTML) para o campo descrição do compromisso, truncado em 160 caracteres (pode cortar tag no meio e exibir tags); `TicketFormMode.tsx:39,178-184` usa `<textarea>` com o HTML cru, mas o componente só é usado nos próprios testes (nenhuma página o importa); busca de lista faz `contains` na descrição (`tickets.service.ts:588`), então casa nomes de tag (`p`) no HTML.
- Teste do detalhe: `apps/web/src/pages/TicketDetailPage.test.tsx` usa descrição em texto puro (linha 40). E2E `apps/web-e2e/src/tickets.spec.ts:34,47` cria pelo editor real e confere `page.getByText(description)`, que passa mesmo com `<p>` escapado (casa por substring), então não pega o defeito.

## Escopo
- `TicketDetail.tsx`: trocar o `<p>` por `<div className="text-sm text-gray-900"><RichContentView content={ticket.description} /></div>` (mesmo padrão dos comentários).
- Testes (matriz abaixo), incluindo reforço do E2E existente para provar que não há `<p>` literal.
- Sem mudança em `RichContentView` (D4 decidida: fora).

## Exclusões
- Sem mudança de API, DTO, schema, migração de dados, e-mail, relatórios, Kanban ou lista.
- Não sanitizar na escrita da API nesta entrega (D2, entrega separada).
- Não corrigir `AppointmentModal` nem a busca (D3, issues separadas); `TicketFormMode` não usado fica como está.
- Não ampliar a allowlist do `RichContentView` (tabela, tachado, destaque, cor, alinhamento) (D4).
- Sem feature flag: correção de exibição, sem efeito externo.

## Tenant / RBAC
Não se aplica: sem endpoint, query ou permissão novos. O detalhe já é autorizado pela API; `description` já vem no payload (`apps/web/src/hooks/useTickets.ts`, tipo `Ticket`), para todos os perfis que veem o ticket. Nada novo exposto.

## Contratos
- API/DTO/tipos: inalterados (`description: string`). O valor continua armazenado como veio (HTML do editor ou texto puro).
- Front: `TicketDetail` passa a depender de `RichContentView` (já exportado, `apps/web/src/components/tickets/RichContentView.tsx`). Sem componente DS novo; story não se aplica (sem mudança em DS).

## Critérios de aceite
- AC-01: Descrição `<p>Erro no emissão da TOP 1100 </p>` aparece como o texto "Erro no emissão da TOP 1100" e nenhum texto `<p>` ou `</p>` fica visível no detalhe.
- AC-02: Descrição com vários parágrafos, `<strong>`, `<em>`, `<ul><li>` e `<br>` renderiza como elementos correspondentes (negrito, itálico, lista, quebra), sem tag literal.
- AC-03 (legado texto puro): Descrição sem HTML, com `\n` (ex.: `linha 1\nlinha 2`), continua exibindo as duas linhas; o contêiner mantém `whitespace-pre-wrap` e o texto íntegro é encontrado. Resultado igual ao de hoje.
- AC-04 (segurança): Descrição com `<p>Ok</p><script>alert(1)</script>`, `<img src="javascript:alert(1)" alt="x">`, `<img src="/uploads/a.png" onerror="alert(1)" alt="ok">` e `<a href="javascript:alert(1)">link</a>` não cria elemento `script`, não exibe o texto `alert(1)` nem tag literal, não renderiza `img` com `javascript:`, nenhum elemento tem atributo `on*`, e o `<a>` inseguro vira texto sem `href`.
- AC-05: Imagem com `src` relativo `/uploads/...` ou `https://` aparece (`img` com `alt`) dentro de link para a mesma URL; a imagem não excede a largura (classe `max-w-full`, já do componente).
- AC-06: Descrição legada em markdown de imagem (`texto\n![evidencia.png](https://cdn…/tela.png)`) mostra o texto e a imagem, sem a sintaxe `![`.
- AC-07: O bloco da descrição mantém `text-sm text-gray-900` (mesmo wrapper dos comentários); o resto do cabeçalho do detalhe (título, selos, SLA, atribuição) não muda.
- AC-08: Fluxo real (Playwright): ticket criado pelo formulário rico mostra o texto no detalhe e nenhum `<p>` literal (`getByText('<p>')` com contagem zero).
- AC-09: Regressão: `RichContentView.test.tsx`, `TicketDetailPage.test.tsx` (demais casos), `TicketComments`/`TicketWorklogs`, Jest da API, typecheck e build seguem verdes sem alteração de teste existente.

## Matriz AC -> teste -> evidência
| AC | Camada / arquivo | Tipo | Evidência esperada |
|---|---|---|---|
| AC-01 | Vitest, `apps/web/src/pages/TicketDetailPage.test.tsx` (caso novo, descrição HTML) | RED por asserção (hoje o `<p>` literal aparece) | Falha antes por `queryByText(/<p>/)` achar o texto; verde depois |
| AC-02 | Vitest, mesmo arquivo | RED por asserção (hoje sem `strong`/`li`) | Falha antes por `getByRole('list')`/`strong` ausentes; verde depois |
| AC-03 | Vitest, mesmo arquivo | Caracterização (passa antes e depois, não é RED) | Verde antes e depois; registrar como regressão |
| AC-04 | Vitest, mesmo arquivo | RED por asserção (hoje o texto `alert(1)` aparece escapado) | Falha antes por `queryByText(/alert/)`; verde depois; asserts de ausência de `script`, `on*`, `javascript:` |
| AC-05 | Vitest, mesmo arquivo | RED por asserção (hoje sem `img`) | Falha antes por `getByAltText` ausente; verde depois |
| AC-06 | Vitest, mesmo arquivo | RED por asserção (hoje mostra `![`) | Falha antes por `queryByText(/!\[/)`; verde depois |
| AC-07 | Vitest, mesmo arquivo (classes do wrapper) | Caracterização (a combinação `text-sm text-gray-900` já existe no `<p>`; passa antes e depois) | Verde antes e depois |
| AC-08 | Playwright, `apps/web-e2e/src/tickets.spec.ts` (asserção adicional no caso de criação, linha ~47) | RED por asserção no código atual; confirmar no CI ou com `scripts/e2e_isolated.sh` | `E2E (Playwright, full stack)` verde no SHA final; nunca rodar contra produção |
| AC-09 | Suítes existentes (Vitest web, Jest API), typecheck, build | Regressão | CI `Typecheck, unit tests, build` verde no SHA final |

Comando do Vitest: `pnpm exec nx run web:test --skip-nx-cache src/pages/TicketDetailPage.test.tsx` (target inferido por `@nx/vitest`; mesmo padrão da DMTE-557). Aceite visual humano do detalhe fica com o Alfredo.

## Riscos
- XSS: a API guarda HTML sem sanitizar; a segurança depende só do renderizador. Mitigado pelo `RichContentView` (DOMParser inerte, allowlist de tags, só `href/src/alt`, `isSafeMediaUrl`). Uma tela futura que renderize `description` com `dangerouslySetInnerHTML` quebraria isso; D2 cobre defesa em profundidade.
- Perda de formatação do editor: `EzRichText` emite tabela, tachado, destaque, cor e alinhamento que o `RichContentView` desembrulha em `<span>` (tabela perde a estrutura) e `HTML_TAG_RE` não reconhece `table`, `s`, `mark`, `pre`, `code`; descrição só com uma tabela cairia no ramo texto puro e apareceria escapada. Raro, já afeta comentários; D4.
- Texto puro legado que contenha literalmente `<b>`, `<div>` etc. (ex.: alguém colando código) passa a ser interpretado como HTML. Improvável; sem migração.
- Descrição `<p></p>` (editor vazio) pode passar o `min(1)` do formulário e renderizar vazia; fora de escopo.
- Sem dados reais em fixtures: usar textos sintéticos.

## Decisões (Alfredo)
- D1 decidida: descrição legada em texto puro fica como está, sem migração nem conversão no cadastro; o `RichContentView` já preserva `
` no ramo texto puro (`whitespace-pre-wrap`, linha 185), provado pelo AC-03.
- D2 decidida: sanitização na API ao gravar fica em entrega separada (Tier 2, reaproveitando `sanitize-article-content.ts`, mais migração do legado). Esta entrega é só front; Tier segue 1. Sem a D2, a defesa em profundidade fica pendente (risco registrado).
- D3 decidida: o mesmo defeito em outros pontos vira issues separadas: `AppointmentModal.tsx:128-131` (copia o HTML cru, truncado em 160) e a busca em `tickets.service.ts:588` (casa nomes de tag). Fora desta entrega.
- D4 decidida: não ampliar o `RichContentView` (compartilhado com comentários e apontamentos). Descrição só com tabela, tachado ou destaque cai no ramo texto puro e fica fora desta entrega (risco registrado).
- D5 decidida: wrapper `text-sm text-gray-900` como nos comentários (AC-07).

## Tier
Tier 1: troca de um elemento em um componente de front, sem API, schema, RBAC, flag ou DS novo; testes só de front mais uma asserção E2E. Subiria a Tier 2 se a sanitização na API e a migração (D2) ou a mudança no componente compartilhado (D4) entrassem; ambas ficaram fora.
