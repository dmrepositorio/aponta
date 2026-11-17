# Contratos: exclusão com modal do DS e foco com contraste

Identidade: DMTE-540, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e1dc-26c8-7ac5-9d76-e836b9d0a530`. Origem: auditoria DMTE-521 da tela de Contratos (`/contracts`), item 5. A direção ("Vamos iniciar") veio de Alfredo no card.

## Situação atual (código observado na base `bba2762`)

- **Anel de foco.** O DMTE-532 criou o token único do foco em `apps/web/src/styles.css` (`--color-focus` = `brand-600`, utilidades `ez-focus` e `ez-focus-inset`, contorno de 2 px) e migrou só `EzTabs` e `EzCheck`. O resto do DS e quatro páginas ainda usam o anel antigo: 31 classes `focus-visible:ring-brand-200` e 5 `focus:ring-brand-200` em 27 arquivos de `apps/web/src` (EzButton, EzActionsButton, EzTaskbar, EzSearchPlus, EzDropdown, EzCalendar, EzEntityGrid, EzFilterBar, modais, `DashboardPage`, `SettingsPage`, `CreateTicketPage`, `TicketFormMode`, entre outros). `brand-200` (`#94ccbd`) dá 1,81:1 sobre branco; `brand-600` (`#008561`) dá 4,64:1 (cálculo WCAG 2.x refeito nesta triagem).
- **Exclusão em Contratos** (`ContractsPage.tsx:199-216`): `window.confirm` com a contagem, uma `deleteContract.mutate` por contrato em paralelo e um único `deleteError` (mostrado num `EzAlert` no topo da página) que o último erro sobrescreve. O botão Excluir da toolbar (`EzEntityToolbar`, `selectedCount > 0`) continua ativo no formulário aberto, porque `openDetail` marca o contrato aberto como selecionado.
- `EzDialog` (`apps/web/src/components/ds/EzDialog.tsx`) existe, com `info`/`danger`/`warning`, mas só aceita `message` em texto, rótulos fixos "Confirmar"/"Cancelar" e não move o foco ao abrir.
- Não reproduzi em navegador o botão Excluir ativo no formulário; a leitura é do código. O AC-09 mede isso em Chromium.

## Decisões (proposta do planejamento dentro do pedido; a cor e a migração em todo o app vêm da issue)

1. **Um token só.** Todo anel `brand-200` de foco passa a `ez-focus` (controle solto) ou `ez-focus-inset` (linha de lista/grade e controle dentro de área que corta o anel de fora), as duas utilidades do DMTE-532. O contorno fica em 2 px e `brand-600`; o anel de 4 px do botão vira o mesmo contorno de 2 px. `outline-none` e `ring-offset-*` de foco saem desses elementos.
2. **Fora da migração:** `ring-1 ring-brand-200` de seleção de cartão no `TicketKanban.tsx` (estado selecionado, não foco) e o `outline` de `.article-content a:focus-visible` em `styles.css` (artigo de Conhecimento, tratado no DMTE-535).
3. **`EzDialog` ganha o mínimo para a exclusão**, sem quebrar quem usa hoje: `children` opcional (corpo abaixo da `message`), `confirmLabel` e `cancelLabel` opcionais (padrões "Confirmar" e "Cancelar"), `confirmDisabled` opcional, `aria-labelledby` ligado ao título e, na variante `danger`, o foco inicial no botão Cancelar (a ação segura).
4. **Contratos**: o Excluir abre `EzDialog` `danger` que cita o contrato como "Nome · Empresa" (o grid usa `name || 'Sem nome'` e `organization.name`); com vários, lista os nomes (até 5 e "e mais N"). Confirmar dispara uma chamada por contrato com `mutateAsync` e `Promise.allSettled`. Sucesso total fecha o diálogo. Com falhas, o diálogo fica aberto e troca o corpo para a lista "Nome · Empresa: mensagem do servidor", os contratos excluídos saem da seleção, os que falharam continuam selecionados, e as ações viram "Tentar novamente" e "Fechar". O `deleteError` e o `EzAlert` do topo saem.
5. **No formulário aberto** o Excluir da toolbar fica desabilitado: a página passa `selectedCount` 0 à toolbar quando `mode === 'form'`. A seleção em si não muda (o formulário depende dela).
6. **Fora desta entrega:** os outros `window.confirm` do app (`VaultPage`, `OrganizationsPage`, `ServiceDesksPage`, `MyAccountPage`, `TicketWorklogs`, `AppointmentModal`, `CompromissoDetailModal`), foco global do `EzDialog` além do foco inicial (trava de Tab), mudança de API, schema ou regra de exclusão no servidor.

## Acceptance criteria

- AC-01: nenhum arquivo de produção de `apps/web/src` (fora de testes e stories) contém `focus:ring-brand-200` nem `focus-visible:ring-brand-200`; os elementos migrados usam `ez-focus` ou `ez-focus-inset`.
- AC-02: `EzButton` (e `EzActionsButton`, `EzTaskbar`, `EzSearchPlus`) tem `ez-focus` e não tem `ring-brand-200`, `ring-4` nem `ring-offset-2` de foco; o teste do token (`styles.focus.test.ts`) continua passando, com `brand-600` a 4,5:1 ou mais sobre branco.
- AC-03: `EzDialog` aceita `children`, `confirmLabel`, `cancelLabel` e `confirmDisabled`; sem essas props renderiza como hoje ("Confirmar", "Cancelar").
- AC-04: `EzDialog` com `variant="danger"` foca o botão Cancelar ao abrir; o diálogo tem `aria-labelledby` apontando para o título.
- AC-05: Excluir em Contratos abre o `EzDialog` e não chama `window.confirm`; o diálogo cita o contrato (um) ou lista os nomes (vários, até 5 mais "e mais N"); nenhuma chamada de exclusão acontece antes de Confirmar; Cancelar e Esc fecham sem excluir.
- AC-06: com vários contratos e falhas parciais, cada falha aparece no diálogo com o nome do contrato e a mensagem do servidor, sem sobrescrever as outras; os excluídos saem da seleção e os que falharam continuam selecionados; "Tentar novamente" refaz só os que falharam; sem falhas o diálogo fecha.
- AC-07: durante a exclusão em andamento, Confirmar fica desabilitado (sem envio duplo).
- AC-08: com o formulário de um contrato aberto, o botão Excluir da toolbar fica desabilitado; na lista, com seleção, continua habilitado e só para quem pode gerenciar contratos.
- AC-09: em Chromium, o foco por teclado no `EzButton` desenha contorno de 2 px `rgb(0, 133, 97)` (`brand-600`), e o diálogo de exclusão a 1440 px e a 390 px não corta o conteúdo; medição e capturas no PR (jsdom não calcula estilo nem layout).
- AC-10: nenhum arquivo de `apps/api` muda; as mensagens de erro do servidor chegam ao usuário como vêm.

## Testes (seams confirmadas: classes do DS lidas do fonte e renderizadas; `EzDialog` isolado; a página de Contratos; vitest + Testing Library)

- AC-01: `apps/web/src/components/ds/focusToken.guard.test.ts` lê os arquivos de `apps/web/src` e falha enquanto houver `focus(-visible)?:ring-brand-200` (hoje 36 ocorrências).
- AC-02: `apps/web/src/components/ds/EzButton.test.tsx` (classes do botão) e o teste de token já existente.
- AC-03, AC-04: `apps/web/src/components/ds/EzDialog.test.tsx`.
- AC-05 a AC-08: `apps/web/src/pages/ContractsPage.test.tsx` (os dois testes de exclusão que mockam `window.confirm` passam a usar o diálogo; novos para vários contratos, falha parcial, nova tentativa, Cancelar/Esc e formulário aberto).
- AC-09: script de Chromium no padrão de `scripts/mesa_focus_check.mjs`; resultado e capturas no PR e no card.
- AC-10: `git diff` do PR sem arquivo em `apps/api`.

## Storybook e DS

`EzDialog` ganha story com lista (`children`) e com falhas; as stories de `EzButton` e dos demais componentes não mudam (a aparência do foco vem do token). Direção das skills de design (Operate): preserva a identidade; o foco passa a ter um só desenho em todo o app; confirmação destrutiva em modal com a ação segura focada (regra de destrutivos do Web Interface Guidelines: "confirmation modal or undo window, never immediate"; foco visível sem `outline-none` sem substituto). Aceite visual é de Alfredo.

## Riscos

- O contorno de 2 px é mais fino que o anel de 4 px: o ganho é contraste (1,81:1 para 4,64:1), a perda é volume. Elementos dentro de `overflow-hidden` e listas rolantes usam `ez-focus-inset` para o contorno não ser cortado; o AC-09 mede os casos principais, e as demais telas ficam para o aceite visual.
- Mexer em 27 arquivos de DS por classe: o guard do AC-01 e os testes de cada componente existente pegam regressão de classe; nenhum comportamento muda.
- A exclusão em lote não é transacional no servidor: falha parcial é o caso normal e fica visível por contrato; nada muda no que o servidor faz.
- Sem impacto em RBAC, tenant ou API: o botão continua só para quem gerencia contratos.
