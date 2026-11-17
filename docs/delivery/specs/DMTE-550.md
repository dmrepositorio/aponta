## Problem Statement

Quem administra usuários no Aponta só consegue listar, buscar e abrir o perfil de um usuário em modo leitura. Falta quase tudo do dia a dia de um cadastro:

1. Não há "Novo usuário" na tela. O serviço sabe criar usuário, mas não existe rota de administrador para isso (`POST /auth/register` força o tipo `CLIENT`).
2. Não há edição pela tela. Só existe `PATCH /users/:id` para tipo e cliente; nome, e-mail, telefone, ramal, grupo de atendentes e grupos de permissões só se leem.
3. Ativar/inativar é um checkbox no detalhe, e a inativação não vale na hora: o login recusa inativo, mas `JwtStrategy.validate` não confere `active`, então quem é inativado segue usando o token que já tem até ele expirar. Um inativo também continua aparecendo no seletor de atendentes (`GET /users/agents`).
4. Não há convite nem redefinição de senha: não existe modelo de token, e `User.password` é obrigatório.
5. A lista filtra por grupo de atendentes e de permissões, mas não por tipo nem por status.
6. A tela não segue o dsgrid de Mesa e Clientes (`EzEntityToolbar`, modo Grade/Formulário, painel de filtros com filtros salvos, colunas configuráveis).
7. `POST /auth/login` passa por `passport-local` sem DTO: e-mail e senha chegam sem validação de tipo nem de tamanho.

Identidade: DMTE-550 (Multica `01a1e7d1-ca02-70e4-bfc5-47ceb1fd8358`), issue GitHub dmrepositorio/aponta#311, Tier 3, ciclo 2026-11-09/2026-11-22. Origem: pedido do Alfredo ("Implemente os recursos no cadastro de usuário", padronizado pelo dsgrid de Mesa/Clientes), com as decisões Q1 a Q19 aceitas por ele nas rodadas de planejamento.

## Solution

A tela Usuários passa a ser um cadastro completo no padrão dsgrid:

- grade com toolbar do DS, painel de filtros (Tipo e Status, no servidor, mais os filtros de grupo e a busca que já existem), colunas configuráveis e a paginação atual;
- Novo usuário e Editar usuário num formulário com abas Geral e Segurança;
- Ativar e inativar com efeito imediato, também em lote, sem exclusão de usuário;
- Convite (link de uso único para o convidado definir a própria senha) e Redefinição de senha (pedida pelo administrador ou pelo próprio usuário no "Esqueci minha senha" da tela de login), tudo atrás de uma feature flag;
- permissões próprias para cada ação, configuráveis em Grupos de permissões, checadas no backend.

## User Stories

1. Como administrador, quero ver os usuários numa grade com a mesma barra de ferramentas de Mesa e Clientes, para usar o cadastro como uso os outros.
2. Como administrador, quero filtrar por tipo (um ou mais), para achar só atendentes ou só clientes.
3. Como administrador, quero filtrar por status (Ativo, Inativo, Convite pendente), para achar quem ainda não entrou ou quem foi inativado.
4. Como administrador, quero salvar um filtro e reaplicá-lo depois, como em Mesa e Clientes.
5. Como administrador, quero que filtrar ou buscar volte à primeira página, para não ver uma página vazia.
6. Como administrador, quero escolher quais colunas aparecem e a densidade, e que isso fique salvo para mim.
7. Como administrador, quero a paginação atual (20 por página) funcionando com todos os filtros, para o volume crescer sem quebrar a tela.
8. Como administrador, quero cadastrar um novo usuário com nome, e-mail, tipo, telefone, ramal, cliente, grupo de atendentes e grupos de permissões, para não depender de seed ou de SQL.
9. Como administrador, quero que o novo usuário nasça "Convite pendente", sem eu digitar nem ver a senha, para a senha ser só da pessoa.
10. Como administrador, quero ver um erro claro ao cadastrar um e-mail que já existe, sem diferença de maiúsculas.
11. Como administrador, quero editar todos os dados do usuário no formulário, para corrigir o cadastro sem pedir a ninguém.
12. Como administrador, quero ser avisado de que trocar o tipo não troca os grupos de permissões, para não achar que o acesso mudou.
13. Como administrador, quero sair do formulário com alteração pendente só depois de confirmar, para não perder o que digitei.
14. Como administrador, quero inativar um usuário e ele perder o acesso na hora, mesmo com o token que já tinha.
15. Como administrador, quero que ninguém inative a si mesmo nem o último administrador ativo, para o sistema nunca ficar sem administrador.
16. Como administrador, quero ativar e inativar vários usuários de uma vez, com confirmação.
17. Como atendente, quero que usuário inativo ou com convite pendente não apareça como atendente atribuível.
18. Como gestor de tickets, quero que ticket antigo continue mostrando o nome de quem foi inativado, para o histórico seguir legível.
19. Como administrador, quero enviar o convite por e-mail e reenviar se a pessoa não o recebeu, e o link antigo deixar de valer.
20. Como convidado, quero abrir o link do e-mail numa página própria e definir a minha senha, para entrar no sistema.
21. Como convidado, quero uma mensagem clara quando o link expirou ou já foi usado, e saber o que fazer.
22. Como administrador, quero solicitar a redefinição de senha de um usuário, para ajudar quem perdeu o acesso sem saber a senha dele.
23. Como usuário, quero pedir a redefinição pelo "Esqueci minha senha" da tela de login, num pop-up com o meu e-mail.
24. Como usuário, quero a mesma resposta qualquer que seja o e-mail digitado, para ninguém descobrir quem tem cadastro.
25. Como usuário com link de redefinição, quero que ele sirva uma só vez e só para a minha conta.
26. Como responsável pela segurança, quero que o link não possa ser usado para trocar a senha de outra pessoa, mesmo que alguém altere o que o formulário envia.
27. Como responsável pela segurança, quero que o token fique fora de logs, de referer e de cache, e que só o hash dele exista no banco.
28. Como responsável pela segurança, quero que todo texto digitado (login, esqueci a senha, definir senha, cadastro) seja validado no servidor, e que nada digitado volte como HTML.
29. Como responsável pela segurança, quero limite de tentativas nas rotas públicas, por origem e por e-mail.
30. Como administrador, quero escolher em Grupos de permissões quem cria usuários, altera o tipo, ativa/inativa e envia convite ou redefinição, para delegar sem dar acesso total.
31. Como administrador, quero que os grupos que já gerenciam usuários continuem podendo tudo no dia da entrega, e eu revogar depois.
32. Como administrador, quero que e-mail novo saindo do sistema só ligue por uma feature flag, para decidir quando começar.
33. Como administrador no celular (390 px), quero ver Nome e Status na grade e a toolbar em uma linha rolável.
34. Como mantenedor, quero as mudanças de DS documentadas e com story ou exceção registrada.

## Implementation Decisions

Estado atual (código observado em `origin/main`, `9cba956`):

- `UsersPage.tsx`: busca, lista de 20 por página (`EzPagination`) e detalhe somente leitura com abas Perfil e Segurança; a aba Segurança só tem um aviso de que 2FA e sessões ficaram fora (DMTE-84). Não usa `EzEntityToolbar`, `EzFilterDrawer` nem `useUserScreenConfig`.
- `UsersService.findAll` devolve array simples sem parâmetros e `{ data, meta }` com `page`, `pageSize`, `q` ou filtro de grupo. `UserQueryDto` tem `q`, `technicalGroupId`, `permissionGroupId`, `page`, `pageSize`.
- Rotas de `UsersController`: todas em `MANAGE_USERS`, exceto `GET /users/agents` (`VIEW_AND_OPEN_TICKETS`). `PATCH /users/:id` aceita só `role` e `organizationId`; `PATCH /users/:id/active` grava `active`.
- `UsersService.create` existe (e-mail único, bcrypt, vínculo ao grupo de permissões padrão do tipo) e só é usado por `POST /auth/register`.
- `User.password` é `String` obrigatório. `AuthService.validateUser` recusa `active = false`; `JwtStrategy.validate` não.
- `PermissionGroup.permissions` é uma lista de chaves do catálogo; um grupo existente não ganha chave nova sozinho. ADMIN tem bypass no `PermissionsGuard`.
- `MailService.sendEmail` devolve `void` e engole a falha de envio (só registra no log); sem SMTP, aborta em silêncio.
- `findAgents` não filtra `active`.
- Flags: `apps/api/src/feature-flags`, cada uma com dono, padrão e data de remoção; valor por ambiente em `FEATURE_<CHAVE>`.
- Throttle global de 100/min, com 5/min no login e no registro; `E2E_TESTING=true` o desliga.

Decisões (todas [Humano], aceitas pelo Alfredo nas rodadas Q1 a Q19, salvo marca de proposta):

- D1 Uma entrega (DMTE-550, Tier 3), seis tickets sequenciais, um PR, um coordenador; T3 e T4 podem trocar de ordem depois de T2.
- D2 Grade no padrão dsgrid de Mesa e Clientes: `EzEntityToolbar` (Incluir = Novo usuário, Recarregar, configurar colunas; sem Excluir nem Duplicar; entram "Ativar" e "Inativar" em lote), modo Grade/Formulário, `EzFilterDrawer` com filtros dinâmicos e salvos, `useUserScreenConfig('users', …)`.
- D3 Filtros Tipo (múltipla escolha, os cinco papéis) e Status (Ativo, Inativo, Convite pendente) no servidor, combinados com `q`, grupo de atendentes e grupo de permissões. Valor fora do enum responde 400. Filtro ou busca volta à página 1. Paginação atual mantida (20 por página, `{ data, meta }`); sem seletor de tamanho.
- D4 Formulário com abas Geral (nome, e-mail, telefone, ramal, tipo, cliente, grupo de atendentes, grupos de permissões) e Segurança (situação, convite, redefinição). Segue o modelo de salvamento da Mesa (DMTE-533): um só botão de salvar, confirmação ao sair com alteração pendente.
- D5 E-mail continua único sem diferença de caixa. Trocar o tipo não troca os grupos de permissões já vinculados; a tela avisa.
- D6 Permissões novas no catálogo (categoria gestão): `CREATE_USERS`, `CHANGE_USER_ROLE`, `ACTIVATE_DEACTIVATE_USERS`, `SEND_USER_INVITES_AND_RESETS`. `MANAGE_USERS` continua dando a tela, a lista e a edição dos dados. O backend checa a chave de cada ação; a tela esconde ou desabilita o que o usuário não pode. Sem regra fixa de papel ("só ADMIN mexe em ADMIN" foi descartada).
- D7 Uma migration acrescenta as quatro chaves a todo `PermissionGroup` que já contém `MANAGE_USERS` (idempotente), e os grupos padrão por tipo as incluem onde `MANAGE_USERS` já está.
- D8 Inativar vale na hora: `JwtStrategy.validate` recusa `active = false` (401). Ninguém inativa a si mesmo nem o último ADMIN ativo (409). Sem exclusão de usuário; histórico preservado. Em lote, as regras valem sobre o conjunto, tudo ou nada, até 100 usuários por chamada.
- D9 `GET /users/agents` deixa de listar inativos e quem está com convite pendente. Tickets que já estão com um inativo continuam mostrando o nome.
- D10 Convite: o usuário criado pelo administrador nasce sem senha (`User.password` passa a aceitar nulo) e, por isso, "Convite pendente"; o login recusa quem não tem senha. O administrador nunca digita nem vê a senha, inclusive com a flag desligada (Q17): sem convite enviado, o usuário novo fica pendente.
- D11 Token (convite e redefinição): 32 bytes aleatórios, só o hash (SHA-256) no banco, em tabela própria com usuário, propósito (convite ou redefinição), validade, marca de uso e quem emitiu. Validade: convite 72 h; redefinição pelo administrador 24 h; "Esqueci minha senha" 1 h. Uso único e atômico (a marca de uso só grava se ainda não usado e não expirado), válido sob concorrência. Emitir um token novo invalida os anteriores do mesmo usuário e propósito. A emissão usa a hora injetável do serviço, para os testes controlarem o relógio.
- D12 Página própria do link (`/definir-senha`), fora do modal: o token vem no fragmento da URL (`#t=…`), que não vai ao servidor nem a sites externos; a página o lê, o apaga da barra de endereço e o envia no corpo de um `POST`. O formulário manda só `token` e `senha`, sem e-mail nem id de usuário: o servidor acha o usuário pelo hash, então o link de A só troca a senha de A. Token inexistente, expirado, usado ou substituído dá a mesma resposta genérica. Respostas das rotas de token saem com `Cache-Control: no-store`; a página, com `Referrer-Policy: no-referrer`. Estados: link válido, link inválido/expirado/usado (mensagem fixa, com o caminho para pedir outro) e sucesso (volta ao login sem entrar logado). Senha de 8 a 128 caracteres.
- D13 Redefinição pelo administrador: pela aba Segurança, para usuário ativo e com senha; a senha atual vale até o link ser usado. "Esqueci minha senha": link na tela de login abre um modal (`EzDialog`) só com o e-mail; a resposta é sempre a mesma; só conta ativa com senha recebe o e-mail; envio sem bloquear a resposta, para o tempo não revelar se a conta existe. Limite de 5 por minuto por origem e por e-mail. Usar um link de redefinição invalida os demais tokens de redefinição do usuário.
- D14 Flag `convite-e-redefinicao-usuario` (dono `alfredo`, padrão desligada, remoção 2027-01-15). Desligada: botões de enviar convite e redefinir senha desabilitados com a explicação, link "Esqueci minha senha" escondido, e as rotas de convite, redefinição, "esqueci" e definir senha respondem 404; nenhum token é criado sem e-mail enviado. Ligar em produção depende do SMTP configurado e de `PUBLIC_APP_URL` (passo do Alfredo).
- D15 `MailService.sendEmail` passa a informar se o envio foi aceito pelo SMTP. Convite ou redefinição cujo envio falha responde erro e deixa nenhum token válido. O nome no corpo do e-mail é escapado; link, token e senha nunca vão para log.
- D16 Sanitização: todo corpo, parâmetro e query dos endpoints novos e do login usa DTO com `class-validator` (`whitelist` e `forbidNonWhitelisted` já são globais): tipo string, texto aparado, e-mail em minúsculas com limite de 254, nome e demais campos com limite de tamanho, senha de 8 a 128, token só hexadecimal de tamanho fixo, UUIDs e listas validados. O login valida o corpo antes de consultar o banco. Só Prisma parametrizado, sem SQL cru. Nada digitado volta como HTML; mensagens de erro são fixas, sem eco da entrada. Os formulários aparam e validam antes de enviar, mas a validação do servidor é a que vale.
- D17 Notificação por e-mail do sistema não sai para quem está com convite pendente.
- D18 [Proposta] O status "Convite pendente" é derivado (`password` nulo), sem coluna nova de status. "Ativo" e "Inativo" seguem `active`. Um pendente pode ser inativado (D8); reativado, volta a pendente.
- D19 [Proposta] `ActiveTag` (DMTE-541) ganha a variante "Convite pendente" (`EzTag`, tokens existentes, texto e ícone). Sem componente novo no DS e sem ADR.
- D20 [Proposta] Parecer de design (impeccable e web-design-guidelines; não há PRODUCT.md nem DESIGN.md, vale o DS): superfície Operate; `tabular-nums`; `autocomplete` correto (`username`, `current-password`, `new-password`); `spellCheck={false}` no e-mail; colar liberado; erro inline com foco no primeiro campo inválido; `aria-live="polite"` nas mensagens; confirmação em modal para ações em lote e inativar; Escape, foco preso e foco devolvido no modal. Divergência consciente: filtros e paginação não vão para a URL, como no dsgrid de Mesa e Clientes.

Riscos:

- R1: `GET /users` não é isolado por organização (`CLIENT_MASTER` com `MANAGE_USERS` hoje enxerga todos); esta entrega não muda isso, e as chaves novas seguem o mesmo escopo da lista. Registrado, fora de escopo.
- R2: o envio de e-mail só é verificável com SMTP simulado; o envio real em produção é passo do Alfredo.
- R3: o token usa o fragmento da URL; se o cliente de e-mail do convidado quebrar o `#`, o link não funciona. Mitigação: a mensagem do link inválido manda pedir outro; o link só ocorre no corpo do e-mail como URL completa.
- R4: a migration das chaves e a de `password` nulo são irreversíveis na prática; o rollback do PR só volta a interface (o código legado não escreve nulo).
- R5: `JwtStrategy.validate` passa a consultar `active` em toda requisição autenticada; já relê o usuário, então não há consulta nova.
- R6: sem lista de sessões, os tokens de login emitidos antes de uma redefinição de senha continuam valendo até expirar (2FA e sessões seguem fora, DMTE-84).
- R7: jsdom não mede layout; responsivo é testado por classes de breakpoint e conferido em Chromium, evidência técnica, não aceite visual.

## Testing Decisions

Um bom teste confere comportamento observável (resposta HTTP, o que a pessoa vê e faz), não detalhe de implementação. Pontos de teste confirmados pelo Alfredo:

1. HTTP da API (supertest com `ValidationPipe`, guards e controllers reais; Prisma e e-mail simulados). Prior art: `auth-rate-limit.integration.spec.ts`, `users.controller.spec.ts`.
2. Telas do web (Vitest e Testing Library, `api` simulada). Prior art: `UsersPage.test.tsx`, `ServiceDesksPage.test.tsx`, `LoginPage.test.tsx`.
3. Ciclo de vida do token pela interface pública do serviço (emitir, consumir) com relógio injetado. É o único ponto novo.

Sem E2E novo; a suíte E2E existente (`scripts/e2e_isolated.sh`) continua verde. Dados sintéticos, sem cliente real.

Critérios de aceite (T1 a T6 são os tickets, abaixo):

- AC-01: a tela Usuários usa `EzEntityToolbar` com Novo usuário (só com `CREATE_USERS`, a partir de T2), Recarregar e configurar colunas, modo Grade/Formulário e painel de filtros; não tem Excluir nem Duplicar.
- AC-02: `GET /users` aceita `roles` (lista) e `status` (`ACTIVE`, `INACTIVE`, e `PENDING` a partir de T5) e filtra no servidor, combinando com `q`, `technicalGroupId`, `permissionGroupId`, `page` e `pageSize`; valor fora do enum responde 400 sem eco da entrada.
- AC-03: o painel de filtros tem Tipo (múltipla escolha) e Status, filtros dinâmicos e salvos e colunas configuráveis por usuário (`useUserScreenConfig`); mudar filtro ou busca volta à página 1; a paginação de 20 por página e o total continuam.
- AC-04: abaixo de 640 px a grade mostra Nome e Status e a toolbar rola em uma linha (classes de breakpoint declaradas).
- AC-05: o catálogo de permissões tem `CREATE_USERS`, `CHANGE_USER_ROLE`, `ACTIVATE_DEACTIVATE_USERS` e `SEND_USER_INVITES_AND_RESETS` na categoria gestão; a migration as acrescenta a todo grupo que tem `MANAGE_USERS` (rodar duas vezes não duplica) e os grupos padrão as incluem onde `MANAGE_USERS` já está.
- AC-06: `POST /users` exige `CREATE_USERS` (403 sem ela, mesmo com a tela manipulada), valida o DTO, cria o usuário sem senha, vincula o grupo de permissões padrão do tipo mais os escolhidos, e responde 409 com mensagem fixa para e-mail já cadastrado (sem diferença de caixa).
- AC-07: o formulário de Novo usuário valida inline (nome, e-mail, tipo obrigatórios), mostra o erro do servidor e, ao criar, abre o cadastro do novo usuário, em "Convite pendente".
- AC-08: o login recusa usuário sem senha com a mesma resposta 401 de credencial inválida; a coluna `password` aceita nulo e nenhum código lê a senha nula como hash.
- AC-09: `PATCH /users/:id` aceita nome, e-mail, telefone, ramal, cliente, grupo de atendentes, grupos de permissões e tipo; exige `MANAGE_USERS` e, para alterar o tipo, também `CHANGE_USER_ROLE` (403 sem ela); e-mail único sem diferença de caixa; cliente e grupos inexistentes respondem 400/404.
- AC-10: a aba Geral edita todos os campos com um só botão de salvar, erro inline por campo, confirmação ao sair com alteração pendente e aviso de que trocar o tipo não troca os grupos de permissões; campo sem permissão para editar fica somente leitura.
- AC-11: `PATCH /users/:id/active` exige `ACTIVATE_DEACTIVATE_USERS`; inativar a si mesmo ou o último ADMIN ativo responde 409; `PATCH /users/active` aplica ativar/inativar em lote (até 100) com as mesmas regras sobre o conjunto, tudo ou nada.
- AC-12: `JwtStrategy.validate` recusa usuário com `active = false` com 401 na requisição seguinte, mesmo com token ainda válido.
- AC-13: `GET /users/agents` não lista inativos nem usuários com convite pendente; um ticket que já tem um inativo como atendente continua mostrando o nome.
- AC-14: "Ativar" e "Inativar" em lote e a troca de situação na aba Segurança pedem confirmação em modal, mostram o motivo quando o servidor recusa e substituem o checkbox atual.
- AC-15: o serviço de token emite e consome tokens de convite (72 h) e de redefinição (24 h; 1 h no "esqueci"): só o hash fica no banco; expirado, usado ou substituído é recusado; o uso é atômico (duas tentativas simultâneas, uma passa); emitir um novo invalida os anteriores do mesmo usuário e propósito.
- AC-16: `MailService.sendEmail` informa se o envio foi aceito; convite ou redefinição com envio falho responde erro e não deixa token válido.
- AC-17: `POST /users/:id/invite` (`SEND_USER_INVITES_AND_RESETS`, flag ligada, só usuário com convite pendente) envia o convite com o link `/definir-senha#t=<token>` montado de `PUBLIC_APP_URL`; reenviar invalida o link anterior; com a flag desligada responde 404 e não cria token.
- AC-18: `POST /auth/password/set` (público, com limite de tentativas) recebe só `token` e `senha`, define a senha do usuário dono do token e marca o token como usado; token inexistente, expirado, usado ou substituído dá a mesma resposta genérica; o corpo não aceita e-mail nem id de usuário; a resposta sai com `Cache-Control: no-store`; o token nunca aparece em log.
- AC-19: a página `/definir-senha` lê o token do fragmento, o apaga da barra de endereço, mostra o formulário (nova senha e confirmação, `autocomplete="new-password"`, erro inline, `aria-live`), os estados de link inválido/expirado/usado e de sucesso (volta ao login), e nunca ecoa o que foi digitado como HTML.
- AC-20: o status "Convite pendente" aparece na grade (`ActiveTag` com texto e ícone), no filtro de Status (`PENDING`) e no formulário; ao definir a senha o usuário vira Ativo; quem está com convite pendente não recebe e-mail de notificação do sistema.
- AC-21: a flag `convite-e-redefinicao-usuario` está registrada (dono `alfredo`, padrão desligada, remoção 2027-01-15); com ela desligada os botões de convite e redefinição ficam desabilitados com a explicação e o link "Esqueci minha senha" não aparece.
- AC-22: `POST /users/:id/password-reset` (`SEND_USER_INVITES_AND_RESETS`, flag ligada, só usuário ativo e com senha) envia o link de 24 h; a senha atual continua valendo até o uso; usar o link invalida os outros tokens de redefinição do usuário.
- AC-23: `POST /auth/forgot-password` (público) responde sempre o mesmo corpo, qualquer e-mail; só conta ativa com senha recebe o e-mail (link de 1 h); o envio não bloqueia a resposta; o limite é de 5 por minuto por origem e por e-mail; com a flag desligada responde 404.
- AC-24: o modal "Esqueci minha senha" (`EzDialog`) na tela de login pede só o e-mail, valida antes de enviar, mostra a mensagem fixa de resposta, tem Escape, foco preso e foco devolvido, e só existe com a flag ligada.
- AC-25: `POST /auth/login` valida o corpo por DTO antes de consultar o banco (e-mail string de até 254 e em minúsculas, senha string de 1 a 128); objeto, lista, número ou texto enorme respondem 400 sem tocar no banco; credencial errada continua 401 com a mensagem atual.
- AC-26: entrada hostil nos endpoints públicos e no cadastro: tipo errado (objeto, lista), texto enorme, `<script>` e HTML, aspas e `'; DROP TABLE`, e-mail com quebra de linha (injeção de cabeçalho), token mal formado; todos respondem erro de validação sem eco, sem erro 500 e sem chamar o banco com o valor.
- AC-27: um link de redefinição de A não troca a senha de B, nem com corpo alterado (campos extras recusados por `forbidNonWhitelisted`).
- AC-28: o usuário nunca vê nem digita a senha de outro: nenhuma resposta da API de usuários contém `password` nem hash.
- AC-29: sem API nova além das listadas; `docs/architecture/03-sankhya-ds-parity.md` registra a variante de `ActiveTag` e o uso do dsgrid em Usuários; o que muda no DS tem story ou exceção registrada no manifesto; `GLOSSARY.md` tem Convite, Convite pendente e Redefinição de senha.
- AC-30: em Chromium, a 1440×900, 1024×768 e 390×844, a tela Usuários, o formulário, o modal e a página `/definir-senha` não têm rolagem horizontal; capturas antes e depois anexadas ao PR. Evidência técnica; o aceite visual é do Alfredo.

Prior art: `users.controller.spec.ts`, `users.service.spec.ts`, `permission-catalog.spec.ts`, `permissions.guard.spec.ts`, `auth-rate-limit.integration.spec.ts`, `feature-flags.spec.ts`, `UsersPage.test.tsx`, `ServiceDesksPage.test.tsx`, `OrganizationsPage.test.tsx`, `LoginPage.test.tsx`.

Matriz de validação: AC-01 a AC-04 grade e filtros (API e tela); AC-05 a AC-08 permissões e criação; AC-09 e AC-10 edição; AC-11 a AC-14 ativar e inativar; AC-15 a AC-21 token, convite e página do link; AC-22 a AC-28 redefinição, login e segurança; AC-29 e AC-30 documentação e evidência visual.

Tickets (sub-issues desta SPEC, em ordem):

- T1 Grade de Usuários no padrão dsgrid (AC-01 a AC-04).
- T2 Permissões granulares e Novo usuário (AC-05 a AC-08), bloqueado por T1.
- T3 Editar usuário (AC-09, AC-10), bloqueado por T2.
- T4 Ativar e inativar (AC-11 a AC-14), bloqueado por T2.
- T5 Convite e página do link (AC-15 a AC-21), bloqueado por T3 e T4.
- T6 Redefinição de senha e login (AC-22 a AC-28), bloqueado por T5.
- AC-26 a AC-28 valem para toda rota exposta; cada ticket cobre as suas e o T6 fecha o conjunto. AC-29 e AC-30 fecham no ticket em que a mudança acontece e se conferem no T6.

## Out of Scope

- 2FA, lista e derrubada de sessões ativas, e login social (DMTE-84, fora desde então).
- Exclusão de usuário (a regra é inativar), importação em massa e seletor de tamanho de página.
- Isolamento por organização em `GET /users` (R1).
- Regra de papel fixa, como "só ADMIN altera ADMIN" (descartada; a delegação é por permissão).
- Política de senha além de 8 a 128 caracteres; derrubar tokens de login já emitidos ao trocar a senha.
- Ligar a flag e configurar o SMTP em produção (passo do Alfredo).
- Qualquer outra tela além de Usuários, login e `/definir-senha`.

## Further Notes

- Evidência visual: capturas de Usuários, do formulário, do modal e da página `/definir-senha` em 390, 1024 e 1440 px, antes e depois, com dados sintéticos, anexadas ao PR. O aceite visual é do Alfredo.
- Tier 3: comportamento de produto com schema, migration, permissões, segurança e e-mail. Impacto em RBAC: cada ação passa a ter chave própria. Sem dado real em fixtures.
- Autorização: nenhuma mudança de produção sem o merge pela fila; o envio real de e-mail depende da flag e do SMTP.
- Desvios e limites da implementação (registrados na etapa Developer; não mudam os critérios):
  - AC-24: o modal "Esqueci minha senha" usa `EzModal` com a prop nova `trapFocus` (desligada por padrão, com story `FocoPreso`), porque o `EzDialog` só aceita texto e não prende o foco.
  - AC-03: Tipo, Status, busca e os filtros de grupo rodam no servidor; os filtros dinâmicos do painel valem só para a página carregada.
  - D2: as ações "Ativar" e "Inativar" em lote ficam numa faixa abaixo da toolbar (escondida abaixo de 640 px), não dentro dela.
  - AC-30: a 390 px a coluna Status fica parcialmente visível na grade (o cabeçalho de Nome já fixa uma largura mínima); o botão primário mede 42 px (`EzButton` medium), abaixo dos 44 px da toolbar do DS.
  - D8: a trava do último ADMIN vale na inativação; trocar o tipo do último ADMIN pelo `PATCH /users/:id` não é barrado. A inativação simultânea de dois administradores não é serializável.
  - D13: o limite de 5 por minuto por e-mail do "esqueci" é um contador em memória por processo; com mais de uma instância precisa ir para um armazenamento compartilhado. O `main.ts` não define `trust proxy`, então atrás do nginx o limite por origem vê um único IP (o login já tinha o mesmo comportamento).
  - D5: o e-mail é guardado aparado e em minúsculas em toda escrita (cadastro do administrador, `POST /auth/register`, `PATCH /auth/me`), então a corrida entre duas caixas diferentes cai no índice único (409). A busca usa a chave única e só varre sem diferença de caixa quando ela não acha (dado legado de caixa mista). O índice único do banco segue sensível à caixa: um índice em `lower(email)` falharia na migration se já houver e-mails duplicados por caixa.
  - D16: senha de até 128 caracteres, mas o bcrypt só usa os 72 primeiros bytes.
  - D17: o filtro de e-mail para convite pendente está no `MailService` (um ponto só, consulta pela chave única do e-mail em minúsculas); só o convite do próprio usuário usa `toPendingUser`.
