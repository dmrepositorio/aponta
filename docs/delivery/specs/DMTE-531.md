# Mesa: toolbar e abas em tela estreita

Identidade: DMTE-531, issue dmrepositorio/aponta#282, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e002-9828-735f-bb7a-2803fe5d86fa`. Origem: auditoria DMTE-520 da tela de Mesa (`/service-desks`), item 3, aprovada por Alfredo ("Aprovado vamos iniciar"), mesma ordem da DMTE-517/525/530: itens 1 e 2 (DMTE-530, integrada), depois 3, 4 e 5 (DMTE-531 a 533). Início confirmado por Alfredo em 2026-11-16, com o pedido de "considerar eventuais conflitos com as demais".

## Situação atual (código observado e renderizado)

Medido em Chromium (Vite local, API simulada, perfil ADMIN, base `c786183`, `scripts/mesa_responsive_check.mjs`), a 390×844:

- A auditoria (4 linhas de toolbar) descreve a base anterior à DMTE-541. A DMTE-541 (integrada, decisão D13 aceita por Alfredo) fez a toolbar do DS rolar em **uma linha** abaixo de 640 px (`EzEntityToolbar.tsx:141`, `max-sm:flex-nowrap max-sm:overflow-x-auto`) e deu 44 px aos botões. O que sobrou: o contador fica no fim da linha que rola e sai da tela; na lista da Mesa, "1 - 4 de 4" está cortado; no formulário, "1 de 4" também. Em Contratos e Clientes o contador não aparece na primeira tela pelo mesmo motivo.
- `ServiceDesksPage.tsx:485-491`: `EzTabs variant="pills"` com `className="flex-wrap overflow-visible"`. O `EzTabs` já tem `overflow-x-auto no-scrollbar` (`ds/EzTabs.tsx:30`), anulado por essa classe. Medido: 12 abas em **8 linhas** a 390 px (3 a 1024 px, 2 a 1440 px) e o primeiro campo do formulário começa em 684 px, na parte baixa da primeira tela de 844 px.
- A 1440 e 1024 px a toolbar tem 1 linha e 45 px nas três telas que a usam (Mesa, Contratos, Clientes).

## Conflitos com as demais entregas (conferidos nas fontes)

- **DMTE-541 (integrada, D13):** a toolbar rola em uma linha e tem alvos de 44 px abaixo de 640 px. Esta entrega mantém as duas coisas. A proposta original do item 3, "ações secundárias no menu Ações abaixo de um breakpoint", muda o que Alfredo aceitou em Clientes (Anexos e Configuração da tela sairiam da barra); por isso **não entra**. O ganho que ela buscava (contador inteiro e toolbar curta) vem do contador em linha própria.
- **DMTE-539 (Contratos, item 4):** pede "toolbar em tela estreita sem cortar o contador" e declara depender desta. A correção aqui é do DS e vale para Contratos; quando esta entrega for integrada, a parte de toolbar da DMTE-539 vira conferência (medição em Contratos já incluída aqui), restando o erro de validação visível.
- **DMTE-532 (foco e semântica das abas):** mexe em `ds/EzTabs.tsx` (anel de foco, `tabpanel`, setas). Esta entrega **não altera `EzTabs.tsx`**; só remove duas classes no uso em `ServiceDesksPage.tsx`. A DMTE-532 vem depois (WIP 1) e não conflita no arquivo do DS.
- **DMTE-533 (modelo de salvamento):** mexe no corpo das abas em `ServiceDesksPage.tsx` (`:448-624`), não na linha das abas. Vem depois; conflito textual improvável.
- Sem PR aberto tocando `EzEntityToolbar.tsx`, `EzTabs.tsx` ou `ServiceDesksPage.tsx` (conferido com `gh pr list` em 2026-11-16). DMTE-534/535/537 (Conhecimento) e DMTE-538/540 (Contratos) não tocam esses arquivos.

## Decisões (propostas do planejamento dentro do pedido aprovado)

1. **Contador em linha própria abaixo de 640 px, fora da área que rola.** O `EzEntityToolbar` passa a ter a linha de botões (que rola, como hoje) e, abaixo de `sm`, uma segunda linha só com o contador, alinhado à direita, sem rolagem. A toolbar fica com no máximo 2 linhas e o contador inteiro. A partir de 640 px o layout é idêntico ao atual (contador no fim da linha, com a borda esquerda).
2. **Sem prop nova, sem mudança nos botões.** O contador continua o mesmo elemento (`data-testid="ez-toolbar-record-count"`); só sua posição no DOM e as classes `max-sm:` mudam. Os alvos de 44 px e a rolagem da linha de botões (D13 da DMTE-541) ficam como estão.
3. **Abas da Mesa com rolagem horizontal, não seletor.** Remover `flex-wrap overflow-visible` do uso em `ServiceDesksPage`; o `EzTabs` pills passa a rolar numa linha, sem mudar o componente. O seletor (select) no mobile foi descartado: duplicaria a navegação e as abas já são 12 rótulos curtos; a rolagem é o padrão que a toolbar da DMTE-541 já adotou. A barra de rolagem continua escondida (`no-scrollbar`): o corte da aba na borda direita é a pista de que há mais.
4. **Nada muda de 640 px para cima** nas três telas que usam a toolbar. Provado por medição: retângulos de todos os elementos com `data-testid` da toolbar iguais antes e depois a 1440 e 1024 px, em Mesa, Contratos e Clientes.
5. **Fora do escopo:** foco e semântica das abas (DMTE-532), salvamento (DMTE-533), erro de validação de Contratos (DMTE-539), menu Ações vazio na Mesa ("Nenhuma ação disponível"), alteração de API ou regra.

Não aplicável: grill-with-docs → to-spec → to-tickets completos. Não é funcionalidade nova nem refatoração grande: é correção de apresentação aprovada item a item, na forma da DMTE-525/530 (uma SPEC, uma issue GitHub, um PR, sem sub-issues).

## Acceptance criteria

- AC-01: abaixo de 640 px o contador do `EzEntityToolbar` fica numa linha própria, fora do elemento que rola (nenhum ancestral do contador até a raiz da toolbar tem `overflow-x-auto`), com `max-sm` para a linha própria; a linha de botões continua rolável (`max-sm:flex-nowrap max-sm:overflow-x-auto`).
- AC-02: a partir de 640 px a toolbar é igual à atual: o contador segue à direita dos botões da direita, com a borda esquerda; sem prop nova; ids de teste, rótulos e ordem de foco dos botões iguais.
- AC-03: em Chromium a 390 px, na lista da Mesa, no formulário da Mesa, em Contratos e em Clientes, a toolbar ocupa no máximo 2 linhas e o contador aparece inteiro dentro da janela.
- AC-04: em Chromium a 1440 e 1024 px, os retângulos dos elementos com `data-testid` da toolbar de Mesa, Contratos e Clientes são idênticos aos da base `c786183`.
- AC-05: na Mesa, as abas não têm `flex-wrap` nem `overflow-visible`; em Chromium a 390 px as 12 abas ocupam uma linha com rolagem horizontal e a aba ativa fica dentro da área visível; o primeiro campo do formulário começa dentro da primeira tela (abaixo de 844 px) e a página não ganha rolagem horizontal nos três tamanhos.
- AC-06: `EzTabs.tsx` não é alterado; sem mudança de API, schema, regra, rótulos ou ordem das abas.
- AC-07: o DS documenta a mudança em `docs/architecture/03-sankhya-ds-parity.md` e o `EzEntityToolbar` ganha story (hoje não tem) com o contador e uma variante de viewport estreito.

## Testes (seams: componente do DS e página, nível do projeto — vitest + Testing Library; layout medido no navegador)

- AC-01, AC-02: `apps/web/src/components/ds/EzEntityToolbar.test.tsx` (contador fora do ancestral que rola e com a classe de linha própria abaixo de `sm`; a linha de botões mantém as classes de rolagem; com `recordCountText` ausente nada é renderizado; botões e ids como antes).
- AC-05, AC-06: `apps/web/src/pages/ServiceDesksPage.test.tsx` (a lista de abas do detalhe da Mesa tem as 12 abas, sem `flex-wrap` nem `overflow-visible`; os rótulos e a ordem não mudam).
- AC-03, AC-04, a parte medida de AC-05: `scripts/mesa_responsive_check.mjs` (novo; mesma API simulada com dados sintéticos; jsdom não calcula layout). A base "antes" fica registrada com `--no-assert --json` e a comparação de retângulos a 1440 e 1024 px é feita no GREEN.
- AC-07: a story é conferida por build do Storybook no CI (build não é teste de interação nem a11y; dito no PR).
- `python3 scripts/aponta_delivery.py check --manifest .delivery/deliveries/DMTE-531.json` e a suíte `web` completa antes do QA (o `EzEntityToolbar` é compartilhado com Contratos e Clientes).

## Evidência visual e aceite

Capturas antes e depois, a 390 px (e 1024/1440 para provar a ausência de regressão), da lista da Mesa, do formulário da Mesa, de Contratos e de Clientes, com dados fictícios. Aceite visual é do Alfredo; captura não substitui a decisão humana. O relatório completo com capturas segue na DMTE-520.

## Riscos

- O `EzEntityToolbar` é compartilhado com Contratos e Clientes: a linha extra do contador abaixo de 640 px aumenta ~24 px de altura nessas duas telas no celular. Mitigação: medição nas três telas e suíte `web` completa; o ganho (contador legível) é o objetivo do item.
- A barra de rolagem das abas continua escondida: quem não percebe o corte da aba na borda pode não saber que há mais abas. A DMTE-532 trata a navegação por teclado; indicador de rolagem visual fica como melhoria possível, fora desta entrega.
- Sem impacto em RBAC, tenant ou API: só apresentação, na tela já restrita a ADMIN.
