# Cofre de Senha: cabeçalho na escala do app e tabela sem corte

Identidade: DMTE-546, issue dmrepositorio/aponta#291, Tier 2, pai Multica `01a1e5d1-1b6c-712c-993b-a4a1c1642c17`. Origem: auditoria [DMTE-523](mention://issue/01a1dfa0-d510-7ee7-989b-65c22ac2e4aa) da tela Cofre de Senha, itens 4 e 5, aprovada por Alfredo. Ordem das três entregas do Cofre: DMTE-544 (#342, integrado) → DMTE-545 (#345, integrado) → DMTE-546 (esta), porque todas editam `VaultPage.tsx`. Base `origin/main` `f8064ed`.

## Situação atual (código observado, base `f8064ed`)

`apps/web/src/pages/VaultPage.tsx`:

- **Cabeçalho fora de escala** (`:503-514`): `h1` em `text-3xl font-bold` (30px/700) com o ícone decorativo `Lock h-8 w-8`, fora do padrão das nove telas que já usam `EzPageLayout` + `EzPageHeader` (20px/semibold, sem ícone). O botão "Auditoria" fica numa faixa própria, não no cabeçalho.
- **Três faixas antes da primeira linha** (`:527-572`): toolbar de busca + "Ações", depois a faixa "Pasta: X" (com editar/remover), depois o `thead` — quando há pasta selecionada.
- **Tabela sem rolagem própria** (`:588-660`): `EzCardItem` com `overflow-hidden` e a tabela direto dentro, sem wrapper `overflow-x-auto`; o grid empilha árvore/tabela só até `md:` (`:516`).
- **URL truncada sem `title`** (`:607-609`): `<span className="truncate max-w-[160px]">{cred.url}</span>` corta visualmente sem expor o valor completo ao passar o mouse.

`apps/web/src/pages/VaultAuditPage.tsx`: mesmo `h1` fora de escala (`:84-86`) e mesma tabela sem wrapper de rolagem (`:144-165`).

**Captura (pré-requisito da auditoria), Chromium com web local e API interceptada com dados sintéticos (3 credenciais, 1 pasta, URL longa, perfil ADMIN), a 768, 1024 e 1440px:**

| Largura | Cartão da tabela | Última ação (lixeira) | Resultado |
|---|---|---|---|
| 768 | 204px | cartão termina em 744, ação em x=1320 | **cortada**: só Nome e Usuário visíveis |
| 1024 | 460px | cartão termina em 1000, ação em x=1320 | **cortada**: URL e Ações inalcançáveis |
| 1440 | 876px | cartão termina em 1416, ação em x=1399 | cabe, sem corte |

O item 5 da auditoria reproduziu e é mais abrangente que a inferência original: corta também a 1024px.

## Decisões

1. **`EzPageLayout` + `EzPageHeader`** no Cofre e na Auditoria do cofre, sem alterar `components/ds/`. Título em 20px/semibold, sem o cadeado/escudo decorativo; no Cofre, o botão "Auditoria" (só com `canEdit`, como hoje) vai para `actions` do cabeçalho.
2. **Faixa "Pasta: X" fundida na toolbar**: o label e os botões de editar/remover pasta entram no mesmo flex row da busca, à esquerda do botão "Ações". Resta no máximo toolbar + `thead` antes da primeira linha.
3. **Wrapper `overflow-x-auto`** em volta de cada `<table>` (Cofre e Auditoria do cofre) e grid do Cofre empilhado até `lg:` (hoje `md:`), dando a largura total à tabela nas larguras onde a árvore (260px) mais a sidebar do app não deixam espaço.
4. **`title` com a URL completa** no `<span>` truncado da coluna URL.
5. **Fora do escopo**: migrar a tabela para `EzEntityGrid` (a lista tem reveal por campo por linha; a captura não pede a grade), qualquer arquivo de `components/ds/`, API, permissões ou lógica de reveal.

## Acceptance criteria

- AC-01: Cofre e Auditoria do cofre renderizam dentro de `EzPageLayout` com `EzPageHeader`; o título sai em 20px/semibold, sem o ícone decorativo; no Cofre, o botão "Auditoria" fica em `actions` do cabeçalho.
- AC-02: a faixa "Pasta: X" (com editar/remover) fica dentro do mesmo row da busca e do botão "Ações"; antes da primeira linha restam no máximo a toolbar e o `thead`.
- AC-03: a tabela (Cofre e Auditoria do cofre) fica dentro de um wrapper `overflow-x-auto`; a 768, 1024 e 1440px a última ação da linha fica alcançável por rolagem horizontal do cartão, sem rolagem horizontal da página.
- AC-04: o grid do Cofre empilha a árvore de pastas acima da tabela até `lg:` (hoje `md:`), dando a largura total à tabela nessas larguras.
- AC-05: a URL truncada tem `title` com o valor completo.
- AC-06: sem mudança de API, permissões, lógica de reveal ou qualquer arquivo de `components/ds/`.

## Testes (seam: as páginas `VaultPage`/`VaultAuditPage`, nível do projeto: vitest + Testing Library; layout medido no navegador)

- AC-01/AC-02/AC-05: `apps/web/src/pages/VaultPage.test.tsx`, describe `VaultPage — header, toolbar and table at the app scale (DMTE-546)`.
- AC-01 (Auditoria): `apps/web/src/pages/VaultAuditPage.test.tsx`, describe `VaultAuditPage — header and table at the app scale (DMTE-546)`.
- AC-03 (comportamento, estrutura do wrapper): mesmos describes acima, asserção de classe `overflow-x-auto` no pai de `getByRole('table')`.
- AC-03 (medida de layout, navegador): `scripts/vault_layout_check.mjs` (novo; Chromium com dados sintéticos e API interceptada, mesmo padrão de `scripts/vault_actions_check.mjs`). jsdom não resolve rolagem nem corte visual.
- AC-04: mesmo describe de VaultPage, asserção de classe `lg:grid-cols-[260px_1fr]` (e ausência de `md:grid-cols-[260px_1fr]`) no grid.
- Comando do RED/GREEN: `pnpm --dir apps/web exec vitest run src/pages/VaultPage.test.tsx -t DMTE-546` e `pnpm --dir apps/web exec vitest run src/pages/VaultAuditPage.test.tsx -t DMTE-546`.
- Comando da prova de layout: `node scripts/vault_layout_check.mjs --out vault-layout-out`.

## Evidência visual e aceite

Capturas antes (anexadas ao plano, comentário do arquiteto) e depois (`vault_layout_check.mjs`, anexadas ao comentário de entrega) a 768, 1024 e 1440px, dados fictícios. Aceite visual é do Alfredo; captura não substitui a decisão humana.

## Riscos

- `EzPageLayout` aplica `p-6` e `overflow-auto` próprios no corpo da página: sem rolagem dupla observada nas capturas (o `overflow-x-auto` fica só no wrapper interno da tabela).
- Os estados de carregamento e erro do Cofre (`foldersQuery.isLoading`/`isError`) também passam a usar `EzPageLayout` + `EzPageHeader`, para o cabeçalho não sumir nesses estados; sem AC dedicado, coberto pelos testes de loading/erro já existentes.
- Sem impacto em tenant ou RBAC: backend e visibilidade de `canEdit` não mudam.
