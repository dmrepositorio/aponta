# Contratos: ação visível na grade e status semântico

Identidade: DMTE-536, issue dmrepositorio/aponta#265, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e1c8-cd23-7bb3-8b11-4ea6b448b80f`. Origem: auditoria DMTE-521 da tela de Contratos (`/contracts`), itens 1 e 2, aprovada por Alfredo ("Vamos implementar mas cuidados pois tem tickets de auditoria que alteram também o dsgrid"). Mesma ordem da DMTE-517 e da DMTE-520: itens 1 e 2 juntos, depois 3, 4 e 5.

## Situação atual (código observado e renderizado)

Renderizado em Chromium (Vite local, API simulada com 5 contratos fictícios, perfil ADMIN, base `0dfd410`), com medições de DOM, no relatório da DMTE-521:

- `ContractViews.tsx:80-163`: a grade tem 9 colunas, todas no tamanho padrão de 150 px do TanStack (exceto o que o conteúdo estica: 167 a 188 px). A 1440 px a área da grade mede 1102 px; "Reajuste" e "Ações" (o botão "Ver detalhes") ficam depois da rolagem horizontal. Contrato e Empresa quebram em até 4 linhas: linhas de 49, 68, 69 e 87 px.
- `ContractViews.tsx:98-115`: Status junta dois textos simples ("Ativo" e "Rascunho" ou "Regularização pendente") na mesma cor (`rgb(11,12,14)`, sem fundo). O contrato inativo se confunde com os ativos.
- Três vocabulários para a aprovação: a grade diz "Aprovado / Rascunho / Regularização pendente" (`ContractViews.tsx:106-110`), o detalhe diz "Aprovado / Pendente" (`:194`) e o filtro "Aprovação" tem só "Aprovado / Pendente" (`ContractsPage.tsx:75-81`), sem os dois estados que bloqueiam lançamentos.
- `EzEntityGrid` já aceita `size` por coluna (cabeçalho e célula usam `getSize()`) e `onRowDoubleClick`. A `ReleasesPage` e, na DMTE-530, a Mesa usam os dois.
- `EzTag` já tem `variant` (`green`, `yellow`, `gray`) e `leftIcon`. `styles.css` define `green-*`, `yellow-*` e `gray-*`; a tela não os usa.

## Decisões (proposta do planejamento dentro do pedido aprovado)

1. **Sem edição no DS.** Nenhum arquivo de `apps/web/src/components/ds/` muda. O pedido de Alfredo avisou que há tickets de auditoria que alteram a grade (PR #262 da DMTE-530 e DMTE-527 mexem em `EzEntityGrid.tsx`). Esta entrega usa só props que a grade já tem, então não conflita. Os itens da auditoria que exigem DS (toolbar em tela estreita, anel de foco, modal de exclusão) ficam para depois dessas entregas.
2. **Ação sempre visível**: o nome do contrato vira o botão que abre o detalhe (`variant`/estilo de link, `text-brand-700`, `hover:underline`, como o Nome da Mesa na DMTE-530), com o nome acessível `Ver detalhes <nome>` de hoje. A coluna "Ações" sai (o botão "Ver detalhes" de cada linha some junto). Duplo clique na linha abre o detalhe. O botão fica na primeira coluna de dados, que nunca sai da tela.
3. **Larguras e uma linha**: `size` fixo por coluna (checkbox 55 já vem da grade): Contrato 180, Empresa 166, Modalidade 188, Situação 300, Valor mensal 156, Hora excedente 130, Reajuste 120. Contrato, Empresa e Modalidade em uma linha (`truncate` com teto em px (`maxWidth` inline) igual ao `size` menos o padding da célula de 32 px, a partir de uma única constante de larguras, porque a tabela usa layout automático e o texto longo esticaria a coluna; `title` com o texto inteiro). Situação e Valor mensal têm o tamanho do conteúdo mais o cabeçalho (rótulo, ordenação, filtro e menu), medido no navegador: 300 e 156 px. O cabeçalho do DS não encolhe abaixo de 150 a 190 px por coluna, então essa foi a única forma de caber em 1076 px sem esconder uma coluna de dados nem tirar a ordenação.
4. **Colunas financeiras secundárias começam ocultas**: "Hora excedente" e "Reajuste" começam ocultas no padrão da tela (`columnVisibility`); continuam na configuração de colunas. Com as colunas padrão (55 + 180 + 166 + 188 + 300 + 156 = 1045 px) a grade cabe em 1076 px (largura da área da grade medida a 1440 px). Quem já salvou a configuração mantém as colunas que escolheu; as que nunca alterou seguem o novo padrão.
5. **Uma coluna "Situação" com duas tags** na mesma linha: Ativo/Inativo e Aprovado/Rascunho/Regularização pendente (dois eixos que continuam separados no filtro e no detalhe). Cada tag é um `EzTag` com texto e ícone, nunca só cor. Uma coluna só porque duas colunas separadas (Status 151 px e Aprovação 216 px, cada uma com o cabeçalho do DS) passavam de 1076 px a 1440 px, medido no navegador.
   - Positivo: `green` com check (Ativo, Aprovado). Negativo: `gray` com traço (Inativo). Rascunho: `yellow` com lápis. Regularização pendente: `yellow` com triângulo de alerta. Sem vermelho (reservado a vencido, crítico e escalado desde a DMTE-525).
   - Os dois amarelos dividem a família (ambos bloqueiam novos lançamentos); o texto e o ícone os distinguem.
6. **Um vocabulário só**: `approvalLabel(contract)` devolve `Regularização pendente` (modalidade legada), `Aprovado` ou `Rascunho`. A grade, o detalhe (linha "Aprovação") e o filtro (opções e `getValue`) usam essa função.
7. Sem API, schema ou regra de negócio. Só tokens que o `@theme` já define.

## Acceptance criteria

- AC-01: o nome de cada contrato na grade é um botão com o nome acessível `Ver detalhes <nome>` que abre o detalhe; a coluna "Ações" não existe; o duplo clique numa linha abre o detalhe do contrato da linha.
- AC-02: Contrato, Empresa e Modalidade renderizam em uma linha (`truncate`, sem quebra) com `title` do texto inteiro; cada coluna tem largura fixa (Contrato 180, Empresa 166, Modalidade 188, Situação 300, Valor mensal 156, Hora excedente 130, Reajuste 120) e a soma das colunas visíveis por padrão, com o checkbox de 55 px, não passa de 1076 px.
- AC-03: a coluna "Situação" mostra duas `EzTag` com texto e ícone: Ativo/Inativo e Aprovado/Rascunho/Regularização pendente; o estado positivo e o negativo diferem em texto, ícone e conjunto de classes (não só em cor); nenhum usa `red-*`; Rascunho e Regularização pendente diferem em texto e ícone.
- AC-04: `approvalLabel` é a única fonte do texto de aprovação: a grade, a linha "Aprovação" do detalhe e as opções e o valor do filtro "Aprovação" usam "Aprovado", "Rascunho" e "Regularização pendente" (não existe mais "Pendente" para aprovação), e o filtro por "Rascunho" e por "Regularização pendente" devolve os contratos certos.
- AC-05: todo par texto/fundo das tags de estado tem contraste mínimo de 4,5:1 (tokens lidos de `styles.css`) e os ícones têm no mínimo 3:1 contra o fundo da tag.
- AC-06: "Hora excedente" e "Reajuste" começam ocultas na configuração padrão da tela e continuam na lista de colunas da configuração de tela; "Situação" aparece nessa lista.
- AC-07: a 1440 px, no navegador, a grade padrão não tem rolagem horizontal, todas as linhas têm a mesma altura e o botão do nome fica dentro da área visível (medido em Chromium com a massa da auditoria).
- AC-08: sem mudança de API, schema ou regra, e nenhum arquivo de `apps/web/src/components/ds/` alterado.

## Testes (seams confirmadas com o pedido: componente de tags, grade de Contratos e filtro; vitest + Testing Library)

- AC-03, AC-05: `apps/web/src/components/contracts/ContractStateTags.test.tsx` (renderiza as tags, compara assinaturas, mede contraste dos pares com os tokens de `styles.css`).
- AC-01, AC-02, AC-04, AC-06: `apps/web/src/pages/ContractsPage.test.tsx` (botão do nome, ausência da coluna Ações, duplo clique, `title`/`truncate`, largura das células, vocabulário no filtro e no detalhe, colunas na configuração de tela e padrão oculto).
- AC-04 (função pura): `apps/web/src/components/contracts/ContractStateTags.test.tsx` cobre `approvalLabel`.
- AC-07: medição em Chromium, resultado no PR (jsdom não calcula layout; o comportamento causador é coberto por AC-02).
- AC-08: `git diff` do PR sem arquivo em `components/ds/` nem em `apps/api`.

## Evidência visual e aceite

Capturas da grade a 1440 px e 390 px antes e depois, anexadas ao PR, como evidência técnica. Aceite visual é de Alfredo (screenshot não substitui a decisão humana). Sem componente novo no DS, então sem story nova: o componente de tags é de domínio, em `components/contracts`, e as stories de Contratos existentes continuam valendo (`Contracts.stories.tsx` é conferido para não depender do texto antigo).

## Riscos

- A grade perde a coluna "Ações" e junta Status e Aprovação em "Situação": quem usava o botão passa a clicar no nome (nome acessível igual) ou a dar duplo clique.
- "Hora excedente" e "Reajuste" saem da vista padrão para quem não tem configuração salva; continuam na configuração de colunas, que vale na próxima abertura da grade (a grade lê a visibilidade só ao montar; isso já era assim e é do DS, fora desta entrega).
- Quem salvou a configuração de colunas com "Status" oculto passa a ver "Situação" (a chave `status` guardada não vale mais para a coluna `situation`); é uma preferência de exibição, sem dado perdido.
- Contratos com nome muito longo ficam truncados na grade (o nome inteiro está no `title` e no detalhe).
- Se a entrega de DS da DMTE-530 (PR #262) entrar antes, o botão "Opções da grade" ganha espaço no último cabeçalho (`pr-10`); esta entrega não depende disso e não o toca.
- Sem impacto em RBAC, tenant ou API: só apresentação.
