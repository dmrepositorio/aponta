# Configurações: carregamento das permissões, hover/foco, agrupamento e largura

Identidade: DMTE-524, issue dmrepositorio/aponta#258, Tier 2, ciclo 2026-11-09/2026-11-22.

## Situação

Auditoria impeccable (audit + critique, modo Operate) da tela `/settings`, publicada e aprovada no card DMTE-524. Os achados vêm do código (`SettingsPage.tsx`, `ds/EzCardItem.tsx`, `styles.css`, `usePermissions.ts`); nada foi renderizado. A identidade visual atual (cartão branco, raio de 16px, ícone + chevron, verde brand) fica.

## Código observado

- `isAdmin` vem do `authStore` (síncrono); `MANAGE_USERS`, `MANAGE_PERMISSION_GROUPS` e `MANAGE_SCHEDULED_JOBS` vêm de `GET /auth/me`, e `useHasPermission` devolve `false` enquanto a consulta carrega. Num ADMIN, o primeiro quadro mostra só "Minha conta" e "Mesa"; depois entram os demais itens e o cartão "Sistema", acima de "Mesa".
- O `<Link>` tem `hover:bg-gray-90` com cantos retos dentro de `EzCardItem` (`rounded-[16px]`, sem `overflow-hidden`), sem `focus-visible` nem estado ativo; o DS usa `focus-visible:ring-2 focus-visible:ring-brand-200`.
- A linha (`px-4 py-3 text-[14px]`, ícone, chevron) está copiada três vezes; `styles.css` define `--control-height-md` (42px) e a página não usa.
- "Mesa" tem uma seção "Mesa" com um link "Mesa" (já existe na barra lateral); "Sistema" é um cartão de uma linha.
- O conteúdo tem `max-w-md` alinhado à esquerda; `MyAccountPage` usa `mx-auto max-w-2xl`.

## Decisão (proposta do planejamento, dentro do pedido aprovado)

Um componente local `SettingsLink` (não entra no DS compartilhado) concentra o estilo da linha. A página mostra um skeleton até `useEffectivePermissions` responder e depois renderiza um único cartão com subtítulos Conta / Usuários / Sistema; grupos sem item não aparecem. O link Mesa (só ADMIN) passa para Sistema. Mantém-se `user?.role === 'ADMIN'` para Mesa e as três permissões atuais para os demais itens.

## Acceptance criteria

- AC-01: enquanto `GET /auth/me` não responde, a página mostra um skeleton (`aria-busy`) e nenhum link; ao responder, os itens permitidos entram juntos.
- AC-02: o hover não vaza pelos cantos arredondados do cartão (cartão recorta o conteúdo); os links têm `focus-visible` com anel `brand-200` do DS e estado ativo.
- AC-03: a linha de link é um único componente local, com altura mínima `--control-height-md` e divisor `gray-90`.
- AC-04: um cartão com subtítulos Conta / Usuários / Sistema; some a seção "Mesa"; o link Mesa (só ADMIN) fica em Sistema; grupo sem item não aparece.
- AC-05: conteúdo centrado com `max-w-2xl`.
- AC-06: a visibilidade por permissão não muda e os testes existentes de `SettingsPage` seguem verdes.

## Testes

- AC-01: `apps/web/src/pages/SettingsPage.test.tsx`, "shows a busy skeleton and no links until GET /auth/me responds"; RED e GREEN pelo coletor.
- AC-02: `SettingsPage.test.tsx`, "keeps hover inside the rounded card and gives links a focus ring" (classes `overflow-hidden`, `focus-visible:ring-2`, `active:`); RED e GREEN pelo coletor.
- AC-03: `SettingsPage.test.tsx`, "renders every row with the control height token"; RED e GREEN pelo coletor.
- AC-04: `SettingsPage.test.tsx`, "groups the links under Conta, Usuários and Sistema, with Mesa under Sistema for an admin" e "omits the Sistema group when the user has no system item"; RED e GREEN pelo coletor.
- AC-05: `SettingsPage.test.tsx`, "centers the content in a max-w-2xl column"; RED e GREEN pelo coletor.
- AC-06: casos já existentes de `SettingsPage.test.tsx` (visibilidade por permissão), executados no GREEN, mais typecheck e lint do `web`.

## Riscos

- Os testes de classe CSS são frágeis a refatoração de estilo; aceitos porque não há navegador no gate unitário e o QA confere o resultado renderizado.
- Sem skeleton, uma falha em `GET /auth/me` deixaria a página vazia: em erro (`isError`) a página cai no comportamento atual (só "Minha conta", sem permissões), sem bloquear a navegação.
- Quem só tem "Minha conta" (perfis cliente) continua vendo uma página de um item; remover o hub para esses perfis é mudança de navegação e fica fora desta entrega.
- Sem impacto em RBAC, tenant ou API: a visibilidade segue as mesmas permissões; o servidor continua sendo quem autoriza cada rota.

## Fora de escopo

`MyAccountPage` (título e largura), textos de apoio novos nas linhas, rotas, barra lateral, mudança de API ou de DS compartilhado.
