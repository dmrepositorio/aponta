# Conhecimento: card que não recolhe depois da edição e erro com lista em cache

Identidade: DMTE-548, issue dmrepositorio/aponta#307, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e6fc-22eb-7330-8021-5ab49eb12907`. Origem: dois achados do QA na DMTE-534 (PR #298, em produção no commit `374023f`), que Alfredo mandou abrir como card pequeno. A DMTE-535 (proporção, tokens, foco, cor de "Interno") já está integrada e fica como está.

## Situação atual (código observado na base `9cba956`)

- **Card expandido sem "Recolher".** Em `KnowledgeArticleCard.tsx`, `expanded` é `useState`. O botão que alterna "Ler artigo completo"/"Recolher" só é renderizado com `hasHiddenContent` (corpo, anexos ou mais de 5 tags). O card é o mesmo componente depois de salvar uma edição (a chave é `article.id`; `invalidateQueries(['articles'])` troca só as props). Se a edição esvazia o corpo e remove anexos e tags extras, `hasHiddenContent` vira `false` com `expanded` ainda `true`: o botão some, o corpo (`.article-content`) e os anexos continuam na tela e não há como recolher.
- **Alerta junto com a lista em cache.** Em `KnowledgePage.tsx`, `useQuery` não usa `placeholderData`: trocar busca, tag, ordem ou pasta muda a chave e `articles` fica `undefined`. Com a mesma chave (refetch por foco da janela, `invalidateQueries` depois de salvar/excluir, "Tentar novamente"), uma falha mantém `articles` do cache com `isError`. O bloco `isError && !isLoading` mostra "Não foi possível carregar os artigos." abaixo da lista, sem dizer que ela pode estar velha, e a mensagem diz "carregar" quando os artigos já estavam carregados.

## Decisões (proposta do planejamento dentro do pedido)

1. **Sem edição no DS nem na API.** A correção fica em `KnowledgeArticleCard.tsx` e `KnowledgePage.tsx`.
2. **Card.** Quando `hasHiddenContent` é `false`, o card volta a recolhido na mesma renderização (`if (expanded && !hasHiddenContent) setExpanded(false)` no corpo do componente, padrão do React para ajustar estado a partir de props, sem efeito e sem quadro intermediário). Invariante: o card nunca fica expandido sem o botão. Se o conteúdo escondido voltar depois, o card continua recolhido (o usuário reabre por escolha).
3. **Erro com lista em cache.** Quando a atualização falha e há `articles`, a lista fica na tela (é a última informação boa) e o alerta passa a ficar **acima** dela, como aviso (`EzAlert variant="warning"`, que já tem `role="alert"`), com a ação "Tentar novamente" no próprio alerta (`action`): "Não foi possível atualizar os artigos. A lista abaixo pode estar desatualizada." Quando não há `articles` (primeira carga), nada muda: alerta de erro "Não foi possível carregar os artigos." com "Tentar novamente", sem lista e sem a mensagem de pasta vazia. Quando a nova tentativa funciona, o aviso some e a lista é a nova. "Lista em cache" quer dizer com pelo menos um artigo: cache vazio (`[]`) que falha na atualização também mostra o erro de carga, porque não há lista a avisar (e o estado de pasta vazia não aparece com `isError`).
4. **Fora desta entrega**: o `h1` do conteúdo duplicando o da página, a DMTE-535, `placeholderData`/`keepPreviousData` na troca de busca (mudaria o que o usuário vê a cada digitação; é outra decisão), qualquer mudança de API ou DS.

## Acceptance criteria

- AC-01: um card expandido cujo conteúdo escondido deixa de existir depois de uma atualização do artigo (corpo, anexos e tags extras removidos) volta recolhido: sem `.article-content`, sem anexos expandidos e sem botão de alternar (nada escondido), e nunca fica expandido sem o botão "Recolher".
- AC-02: se o conteúdo escondido voltar depois disso, o card continua recolhido, com o botão "Ler artigo completo" e `aria-expanded="false"`.
- AC-03: quando a atualização da lista falha e há lista em cache, a lista continua na tela e um aviso (`role="alert"`) acima dela diz que a atualização falhou e que a lista pode estar desatualizada, com o botão "Tentar novamente"; "Não foi possível carregar os artigos." não aparece.
- AC-04: "Tentar novamente" com sucesso mostra a lista nova e remove o aviso.
- AC-05: sem lista em cache (primeira carga que falha) o comportamento atual se mantém: alerta "Não foi possível carregar os artigos." com "Tentar novamente", sem lista e sem mensagem de pasta vazia.
- AC-06: com a lista em cache vazia (`[]`), a falha de atualização mostra o erro "Não foi possível carregar os artigos.", sem o aviso de lista desatualizada e sem a mensagem de pasta vazia.
- AC-07: nenhum arquivo de `apps/web/src/components/ds/` nem de `apps/api` é alterado.

## Testes (seams: o card pelo componente, a lista pela página; vitest + Testing Library)

- AC-01, AC-02: novo `apps/web/src/components/knowledge/KnowledgeArticleCard.test.tsx`, expande o card e atualiza as props com `rerender` (é o que o salvamento faz: o React Query entrega o mesmo artigo com o conteúdo novo).
- AC-03, AC-04: `apps/web/src/pages/KnowledgePage.test.tsx`: abre a pasta com a API respondendo, faz a API falhar e dispara um refetch real (volta de foco da janela, `visibilitychange`), confere lista e aviso; depois a API volta e "Tentar novamente" troca a lista.
- AC-05: o teste existente "shows a retryable error, not the empty message, when the query fails" já cobre; segue passando sem mudança.
- AC-06: `KnowledgePage.test.tsx`, cache vazio que falha na atualização.
- AC-07: `git diff` do PR sem arquivo em `components/ds/` nem em `apps/api`.

## Avaliação de design (impeccable e web-design-guidelines, lidas nesta etapa)

Superfície de operação: precisão e consistência valem mais que expressão. Reuso do DS: `EzAlert` (variante `warning` e prop `action`), `EzButton`; nenhum componente novo, sem story nova. Diretrizes: o aviso é assíncrono e usa `role="alert"` do `EzAlert`; o erro diz o que aconteceu e a ação seguinte ("Tentar novamente"); o botão de alternar mantém `aria-expanded`/`aria-controls`. Sem tokens novos e sem mudança de cor, tipografia ou espaçamento fora do que o DS já define.

## Evidência visual e aceite

Sem mudança de layout. Captura do aviso acima da lista (Chromium, API simulada que falha na segunda chamada) como evidência técnica no card, se o ambiente permitir; aceite visual é de Alfredo.

## Riscos

- O aviso (`role="alert"`) é anunciado por leitor de tela a cada falha de refetch, inclusive por foco da janela; é o comportamento esperado de um erro de atualização.
- Recolher o card ao esvaziar o conteúdo muda estado local durante a renderização; o padrão é o documentado pelo React e o teste do `rerender` o cobre.
- Sem impacto em RBAC, tenant ou API: só apresentação.
