# Paridade Sankhya DS (`ez-*`) → Aponta DS

Documento de decisão arquitetural. O Aponta DS mira **paridade funcional** com o
catálogo Sankhya DS (`ez-*`, documentado em
`gilded-nasturtium-6b64dd.netlify.app`), mas **sem replicar APIs imperativas ou
composições legadas que não são idiomáticas em React**.

Regra geral: antes de implementar um componente novo, verificar se o nome
`ez-*` já não é atendido por um equivalente Aponta — duplicar componentes com
API diferente para "paridade de nome" gera custo de manutenção sem ganho real.

## Equivalências oficiais (não criar componente novo)

| Sankhya DS | Aponta DS | Justificativa |
|---|---|---|
| `ez-tabselector` | `EzTabs` | Mesma função (seleção de aba ativa). `EzTabs` usa API controlada React (`value`/`onChange`), enquanto `ez-tabselector` é imperativa (`setActive()`). Idiomático React > paridade literal de API. |
| `ez-multi-select-input` | `EzMultiSelect` | Mesma função (seleção múltipla com tags). Sankhya implementa como composição de `ez-popover` + `ez-list`; `EzMultiSelect` encapsula tudo num único componente controlado — padrão React mais limpo. |
| `ez-grid` (engine completa) | `EzGridWrapper` + Tanstack React Table | `ez-grid` da Sankhya é uma engine completa (paginação server-side, edição inline, `DataUnit`, totalizadores, filtro de coluna). Decisão deliberada e documentada no próprio código: usar Tanstack React Table como engine e `EzGridWrapper` como skin DS. Reimplementar a engine Sankhya seria reinventar uma lib madura. |
| `ez-sidebar-button` | `EzSidebarButton` (em `EzSidebar.tsx`) | Já existia embutido no `EzSidebar` — não criar arquivo standalone. |
| `ez-empty-card` | `EzEmptyCard` (em `EzCardItem.tsx`) | Versão conectada às páginas reais (`OrganizationsPage` etc.) vive em `EzCardItem.tsx`. Existe uma implementação standalone em `EzEmptyCard.tsx` (com testes próprios) **não exportada pelo barrel** — consolidar é refactor futuro. |
| `ez-file-item` | `EzFileItem` (em `EzUpload.tsx`) | Idem: versão em uso (TicketForm) vive em `EzUpload.tsx`; standalone em `EzFileItem.tsx` não é re-exportada. |
| `ez-list-item` | `EzListItem` (em `EzList.tsx`) | Idem: versão em uso (`EzDoubleList`) vive em `EzList.tsx`; standalone em `EzListItem.tsx` não é re-exportada. |

## Componentes criados para paridade (barrel `index.ts`)

Os seguintes componentes foram criados porque eram gaps reais (não tinham
equivalente funcional no Aponta DS) — todos com testes e tokens DS:

`EzActionsButton`, `EzAlertList`, `EzCalendar`, `EzChart`, `EzChip`,
`EzClassicComboBox`, `EzClassicInput`, `EzClassicTextArea`, `EzCollapsibleBox`,
`EzDateTimeInput`, `EzDialog`, `EzFilter`, `EzFilterInput`, `EzForm`,
`EzFormView`, `EzGridView`, `EzGuideNavigator`, `EzLineChart`, `EzModalContainer`,
`EzMultiSelectionList`, `EzNumberInput`, `EzPopoverPlus`, `EzPopup`, `EzScrim`,
`EzScroller`, `EzSearchPlus`, `EzSortableList`, `EzSplitButton`, `EzSplitPanel`,
`EzTagInput`, `EzTextEdit`, `EzTileMedium` (único criado após auditoria
completa), `EzTimeInput`, `EzTree`, `EzUnderface`.

## Seletor de escolha única: `EzSelect` (DMTE-490)

O `<select>` nativo não permite estilizar a lista aberta (é o navegador que a desenha). `EzSelect` é o único seletor de escolha única do Aponta: lista própria na paleta `brand-*`/`gray-*`, teclado (setas, Home, End, Enter, Esc) e padrão ARIA de listbox. Um `<select>` nativo escondido continua no DOM como controle de formulário (recebe `id`, `name`, `ref`, `data-testid` e dispara `onChange`). `EzComboBox` e `EzClassicComboBox` mantêm a API e renderizam por ele (`variant="classic"` no segundo). `<select>` cru fora do `EzSelect` é reprovado por `scripts/check_native_select.py` no CI.

## Como decidir no futuro

1. Nome `ez-*` novo apareceu numa spec da Sankhya? Procurar primeiro em
   `apps/web/src/components/ds/` por equivalente funcional.
2. Existe equivalente com API diferente? Documentar aqui na tabela acima —
   **não** criar duplicata com API Sankhya idêntica.
3. Não existe equivalente funcional? Criar componente novo seguindo o padrão
   do DS (`forwardRef`, `cn()`, tokens `brand-*`/`gray-*`, JSDoc nas props,
   testes com ≥3 casos, story Storybook).

## Convenção: cadastro em modo formulário (dados oficiais travados + proporção)

Decisão tomada no cadastro de Clientes (`OrganizationsPage.tsx`, DMTE-11) e que
vale para qualquer tela futura de cadastro ("modo formulário") que busque dados
de uma fonte externa oficial (ex.: CNPJ/Razão Social via Receita Federal):

- **Campo vindo de fonte oficial externa fica travado (`disabled`) após a
  busca ter sucesso**, com uma ação explícita ("Editar manualmente") para
  destravar. Nunca travar o campo *antes* da busca — cadastro 100% manual
  (sem consultar a fonte externa) continua livre, sempre.
- **Campo de texto longo (nome/razão social) ocupa o dobro da largura de
  campo de código/identificador** (`colSpan`/grid proporcional), evitando a
  grade "quadriculada" genérica onde todo campo tem a mesma largura.

Essa convenção **não está em um componente compartilhado** — `EzEntityForm`
(`apps/web/src/components/ds/EzEntityForm.tsx`) é genérico por desenho (recebe
um `schema` via prop, sem vínculo com nenhuma entidade específica), mas hoje
nenhuma tela em produção o usa; cada tela de cadastro (Clientes, Mesas,
Chamados, Contratos) tem seu próprio formulário. Migrar para um componente
compartilhado seria abstração prematura com um único consumidor real. Decisão:
replicar esta convenção manualmente em cada tela que precisar dela até existir
um **segundo** caso de uso real — nesse momento, extrair para o `EzEntityForm`
(adicionando `readOnly` ao schema de campo) passa a valer a pena.

## Paleta única e escala de proporção na aba Tickets (DMTE-427 fatia 1)

ADR `docs/adr/0001-paleta-unica-brand-na-aba-tickets.md`. Decisão I1/D5/D6,
fechada pelo Developer na fatia 1 com medidas reais, não com os valores
hipotéticos (36px/8px) da SPEC v2 — a SPEC marcava esses números como
`[Proposta]`, a serem fixados por quem implementasse com a renderização real.

- **Paleta**: a aba Tickets (`apps/web/src/pages/Ticket*.tsx`,
  `CreateTicketPage.tsx`, `apps/web/src/components/tickets/*.tsx`) usa somente
  `brand-*` e as paletas semânticas do DS (`gray-*`, `green-*`, `yellow-*`,
  `red-*`, `petroleum-*`). Sem hex literal, sem `teal-*`/`emerald-*`/`rose-*`,
  sem grau de `gray` fora da escala do DS (`gray-50`, `gray-950` etc. — o DS
  define apenas 70/80/90/100/200…900/1000). Verificado em CI por
  `scripts/check_tickets_palette.py` (AC-01).
- **Altura de controle** (`--control-height-md: 42px`,
  `--control-height-compact: 32px`, em `apps/web/src/styles.css`): os mesmos
  valores que `EzButton`/`EzTextInput`/`EzSearch`/`EzComboBox`/`EzDateInput`
  já usam como tamanho "medium"/"small"/"slim" — nenhum valor novo. A
  inconsistência real (`h-[34px]`/`h-[38px]` ad hoc na toolbar do Kanban, da
  Lista e do cabeçalho) foi normalizada para esses dois. Verificado em CI por
  `scripts/check_tickets_proportion.py` (AC-02).
- **Raio e sombra** (`--radius-control: 10px`, `--radius-card: 16px`,
  `--shadow-card`, `--shadow-popover`, também em `styles.css`, geram as
  utilities `rounded-control`, `rounded-card`, `shadow-card`,
  `shadow-popover`): documentados nesta fatia, com `rounded-control` e
  `shadow-popover` já aplicados aos controles e popovers da toolbar que
  tiveram a altura normalizada (Mesa, Ordenar, Configurações e seus menus no
  Kanban; busca e Busca avançada no cabeçalho; Exibir colunas na Lista).
  `rounded-card` e `shadow-card` ficam definidos, documentados na story e sem
  consumidor em código de produto ainda — aplicá-los a cartões do Kanban,
  chips e badges de outras superfícies da aba é trabalho das fatias 2–6 (cada
  uma já toca essas superfícies com seus próprios ACs); não foi replicado às
  cegas aqui sem captura de tela para comparar.
- Story de documentação: `apps/web/src/components/ds/EzDesignTokens.stories.tsx`
  (`DS/Tokens de proporção (D6)`).

## Chip de prazo no Kanban (DMTE-427 fatia 2)

O cartão do Kanban mostrava o SLA como pílulas largas ("Resposta: Dentro do prazo"), empilhadas. A fatia 2 troca isso por `EzSlaChip` (`apps/web/src/components/ds/EzSlaChip.tsx`): ícone (resposta ou resolução) + tempo restante, negativo quando vencido, com o texto completo no nome acessível e no tooltip.

- Sem equivalente oficial no Sankhya: `EzTag` leva só texto e ícone fixo, sem cálculo de tempo. O chip é novo, não uma variante de `EzTag`, para não mexer em outras telas que usam `EzTag` (risco R1 da SPEC).
- Cores: pares `green-800/green-100`, `yellow-800/yellow-100` e `red-800/red-100`, todos do DS. O teste do chip confere contraste mínimo AA (4.5:1) lendo os tokens de `styles.css`.
- Dados: usa o estado já calculado pelo backend (`responseSlaStatus`/`resolveSlaStatus`) e os prazos que o ticket já tem. Sem prazo conhecido, mostra só o ícone e a palavra curta (DMTE-528). Nos dois prazos (resposta e resolução), o tempo soma as pausas acumuladas e a pausa em curso, na mesma regra de `getSlaStatus` (apps/api), para não contradizer o estado. Sem mudança de API.
- `SlaBadge` continua no detalhe do ticket e passa a delegar ao chip quando o detalhe for tratado (fatia 5).
- Story: `EzSlaChip.stories.tsx`. Testes: `EzSlaChip.test.tsx`.
- Coluna do Kanban com 290px (antes 320px, `w-80`).

## Controle segmentado Lista/Kanban (DMTE-427 fatia 3)

O alternador Lista/Kanban do cabeçalho de Tickets era um par de botões com classes próprias, sem estado exposto a leitor de tela. A fatia 3 troca isso por `EzSegmented` (`apps/web/src/components/ds/EzSegmented.tsx`).

- Verificado antes de criar (I2 da SPEC): `EzTabs` não cobre o caso. Ele expõe `role="tab"` e `aria-selected`, o que pressupõe painéis de aba, e o alternador troca a visão do mesmo conteúdo. As variantes `line` e `pills` também não têm o formato segmentado, e o `EzTabs` não emite `aria-pressed` nem usa a altura de controle. O raio do container passa a ser `rounded-control` (10px), no lugar do `rounded-[8px]` antigo, pela escala da fatia 1.
- `EzSegmented` é um grupo nomeado (`role="group"` com `aria-label`) de botões com `aria-pressed`, altura do token `--control-height-md` (alinhado com Buscar e Busca avançada) e anel de foco visível. Opção pode ser desabilitada. Desde a DMTE-527 aceita `size` (`default` mantém 42 px; `toolbar` usa `--control-height-toolbar`, 36 px a partir de `sm`, e 44 px abaixo).
- `EzTabs` não foi alterado. Os testes que buscavam os botões "Lista" e "Kanban" por papel `button` seguem valendo.
- Story: `EzSegmented.stories.tsx`. Testes: `EzSegmented.test.tsx` (5 casos), `TicketsHeader.test.tsx` e `TicketsPage.test.tsx`.

## Lista, filtros ativos e paginação (DMTE-427 fatia 4)

Nenhum componente novo no DS nesta fatia; só reaproveitamento.

- **Filtros ativos** (`TicketActiveFilters`, em `components/tickets`, não no DS): chips com `EzTag` (variante `gray`) e a ação "Redefinir filtros" com `EzButton` (`tertiary`). Mostra só filtros que a tela já suportava (URL e Busca avançada); filtro que guarda só um id mostra o nome do campo ("Cliente", "Mesa de serviço"), não o valor. Página, ordenação e o filtro por avatar do Kanban não contam. Fica visível também durante o carregamento e quando a consulta falha, para dar para limpar um filtro que quebra a lista.
- **Paginação:** "Anterior" e "Próxima" passam de botões nativos com classes próprias para `EzButton` (`secondary`, `small`). Comportamento e nomes acessíveis iguais; os testes existentes seguem valendo.
- **Grupos da Lista:** o botão do cabeçalho do grupo continua um `<button>` nativo (uma linha de tabela clicável não tem equivalente no DS), agora com chevron e `aria-expanded`, `rounded-control` e anel de foco por token.
- **Fora desta fatia:** linhas de altura fixa e contagem do grupo mais discreta (D10) ficam para a fatia 7, que revisa as capturas por largura; o ajuste visual depende do aceite do Alfredo.

## Busca avançada e Criar ticket (DMTE-427 fatia 5)

As duas telas já usavam `EzComboBox`, `EzTextInput`, `EzButton` e `EzCardItem`. A fatia 5 troca só o que ainda fugia do DS; nenhum componente novo.

- **Filtros adicionais da Busca avançada:** os quatro checkboxes nativos (Meus, Não atendidos, Pausados, Vencidos) passam para `EzCheck`, com `id` e rótulo próprios. O mapeamento para `mine`/`unassigned`/`paused`/`overdue` não mudou. O bloco que abre e recolhe esses filtros usa `EzCollapsibleBox` (cabeçalho com `aria-expanded` e chevron), no lugar do `<details>`/`<summary>` nativo; o DS já tinha esse componente, e a justificativa anterior de que não havia equivalente estava errada. O formulário passa de `max-w-3xl` para `max-w-5xl` com três colunas em telas largas (o intervalo De/Até ocupa duas).
- **Criar ticket:** o banner de erro do formulário passa a ser `EzAlert` (`error`), que tem `role="alert"` e é anunciado por leitor de tela. O cartão do formulário usa os tokens `rounded-card` e `shadow-card` da fatia 1, no lugar do raio e da sombra literais. "Voltar para o catálogo" e "Meu problema não está catalogado" passam de botões nativos para `EzButton` (`tertiary`); o botão do item do catálogo usa `rounded-card`.
- **Comportamento:** igual, com uma única exceção: o erro de envio agora tem `role="alert"` (vem do `EzAlert`). Nomes acessíveis dos botões mantidos.
- **Mudanças visuais, sem captura ainda** (dependem do aceite do Alfredo na fatia 7): o rótulo dos checkboxes passa de 13px para 14px (tamanho fixo do `EzCheck`); o título "Filtros adicionais" passa de 13px médio para 14px semibold, dentro de uma caixa com raio de 12px e chevron (do `EzCollapsibleBox`), e o conteúdo ganha divisória e mais respiro. Comportamento: o `EzCollapsibleBox` desmonta o conteúdo quando recolhido (o `<details>` o mantinha no DOM), então os checkboxes saem da tela, do foco e da árvore de acessibilidade enquanto fechado; o estado continua no formulário da página e o que foi marcado volta marcado ao reabrir (teste de caracterização, sem RED, em `TicketAdvancedSearchPage.collapsible.test.tsx`); a Busca avançada fica mais larga (`max-w-5xl`, três colunas em tela larga), o que é uma proposta, não um pedido da SPEC; "Meu problema não está catalogado" deixa de ser texto sublinhado cinza e vira um botão `tertiary` na cor de marca, que pode quebrar linha em tela estreita; "Voltar para o catálogo" passa a ser o botão quadrado do `EzButton` sem rótulo, com o nome acessível no `aria-label`.
- **Continua nativo, de propósito:** o `<button>` de cada serviço do catálogo (o `EzButton` não tem formato de linha de cartão). DMTE-485: o catálogo passa a ter um `EzCardItem` por categoria (`role="region"` rotulada pelo título), com os serviços numa lista de botões nativos dentro dele, em 1/2/3 colunas (`columns-*`, `break-inside-avoid`). O botão "Meu problema não está catalogado" é um `EzButton` terciário no cabeçalho, com `className` para quebrar linha no celular (`h-auto whitespace-normal`); o seletor de Cliente é um `EzSearch`.
- **DMTE-499:** a Busca avançada deixa de ter teto de largura (`max-w-5xl` removido do contêiner), como a tela de novo ticket (DMTE-493), por decisão do Alfredo em 2026-11-12. A grade de três colunas e o restante do formulário não mudam; isso substitui a proposta de `max-w-5xl` descrita acima.

## Detalhe do ticket (DMTE-427 fatia 6)

Nenhum componente novo no DS. A paleta do detalhe já estava limpa desde a fatia 1 (a checagem estática cobre `TicketDetailPage`, `TicketCsat` e `TicketWorklogs`); esta fatia troca o que ainda fugia do DS em forma, raio e acessibilidade.

- **Avaliação (CSAT), acessibilidade:** as cinco estrelas eram cinco botões com o mesmo nome acessível ("★") e sem estado. Agora são um grupo nomeado por `aria-labelledby` (rótulo visível "Nota", que deixou de ser um `<label>` sem controle e virou um `<span>`) com botões "Nota N de 5" e `aria-pressed` na escolhida. Na visão só de leitura, a nota vira um único `role="img"` ("Nota 4 de 5") em vez de cinco botões desabilitados, o que também tira o hover e o cursor padrão que eles tinham. É uma mudança de comportamento (semântica), com testes, e a única da fatia além de trocas de componente. Escolhi grupo com `aria-pressed`, como o `EzSegmented`; um `radiogroup` (ou o `EzRadioButton`) seria semanticamente mais exato para escolha única, mas pede setas de teclado e foco móvel, e fica como melhoria futura.
- **Avaliação (CSAT), visual:** "Enviar Avaliação", "Cancelar" e "Alterar Nota" passam a `EzButton`; as estrelas ganham anel de foco e `rounded-control`; o cartão usa `rounded-card`, `shadow-card` e `border-gray-100`.
- **Abas do detalhe:** os cinco botões de ação sem comportamento ainda ("+ Compromisso", "+ Valor extra", "+ Assinatura", "+ Criar issue", "+ Associar issue") passam de botões nativos com raio de 6px para `EzButton`. Os rótulos e o fato de não terem ação continuam iguais.
- **Raios:** `rounded-[8px]` e `rounded-[10px]` do `TicketDetailPage` e do `TicketWorklogs` passam a `rounded-control`. Ficam literais, de propósito, os raios de 6px e 4px do `TicketWorklogs` (botões pequenos e checkboxes dentro de um arquivo de 1700 linhas, risco R6 da SPEC); eles pertencem a uma revisão própria depois do aceite visual.
- **Continua nativo:** os dois `<select>` do cabeçalho do ticket (Status e Atribuído a), os botões do `TicketWorklogs` e o `<textarea>` do CSAT. Trocá-los por `EzComboBox` e `EzButton` mexe no layout do cabeçalho e do apontamento, que não tenho como validar sem captura.
- **Mudança visual sem captura:** botões `EzButton` ocupam a altura do DS, então ficam um pouco maiores que os de 12px anteriores. Depende do aceite da fatia 7.

### Ainda pendente para a fatia 7 (conferido por `grep`, sem captura)

A fatia 6 não zerou o AC-12 no detalhe. O que continua fora dos tokens ou do DS, para decidir com as capturas por largura:

- **Raios fora de token** (`rounded-lg`, `rounded` simples, `rounded-[6px]`, `rounded-[4px]`): `TicketDetail` (2), `TicketComments` (1), `TicketAttachments` (3), `TicketChecklist` (2 + 1), `TicketParent` (3 + 1), `CommentForm` (1), `TicketCsat` (1 + 1) e `TicketWorklogs` (18 `rounded` simples e 10 `rounded-[Npx]` de 6px e 4px). Não troquei porque cada um pode virar `rounded-control` (10px) ou `rounded-card` (16px) conforme o papel (campo, cartão, chip), e escolher sem ver a tela é chute.
- **Controles nativos estilizados à mão:** os dois `<select>` do cabeçalho do ticket (Status e Atribuído a), os 18 botões e 3 inputs do `TicketWorklogs`, o botão de `TicketParent`, o input de `TicketAttachments`, o `<textarea>` da CSAT e o botão redondo de parar o pré-apontamento no `TicketDetailPage`.
- **Cor semântica de erro** (`text-red-*`) em anexos, checklist e parent: usa a paleta do DS e passa na checagem estática; fica só como registro.

## Responsividade e celular (DMTE-427 fatia 7)

Nenhum componente novo no DS. Por decisão do Alfredo (2026-11-08), o celular entrou no escopo, medido em 390px, e com ele o shell global. Capturas por largura (1440, 1280, 1024, 768 e 390px) com dados sintéticos e API simulada no navegador, mostrando as telas Kanban, Lista, Lista com filtros, Busca avançada, Criar ticket e Detalhe, mais o menu aberto em 390px.

O que a primeira captura mostrou em 390px: a barra lateral fixa de 240px ocupava 62% da tela e deixava cerca de 150px para o conteúdo; o campo de busca e o botão "Busca avançada" saíam da tela; o título do detalhe ficava numa coluna de 150px e se sobrepunha ao seletor "Atribuído a". Em qualquer largura, os cartões do Kanban mostravam um marcador de lista (`•`) e a barra lateral terminava antes do fim da tela.

- **Menu retrátil (AC-17):** abaixo de 768px o menu lateral some e o cabeçalho ganha o botão "Abrir menu" (44px, `aria-expanded`, `aria-controls`). O painel é um `role="dialog"` modal com foco que entra ao abrir e volta ao botão ao fechar, botão "Fechar menu" visível e fechamento por Esc, toque fora ou ao escolher um destino. Dentro dele o botão "Esconder" não existe (não faz sentido em tela pequena). Desde 768px o menu continua fixo, agora `sticky` com altura da tela, o que corrige a barra que terminava antes do fim.
- **Cabeçalho e conteúdo:** margem do conteúdo de 12px no celular (24px desde 640px); título e busca do cabeçalho da aba quebram em linhas (busca ocupa a linha inteira no celular).
- **Kanban:** cartões sem marcador de lista.
- **Lista:** a tabela ganha largura mínima de 720px e rola na horizontal dentro de uma região focável e nomeada ("Tabela de chamados"), em vez de espremer as colunas; o número do chamado não quebra linha e o título tem largura mínima.
- **Detalhe:** título, seletores de status e de responsável se empilham no celular.
- **Busca avançada e Criar ticket:** já cabiam em 390px, sem mudança.

- **Acessibilidade do menu (achados da revisão `web-design-guidelines` e do code-review):** com o painel aberto, o resto da página fica `inert` (Tab e leitor de tela não saem do painel), a rolagem do fundo é travada, e o painel se fecha sozinho se a tela crescer até 768px, para a barra fixa e o painel nunca coexistirem.
- **Detalhes pequenos que também mudaram:** campo de busca do cabeçalho com `name="search"` e `autoComplete="off"`; título do detalhe de 24px para 20px até 640px, com quebra de palavra; painel do menu com largura máxima de 85% da tela; tabela da Lista com `min-w-[720px]`, número do chamado sem quebra e título com largura mínima de 14rem; borda da região da tabela passa de `rounded-[10px]` para `rounded-control`.
- **Outras páginas do shell (Dashboard, Relatórios, Clientes, Mesa, Contratos, Agenda, Configurações e Conhecimentos):** capturadas em 390px e 768px só para medir rolagem horizontal da página (nenhuma passou da largura) e olhadas por amostra (Dashboard e Contratos usáveis). Não foram ajustadas nem validadas ponta a ponta; o menu retrátil e a margem de 12px valem para elas.

Não foi feito, de propósito: (a) menu recolhido por padrão entre 768px e 1023px (o menu fixo de 240px funciona, e o botão "Esconder" recolhe); (b) a lista de raios fora de token e controles nativos do detalhe registrada na seção da fatia 6, que continua pendente e não ganhou captura de decisão; (c) tabela da Lista em cartões no celular (hoje rola na horizontal). Não testado: toque real em aparelho, orientação paisagem e Safari; as capturas são do Chromium com viewport emulado.

## Dashboard: gráfico de linha no DS (DMTE-529)

`EzLineChart` (`apps/web/src/components/ds/EzLineChart.tsx`, story `DS/EzLineChart`) é o gráfico de linha da Dashboard, em SVG próprio, sem dependência nova (`recharts` continua sem uso). Eixo Y com 0, valor médio e máximo; rótulos do eixo X escolhidos pela largura medida do contêiner (no máximo 4 abaixo de 640 px e 7 acima, sempre com o último ponto, sem sobreposição); tooltip por hover do mouse, foco de teclado e toque; último ponto parcial (dia de hoje) como marcador vazado, sem segmento de queda; altura de 160 px abaixo de 640 px e 192 px a partir daí. A cor da série é um token do DS (`brand-600`, `green-600`, `gray-500`), nunca hex. Medido em Chromium nas quatro larguras por `scripts/dashboard_responsive_check.mjs` (evidência técnica, aceite visual é humano).

## Clientes: grade legível, painel de filtros e moldura compacta (DMTE-541)

Nenhum componente nem token novo. Seis mudanças no DS, todas verificadas por teste de classe e por medição em Chromium (390, 1024 e 1440 px, `scripts/clientes_responsive_check.mjs`, dados sintéticos; evidência técnica, o aceite visual é do Alfredo).

- **`EzFilterDrawer`:** abaixo de `xl` (1280 px) vira sobreposição sobre a grade (`absolute inset-y-0 left-0 z-20`, `max-w-[85%]`, `shadow-xl`); de `xl` em diante volta a ficar ao lado (`xl:relative`). O contêiner da grade nas páginas Clientes, Mesa e Contratos ganhou `relative` e o da grade `isolate`, para o botão de colunas da grade não pintar por cima do painel. `motion-reduce:animate-none` na entrada. Esc e o botão de fechar continuam iguais. Não há story do `EzFilterDrawer` hoje; exceção registrada no manifesto da entrega.
- **`EzEntityGrid`:** `meta.truncate` (uma linha com reticências, `title` com o texto inteiro, `size` como largura máxima), `meta.align: 'right'` (cabeçalho e células à direita, `tabular-nums`) e `meta.hideBelowSm`; a prop `compactBelowSm` esconde "#" e a seleção abaixo de 640 px. Todas desligadas por padrão, e com elas desligadas o markup é o de antes. Os checkboxes da grade (seleção, filtro de coluna, configurador) ganharam `accent-brand-600`. Corrigido junto: o espaço digitado numa célula editável era engolido pela navegação por teclado da linha (a barra de espaço alternava a seleção); agora a navegação ignora eventos de `input`, `textarea` e `select`.
- **`EzEntityToolbar`:** abaixo de 640 px a toolbar rola em uma linha (`max-sm:flex-nowrap max-sm:overflow-x-auto`), cada botão tem no mínimo 44 px (`max-sm:min-h-11 max-sm:min-w-11`) e os menus "Ações" e de modo abrem como folha na base da tela (`max-sm:fixed`), porque a linha que rola cortaria um menu absoluto. A partir de 640 px nada muda.
- **`EzPageHeader`:** compacto, com 8 px de padding vertical (era 16), linha mínima de 32 px (era 40), 16 px dos lados abaixo de 640 px e 24 px a partir daí; cerca de 49 px medidos (eram 73). Vale para as 7 páginas que o usam. `EzPageLayout` mantém o padding do corpo.
- **`TabBar`:** quando a rota atual não é uma aba aberta mas está no menu lateral, mostra uma aba ativa transitória com o título do menu (sem botão de fechar, fora do `sessionStorage`; some ao navegar).
- **`ActiveTag`** (`components/ActiveTag.tsx`): o status Ativo/Inativo de Contratos (`ContractActiveTag`) foi movido para um componente neutro e passou a valer também em Clientes e Usuários, sem mudar a aparência. Verde com check e cinza com traço, pares `green-800/green-100` e `gray-700/gray-90` a 4,5:1 ou mais, sem `emerald` cru.

## Mesa: toolbar e abas em tela estreita (DMTE-531)

Nenhum componente nem token novo. Medido em Chromium (390, 640, 768, 1024 e 1440 px, `scripts/mesa_responsive_check.mjs`, dados sintéticos; evidência técnica, o aceite visual é do Alfredo).

- **`EzEntityToolbar`:** os grupos de botões foram para uma linha interna que rola abaixo de 640 px (`max-sm:overflow-x-auto`) e vira `sm:contents` a partir daí; o contador de registros saiu do grupo da direita e fica fora dessa linha: abaixo de 640 px ocupa uma linha própria, alinhada à direita (`max-sm:self-end`), e a toolbar passa a ter no máximo 2 linhas com o contador inteiro; a partir de 640 px ele segue à direita dos botões, com a mesma borda e espaçamento (retângulos iguais, medidos). Sem prop nova; a rolagem em uma linha e os alvos de 44 px da DMTE-541 continuam. Ganha a story `DS/EzEntityToolbar` (Default; o caso estreito se vê reduzindo a janela, sem addon de viewport).
- **Abas da Mesa:** o uso do `EzTabs` em `ServiceDesksPage` deixou de anular a rolagem do componente (`flex-wrap overflow-visible` removido): as 12 abas ficam numa linha que rola. `EzTabs` não mudou.

## Tickets: escala de altura da barra, faixas fixas e preferências no servidor (DMTE-527)

Um token novo e uma opção de componente no DS; o resto reaproveita o que existe. Medido em Chromium (390, 1024 e 1440 px, `scripts/tickets_responsive_check.mjs`, dados sintéticos; evidência técnica, o aceite visual é do Alfredo).

- **`--control-height-toolbar: 36px`** (`apps/web/src/styles.css`), só para a barra da aba Tickets (título, busca, "Busca avançada", Lista/Kanban, Mesa, Ordenar, Configurações) a partir de `sm` (640 px). Abaixo de `sm` esses controles têm no mínimo 44 px (alvo de toque). Os filtros (atalhos, "Exibir colunas", "Agrupar por") ficam em `--control-height-compact` (32 px) a partir de `sm` e 44 px abaixo. `--control-height-md` (42 px) e `--control-height-compact` (32 px) não mudam e seguem valendo nas outras telas. O 36 px antes era registrado como placeholder sem medição; passa a ser exceção da barra de Tickets (decisão do Alfredo no Q1 da DMTE-527). `scripts/check_tickets_proportion.py` continua aceitando só 32 e 42 px literais: o 36 px entra apenas pelo token.
- **`EzSegmented`:** opção `size` (`default` = 42 px, `toolbar` = 36 px a partir de `sm`, 44 px abaixo), story `DS/EzSegmented` com os dois tamanhos.
- **Mesa do Kanban em contorno** (`brand-500` na borda, `brand-700` no texto, fundo branco): desfaz a cor cheia da DMTE-498, para "Novo Ticket" ser o único elemento preenchido da barra.
- **Cartão do Kanban:** agrupado por Status não mostra a tag de status (a coluna já diz) e o SLA sobe para a linha dela; nos outros agrupamentos a tag continua.
- **Colunas finais recolhidas** (Resolvido, Fechado e estágios `isFinal`) para quem nunca mexeu, com **faixas fixas na borda direita** a partir de `lg` (`position: sticky`, `scroll-padding` no quadro). O quadro usa `scroll-snap-type: proximity` e desliga o encaixe (`snap-none`) enquanto há um cartão sendo arrastado: com o encaixe ligado, a rolagem automática do arrastar voltava ao ponto de encaixe e o cartão não chegava à borda (medido em Chromium). A pesquisa de mercado está em `docs/research/kanban-quadro-largo-e-mobile.md`; nenhum produto pesquisado fixa faixas assim.
- **Preferências de tela no servidor** (ADR 0002): `useUserScreenConfig` lê e grava em `/me/screen-preferences/:screen` e importa uma vez o que o usuário tinha no `localStorage`.

## Kanban de Tickets: alvos, foco e legenda do SLA (DMTE-528)

Nenhum token, prop ou componente novo no DS; o resto reaproveita o que existe.

- **Alvos de 32 px** (WCAG 2.5.8) em "Mais ações" do cartão (`EzDropdown` por `className`) e em "Recolher coluna", com margem negativa para o cabeçalho manter a altura. O botão de recolher ganha `aria-label` "Recolher coluna <nome>" e o anel `focus-visible:ring-brand-500` que o botão de expandir já usa.
- **Avatares do filtro de responsável:** anel `focus-visible:ring-brand-600` e `z-10` ao focar, para o avatar focado não ficar coberto pelo vizinho; alvo de 28 px mantido.
- **`EzSlaChip`:** escreve "Resp." (resposta) ou "Solução" (resolução) antes do tempo, e só a palavra quando não há prazo. `aria-label` e `title` seguem com o texto completo.

## Foco único do DS e semântica das abas (DMTE-532)

Um token novo de foco e duas utilidades; nenhum componente novo. O foco do `EzTabs` e do `EzCheck` era `brand-200` (1,81:1 sobre branco, abaixo dos 3:1 da WCAG 1.4.11); a variante `line` das abas nem tinha anel.

- **Token (`styles.css`):** `--color-focus` (= `brand-600`: 4,64:1 sobre branco, 3,86:1 sobre `gray-90`, 3,24:1 sobre `brand-100`), `--focus-ring-width: 2px` e `--focus-ring-offset: 2px`. Utilidades `ez-focus` (contorno com folga, para controle solto) e `ez-focus-inset` (contorno por dentro da caixa, para controle dentro de área que rola e cortaria o anel de fora). É contorno (`outline`), não `ring`: segue o raio e aparece em `forced-colors`. Regra: foco novo no DS usa `ez-focus` ou `ez-focus-inset`; os demais pontos de foco do app (`ring-brand-200`, `ring-brand-500`, `ring-brand-600` soltos) migram em entrega própria.
- **`EzCheck`:** `ez-focus`. **`EzTabs`** (pills e line): `ez-focus-inset`.
- **`EzTabs`, teclado:** tabindex móvel (só a aba ativa, ou a primeira habilitada, entra na ordem do Tab); setas, Home e End movem o foco e ativam a aba (ativação automática, padrão ARIA de abas), pulando abas desabilitadas e voltando do fim ao início. Só com o `role` padrão (`tablist`); com `role` customizado o componente se comporta como antes.
- **`EzTabs`, painel:** prop opcional `idPrefix`; com ela cada aba ganha `id` e `aria-controls`, e o DS exporta `ezTabId(prefix, tabId)` e `ezTabPanelId(prefix, tabId)` para o consumidor montar o painel (`role="tabpanel"`, `id`, `aria-labelledby`). Sem `idPrefix` não há `id` nem `aria-controls` (não aponta para painel que não existe). A Mesa usa o `EzCardItem` do corpo como painel; os outros usos de `EzTabs` ganham só o tabindex móvel e as teclas.
- **Medido em Chromium** (1440 e 390 px, `scripts/mesa_focus_check.mjs`, dados sintéticos; evidência técnica, o aceite visual é do Alfredo): contorno de 2 px em `rgb(0, 133, 97)` na aba e no checkbox, aba focada dentro da lista que rola, 12 `tab`, 1 `tabpanel`, 12 `aria-controls`, seta troca a aba, Tab sai da lista para o conteúdo, End leva à última aba e o foco a traz para a área visível da lista (a 390 px ela fica fora da tela).

## Conhecimento: proporção, tokens, foco e semântica de cor (DMTE-535)

Nenhum token, prop ou componente novo no DS; o resto reaproveita o que existe. Medido em Chromium (390 e 1440 px, `scripts/knowledge_proportion_check.mjs`, dados sintéticos; evidência técnica, o aceite visual é do Alfredo).

- **Uma altura por linha:** `--control-height-md` (42 px) no cabeçalho (busca, `+ Novo artigo`) e na ordenação (combo e alternador Lista/Grade com `rounded-control`); `+ Nova pasta` e `Compartilhar` também em 42 px.
- **Terciárias** do card (`Ler artigo completo`, `Editar`, `Excluir`) com `px-0`, alinhadas à borda do conteúdo; `tailwind-merge` deixa o `px-0` vencer o `px-4` do `EzButton`.
- **Exceção declarada, primário local:** `bg-brand-600` (4,64:1) nos primários da tela, por `KNOWLEDGE_PRIMARY` em `components/knowledge/knowledgeStyles.ts`. O `EzButton` primário segue em `brand-500` (3,94:1) nas outras telas; corrigir no DS inteiro é entrega própria, e então a constante sai. O "Confirmar" do `EzDialog` fica em `brand-500` até lá.
- **Foco:** `FOCUS_RING` repete o anel do `EzButton` (`ring-4 ring-brand-200 ring-offset-2`) na tag clicável, no "×" do filtro e no alternador. A tag clicável tem `aria-pressed` e `Check` quando ativa.
- **Cor:** "Interno" em `petroleum` com cadeado; amarelo fica para alerta. Exclusão de artigo e de pasta por `EzDialog` (`danger`), não `window.confirm`.

## Usuários: dsgrid, Convite pendente e "Esqueci minha senha" (DMTE-550)

Nenhum componente nem token novo no DS. Uma prop opcional no `EzModal`, uma variante no `ActiveTag` e a tela Usuários no padrão de Mesa e Clientes. Evidência visual (390, 1024 e 1440 px, dados sintéticos) é técnica; o aceite visual é do Alfredo.

- **Usuários no dsgrid** (`pages/UsersPage.tsx`, `components/users/UserForm.tsx`): `EzEntityToolbar` (Novo usuário só com `CREATE_USERS`, Recarregar, configurar colunas, Grade/Formulário; sem Excluir nem Duplicar), `EzFilterDrawer` "Filtros de Usuários" (busca, Tipo em múltipla escolha, Status, grupo de atendentes, grupo de permissões, filtros dinâmicos e salvos), `EzEntityGrid` com `compactBelowSm` e `meta.hideBelowSm` (abaixo de 640 px só Nome e Status), colunas e densidade por usuário em `useUserScreenConfig('users', …)` e o modelo de salvamento da Mesa (`MesaSaveProvider`, linha "Alterações não salvas" e confirmação "Descartar alterações?"). Tipo, Status e grupos vão ao servidor em `GET /users`; só os filtros dinâmicos valem para a página carregada. Filtros e paginação não vão para a URL, como em Mesa e Clientes.
- **Ativar e Inativar em lote:** botões `EzButton` numa faixa abaixo da toolbar (escondida abaixo de 640 px, onde a seleção da grade também some), com `EzDialog` de confirmação; a toolbar não ganhou prop. A grade é refeita (`key`) quando página, filtros, colunas ou um lote aplicado mudam, para a seleção, que o `EzEntityGrid` guarda por posição de linha, não apontar para outro usuário.
- **`ActiveTag`:** nova variante `pending` ("Convite pendente"): `EzTag` `yellow` com ícone de relógio, par `yellow-800/yellow-100` (4,6:1) no mesmo teste de contraste. O estado vem de `active` e `pending` (senha ainda não definida); Inativo vence Convite pendente.
- **`EzModal`, `trapFocus`:** prop opcional, desligada por padrão (sem ela o markup é o de antes). Com ela, o foco entra no diálogo ao abrir (no `autoFocus` do conteúdo, senão no próprio diálogo, `tabIndex={-1}`), Tab e Shift+Tab ficam dentro, e o foco volta ao gatilho ao fechar (`useEscapeLayer`). Usada no modal "Esqueci minha senha" da tela de login, que passa a conter conteúdo no `EzModal` (o `EzDialog` só aceita texto). Story `DS/EzModal` ganha `FocoPreso`; testes em `EzModal.test.tsx`.
- **Selects:** `EzComboBox` com `<label htmlFor>` próprio, como no painel de filtros da Mesa (o `label` do `EzSelect` duplica o nome acessível com o controle visível).
- **Página `/definir-senha`:** pública, fora do `AppLayout`; só `EzCardItem`, `EzTextInput`, `EzButton` e `EzAlert`. O token vem do fragmento e é apagado da barra de endereço.
- **Story ou exceção:** `EzModal` (em `components/ds`) ganhou a story `FocoPreso`. `ActiveTag` fica fora de `components/ds` e nunca teve story; a variante `pending` é coberta por `ActiveTag.test.tsx`, sem exceção nova.
