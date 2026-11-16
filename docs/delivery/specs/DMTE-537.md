# Conhecimento: busca perde o foco e descarta teclas ao digitar

Identidade: DMTE-537, issue dmrepositorio/aponta#293, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e1ca-5ed0-718b-a8ea-3dfa04a76064`. Origem: auditoria DMTE-522 da tela de Conhecimento, segunda passada. Fila aprovada por Alfredo na DMTE-522: DMTE-537, depois DMTE-534, depois DMTE-535.

## Situação atual (código observado e reproduzido)

`apps/web/src/pages/KnowledgePage.tsx`, base `caa1196`:

- A query de artigos usa `queryKey: ['articles', { search, tags, sort, folderId }]` (linha 111), sem `placeholderData`. Cada tecla na busca, cada tag e cada troca de ordenação cria uma chave nova e `isLoading` volta a `true`.
- `if (isLoading) { return <div className="p-8"><EzSpinner label="Carregando artigos..." /></div>; }` (linha 298) devolve só o spinner. Breadcrumb, título, campo de busca, tags, ordenação, alternador Lista/Grade e formulário de artigo saem do DOM. O campo de busca é desmontado, o foco vai para `BODY` e as teclas seguintes não entram em campo nenhum.
- Reprodução (Vitest, `userEvent` com 20 ms entre teclas, API simulada com 150 ms por resposta, digitando "senha"): a árvore DOM só tem o `role=status` do spinner, o foco está em `BODY` e saem duas chamadas, `/articles?folderId=folder-1` e `/articles?search=s&folderId=folder-1`. Duas execuções, mesmo resultado. É o mesmo sintoma da auditoria (Chromium, 400 ms, 120 ms entre teclas).
- Mesmo sintoma em outros consumidores: procurado, não há outro `isLoading` de página inteira com campo de busca. A `VaultPage` resolveu o mesmo caso com `placeholderData: keepPreviousData`.
- `EzEmptyCard` ("Nenhum artigo encontrado para a busca atual.") hoje só aparece depois do carregamento, porque o `return` antecipado esconde o resto. Ao tirar o `return`, ele passaria a aparecer durante o carregamento se a condição não mudar.

## Decisões (proposta do planejamento dentro do pedido da auditoria)

1. **Carregamento na área da lista, cabeçalho sempre montado.** Remove o `return` antecipado por `isLoading`. Com `isLoading`, o bloco de cards e a paginação dão lugar ao `EzSpinner` com o mesmo rótulo ("Carregando artigos..."); o resto da página não muda. É o critério do card: "a lista mostra carregamento sem desmontar o cabeçalho".
2. **Sem `keepPreviousData`.** Mostraria artigos de outra pasta ao trocar de pasta (a `folderId` está na chave) e exigiria uma regra extra. O spinner na lista basta e é a menor mudança.
3. **O estado vazio só aparece sem carregamento:** `!isLoading && !articles?.length`.
4. **Debounce fora do escopo.** Reduziria requisições, mas não causa a perda do foco. Proposta para outra entrega, se Alfredo quiser.
5. Sem mudança na API, nas chaves de query, nos parâmetros enviados, no DS, na paginação nem no RBAC.

## Acceptance criteria

- AC-01: com a API respondendo devagar, digitar "senha" na busca da pasta, sem pausa entre as teclas, mantém o mesmo campo no DOM, com o valor "senha" e o foco nele.
- AC-02: enquanto a lista carrega, o cabeçalho (breadcrumb, título, campo de busca, ordenação e alternador Lista/Grade) continua na tela e a área da lista mostra "Carregando artigos..." sem os cards e sem "Nenhum artigo encontrado para a busca atual."; terminado o carregamento, os artigos aparecem.
- AC-03: a busca digitada de uma vez chega à API com o texto completo (`/articles?search=senha&folderId=folder-1`) e a lista mostra o resultado dessa consulta.
- AC-04: o comportamento existente continua: os testes de `KnowledgePage.test.tsx` anteriores passam sem edição, e abrir uma pasta pela primeira vez mostra o carregamento na área da lista.
- AC-05: nenhum arquivo de `apps/web/src/components/ds/`, de `apps/api` nem de `apps/web-e2e` é alterado, e os parâmetros enviados à API não mudam.
- AC-06: no navegador (Chromium, API simulada com 400 ms, "senha" com 120 ms entre teclas, dados fictícios), o campo termina com "senha" e o foco, e a lista mostra os artigos da última consulta.

## Testes (seam: `KnowledgePage` renderizada com `api` simulado; vitest + Testing Library; o mesmo padrão do arquivo existente)

- AC-01, AC-02, AC-03: novos casos em `apps/web/src/pages/KnowledgePage.test.tsx`, com `/articles` atrasado por `setTimeout` e `userEvent.setup({ delay })`. O elemento do campo é guardado antes de digitar e as asserções usam `queryByRole('searchbox')`, para o RED falhar por asserção (campo ausente, valor vazio, foco em `BODY`) e não por exceção de consulta.
- AC-04: os testes existentes do arquivo, sem edição.
- AC-05: `git diff` do PR sem arquivo nesses diretórios.
- AC-06: medição em Chromium, resultado no PR (jsdom não mede foco real de navegador).
- Seam correto: o teste reproduz o padrão real do bug no ponto de chamada (página com a query lenta). Um teste de unidade de componente isolado não pegaria o `return` antecipado.

## Parecer de design (Operate, tela de Conhecimento)

- impeccable (modo Operate): a mudança é de comportamento, sem estilo novo. Em tela de tarefa vale a consistência: o carregamento fica no lugar da lista, o controle que o usuário está usando não se mexe. Reaproveita `EzSpinner` e o rótulo atual. O launcher `impeccable context` não rodou (`Permission denied` no script), então o parecer partiu de `AGENTS.md`, do DS e do código.
- web-design-guidelines (regras buscadas da fonte em 2026-11-16): sem regra sobre debounce ou skeleton; aplicam-se foco visível preservado (o campo não é remontado) e texto de carregamento terminando em reticências, que já é o do `EzSpinner`. O rótulo atual "Carregando artigos..." não muda.
- Aceite visual: não há mudança visual estática; o aceite é do comportamento ao digitar, de Alfredo.

## Riscos

- A lista passa a piscar o spinner a cada tecla (sem debounce nem `keepPreviousData`). É o custo da decisão 2; a perda do foco, que era o defeito, deixa de ocorrer. Se Alfredo achar o pisca incômodo, a evolução é um `keepPreviousData` condicionado à pasta, em outra entrega.
- Respostas fora de ordem: o TanStack Query descarta a resposta de chave que não é mais a atual; o AC-03 cobre o texto final.
- Sem impacto em RBAC, tenant ou API: só apresentação no cliente.
