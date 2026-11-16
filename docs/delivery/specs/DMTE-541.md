## Problem Statement

Quem administra clientes no Aponta lê e edita a grade de Clientes o dia inteiro, e a tela atrapalha em cinco pontos. A auditoria DMTE-519 (impeccable audit e critique, modo Operate, com a tela renderizada em 1440, 1024 e 390 px) apontou:

1. O nome do cliente parece link, mas clicar nele abre a edição inline. Abrir o cadastro exige um ícone de 14×14 px, cinza a 4,46:1.
2. O chip Ativo/Inativo troca o status com um clique, sem confirmação, e usa `emerald-*` cru em vez dos tokens do DS. A edição inline não tem tratamento de erro: se o PATCH falhar, nada aparece.
3. O painel de filtros espreme a grade: a 1440 px ele ocupa cerca de 290 px, a coluna Status sai da tela e um nome longo quebra em 5 linhas (linha de ~97 px contra ~33 px das outras).
4. A moldura gasta altura: a faixa "Tickets" aparece em todas as páginas sem aba ativa, e o cabeçalho (`EzPageHeader`) ocupa ~72 px. A primeira linha de dados começa a 36% da altura da tela.
5. O vocabulário das colunas induz erro: a última coluna se chama "Clientes" (e conta usuários), "Código" é só a numeração da página, e o CPF aparece sem máscara.

O escopo foi ampliado pelo Alfredo nas rodadas de planejamento: o painel de filtros, o cabeçalho e a aba ativa valem para todas as telas que os usam; o chip de Usuários entra; o formulário do cliente (abas e checkbox de seleção das grades) entra; e o tratamento responsivo (390 px) faz parte da entrega.

Identidade: DMTE-541 (Multica `01a1e22a-3305-7c24-a994-df846c1d46e8`), issue GitHub dmrepositorio/aponta#273, Tier 2, ciclo 2026-11-09/2026-11-22. Origem: auditoria DMTE-519, decisões Q1 a Q18 aceitas pelo Alfredo, com a instrução de pensar responsivo.

## Solution

A tela de Clientes mantém a identidade atual (cartão branco, verde da marca, toolbar e grade do DS) e passa a:

- abrir o cadastro pelo nome, com o status somente leitura e erros de edição visíveis;
- mostrar uma grade legível: colunas com nomes honestos, CPF com máscara, Nome e Razão Social em linha única, checkbox de seleção na cor da marca;
- abrir o painel de filtros como sobreposição em telas abaixo de 1280 px, sem espremer a grade, em Clientes, Mesa e Contratos;
- ter uma moldura compacta (cabeçalho de ~48 px em todas as páginas que o usam) e uma aba ativa que sempre diz onde o usuário está;
- ter um formulário cujas abas dizem o que guardam ("Geral" e "Usuários");
- funcionar em 390 px: grade com Nome e Status à vista, toolbar em uma linha rolável e alvos de toque de 44 px.

## User Stories

1. Como administrador, quero clicar no nome do cliente para abrir o cadastro, para chegar ao detalhe sem procurar um ícone.
2. Como administrador de teclado, quero abrir o cadastro com Enter no nome, para não depender do mouse.
3. Como administrador, quero que o nome não entre em edição ao ser clicado, para não alterar um cliente sem querer.
4. Como administrador, quero editar Razão Social e CPF/CNPJ direto na grade, para correções rápidas.
5. Como administrador, quero ver uma mensagem de erro com o motivo quando uma edição não for salva, para saber que o dado não mudou.
6. Como administrador, quero que a célula volte ao valor anterior quando o salvamento falhar, para não ler na grade um dado que o servidor não tem.
7. Como administrador, quero que o status na grade seja só de leitura, para não inativar um cliente com um clique perdido.
8. Como administrador, quero alterar Ativo/Inativo no formulário ("Cliente ativo"), para a troca ser uma decisão explícita.
9. Como administrador, quero ler Ativo e Inativo por texto, ícone e cor, para não depender só do verde.
10. Como administrador, quero o mesmo chip de status em Clientes, Usuários e Contratos, para aprender a ler uma vez.
11. Como administrador, quero a coluna de contagem chamada "Usuários", à direita e com números tabulares, para não confundi-la com o nome da tela.
12. Como administrador, quero que a numeração da grade se chame "#", para não achar que é um código do cliente.
13. Como administrador, quero ver o CPF com máscara (000.000.000-00), como já vejo o CNPJ, para conferir o documento.
14. Como administrador, quero Nome e Razão Social em uma linha, com o texto completo ao passar o mouse, para as linhas terem a mesma altura.
15. Como administrador, quero o checkbox de seleção na cor da marca, para a grade parecer com o resto do Aponta.
16. Como administrador de uma tela de 1024 px, quero que o painel de filtros abra por cima da grade, para não perder colunas.
17. Como administrador de uma tela larga (1280 px ou mais), quero o painel de filtros ao lado da grade, como hoje, para ver os dois ao mesmo tempo.
18. Como administrador, quero que o painel de filtros se comporte do mesmo jeito em Clientes, Mesa e Contratos, para aprender uma vez.
19. Como administrador, quero um cabeçalho de página mais baixo, para ver mais linhas de dados sem rolar.
20. Como administrador, quero ver uma aba ativa para a página em que estou, para a faixa de abas deixar de sugerir que estou em Tickets.
21. Como administrador, quero que a aba da página atual saia quando eu navego, sem virar aba permanente, para a faixa não crescer sozinha.
22. Como administrador, quero a primeira aba do formulário chamada "Geral", para achar dados cadastrais, perfil, endereços e contatos onde espero.
23. Como administrador, quero uma aba "Usuários" só com os usuários vinculados, para gerenciar vínculos sem rolar por endereços.
24. Como administrador no celular, quero ver Nome e Status na grade, para consultar um cliente sem rolar na horizontal.
25. Como administrador no celular, quero a toolbar em uma linha que rola, para não perder um quarto da tela com botões.
26. Como administrador no celular, quero alvos de toque de 44 px na toolbar, para acertar o botão com o dedo.
27. Como mantenedor, quero as mudanças de DS documentadas e com story, para reaproveitá-las.
28. Como aprovador, quero capturas antes e depois em 390, 1024 e 1440 px, para dar o aceite visual.

## Implementation Decisions

Estado atual (código observado em `origin/main`, `6cfd3fc`; renderizado na auditoria DMTE-519 com dados sintéticos, Chromium headless):

- `OrganizationsPage.tsx`: Nome, Razão Social e CPF/CNPJ usam `EzTextEdit` (vira input ao clicar; grava no Enter ou ao sair); o ícone `ExternalLink` de 14×14 chama `openDetail`; o chip de status é um `<button>` com `bg-emerald-50 text-emerald-700` que chama `inlinePatchMutation` com `active` invertido; `inlinePatchMutation` não tem `onError`; a coluna de contagem usa `_count.users` com cabeçalho "Clientes"; `EzEntityGrid` recebe `rowNumberLabel="Código"`; a primeira aba do formulário (`users`) guarda Razão Social, Nome Fantasia, usuários vinculados, Perfil, Endereços e Contatos.
- `formatCnpj` mascara só 14 dígitos; não há `formatCpf`. O CPF sai cru na grade e no resumo do formulário.
- `EzEntityGrid`: `showRowNumbers` + `rowNumberLabel`; o checkbox de seleção usa `text-brand-600` e `focus-visible:ring`, mas sem `accent-color` o controle nativo não pinta (medido `appearance: auto`); `size` por coluna já existe; a prop de truncagem não existe.
- `EzFilterDrawer` é usado por `OrganizationsPage`, `ServiceDesksPage` e `ContractsPage`, sempre ao lado da grade (irmão em `flex`).
- `EzPageHeader`: `py-4` + `min-h-[40px]` (~72 px com o título de 20 px); usado por 7 páginas (`OrganizationsPage`, `UsersPage`, `ContractsPage`, `ServiceDesksPage`, `TechnicalGroupsPage`, `PermissionGroupsPage`, `ScheduledJobsPage`).
- `TabBar`: mostra as abas de `TabsContext` (aba inicial "Tickets" mais as abertas); só marca ativa a aba cujo `path` é igual à rota. Clientes não é aba, então nenhuma fica ativa.
- `ContractStateTags.tsx` (DMTE-536) já tem `ContractActiveTag` (`EzTag` `green` com check e `gray` com traço) e os pares de token `green-800/green-100` e `gray-700/gray-90`, conferidos a 4,5:1.
- O app não tem provedor de toast: `EzToast` só existe como componente de apresentação, sem uso nas páginas. Erros de ação na página já usam `EzAlert variant="error"` (por exemplo `deleteError`).
- `serviceType` e `healthStatus` são `String?` no banco; os selects do formulário oferecem `SUPORTE/CONSULTORIA/DESENVOLVIMENTO` e `SAUDAVEL/ATENCAO/RISCO` ("Sem dados" para vazio).

Decisões (confirmadas pelo Alfredo nas rodadas Q1 a Q18, salvo marca de proposta):

- D1 [Humano] Entrega única com card próprio (DMTE-541) e issue principal #273; DMTE-519 fica como a auditoria. Seis tickets, um PR, integração por `implement-spec`, no máximo dois tickets em paralelo.
- D2 [Humano] O nome vira um botão que abre o cadastro (modo formulário) por clique ou Enter, com nome acessível `Abrir cadastro de <nome>`; o ícone `ExternalLink` sai; o Nome deixa de ser editável na grade (continua em "Nome Fantasia" no formulário). Razão Social e CPF/CNPJ continuam editáveis por clique.
- D3 [Humano] O chip de status é somente leitura. A troca Ativo/Inativo fica no formulário ("Cliente ativo", que já existe).
- D4 [Humano, com ajuste] Erro de edição inline visível com o motivo e a célula volta ao valor anterior. [Proposta] O app não tem provedor de toast, então a mensagem usa `EzAlert variant="error"` com `onClose`, como o `deleteError` da própria página, em vez de criar infraestrutura de toast. Sem aviso de sucesso.
- D5 [Humano] Status sem `emerald` cru: `EzTag` `green` com check (Ativo) e `gray` com traço (Inativo), com os pares de token já usados em Contratos. [Proposta] O componente deixa de ser de Contratos: `ContractActiveTag` é movido para um componente neutro compartilhado por Clientes, Usuários e Contratos, e Contratos passa a importá-lo, sem mudar a aparência. Sem token novo no `@theme` e sem ADR novo (adendo ao ADR 0001 na SPEC). A Dashboard fica fora (recorte do DMTE-529).
- D6 [Humano] Coluna de contagem "Usuários" (alinhada à direita, `tabular-nums`); rótulo de numeração "#"; `formatCpf` ao lado de `formatCnpj`, usado na grade e no resumo do formulário (11 dígitos viram 000.000.000-00; outro tamanho fica como está).
- D7 [Humano] `EzEntityGrid` ganha uma opção de linha única com reticências e `title` (desligada por padrão, markup igual ao de hoje quando desligada); só Clientes a liga, com larguras fixas para Nome e Razão Social. Mesa, Contratos e Releases não entram.
- D8 [Humano] Checkbox de seleção (cabeçalho e linhas) e os checkboxes internos da `EzEntityGrid` ganham `accent-brand-600`; vale para as grades que usam `EzEntityGrid`.
- D9 [Humano] `EzFilterDrawer` vira sobreposição abaixo de `xl` (1280 px) por padrão, em Clientes, Mesa e Contratos, com fechar por Esc e pelo botão como hoje; a partir de `xl` continua ao lado da grade. [Proposta] Se um contêiner de página precisar de `relative` para a sobreposição, essa é a única edição permitida nas páginas.
- D10 [Humano] `EzPageHeader` compacto nas 7 páginas: padding vertical 8 px (hoje 16), altura mínima de 32 px (hoje 40), cerca de 48 px; padding horizontal de 16 px abaixo de 640 px e 24 px a partir daí. [Proposta] `EzPageLayout` mantém o padding do corpo.
- D11 [Humano] `TabBar`: quando a rota atual não está entre as abas, mostra uma aba ativa extra para ela, com o título do item do menu lateral. Ela não persiste (fora do `sessionStorage`), não tem botão de fechar e some ao navegar. A aba "Tickets" e as abas abertas continuam como hoje.
- D12 [Humano] Formulário do cliente: a primeira aba passa a "Geral" (Razão Social, Nome Fantasia, Perfil, Endereços e Contatos) e nasce uma aba "Usuários" só com os usuários vinculados. Ordem: Geral, Usuários, Recursos, Relacionamentos, Faturamento; a aba padrão é "Geral".
- D13 [Humano] Responsivo (390 px): abaixo de 640 px a grade de Clientes esconde "#" e a seleção para mostrar Nome e Status; a toolbar da grade rola em uma linha; os botões da toolbar têm alvo de 44 px. A toolbar é do DS (`EzEntityToolbar`): a mudança vale para todos os consumidores, só abaixo de 640 px.
- D14 [Retificação] Na rodada 2 apontei os selects "Tipo de Atendimento" e "Saúde" como vazios e o Alfredo aprovou corrigi-los. A causa era o meu dado sintético (`"Suporte"` e `"OK"` não existem entre as opções, que usam `SUPORTE` e `SAUDAVEL`). Não é defeito de produto e sai do escopo. Fica a observação de que, como `serviceType` e `healthStatus` são texto livre no banco, um valor legado fora das opções aparece em branco; tratar isso é proposta futura.
- D15 [Proposta] Parecer de design (impeccable e web-design-guidelines, abertos na auditoria DMTE-519; não há PRODUCT.md nem DESIGN.md, vale o DS): superfície Operate, sem mudar a identidade; `tabular-nums` nos números; foco visível preservado; `prefers-reduced-motion` respeitado em qualquer transição da sobreposição.
- D16 [Proposta] Sem API, schema, migração, permissão ou feature flag: é interface sobre dados que já existem. Sem termo novo no `GLOSSARY.md` e sem ADR novo.

Riscos:

- R1: o PR #262 (DMTE-530) e o DMTE-527 alteram a `EzEntityGrid`. Os tickets de grade (ticket 2) esperam o merge deles e são revalidados na base nova.
- R2: o ticket 1 e o ticket 2 tocam a mesma `OrganizationsPage.tsx` (arquivo longo): ordem fixa e um único integrador.
- R3: o painel como sobreposição muda Mesa e Contratos sem tocar nas páginas; as duas ganham capturas e os testes existentes de cada uma precisam seguir verdes.
- R4: o cabeçalho compacto muda 7 páginas e os testes de `EzPageLayout` e de escape; as 7 ganham capturas antes e depois.
- R5: esconder a seleção abaixo de 640 px tira "Excluir" e "Duplicar" do celular (dependem da seleção). Decisão aceita pelo Alfredo (Q9); fica registrada como limite.
- R6: a toolbar de 44 px abaixo de 640 px muda todas as grades que usam `EzEntityToolbar`.
- R7: jsdom não calcula layout. Responsivo é testado por classes de breakpoint declaradas e conferido em Chromium; é evidência técnica, não aceite visual.
- R8: a aba transitória do `TabBar` precisa de um mapa rota-título; rota fora do mapa não ganha aba.

## Testing Decisions

Um bom teste confere comportamento observável (o que a pessoa vê e faz), não detalhe de implementação. Pontos de teste confirmados: (1) teste de página, `OrganizationsPage.test.tsx` e `UsersPage.test.tsx`; (2) teste do componente do DS onde o comportamento é do DS (`EzFilterDrawer`, `EzEntityGrid`, `EzEntityToolbar`, `EzPageLayout`, `TabBar`). Vitest + Testing Library, como o resto do app.

- AC-01: o nome de cada cliente na grade é um botão com o nome acessível `Abrir cadastro de <nome>` que abre o modo formulário por clique e por Enter; o ícone `ExternalLink` não existe; clicar no nome não abre input de edição.
- AC-02: Razão Social e CPF/CNPJ continuam editáveis por clique; quando o PATCH falha, aparece um `EzAlert` de erro com o motivo e a célula volta ao valor anterior; quando dá certo, nenhum aviso de sucesso aparece.
- AC-03: o status é somente leitura (sem `<button>`, sem ação ao clicar), mostra `EzTag` com texto e ícone (Ativo verde com check; Inativo cinza com traço), sem `emerald-*` nem `red-*`; o mesmo componente é usado em Clientes, Usuários e Contratos; todo par texto/fundo tem contraste mínimo de 4,5:1 lido de `styles.css`.
- AC-04: o cabeçalho da coluna de contagem é "Usuários", alinhado à direita e com `tabular-nums`; o rótulo da numeração é "#"; a palavra "Código" não aparece como cabeçalho na grade de Clientes.
- AC-05: `formatCpf` devolve 000.000.000-00 para 11 dígitos e o valor original para outro tamanho; a grade e o resumo do formulário mostram o CPF mascarado e o CNPJ continua mascarado.
- AC-06: `EzEntityGrid` tem uma opção de linha única com reticências e `title` do texto inteiro, desligada por padrão (com a opção desligada o markup é igual ao atual); Clientes a liga para Nome e Razão Social, com larguras fixas.
- AC-07: o checkbox de seleção do cabeçalho e o de cada linha, e os checkboxes de filtro de coluna e de configuração, têm `accent-brand-600`.
- AC-08: `EzFilterDrawer` renderiza como sobreposição abaixo de `xl` (classes de posição e camada declaradas) e ao lado da grade a partir de `xl`; Esc e o botão de fechar continuam fechando; Clientes, Mesa e Contratos usam o mesmo comportamento sem lógica nova nas páginas.
- AC-09: `EzPageHeader` tem padding vertical de 8 px, altura mínima de 32 px e padding horizontal de 16 px abaixo de `sm` e 24 px a partir dele (classes declaradas); as 7 páginas continuam renderizando título, botão de voltar e ações.
- AC-10: quando a rota atual não está entre as abas, o `TabBar` mostra uma aba extra, ativa (`aria-selected`), com o título do menu lateral, sem botão de fechar; ela não é gravada no `sessionStorage` e some ao navegar; a aba "Tickets" e as abas abertas se comportam como hoje.
- AC-11: o formulário do cliente tem as abas Geral, Usuários, Recursos, Relacionamentos e Faturamento, com "Geral" aberta por padrão; "Geral" mostra Razão Social, Nome Fantasia, Perfil, Endereços e Contatos; "Usuários" mostra só os usuários vinculados e o botão Adicionar/Remover de cada um.
- AC-12: abaixo de 640 px a grade de Clientes esconde "#" e a seleção (classes de breakpoint declaradas) e mostra Nome e Status; a toolbar da grade rola em uma linha; os botões da toolbar têm altura e largura mínimas de 44 px abaixo de 640 px e mantêm o tamanho atual a partir daí.
- AC-13: em Chromium, a 1440×900, 1024×768 e 390×844: a página de Clientes não tem rolagem horizontal; as linhas da grade têm a mesma altura; o painel de filtros aberto abaixo de `xl` não estreita a grade; as páginas Mesa e Contratos, com o painel aberto, e as 7 páginas do cabeçalho compacto não têm rolagem horizontal. Evidência técnica com capturas antes e depois; jsdom não mede layout, e o aceite visual é do Alfredo.
- AC-14: sem mudança de API, schema ou regra; `docs/architecture/03-sankhya-ds-parity.md` registra as mudanças de DS (`EzFilterDrawer`, `EzEntityGrid`, `EzEntityToolbar`, `EzPageLayout`); `EzEntityGrid` e `EzPageLayout` têm story atualizada; `EzFilterDrawer` não tem story hoje e o manifesto registra a exceção.

Prior art: `OrganizationsPage.test.tsx`, `ContractsPage.test.tsx` e `ContractStateTags.test.tsx` (DMTE-536: assinatura de classes, contraste dos pares de token), `EzFilterDrawer.test.tsx`, `EzEntityGrid.test.tsx`, `EzPageLayout.test.tsx` e `TabBar.test.tsx`. Medição de layout: Playwright (Chromium) com API simulada e dados sintéticos, como na auditoria.

Tickets (sub-issues desta SPEC): T1 nome, status e erro (AC-01 a AC-03); T2 grade legível (AC-04 a AC-07); T3 painel de filtros (AC-08); T4 moldura compacta (AC-09, AC-10); T5 formulário do cliente (AC-11); T6 celular e validação responsiva (AC-12 a AC-14).

## Out of Scope

- A paleta da Dashboard (recorte do DMTE-529) e qualquer mudança global do `EzPageHeader` além do tamanho (por exemplo, breadcrumbs ou atalhos de modo).
- Truncagem de colunas em Mesa, Contratos e Releases (a opção do DS fica disponível, desligada).
- Filtro por prazo ou "sem resposta" na lista de Tickets, e qualquer mudança de API ou schema.
- Tratar valor legado de `serviceType`/`healthStatus` fora das opções (D14).
- Um provedor de toast para o app (D4 usa `EzAlert`).
- Excluir ou duplicar cliente no celular (consequência aceita de esconder a seleção abaixo de 640 px).

## Further Notes

- Evidência visual: capturas de Clientes, Mesa, Contratos e das páginas com cabeçalho compacto em 390, 1024 e 1440 px, antes e depois, com dados sintéticos, anexadas ao PR. O aceite visual é do Alfredo; captura não substitui a decisão humana.
- Ordem na fila de entregas: depois do DMTE-530 (PR #262) e do DMTE-527, que alteram a mesma `EzEntityGrid`; o WIP é de uma entrega por vez.
- Tier 2 (comportamento de produto sem API/schema). Sem impacto em RBAC, tenant ou dados: só apresentação; a tela de Clientes já exige perfil ADMIN e as demais mantêm as permissões que têm.
