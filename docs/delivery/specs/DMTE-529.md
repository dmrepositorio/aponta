## Problem Statement

Quem abre a Dashboard para começar o turno não consegue ler, de relance, o que exige ação. A auditoria DMTE-518 (impeccable audit e critique, modo Operate, com a tela renderizada em 1440, 1024 e 390 px) apontou cinco problemas:

1. Os gráficos de linha não têm eixo, valor nem tooltip. O de horas ocupa 320 px de altura e termina numa queda a zero que é só o dia de hoje ainda aberto. No gráfico de 30 dias só dois rótulos de data aparecem. Em 390 px os rótulos do eixo X se sobrepõem.
2. A cor não carrega significado: o mesmo ícone de alerta aparece em "Hoje", "Amanhã" e "Depois" em âmbar, índigo e esmeralda. Âmbar (2,15:1), esmeralda (2,54:1) e as fatias claras do pizza ficam abaixo do contraste mínimo sobre branco.
3. A hierarquia não destaca o crítico. "Vencidos" cai sozinho numa segunda linha. Os cabeçalhos dos cards de prazo ocupam cerca de 40% da altura de cada card. Os totais de horas têm 11 px e ficam cortados em 390 px. "Minhas horas apontadas" e "Últimas notificações" se repetem entre abas, e o gráfico de tickets dos últimos 30 dias está na aba Horas.
4. Alguns estados prometem o que não fazem: KPIs que não são links parecem links, o foco de teclado nos links é o do navegador, as tabelas de Chats mostram ícone de ordenação sem ordenar, "Modo TV" é um `<span>` com cursor de bloqueado e "Ações" recarrega a página.
5. A cor vem de duas fontes: tokens do DS (`green-600`, `red-600`) e a paleta padrão do Tailwind (`teal`, `amber`, `indigo`, `emerald`, `blue`), mais hex literais no arquivo.

Identidade: DMTE-529 (Multica `01a1dfff-6e72-7a70-b5db-646187d9fbc4`), issue GitHub dmrepositorio/aponta#266, Tier 2, ciclo 2026-11-09/2026-11-22. Origem: DMTE-518, decisões das perguntas Q1 a Q7 aceitas com "sim" pelo Alfredo, com a instrução explícita de pensar responsivo nos itens Q4 (gráficos) e Q5 (hierarquia e abas).

## Solution

A Dashboard mantém a identidade atual (cards brancos planos, abas com linha, verde da marca) e passa a:

- usar cor só com papel: crítico, atenção, neutro, positivo e marca, todos com tokens do DS e contraste mínimo de 4,5:1 para texto;
- mostrar gráficos de linha legíveis e proporcionais, com escala real, tooltip e rótulos que nunca se sobrepõem, do celular ao desktop;
- abrir com o crítico em destaque (faixa de KPIs no topo, prazos num card só) e sem repetição entre abas;
- ter estados de interação coerentes (só é clicável o que parece clicável, foco visível igual ao resto do app);
- obedecer ao ADR 0001 também aqui, com verificação no CI.

Em todos os itens vale o requisito responsivo (AC-07): 390, 768, 1024 e 1440 px, sem rolagem horizontal da página e sem nada cortado.

## User Stories

1. Como atendente, quero ver "Vencidos" em destaque no topo, para saber de relance o que exige ação agora.
2. Como atendente, quero que vermelho signifique crítico e amarelo-escuro signifique atenção em toda a tela, para aprender a ler a Dashboard uma vez.
3. Como atendente, quero que "Amanhã" e "Depois" não tenham ícone de aviso, para não ler alerta onde não há risco.
4. Como atendente com baixa visão ou projetor ruim, quero números e rótulos com contraste mínimo de 4,5:1, para lê-los sem esforço.
5. Como atendente, quero ver no gráfico de horas quanto apontei em cada dia, para responder "quanto apontei ontem?" sem sair do gráfico.
6. Como atendente, quero que o dia de hoje apareça como parcial e não como queda a zero, para não achar que perdi horas.
7. Como atendente, quero um tooltip por hover, por foco de teclado e por toque, para ler o valor de qualquer ponto em qualquer aparelho.
8. Como atendente no celular (390 px), quero rótulos de data que não se sobreponham e totais de horas que quebram de linha, para ler tudo sem rolagem horizontal.
9. Como atendente, quero o gráfico de 30 dias de tickets na aba Tickets, para encontrar volume de tickets onde espero encontrar.
10. Como atendente, quero a aba Horas só com minhas horas, para não ver repetido o que já vi em outra aba.
11. Como atendente, quero todos os prazos (atendimento e solução, hoje, amanhã, depois, todos) em um card compacto, para compará-los de uma vez.
12. Como atendente, quero que a legenda do pizza mostre todas as linhas, com número e percentual, para não perder categoria cortada.
13. Como atendente, quero que o pizza agrupe o excedente em "Outros", para distinguir as fatias principais.
14. Como atendente, quero que só os números clicáveis pareçam clicáveis, para não clicar em vão.
15. Como usuário de teclado, quero o mesmo anel de foco verde nos KPIs que nas abas e no botão "Ações", para saber onde estou.
16. Como atendente, quero que "Modo TV" pareça desabilitado e diga "Em breve" na tela, para não precisar do tooltip.
17. Como atendente, quero que "Ações > Novo Ticket" abra a tela sem recarregar a página, para manter o estado da sessão.
18. Como atendente, quero o status do atendente em português nas tabelas de Chats, para ler a tabela sem tradução.
19. Como mantenedor, quero que o CI reprove hex literal e paleta fora do DS na Dashboard, para a regra do ADR 0001 não regredir.
20. Como mantenedor, quero o gráfico de linha como componente do DS com story, para reaproveitá-lo em outras telas.

## Implementation Decisions

Estado atual (código observado em `origin/main`, `0dfd410`; renderização com dados sintéticos feita na auditoria DMTE-518):

- A Dashboard é uma página única de cerca de 1.040 linhas com cartão local, linha de KPIs, tabela, pizza e gráfico de linha definidos no mesmo arquivo; dados de `GET /reports/summary`.
- `recharts` está no `package.json`, mas nenhum arquivo o importa. `EzChart` do DS só desenha barras com divs.
- `scripts/check_tickets_palette.py` e `scripts/check_tickets_proportion.py` valem para arquivos da aba Tickets (`scripts/tickets_scope.py`); a Dashboard não está no escopo.
- A lista de Tickets só aceita os filtros `mine`, `unassigned`, `paused` e `overdue`; não há filtro por prazo nem por "sem resposta".

Decisões (confirmadas pelo Alfredo nas rodadas, salvo marca de proposta):

- D1 [Humano] Entrega nova com card próprio (DMTE-529) e issue principal no GitHub (#266); o DMTE-518 fica como fonte da auditoria. A implementação respeita o WIP 1 do projeto.
- D2 [Humano] Paleta: ADR 0001 vale na Dashboard. Só tokens do DS, sem hex nem famílias Tailwind fora do DS. Papéis: crítico `red-600` (6,58:1), atenção `yellow-800` (4,96:1), neutro `gray-500` (8,85:1), positivo `green-600` (5,5:1), marca `brand-600` (4,64:1). Registro como adendo ao ADR 0001, sem ADR novo.
- D3 [Proposta] Mapeamento dos KPIs: Todos e Meus `brand-600`; Não atendidos `yellow-800`; Em andamento `green-600`; Pausados `gray-500`; Vencidos `red-600`. Nos prazos: "Hoje" `yellow-800`; "Todos", "Amanhã" e "Depois" `gray-500`. Ícone de alerta só em "Vencidos" e em "Hoje"; demais sem ícone de aviso.
- D4 [Humano] Pizza: no máximo 6 fatias e "Outros" com o resto. Legenda com número e percentual escritos, sem corte. [Proposta] Cores das fatias, só de tokens neutros em significado (sem vermelho nem amarelo, que são papéis semânticos): `brand-600`, `petroleum-500`, `green-500`, `brand-300`, `petroleum-300`, `petroleum-700`, e "Outros" em `gray-300`. O número dentro da fatia é branco sobre `brand-600`, `petroleum-500` e `petroleum-700` (todas acima de 4,5:1) e escuro sobre as demais; fatia abaixo de 4% do total não leva número. A distinção entre fatias é conferida nas capturas e fica para o aceite visual do Alfredo.
- D5 [Humano] Gráfico de linha: componente novo do DS, `EzLineChart`, SVG próprio, sem dependência nova, com story. Altura 160 px em tela pequena e 192 px a partir de `sm` (hoje 320 px). Eixo Y com 0, valor médio e máximo; linhas de grade finas; hoje desenhado como ponto parcial (marcador vazado, sem segmento de queda). Tooltip por hover, por foco de teclado nos pontos e por toque (toque abre, toque fora fecha). Série com nome acessível e resumo para leitor de tela.
- D6 [Humano, a pedido do Alfredo] Responsivo é requisito, não acabamento. Rótulos do eixo X: função pura que escolhe quais índices mostrar a partir de quantos cabem na largura medida (no máximo 4 abaixo de `sm`, 7 a partir dele), sempre incluindo o último ponto, sem reservar largura para o que não aparece. O gráfico mede a largura do próprio contêiner (não da janela).
- D7 [Humano, a pedido do Alfredo] Hierarquia e abas: faixa de KPIs no topo (Vencidos em destaque, Não atendidos, Sem resposta, Meus); os cards de prazo de atendimento e de solução viram um só, com tabela 2×4 (Atendimento e Solução × Todos, Hoje, Amanhã, Depois). "Tickets nos últimos 30 dias" vai para a aba Tickets. A aba Horas fica só com "Minhas horas apontadas". "Últimas notificações" sai da aba Horas e fica na aba Tickets. Totais de horas em 13 px, alinhados pela linha de base dos valores, com quebra de linha permitida. [Proposta] Comportamento responsivo: a faixa de KPIs em 2 colunas abaixo de `sm`, 4 a partir de `md`, com "Vencidos" ocupando a linha inteira em 390 px; na tabela de prazos, o nome da linha (Atendimento, Solução) fica acima das quatro células em 390 px e ao lado a partir de `sm`; as duas colunas da aba Tickets viram uma abaixo de `lg`, com a ordem Faixa, Prazos, Horas, Tickets em andamento, 30 dias, Notificações, Chamados por status.
- D8 [Humano] Interações: KPIs de prazo e de "sem resposta" ficam só de leitura (sem hover nem cursor de clique); os KPIs que já são links ganham o anel `focus-visible` `brand` das abas e do botão "Ações"; o ícone de ordenação sai das tabelas de Chats; "Modo TV" vira botão `disabled` com `aria-disabled` e "Em breve" visível; "Ações" mantém o menu e navega com `useNavigate`. Links de prazo e "sem resposta" ficam para uma entrega com backend.
- D9 [Humano] Menor: status do atendente em Chats traduzido (Online, Ocupado, Ausente, Offline). O rótulo "Tickets" na barra de abas do layout fica fora. Aceite visual é do Alfredo, com capturas antes e depois em 390, 768, 1024 e 1440 px, com dados sintéticos.
- D10 [Proposta] CI: `tickets_scope.py` passa a incluir `DashboardPage.tsx` e `EzLineChart.tsx`; as mensagens dos dois verificadores deixam de dizer só "aba Tickets". Teste Python do escopo novo no padrão de `test_check_tickets_palette.py`.
- D11 [Proposta] Parecer de design (impeccable e web-design-guidelines; launcher do impeccable exigiu `sh`; não há PRODUCT.md nem DESIGN.md, vale o DS e o ADR 0001): superfície Operate, sem mudar a identidade. Alvos de toque de links e botões com pelo menos 44 px de altura em tela de toque; `tabular-nums` nos números; `prefers-reduced-motion` respeitado em qualquer transição do tooltip.
- D12 [Proposta] Sem API, schema, migração, permissão ou feature flag: é interface sobre dados que já existem. Sem termo novo no `GLOSSARY.md` e sem ADR novo (adendo ao 0001).

Riscos:

- R1: a Dashboard é um arquivo só; os tickets tocam as mesmas linhas. Mitigação: ordem e bloqueios entre tickets, e trabalho em worktrees exclusivos coordenado por um único integrador.
- R2: jsdom não calcula layout nem toque. Overflow, quebra de linha, sobreposição de rótulos e tooltip por toque são conferidos em Chromium (Playwright) nas quatro larguras, com toque sintetizado; é evidência técnica, não aceite visual.
- R3: distinguir 6 categorias só com tokens do DS pode não bastar; a legenda com número e percentual evita depender só da cor, e o aceite visual confirma.
- R4: testes existentes de `DashboardPage.test.tsx` conferem textos e classes que mudam (altura responsiva do gráfico, "Modo TV", posição de cards); precisam ser atualizados junto com cada comportamento, sem enfraquecer a asserção.
- R5: `dashboard.spec.ts` (E2E) usa a lista de tickets e a Busca avançada, não a Dashboard; sem impacto esperado.

## Acceptance criteria

- AC-01: `scripts/check_tickets_palette.py` e `scripts/check_tickets_proportion.py` passam cobrindo `DashboardPage.tsx` e `EzLineChart.tsx`; a Dashboard não tem hex literal nem classe de paleta fora do DS; o escopo novo tem teste Python.
- AC-02: os KPIs usam o mapeamento de D3 (texto `red-600` em Vencidos, `yellow-800` em Não atendidos e "Hoje", `green-600` em Em andamento, `gray-500` em Pausados, "Todos", "Amanhã" e "Depois", `brand-600` em Todos e Meus do resumo); o ícone de alerta só existe em "Vencidos" e em "Hoje".
- AC-03: nenhum texto de KPI, rótulo ou legenda usa token com contraste abaixo de 4,5:1 sobre o fundo do card (tabela de tokens permitidos conferida em teste).
- AC-04: o pizza mostra no máximo 6 fatias mais "Outros"; a legenda lista todas as linhas, com número e percentual; fatia abaixo de 4% não tem número dentro; nenhuma linha da legenda é cortada pela altura do contêiner.
- AC-05: `EzLineChart` existe no DS, exportado pelo barrel, com story e pelo menos três testes: eixo Y com 0, valor médio e máximo; tooltip abre por hover, por foco de teclado e por toque; o último ponto parcial é marcado e não desenha segmento de queda.
- AC-06: a função de rótulos do eixo X devolve no máximo 4 índices para largura de `< sm` e 7 para `>= sm`, inclui sempre o último ponto e nunca devolve dois índices vizinhos que se sobreponham.
- AC-07 (responsivo): em 390, 768, 1024 e 1440 px, toda a Dashboard (as quatro abas) fica sem rolagem horizontal da página e sem texto cortado fora de contêiner com rolagem declarada; alvos de toque de links e botões do conteúdo têm pelo menos 44 px de altura abaixo de `lg`; rótulos de data nunca se sobrepõem. Verificação em Chromium com medição automática de `scrollWidth` e captura por largura, com toque sintetizado para o tooltip.
- AC-08: a faixa de KPIs mostra Vencidos em destaque no topo e linkado para `/tickets?overdue=true`; os dois cards de prazo viram um com tabela 2×4; os blocos antigos não existem mais.
- AC-09: a aba Tickets tem "Tickets nos últimos 30 dias" e "Últimas notificações"; a aba Horas tem só "Minhas horas apontadas"; nenhum bloco aparece em duas abas.
- AC-10: os totais de horas têm 13 px, ficam alinhados pela linha de base dos valores e quebram de linha em 390 px sem cortar.
- AC-11: KPIs de prazo e de "sem resposta" não têm hover nem cursor de clique; KPIs que são links têm `focus-visible` com anel `brand` igual ao do botão "Ações".
- AC-12: as tabelas de Chats não mostram ícone de ordenação; "Modo TV" é `<button disabled aria-disabled="true">` com o texto "Em breve" visível; "Ações > Novo Ticket" navega sem recarregar a página (sem `window.location`).
- AC-13: os status de atendente em Chats aparecem como Online, Ocupado, Ausente e Offline.
- AC-14: nenhum arquivo de `apps/api` muda e não há migração.
- AC-15: ADR 0001 recebe adendo estendendo a regra à Dashboard; `docs/architecture/03-sankhya-ds-parity.md` registra o `EzLineChart` entre os componentes criados.

## Testing Decisions

Um bom teste confere o que o usuário vê e faz (papéis, rótulos, atributos, o que a tela pede à API) e não detalhe de implementação. Três seams, todos já existentes ou convencionais:

1. `apps/web/src/pages/DashboardPage.test.tsx` (Vitest + Testing Library, `api.get` mockado): o seam principal, que já cobre as quatro abas, os KPIs como links, o pizza e os gráficos. Cobre AC-02, AC-03, AC-04, AC-08 a AC-13.
2. `apps/web/src/components/ds/EzLineChart.test.tsx`: convenção do DS (pelo menos três casos por componente novo). Cobre AC-05 e AC-06.
3. `scripts/test_check_tickets_palette.py` e `scripts/test_tickets_scope.py`: cobrem AC-01 (escopo estendido).

Responsivo (AC-07) não cabe em jsdom: um script Playwright em Chromium abre a Dashboard com `GET /reports/summary` interceptado e dados sintéticos, mede `scrollWidth` contra `clientWidth`, a altura dos alvos de toque e a sobreposição de rótulos nas quatro larguras, sintetiza toque para o tooltip e guarda capturas antes e depois. O resultado vai no PR e no pai Multica como evidência técnica; o aceite visual continua do Alfredo. Prior art: `DMTE-497` (capturas do Chromium em 1440 e 390 px anexadas no pai).

AC-14 e AC-15: `git diff --stat` do PR sem `apps/api` nem `prisma/migrations`, e leitura dos dois documentos.

## Out of Scope

- Links de prazo ("Hoje", "Amanhã", "Depois") e de "sem resposta" para a lista de Tickets: exigem filtros novos no backend.
- Ordenação real das tabelas de Chats.
- Modo TV funcional.
- O rótulo "Tickets" na barra de abas do layout quando a rota é a Dashboard.
- Tela de Tickets (DMTE-525), `recharts` e qualquer dependência nova.
- Mudança de identidade (verde da marca, cards planos, abas com linha).

## Further Notes

- Fonte da auditoria: DMTE-518 (capturas com dados sintéticos anexadas lá). Os números de contraste foram calculados a partir dos tokens de `apps/web/src/styles.css`.
- Mudança de escopo atualiza esta SPEC antes de implementar.
- Tickets de implementação (sub-issues de #266, aprovados pelo Alfredo): #267 T1 base (paleta, CI, medição responsiva); #268 T2 `EzLineChart` e gráficos de linha (bloqueado por #267); #269 T3 pizza (bloqueado por #267); #270 T4 hierarquia e abas (bloqueado por #267 e #268); #271 T5 interações e status de Chats (bloqueado por #270). #268 e #269 podem andar em paralelo depois de #267.
- Seams e divisão em tickets confirmadas pelo Alfredo no DMTE-518 ("Aprovado ambos, vamos iniciar").
