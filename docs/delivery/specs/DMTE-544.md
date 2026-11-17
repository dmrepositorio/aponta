# Cofre de Senha: ações da linha acessíveis e revelar por campo

Identidade: DMTE-544, issue dmrepositorio/aponta#289, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e5d1-18c0-7495-b10e-93e3647f292d`. Origem: auditoria DMTE-523 da tela Cofre de Senha (`/vault`), itens 1 e 2, aprovada por Alfredo. Pedido de início no card: "Iniciar 544". Os itens 3, 4 e 5 ficam na DMTE-545 e na DMTE-546.

## Situação atual (código observado)

`apps/web/src/pages/VaultPage.tsx` e `hooks/useVault.ts`, base `ca109a3`:

- Os botões de ícone da linha (revelar, copiar usuário/senha/URL, editar, excluir) e os da faixa da pasta (editar/remover pasta) só têm `title`; nenhum tem `aria-label`, nem classe de foco visível. Os de copiar são ícones `h-3.5 w-3.5` sem padding (~14px); editar/excluir têm `p-1` (~24px).
- `handleCopy` chama `revealMutation.mutateAsync` e `navigator.clipboard.writeText` sem `try/catch` e sem aviso: não confirma e uma falha vira promise rejeitada sem tela. `handleToggleReveal` tem o mesmo problema.
- O cadeado de revelar fica na coluna Nome, revela usuário e senha juntos (dois POST `/vault/credentials/:id/reveal` com `intent: 'reveal'`) e alterna entre `Lock` e `LockOpen`. `setRevealed({})` só roda em `handleSelectFolder`; buscar e paginar mantêm os valores, e não há timer.
- Padrão de aviso existente: `components/mesaSave.tsx` mostra `EzToast` fixo no canto superior direito, com `role="status"` (sucesso, some sozinho) ou `role="alert"` (erro, fica até fechar). Não há componente de aviso compartilhado; `EzToast` é o componente do DS.
- Os testes atuais localizam os botões por `title` (`Revelar linha`, `Ocultar`, `Copiar usuário`, `Copiar senha`, `Copiar URL`, `Abrir URL`, `Editar`, `Excluir`, `Editar pasta`, `Remover pasta`).

## Decisões (proposta do planejamento dentro do pedido aprovado)

1. **Só `VaultPage.tsx` e testes.** Nenhum arquivo de `components/ds/`, API, schema ou `useVault.ts` muda. O aviso é um bloco local em `VaultPage.tsx` que usa o `EzToast` existente, no mesmo desenho do `mesaSave.tsx`.
2. **Nome acessível sem perder o `title`.** Cada botão de ícone ganha `type="button"` e `aria-label` com o nome da credencial (por exemplo `Copiar senha de Servidor FTP`); o `title` atual fica, então os testes que usam `getByTitle` continuam valendo. Na faixa da pasta, `Editar pasta Servidores` e `Remover pasta Servidores`.
3. **Alvo e foco.** Os botões de ícone da linha e da faixa da pasta passam a `h-8 w-8` (32px, igual a `--control-height-compact`), centralizados, com `rounded-md` e `ez-focus`-equivalente: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200`, o mesmo anel do `EzCheck`. O link "Abrir URL" recebe o mesmo tratamento.
4. **Revelar por campo.** O cadeado da coluna Nome sai. Nas células Usuário e Senha entra um botão de olho (`Eye`/`EyeOff`, `aria-pressed`, nomes `Revelar usuário de X`/`Ocultar usuário de X` e o equivalente para senha), antes do valor e do botão de copiar. Clicar revela só aquele campo (um POST com `intent: 'reveal'` e o `field` correspondente). Os 8 bullets fixos continuam.
5. **Ocultação automática.** Cada valor revelado some depois de 30 s (timer por campo) e todos somem ao trocar de pasta, ao mudar a busca e ao mudar de página. Os timers são limpos ao desmontar.
6. **Retorno de ação.** Copiar com sucesso mostra "Usuário copiado.", "Senha copiada." ou "URL copiada." (`role="status"`, some em 3 s). Falha de reveal mostra "Não foi possível revelar." e falha de reveal ou de clipboard ao copiar mostra "Não foi possível copiar." (`role="alert"`, fica até fechar). Nenhuma mensagem leva o valor do segredo.
7. Sem mudança em RBAC (`canEdit`), nas rotas, no corpo das requisições nem nos modais (DMTE-545).

## Acceptance criteria

- AC-01: todo botão de ícone da tabela (revelar usuário/senha, copiar usuário/senha/URL, editar, excluir) e da faixa da pasta (editar/remover pasta) é `<button type="button">` com `aria-label` que inclui o nome da credencial (ou da pasta) e mantém o `title` atual; o link "Abrir URL" também tem `aria-label` com o nome.
- AC-02: esses controles têm 32px (`h-8 w-8`) e anel de foco `focus-visible:ring-2` na cor da marca.
- AC-03: não há mais botão de revelar na coluna Nome; as células Usuário e Senha têm cada uma um botão de olho com `aria-pressed`; clicar no olho do usuário revela só o usuário (um POST com `field: 'username'`, nenhum para `password`) e o inverso; clicar de novo oculta sem nova requisição.
- AC-04: um valor revelado volta aos bullets 30 s depois; trocar de pasta, mudar a busca e mudar de página também voltam todos aos bullets.
- AC-05: copiar usuário, senha ou URL com sucesso mostra a mensagem correspondente em `role="status"`, que some em 3 s; o valor copiado continua indo para `navigator.clipboard.writeText`.
- AC-06: se o reveal falhar ao revelar, aparece "Não foi possível revelar." em `role="alert"`; se o reveal ou o clipboard falhar ao copiar, aparece "Não foi possível copiar." em `role="alert"`; nenhuma promise fica sem tratamento e a mensagem não contém o valor.
- AC-07: no navegador (Chromium, 1440 px e 768 px, dados fictícios e API simulada), os botões de ícone medem 32x32 px, o foco por teclado mostra o anel, o olho de cada célula revela só o seu campo e o aviso de cópia aparece e some.
- AC-08: nenhum arquivo de `apps/web/src/components/ds/`, `apps/api`, `apps/web-e2e` nem `hooks/useVault.ts` é alterado.
- AC-09: os testes atuais de `VaultPage.test.tsx` passam sem edição, exceto os três que usam o cadeado da linha (`Revelar linha`/`Ocultar`), que passam a usar os olhos por campo.

## Testes (seams: a página `VaultPage`; vitest + Testing Library; só a `api` simulada, como no teste atual)

- AC-01 a AC-06: novo arquivo `apps/web/src/pages/VaultPageAccess.test.tsx`, que renderiza `VaultPage` como `VaultPage.test.tsx` e consulta por papel (`button`, `status`, `alert`), `aria-pressed` e classes; timers de 30 s e 3 s com `vi.useFakeTimers`.
- AC-09: os três testes de reveal de `VaultPage.test.tsx` são atualizados no mesmo passo que o RED (vão falhar antes da implementação); os demais não mudam.
- AC-07: medição em Chromium, resultado e capturas no PR (jsdom não calcula layout).
- AC-08: `git diff` do PR.

## Evidência visual e aceite

Capturas a 1440 px e 768 px, antes e depois, anexadas ao PR como evidência técnica. O aceite visual é de Alfredo. Sem componente novo no DS, então sem story nova.

## Riscos

- O olho por campo muda o número de requisições de reveal (uma por campo clicado, em vez de duas por linha): a auditoria do servidor passa a registrar só o campo que a pessoa abriu. Sem mudança na API.
- Autoocultar em 30 s pode esconder o valor enquanto alguém lê: o olho volta a revelar com uma nova chamada auditada.
- Sem impacto em RBAC, tenant ou API: só apresentação e estado local; nenhum segredo vai para mensagem, log ou atributo.
- `aria-label` longo (nome da credencial) é lido por leitor de tela a cada botão; é o preço de distinguir linhas.
