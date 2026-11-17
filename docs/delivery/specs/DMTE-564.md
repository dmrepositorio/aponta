# Configurações: uniformidade de layout com o padrão do sistema

Identidade: DMTE-564, issue dmrepositorio/aponta#340, Tier 2, ciclo 2026-11-09/2026-11-22. Follow-up da DMTE-524.

## Situação

A reauditoria renderizada da DMTE-524 (Chromium, API simulada, 1440 px) mediu que `/settings` está centrada numa coluna de 672 px, com o título em x=504, sobre o fundo da página. Usuários, Grupos de atendentes, Grupos de permissões, Tarefas agendadas, Mesa, Clientes e Conhecimentos usam a faixa branca de título do DS e o conteúdo a partir de x=264, com 1152 px. Ao ir de Configurações para Usuários, o título pula 216 px. O skeleton tem ≈127 px; o cartão de um ADMIN tem ≈354 px.

Decisão do usuário (comentário na DMTE-524): "Temos que ter uniformidade no sistema, como está o padrão hoje".

## Código observado

- `apps/web/src/pages/SettingsPage.tsx`: contêiner `mx-auto max-w-2xl` com um `<h1>` próprio e um skeleton de 3 linhas.
- `apps/web/src/components/ds/EzPageLayout.tsx`: `EzPageLayout` (fundo, área rolável com `p-6`) e `EzPageHeader` (faixa branca com `<h1>` de 20 px/600), usados por `ScheduledJobsPage`, `UsersPage`, `ServiceDesksPage` e outras.

## Decisão (proposta do planejamento, dentro do pedido)

`SettingsPage` passa a renderizar `<EzPageLayout header={<EzPageHeader title="Configurações" />}>` com o cartão agrupado no conteúdo, sem `mx-auto` nem `max-w-*`, como as vizinhas. O `<h1>` próprio sai (o `EzPageHeader` já o renderiza). O skeleton reproduz os grupos: ADMIN (visibilidade conhecida pelo store, síncrona) mostra 3 grupos e 6 linhas; os demais perfis, 1 grupo e 1 linha. Mantém-se o gate `isLoading && failureCount === 0` da DMTE-524.

## Acceptance criteria

- AC-01: `/settings` usa `EzPageLayout` + `EzPageHeader` (título na faixa branca) e o conteúdo não fica numa coluna centrada.
- AC-02: o skeleton reproduz os grupos (subtítulo + linhas): 3 grupos e 6 linhas para ADMIN, 1 grupo e 1 linha para os demais perfis.
- AC-03: a visibilidade por permissão e os testes já existentes de `SettingsPage` seguem verdes.

## Testes

- AC-01: `apps/web/src/pages/SettingsPage.test.tsx`, "renders the title in the page header band and keeps the content out of a centered column"; RED e GREEN pelo coletor.
- AC-02: `SettingsPage.test.tsx`, "gives the skeleton the shape of the groups: 3 groups and 6 rows for an admin, 1 and 1 for other roles"; RED e GREEN pelo coletor.
- AC-03: casos já existentes de `SettingsPage.test.tsx`, executados no GREEN, mais `tsc` e `eslint` do `web`.

## Riscos

- Largura total: a linha do cartão fica mais larga que hoje (chevron longe do texto em 1440 px). É o padrão das vizinhas; se o QA ou o usuário achar ruim na captura, o limite de largura vira decisão nova.
- O teste "centers the content in a max-w-2xl column" da DMTE-524 deixa de valer e é substituído pelo do AC-01.
- Sem impacto em RBAC, tenant ou API: a visibilidade dos links não muda.

## Fora de escopo

Título e largura de `MyAccountPage`, link de volta e abas nas telas `/settings/*`, hub para perfis cliente, altura de linha no celular, qualquer mudança em componente ou token do DS.
