# Mesa: estado ativa/recebendo visível e grade com densidade uniforme

Identidade: DMTE-530, issue dmrepositorio/aponta#261, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e002-8e30-7b1a-a480-13220a6ec58c`. Origem: auditoria DMTE-520 da tela de Mesa (`/service-desks`), itens 1 e 2, aprovada por Alfredo ("Aprovado vamos iniciar"), na mesma ordem da DMTE-517/525: itens 1 e 2 juntos, depois 3, 4 e 5 (cards DMTE-531 a 533).

## Situação atual (código observado e renderizado)

Renderizado em Chromium (Vite local, API simulada com 4 mesas fictícias, perfil ADMIN, base `105b5de`), com medições de DOM:

- `ServiceDesksPage.tsx:96-105`: as colunas Ativa e Recebendo mostram "Sim"/"Não" em texto simples. A mesa inativa (Financeiro) é visualmente igual às ativas.
- `ServiceDesksPage.tsx:106-113`: Clientes junta todos os nomes com vírgula e quebra linha. Alturas de linha medidas a 1440 px: 107, 31, 31 e 67 px (modo compacto) para 4, 1, 0 e 2 clientes.
- A tabela tem barra de rolagem horizontal a 1440 px: a área da grade mede 1102 px e as colunas somam 1123 px (todas com o tamanho padrão de 150 px do TanStack, exceto o que o conteúdo estica).
- `EzEntityGrid.tsx:1676-1688`: o botão "Opções da grade" é `absolute top-1.5 right-1.5` sobre o cabeçalho da última coluna; em Mesa ele cobre a borda direita de "Agentes" (a 1440 px o rótulo termina colado no botão, que cobre os ícones de filtro/menu da coluna).
- `styles.css` define `green-*` e `gray-*`; a tela não os usa. `gray-400` (`#77777a`) dá 4,46:1 sobre branco, abaixo do mínimo de 4,5:1.
- `EzBadge` (`ds/EzBadge.tsx`) é um contador numérico redondo; `EzTag` (`ds/EzTag.tsx`) já traz variantes `green`, `gray` e `outline` e `leftIcon`, e é o que a DMTE-525 usou para status.

## Decisões (propostas do planejamento dentro do pedido aprovado)

1. **`EzTag` com ícone, não `EzBadge`.** O pedido cita `EzBadge`, mas ele é um contador sem ícone nem texto. `EzTag` entrega a semântica pedida (cor + texto + ícone) e segue o precedente da DMTE-525. `EzBadge` fica para o chip "+N" de Clientes, que é numérico.
2. **Estado positivo e negativo se distinguem por texto, ícone e cor** (nunca só pela cor): Ativa = `green` + check, texto "Ativa"; inativa = `gray` + traço, texto "Inativa". Recebendo = `green` + check, texto "Recebendo"; não recebe = `gray` + traço, texto "Não recebe".
3. **Sem vermelho.** A DMTE-525 reservou o vermelho para vencido, crítico e escalado; desativar uma mesa é uma decisão de configuração, não um erro. O pedido aceitava "neutro ou vermelho"; escolhido o neutro.
4. **Linha da mesa inativa em `gray-500`, não `gray-400`.** O pedido sugere `gray-400`, mas ele reprova o contraste mínimo de 4,5:1 que o próprio pedido exige (4,46:1). `gray-500` (`#494a4e`) dá 8,85:1 e continua claramente mais fraco que o texto normal (`gray-900`). O link de Nome também passa a `gray-500` nessa linha, com sublinhado no hover.
5. **Clientes em uma linha**: nome do primeiro cliente truncado + `EzBadge` "+N" quando há mais de um, e `title` com a lista completa separada por vírgula (também no chip). Sem clientes: "—" (como hoje). O fallback `organization` único continua valendo.
6. **Larguras fixas por coluna** (`size` do `ColumnDef`; Nome e Nome de exibição truncam com `title`). Alvo a medir: a soma cabe nos 1102 px a 1440 px sem rolagem horizontal. A 1280 px e abaixo a rolagem horizontal continua permitida (o contêiner já é rolável por toque, DMTE-455).
7. **Espaço para o botão de colunas no `EzEntityGrid`** (componente compartilhado): quando `showGridCornerMenu` está ligado, o cabeçalho da última coluna visível ganha `pr-10`. É mudança de DS sem prop nova; afeta o espaçamento do último cabeçalho de todas as grades, nunca esconde conteúdo. A story existente já exibe o botão; sem story nova (exceção documentada: só espaçamento, coberto por teste).
8. Fora do escopo: toolbar e abas no celular (DMTE-531), foco e semântica das abas (DMTE-532), modelo de salvamento (DMTE-533), qualquer alteração de API, filtros ou regra de negócio. Os filtros continuam com os valores "Sim"/"Não".

Não aplicável: grill-with-docs → to-spec → to-tickets completos. Não é funcionalidade nova nem refatoração grande: é correção de apresentação aprovada item a item pelo humano, na mesma forma da DMTE-525 (uma SPEC, uma issue GitHub, um PR, sem sub-issues).

## Acceptance criteria

- AC-01: cada mesa mostra Ativa e Recebendo como `EzTag` com texto e ícone: "Ativa"/"Inativa" e "Recebendo"/"Não recebe"; o padrão (`active`/`acceptingNewTickets` ausente) continua valendo como verdadeiro.
- AC-02: o estado positivo e o negativo diferem em texto, ícone e conjunto de classes (não só em cor), e o negativo não usa `red-*` nem `green-*`.
- AC-03: todo par texto/fundo das tags de estado e do texto da linha inativa tem contraste mínimo de 4,5:1 (tokens lidos de `styles.css`, sobre o fundo real da célula), e os ícones têm no mínimo 3:1 contra o fundo da tag.
- AC-04: a linha da mesa inativa usa `gray-500` no Nome, no Nome de exibição, em Clientes e em Agentes; as linhas ativas mantêm as cores atuais; o Nome continua um botão que abre o detalhe.
- AC-05: Clientes renderiza uma linha (sem quebra: `whitespace-nowrap` + `truncate`): o primeiro nome e, com 2 ou mais clientes, o chip "+N" (N = total − 1); o `title` lista todos; sem clientes mostra "—".
- AC-06: em modo compacto todas as linhas da grade têm a mesma altura (medido no navegador com a grade da auditoria: 4 mesas com 4, 1, 0 e 2 clientes) e a grade não tem barra de rolagem horizontal a 1440 px.
- AC-07: o cabeçalho da última coluna reserva espaço para o botão "Opções da grade" (`pr-10` quando `showGridCornerMenu`, sem a reserva quando desligado), e a 1440 px nenhum cabeçalho fica cortado nem coberto pelo botão (medido no navegador).
- AC-08: sem mudança de API, schema ou regra; `SERVICE_DESK_FILTER_FIELDS`, os valores "Sim"/"Não" dos filtros e as colunas (ids, cabeçalhos, ordem) idênticos.

## Testes (seams: componente de estado e página, nível do projeto — vitest + Testing Library; medidas de layout no navegador)

- AC-01, AC-02, AC-03: `apps/web/src/components/ServiceDeskStateTags.test.tsx` (novo; renderiza os quatro estados, compara assinaturas e ícones, mede contraste dos pares exportados com os tokens de `apps/web/src/styles.css`).
- AC-04, AC-05, AC-08: `apps/web/src/pages/ServiceDesksPage.test.tsx` (mesa inativa com `gray-500`, Clientes com "+N" e `title`, sem clientes "—", colunas e filtros iguais; os testes existentes seguem verdes).
- AC-07: `apps/web/src/components/ds/EzEntityGrid.test.tsx` (último cabeçalho com `pr-10` com o botão ligado, sem ele desligado).
- AC-06 e a parte medida de AC-07: o jsdom não calcula layout, então a evidência é a medição de DOM em Chromium (alturas de linha, `scrollWidth` × `clientWidth`, retângulos dos cabeçalhos e do botão) a 1440 px, antes e depois, com a mesma API simulada da auditoria; resultado e capturas vão no PR e no resultado da implementação, como evidência técnica, não como aceite visual.
- `python3 scripts/aponta_delivery.py check --manifest .delivery/deliveries/DMTE-530.json` e a suíte `web` completa antes do QA (o `EzEntityGrid` é compartilhado).

## Evidência visual e aceite

Capturas de `/service-desks` a 1440 px antes e depois (e 390 px para conferir que nada piora), com API simulada e dados fictícios. Aceite visual é de Alfredo; screenshot não substitui a decisão humana.

## Riscos

- `pr-10` no último cabeçalho do `EzEntityGrid` muda levemente a largura útil da última coluna em outras grades (Organizações, Usuários etc.); mitigação: suíte `web` completa e conferência visual de Organizações na captura de depois.
- Larguras fixas somando mais que a área em telas menores aumentam a rolagem horizontal, que já existe; a rolagem por toque é preservada (teste DMTE-455 existente).
- A escolha do texto "Não recebe" e do cinza neutro para o estado negativo é visual/semântica nova; se Alfredo preferir "Pausada" ou outro tom, é troca de uma linha no componente de estado.
- Sem impacto em RBAC, tenant ou API: só apresentação, na tela já restrita a ADMIN.
