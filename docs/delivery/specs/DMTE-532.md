# Mesa: foco visível e semântica das abas

Identidade: DMTE-532, issue dmrepositorio/aponta#299, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e002-a2a1-71c2-be41-fe7c2bd409f0`. Origem: auditoria DMTE-520 da tela de Mesa (`/service-desks`), item 4, aprovada por Alfredo ("Aprovado vamos iniciar"); ordem dos itens 1 e 2 (DMTE-530, integrada), 3 (DMTE-531, integrada), depois 4 e 5 (DMTE-532 e DMTE-533). Início pela fila: a DMTE-527 (WIP) está `done`, e não há outra entrega Aponta em implementação ou revisão.

## Situação atual (código observado e medido)

Base `374023f`, na auditoria DMTE-520 (Chromium, perfil ADMIN, dados sintéticos) e relido no código:

- `ds/EzTabs.tsx:56` (pills): `outline-none focus-visible:ring-2 focus-visible:ring-brand-200`. `brand-200` é `#94ccbd`, **1,81:1** sobre branco (cálculo a partir de `styles.css`). Abaixo de 3:1 (WCAG 1.4.11).
- `ds/EzTabs.tsx:76` (line): `outline-none focus-visible:bg-gray-80`. Não há anel; o único sinal é um fundo `#f9f9f9` sobre branco.
- `ds/EzCheck.tsx:44`: `focus-visible:ring-2 focus-visible:ring-brand-200 focus:outline-none`. Mesmo 1,81:1.
- Semântica: o `EzTabs` emite `role="tab"` e `aria-selected`, mas nenhum `id`, `aria-controls`, `tabindex` nem tecla. Medido na Mesa: 12 `role=tab`, 0 `role=tabpanel`, 0 `aria-controls`; ArrowRight não troca a aba; as 12 abas ficam na ordem do Tab (12 paradas antes do formulário).
- A área rolável das abas (`overflow-x-auto`) corta qualquer anel desenhado fora da caixa do botão: o anel `ring-2` atual, sem folga, é cortado em cima e embaixo (a altura da lista é a do botão).
- Há mais de 60 pontos de foco no DS e nas telas (`focus-visible:ring-brand-600` em Kanban, atalhos e links; `ring-brand-200` ou `ring-brand-500` em outros). Não há token único.
- `EzTabs` tem 11 usos (Relatórios, Dashboard, Grupos técnicos, Grupos de permissão, Organizações, Mesa, Detalhe do ticket, Meu cadastro, Usuários, modal de configuração de tela e `TicketFormMode`); `EzCheck` em 15 arquivos.

## Conflitos com as demais entregas (conferidos nas fontes)

- **DMTE-531 (integrada):** só removeu duas classes no uso das abas da Mesa e não mexeu em `EzTabs.tsx`. As abas continuam numa linha que rola; esta entrega preserva isso.
- **DMTE-528 (integrada):** pôs `focus-visible:ring-brand-500`/`ring-brand-600` em botões do Kanban. Esta entrega não troca esses pontos (ver "Fora do escopo"); o token novo vale para eles quando migrarem.
- **DMTE-533 (salvamento, próxima):** mexe no corpo das abas em `ServiceDesksPage.tsx`. Esta entrega mexe no uso de `EzTabs` e no contêiner do corpo (`EzCardItem`, ~`:485-491`), nada no conteúdo de cada aba; conflito textual possível só nas primeiras linhas do corpo, e a DMTE-533 vem depois.
- DMTE-534/537 (Conhecimento), DMTE-538 (Contratos), DMTE-544 a 546 (Cofre): sem PR aberto nos arquivos desta entrega (`gh pr list` em 2026-11-16 e `git log origin/main`).

## Decisões (propostas do planejamento dentro do pedido aprovado)

1. **Token único de foco, em `styles.css`.** `--color-focus` (= `brand-600`, 4,64:1 sobre branco), `--focus-ring-width: 2px` e `--focus-ring-offset: 2px`, mais duas utilidades Tailwind: `ez-focus` (contorno com folga, para controles soltos) e `ez-focus-inset` (contorno por dentro da caixa, para controles dentro de área que rola e corta). Contorno (`outline`) e não `ring`/`box-shadow`: segue o raio do elemento, aparece em modo de alto contraste (`forced-colors`) e não depende de `outline-none` como hoje.
2. **Só `EzTabs` e `EzCheck` migram agora** (pedido do item 4). A migração dos demais pontos de foco fica para entrega própria; o token existe e a regra "foco novo usa `ez-focus`" fica no DS parity.
3. **Abas: `ez-focus-inset` nas duas variantes.** Dentro de `overflow-x-auto` um contorno com folga seria cortado; por dentro o indicador fica inteiro e não muda a altura nem a largura da lista. Contraste medido do `brand-600` sobre os fundos da aba: branco 4,64:1, `gray-90` (hover) 3,86:1, `brand-100` (aba ativa) 3,24:1; todos ≥ 3:1. A variante `line` ganha o anel (hoje só muda o fundo).
4. **`EzCheck`: `ez-focus` (com folga 2 px).** A caixa do checkbox é solta no layout, sem área que corte; `appearance-none` não impede o contorno.
5. **Abas navegáveis por teclado (padrão ARIA de abas, ativação automática).** Tabindex móvel: só a aba ativa (ou, sem aba ativa na lista, a primeira habilitada) entra na ordem do Tab; as demais ficam com `tabindex=-1`. ArrowRight/ArrowLeft movem o foco e ativam a aba vizinha habilitada, com volta ao fim/início; Home e End vão à primeira e à última habilitada. Ativação automática porque o item pede que a seta troque a aba e porque o painel é local (sem carga remota na Mesa); riscos nas outras telas em "Riscos".
6. **Painel associado por prefixo opcional, sem componente novo.** Prop opcional `idPrefix`: com ela, cada aba ganha `id` e `aria-controls`, e o DS exporta `ezTabId(prefix, tabId)` e `ezTabPanelId(prefix, tabId)` para o consumidor montar o painel (`role="tabpanel"`, `id`, `aria-labelledby`). Sem `idPrefix` o componente não emite `id` nem `aria-controls` (não aponta para painel que não existe) e as outras 10 usos só ganham o tabindex móvel e as teclas. A Mesa passa `idPrefix` e marca o `EzCardItem` do corpo como painel da aba ativa. As teclas e o tabindex só valem com `role` padrão (`tablist`); com `role` customizado o comportamento é o de hoje.
7. **Fora do escopo:** salvamento (DMTE-533), troca dos demais pontos de foco, painéis nos outros 10 usos, indicador visual de rolagem das abas, `EzSegmented` e demais componentes, alteração de API, schema, regra, rótulos ou ordem das abas.

Não aplicável: grill-with-docs → to-spec → to-tickets completos. Correção de acessibilidade aprovada item a item, na forma da DMTE-525/530/531 (uma SPEC, uma issue GitHub, um PR, sem sub-issues). A única decisão fora do pedido literal é a ativação automática (D5); está registrada para o aceite do Alfredo.

## Acceptance criteria

- AC-01: `styles.css` define `--color-focus` igual a `var(--color-brand-600)`, `--focus-ring-width: 2px`, `--focus-ring-offset: 2px` e as utilidades `ez-focus` e `ez-focus-inset` (contorno sólido em `--color-focus` com a largura do token; `ez-focus` com folga do token e `ez-focus-inset` com folga negativa de mesmo valor, ambos só em `:focus-visible`); o contraste de `brand-600` calculado a partir de `styles.css` é ≥ 4,5:1 sobre branco e ≥ 3:1 sobre `gray-90` e `brand-100`.
- AC-02: `EzTabs` (pills e line) usa `ez-focus-inset` e nenhuma das duas variantes mantém `outline-none`, `focus-visible:bg-gray-80` ou `ring-brand-200`; `EzCheck` usa `ez-focus` e não mantém `focus:outline-none` nem `ring-brand-200`.
- AC-03: tabindex móvel: com um `tablist` padrão, a aba ativa tem `tabindex=0` e as outras `tabindex=-1`; sem aba ativa na lista, a primeira habilitada tem `tabindex=0`; abas desabilitadas continuam fora do foco.
- AC-04: ArrowRight/ArrowLeft movem o foco para a aba habilitada seguinte/anterior, com volta ao fim e ao início, e chamam `onChange` com o id dela; Home e End vão à primeira e à última habilitada; abas desabilitadas são puladas; outras teclas não chamam `onChange`; com `role` customizado nada disso se aplica.
- AC-05: com `idPrefix`, cada aba tem `id=ezTabId(prefix, id)` e `aria-controls=ezTabPanelId(prefix, id)`; sem `idPrefix`, nenhuma aba tem `id` nem `aria-controls` emitidos pelo componente; a API existente (props, `role`, `variant`, `className`) continua aceita sem mudança e as outras telas que usam `EzTabs` passam na suíte `web`.
- AC-06: na Mesa, as 12 abas têm `aria-controls`, existe um único `role=tabpanel` com `aria-labelledby` igual ao `id` da aba ativa (e `id` igual ao `aria-controls` dela), o painel acompanha a aba ao trocar por clique e por seta, e rótulos e ordem das 12 abas não mudam.
- AC-07: em Chromium a 1440 e 390 px, na Mesa: o foco por teclado em aba (pills) e em checkbox (`EzCheck` do `MesaFlagEditor`) tem contorno de 2 px em `rgb(0, 133, 97)` (computed style) e o contorno da aba não é cortado pela lista; um Tab sai da aba ativa direto para o conteúdo do painel; ArrowRight troca a aba ativa e mantém o foco nela; a contagem é 12 `role=tab`, 1 `role=tabpanel`, 12 `aria-controls`; a página não ganha rolagem horizontal.
- AC-08: `EzTabs.stories.tsx` ganha a história com painel e teclado (`idPrefix`) e `EzCheck.stories.tsx` uma história de foco; `docs/architecture/03-sankhya-ds-parity.md` registra o token, as utilidades e a regra; os testes de DS (`EzTabs.test.tsx`, `EzCheck.test.tsx`) cobrem AC-02 a AC-05.

## Testes (seams: componente do DS e página, nível do projeto: vitest + Testing Library; foco medido no navegador)

- AC-01: `apps/web/src/styles.focus.test.ts` lê `styles.css`, confere token e utilidades e calcula o contraste.
- AC-02 a AC-05: `apps/web/src/components/ds/EzTabs.test.tsx` (tabindex móvel, teclas, `idPrefix`, role customizado, classes de foco) e `EzCheck.test.tsx` (classe de foco).
- AC-06: `apps/web/src/pages/ServiceDesksPage.test.tsx` (tablist e painel na tela real, por clique e por seta).
- AC-07: `scripts/mesa_focus_check.mjs` (novo; Chromium com dados sintéticos, mesma montagem de `mesa_responsive_check.mjs`; jsdom não resolve `outline` de utilidade nem layout). A base "antes" é gravada com `--no-assert --json` para mostrar a diferença.
- AC-08: story conferida pelo build do Storybook no CI (build não é teste de interação nem a11y; dito no PR); documentação conferida por leitura.
- `python3 scripts/aponta_delivery.py check --manifest .delivery/deliveries/DMTE-532.json` e a suíte `web` completa antes do QA (`EzTabs`/`EzCheck` são compartilhados).

## Evidência visual e aceite

Capturas antes e depois, a 1440 e 390 px, da aba e do checkbox em foco na Mesa, com dados fictícios, e a medição do script. Aceite visual é do Alfredo; captura não substitui a decisão humana. O relatório completo segue na DMTE-520.

## Riscos

- **`EzTabs`/`EzCheck` no app inteiro:** o anel muda de `brand-200` (fraco) para `brand-600` em 11 usos de abas e 15 arquivos com checkbox; é o efeito pedido. Mitigação: suíte `web` completa e capturas das duas variantes.
- **Tabindex móvel nos outros 10 usos de abas:** as abas inativas saem da ordem do Tab (padrão ARIA, mas muda o hábito de quem navega só com Tab) e a seta passa a trocar a aba. Em telas em que a troca de aba dispara carga (Dashboard, Relatórios), navegar por seta pode disparar várias cargas seguidas. Mitigação: conferido nos testes existentes; se o Alfredo preferir ativação manual (seta move, Enter/Espaço ativa), é troca de uma linha no `EzTabs` e de dois testes; decisão D5 aberta para o aceite.
- **Teste que usava Tab entre abas:** a suíte `web` completa roda antes do QA; qualquer teste que dependa de o Tab parar em aba inativa é corrigido na própria entrega (sem mudar comportamento além do especificado).
- **`styles.css` é global:** utilidades novas com nomes `ez-*`, sem sobrescrever utilidade do Tailwind; build do web e do Storybook conferem.
- Sem impacto em RBAC, tenant ou API: só apresentação e semântica, na tela já restrita a ADMIN.
