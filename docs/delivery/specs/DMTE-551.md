# Login: senha forte, sessões que caem, segundo fator e login social (Google e GitHub; Facebook fora, ver a emenda da rodada 2)

Identidade: DMTE-551, issue dmrepositorio/aponta#310, pai Multica `01a1e7d3-5980-779f-8b61-200fa5eac492`, Tier 3, ciclo 2026-11-09/2026-11-22. Pedido de Alfredo em 17/11/2026: redefinir senha por e-mail com regra de complexidade, entrar com GitHub, Google e Facebook, e ativar autenticação em dois fatores na conta. Decisões confirmadas por Alfredo no pai (Q1 a Q12). Base de planejamento: `main` em `35b982f`.

**Emenda da rodada 2 (decisão de Alfredo no pai, 17/11/2026): o Facebook sai desta entrega.** A documentação do Graph API não garante que o `email` seja confirmado e não oferece campo que diga isso; tratar a presença do e-mail como verificação deixaria alguém assumir a conta de outra pessoa. Esta entrega traz só Google e GitHub. O Facebook volta em ticket próprio, com a ligação da conta feita em Minha Conta por quem já está logado. Onde o texto abaixo cita o Facebook (histórias 9 e 12, AC-17 em diante) vale a emenda; a flag e as variáveis `OAUTH_FACEBOOK_*` não existem.

**Reconciliação com a DMTE-550 (#311, integrada em `35b982f`).** A redefinição de senha por e-mail já existe por ela: "Esqueci minha senha" no login, `POST /auth/forgot-password`, `POST /auth/password/set`, página `/definir-senha`, token com hash e uso único, flag `convite-e-redefinicao-usuario`, `PUBLIC_APP_URL`, link de 1 h e 5 pedidos por minuto por origem e por e-mail. Alfredo aceitou manter esses valores (Q10). Esta SPEC não recria esse fluxo: acrescenta o que a DMTE-550 deixou de fora, a regra de senha forte e a queda das sessões antigas, e entrega o segundo fator e o login social.

## Problem Statement

Quem usa o Aponta (administrador, atendente ou cliente) só entra com e-mail e senha. A regra de senha é só "8 caracteres" e permite senhas óbvias, como o nome da pessoa com um número. Trocar ou redefinir a senha não derruba as sessões abertas: quem estava com a senha antiga continua dentro até o token expirar. Não há login com contas que a pessoa já usa (Google, GitHub, Facebook) e não há segundo fator: uma senha vazada basta para entrar.

## Solution

A senha passa a seguir uma regra de complexidade mais forte, no cadastro, na troca de senha e na definição por link (a redefinição por e-mail já existe). Trocar ou redefinir a senha encerra as outras sessões. A pessoa pode entrar com Google, GitHub ou Facebook, desde que já tenha conta no Aponta. Em Minha Conta, pode ativar a autenticação em dois fatores com um aplicativo autenticador; quem ativa passa a informar um código a cada entrada, seja por senha ou por login social. Um administrador consegue desativar o segundo fator de quem perdeu o aplicativo e os códigos de recuperação.

## User Stories

1. Como usuário, quero ver a regra da senha e o que falta cumprir enquanto digito, para acertar de primeira.
2. Como usuário, quero que a senha não possa ser meu nome, meu e-mail ou o domínio dele, mesmo com números ou símbolos colados, para que minha senha não seja adivinhada.
3. Como usuário, quero a mesma regra de senha no cadastro, na troca de senha e na definição pelo link do e-mail, para não haver caminho mais fraco.
4. Como usuário que trocou ou redefiniu a senha, quero que as outras sessões abertas deixem de valer, para que quem estava com a senha antiga seja desconectado.
5. Como usuário que trocou a senha em Minha Conta, quero continuar logado na sessão em que troquei, para não ser deslogado sem motivo.
6. Como responsável pelo deploy, quero que o envio de e-mail exija TLS nas portas que não são a 465, para que a senha do SMTP e o conteúdo não trafeguem abertos.
7. Como usuário, quero entrar com minha conta Google, para não precisar lembrar outra senha.
8. Como usuário, quero entrar com minha conta GitHub, para não precisar lembrar outra senha.
9. Como usuário, quero entrar com minha conta Facebook, para não precisar lembrar outra senha.
10. Como administrador, quero que o login social só entre em conta que já existe no Aponta e está ativa, para que ele não seja uma segunda porta de cadastro.
11. Como administrador, quero que a conta social seja ligada pelo e-mail verificado do provedor, para que ninguém assuma a conta de outra pessoa com um e-mail não verificado.
12. Como usuário que tenta entrar pelo Facebook sem e-mail verificado, quero uma mensagem clara do que fazer, para não ficar sem saber por que falhou.
13. Como administrador, quero que o botão de cada provedor só apareça quando o provedor está configurado e a funcionalidade está ligada, para não oferecer um login que não funciona.
14. Como usuário, quero ativar o segundo fator em Minha Conta, escaneando um QR com meu aplicativo autenticador e confirmando com um código, para que a ativação só valha depois de eu provar que o aplicativo funciona.
15. Como usuário, quero receber 10 códigos de recuperação uma única vez na ativação, para ter uma saída se perder o aplicativo.
16. Como usuário com segundo fator, quero informar o código depois da senha, para que a senha sozinha não baste.
17. Como usuário com segundo fator, quero ser desafiado também depois de entrar com GitHub, Google ou Facebook, para que o login social não pule o segundo fator.
18. Como usuário sem segundo fator, quero continuar entrando direto, como hoje, porque o segundo fator é opcional.
19. Como usuário, quero usar um código de recuperação no lugar do código do aplicativo, e que ele só funcione uma vez, para sair de uma perda do aparelho.
20. Como usuário, quero desativar o segundo fator informando minha senha atual e um código, para que ninguém com minha sessão aberta consiga desativá-lo.
21. Como administrador, quero desativar o segundo fator de um usuário que perdeu o aplicativo e os códigos, e que isso fique registrado (quem, quem foi afetado, quando), para recuperar o acesso dele com rastreio.
22. Como administrador, quero controlar quem pode desativar o segundo fator de outros pelas permissões do Aponta, com ADMIN podendo por padrão, para delegar depois sem dar acesso total.
23. Como administrador, quero ligar e desligar cada parte (segundo fator, cada provedor) por feature flag, para liberar aos poucos em cada ambiente.
24. Como responsável pelo deploy, quero que as credenciais de SMTP, dos provedores e a chave de cifra fiquem só nas variáveis de ambiente e nunca no repositório, nos logs ou nos testes.
25. Como usuário de API ou do servidor MCP, quero que meus tokens de API continuem funcionando sem segundo fator, porque não passam pela tela de login.

## Implementation Decisions

Três blocos, entregues nesta ordem: A (senha forte e sessões), B (segundo fator), C (login social). Uma SPEC, nove tickets.

**Regra de senha e sessões (A)**
- Uma única implementação da regra, usada pelo cadastro, pela troca de senha e pela definição por link. Mínimo de 10 caracteres, com maiúscula, minúscula, número e símbolo; o máximo continua 128.
- Recusa a senha que contiver, sem diferenciar maiúsculas, acentos ou números e símbolos colados: qualquer parte do nome do usuário com 3 letras ou mais, a parte do e-mail antes do `@` ou o domínio do e-mail.
- Senhas atuais continuam válidas até a próxima troca. Ninguém é forçado a trocar. Usuário criado pelo administrador nasce sem senha (DMTE-550) e define a dele pelo link, já sob a regra nova.
- Versão de senha no usuário, levada no JWT e conferida na estratégia JWT, que já consulta o usuário a cada requisição. Trocar a senha em Minha Conta e definir a senha pelo link incrementam a versão; token de versão diferente é recusado. A sessão que fez a troca recebe um token novo.
- O envio de e-mail exige TLS quando a porta não é a 465. Sem SMTP configurado, o comportamento da DMTE-550 se mantém.
- Segurança contra injeção: nenhum SQL cru nos fluxos novos, acesso a dados só pelo ORM parametrizado, toda entrada validada por DTO com tamanho máximo. Símbolos e aspas na senha não são proibidos.
- A redefinição por e-mail (endpoints, página, token, flag `convite-e-redefinicao-usuario`, `PUBLIC_APP_URL`, 1 h, 5 por minuto) é da DMTE-550 e não muda, com uma exceção da rodada 3: `POST /auth/forgot-password` passa a responder 200 (antes 201), porque não cria recurso; o web aceita qualquer 2xx e o spec da DMTE-550 aceita 200 ou 201.

**Segundo fator (B)**
- TOTP (RFC 6238), compatível com aplicativos autenticadores comuns. Ativação em Minha Conta: o servidor gera um segredo pendente, o usuário confirma com um código válido, só então o segundo fator fica ativo e os 10 códigos de recuperação são mostrados uma única vez.
- Segredo guardado cifrado com chave vinda de variável de ambiente (`TWO_FACTOR_ENCRYPTION_KEY`); códigos de recuperação guardados só como hash e de uso único. Chave ausente com o recurso ligado impede a ativação, não o login.
- Login em dois passos: senha (ou login social) correta de quem tem segundo fator devolve um token curto, que serve apenas para o desafio; o JWT completo só sai com um código do aplicativo ou de recuperação válido. Tentativas de código limitadas a 5 por minuto, como o login.
- O desafio vale para quem já ativou mesmo que a feature flag seja desligada depois; a flag controla apenas a ativação.
- Desativar o próprio segundo fator exige senha atual e um código.
- Desativar o de outro usuário é uma permissão nova do catálogo, `DISABLE_USER_TWO_FACTOR`, checada no backend. ADMIN a tem pelo bypass do guard de permissões; nenhum grupo a recebe por padrão. A ação fica na aba Segurança do formulário de usuário (DMTE-550). O evento é gravado numa tabela de eventos de segurança (quem, afetado, quando, tipo). Não há outro caminho de recuperação.
- Tokens de API e MCP não mudam e não passam pelo desafio.

**Login social (C)**
- Fluxo OAuth 2.0 com código de autorização: o web leva a pessoa ao provedor, o servidor recebe o retorno, troca o código, lê o e-mail e se ele é verificado. Estado de uso único e de curta duração contra CSRF, PKCE onde o provedor aceita, `nonce` quando o provedor é OIDC (Google).
- O servidor não devolve JWT na URL: entrega ao web um código de troca de uso único e vida curta, que o web troca por JWT (ou pelo token de desafio, se houver segundo fator).
- Só entra em conta existente e ativa, com senha ou convite já concluído. Liga a identidade do provedor ao usuário pelo e-mail verificado na primeira vez; depois, a ligação é pelo identificador do provedor. Papel e organização do usuário não mudam. Sem e-mail verificado, falha com mensagem clara. Desvincular provedor fica de fora.
- Cada provedor tem feature flag própria e variáveis de ambiente próprias (identificador e segredo do aplicativo). Sem as variáveis, o botão fica oculto e a rota recusa.
- Implementação sem biblioteca de OAuth de terceiros se for possível com a plataforma e a biblioteca padrão; qualquer dependência nova passa antes pela skill `development-dependencies`.

**Dados e contratos**
- Novas estruturas: versão de senha no usuário, estado do segundo fator do usuário (segredo cifrado, ativo, códigos de recuperação com hash), identidade externa (provedor, identificador no provedor, usuário) e evento de segurança. Migração só aditiva e reversível pelo aplicativo anterior.
- Endpoints públicos novos limitados e com resposta uniforme; endpoints de segundo fator autenticados; desativação por outro usuário pela permissão nova.
- Feature flags registradas no registro existente com dono `alfredo`, padrão desligado e data de remoção 2027-01-31: `autenticacao-dois-fatores`, `login-social-google`, `login-social-github`.
- Web: botões de provedor e desafio de código no login, seção Segurança em Minha Conta e ação de administrador na aba Segurança do formulário de usuário; a regra da senha aparece nas telas de cadastro, troca e definição de senha. Reusar componentes e tokens do DS; sem Carbon nem Next.js.

**Configuração de ambiente (sem valores no repositório)**
- `PUBLIC_APP_URL` e `SMTP_*` já existentes; novas: `TWO_FACTOR_ENCRYPTION_KEY`, identificador e segredo por provedor. Os valores reais ficam nos segredos de cada ambiente, sob gestão de Alfredo. A senha SMTP que apareceu em comentário do pai deve ser trocada por Alfredo depois da configuração; este plano não a copia.

## Acceptance criteria

Bloco A: senha forte, sessões e e-mail
- AC-01: a regra de senha recusa senha com menos de 10 caracteres ou sem maiúscula, minúscula, número ou símbolo, e aceita uma que cumpre tudo.
- AC-02: a regra recusa senha que contém parte do nome (3 letras ou mais), a parte local do e-mail ou o domínio, sem diferenciar maiúsculas, acentos ou números e símbolos colados (`joao2026`, `Joao!123`, `JOÃO_1`).
- AC-03: cadastro, troca de senha e definição pelo link aplicam a mesma regra e recusam com 400 e mensagem que diz o que falta; senhas existentes continuam entrando.
- AC-04: depois da troca de senha em Minha Conta ou da definição pelo link, um JWT emitido antes é recusado e o login com a senha nova funciona; a sessão que trocou a senha recebe um token novo e continua válida.
- AC-05: com porta diferente de 465 o transporte de e-mail exige TLS; o comportamento sem SMTP configurado não muda.
- AC-06: payloads de injeção (aspas, `;`, `--`, `' OR '1'='1`) nos campos de senha, código, token e `state` dos endpoints desta entrega não alteram o resultado nem causam erro 500, e nenhum deles usa SQL cru.
- AC-07: no web, as telas de cadastro, de troca de senha e de definição de senha mostram a regra e o que falta, e exibem o erro do servidor, com a API simulada.

Bloco B: segundo fator
- AC-08: a ativação gera segredo pendente, só ativa com um código TOTP válido (conferido contra os vetores do RFC 6238) e mostra 10 códigos de recuperação uma única vez; segredo e códigos não aparecem em resposta posterior nem em log.
- AC-09: o segredo fica cifrado e os códigos de recuperação ficam como hash; sem `TWO_FACTOR_ENCRYPTION_KEY` a ativação é recusada e o login de quem não tem segundo fator segue normal.
- AC-10: quem tem segundo fator, ao entrar com a senha correta, recebe só um token de desafio (que não acessa nenhuma outra rota) e o JWT completo só sai com código válido do aplicativo ou de recuperação; quem não tem entra direto.
- AC-11: um código de recuperação funciona uma vez; código TOTP repetido na mesma janela é recusado; mais de 5 tentativas por minuto recebem 429.
- AC-12: desativar o próprio segundo fator exige senha atual e código válido; sem os dois, recusa.
- AC-13: a permissão `DISABLE_USER_TWO_FACTOR` está no catálogo; quem a tem (ADMIN pelo bypass) desativa o segundo fator de outro usuário e o evento (quem, afetado, quando, tipo) é gravado; quem não a tem recebe 403 e nenhum grupo a recebe por padrão.
- AC-14: o desafio continua valendo para quem já ativou mesmo com a flag `autenticacao-dois-fatores` desligada; a flag só esconde e recusa a ativação.
- AC-15: tokens de API e do servidor MCP continuam autenticando sem segundo fator.
- AC-16: no web, Minha Conta tem a seção Segurança (ativar, mostrar QR e códigos, desativar), o login mostra o campo de código com opção de código de recuperação, e a aba Segurança do formulário de usuário tem a ação do administrador, escondida de quem não tem a permissão.

Bloco C: login social
- AC-17: com provedor simulado, o retorno com e-mail verificado de conta existente e ativa liga a identidade, devolve o código de troca de uso único e o web o troca por JWT; o JWT nunca aparece na URL.
- AC-18: o login social nunca cria usuário; conta inexistente, inativa, com convite pendente ou e-mail sem verificação falha com mensagem clara e sem ligar identidade.
- AC-19: estado inválido, reutilizado ou expirado, `nonce` divergente (Google) e código de troca reutilizado são recusados.
- AC-20: depois de ligada, a entrada é pelo identificador do provedor, não mais pelo e-mail; papel e organização do usuário não mudam.
- AC-21: quem tem segundo fator é desafiado depois do login social do mesmo modo que depois da senha.
- AC-22: cada provedor tem sua flag e variáveis; sem elas o botão não aparece e a rota recusa; as flags são independentes; o Facebook não é oferecido nem aceito, mesmo com variáveis configuradas (emenda da rodada 2).
- AC-23: nenhum segredo de provedor, de SMTP ou chave de cifra aparece no repositório, em fixtures, em log ou na resposta de qualquer endpoint.
- AC-24 (rodada 3, defeito achado na validação humana em produção): na aplicação real, com a flag `convite-e-redefinicao-usuario` ligada, `POST /auth/forgot-password` responde 200 com `{ ok: true }` e `POST /auth/password/set` com link inválido responde 400; com a flag desligada as duas respondem 404. Causa: o `AuthModule` não importava o `FeatureFlagsModule`, o guard das rotas recebia a flag vazia (`@Optional`) e a rota dava 404 em produção, embora `/api/feature-flags` dissesse que a flag estava ligada.
- AC-25 (rodada 4, pedido do usuário na validação em produção): cada botão "Entrar com Google" e "Entrar com GitHub" da tela de login mostra o logo do provedor; o logo é decorativo para leitor de tela (`aria-hidden`) e o nome acessível do link continua "Entrar com <provedor>".

## Testing Decisions

- Um bom teste verifica o comportamento externo (resposta HTTP, token aceito ou recusado, tela vista), não o modo como o serviço é montado.
- Seams, na ordem de preferência: (1) controllers de autenticação por HTTP com Prisma de teste (estilo do `auth-rate-limit.integration.spec.ts`), com provedores OAuth simulados por um servidor falso em memória; (2) a regra de senha como função pura, com tabela de casos; (3) páginas do web com Testing Library (login, Minha Conta, definição de senha, formulário de usuário) e API simulada; (4) E2E por `scripts/e2e_isolated.sh`, sem provedor real.
- Prior art: `auth.controller.spec.ts`, `auth.service.spec.ts`, `auth-rate-limit.integration.spec.ts`, `LoginPage.test.tsx`, `MyAccountPage.test.tsx`, `feature-flags.spec.ts`.
- TOTP conferido contra os vetores de teste do RFC 6238. Testes de injeção com payloads fixos.
- Provedores reais (Google, GitHub) e SMTP real não entram em teste automatizado; a validação nos provedores é um passo de Alfredo com os aplicativos criados, em staging.
- RED/GREEN reais por ticket com o coletor do projeto; evidência por ticket no manifest.

## Out of Scope

- Redefinição de senha por e-mail, convite e página de definição de senha: entregues pela DMTE-550, sem alteração de fluxo, prazo, limite ou flag.
- SMS ou e-mail como segundo fator; segundo fator obrigatório por administrador.
- Cadastro automático por login social; desvincular provedor; troca de provedor.
- Regra de senha configurável por administrador; forçar a troca das senhas atuais.
- Resposta de e-mail por webhook (mencionada no comentário do SMTP, sem relação com esta demanda).
- Mudança nos tokens de API e do servidor MCP.
- Criação dos aplicativos nos provedores, dos segredos e a configuração de SMTP e DNS de produção: são de Alfredo. Merge e deploy seguem o contrato do projeto.

## Further Notes

**Situação atual (código observado na base `35b982f`)**
- A API tem `POST /auth/login` (validado por DTO, 5 por minuto), `POST /auth/register`, `POST /auth/change-password`, `POST /auth/forgot-password`, `POST /auth/password/set` e `GET /auth/me`; `login` assina JWT de 1 dia só com `sub`, e-mail, papel e organização.
- `JwtStrategy.validate` consulta o usuário a cada requisição e recusa inativo; é o ponto onde a versão de senha é conferida sem custo novo.
- A regra de senha de hoje é `MinLength(8)` nos DTOs de cadastro e de troca de senha.
- O `MailService` (nodemailer) só envia com `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS`, informa se o envio foi aceito e só define conexão segura na porta 465.
- O web guarda a sessão no navegador (store persistido) e a rota de login é pública. Não há tabela de auditoria de usuário; `TicketAudit` e `CredentialAuditLog` são de outros domínios.
- Não há OAuth nem segundo fator.

**Riscos**
- Segurança de autenticação: erro de lógica aqui expõe contas. O QA examina RBAC, resposta uniforme, expiração, uso único, `state`/`nonce`, tentativas e a ausência de segredo em log.
- Facebook fora desta entrega: o Graph não informa se o e-mail foi confirmado (decisão de Alfredo, emenda da rodada 2). A rota do Facebook responde 404 mesmo com variáveis configuradas.
- Perda de acesso: quem perde o aplicativo e os códigos depende de quem tem a permissão de desativar. Se o único ADMIN perder o segundo fator, a recuperação exige intervenção no banco, fora do aplicativo.
- A chave de cifra do segredo do segundo fator, se trocada, invalida todos os segredos guardados; a rotação de chave fica fora desta entrega e precisa de decisão própria.
- O JWT de 1 dia sem revogação por token continua; a versão de senha cobre só troca e definição de senha.
- A versão de senha muda o formato do JWT: tokens emitidos antes da migração não têm a versão e precisam ser tratados como versão 0, para não deslogar todos no deploy.
- Migração aditiva: o aplicativo anterior ignora as colunas e tabelas novas, o que mantém o rollback seguro.
- O primeiro login depois de ligar uma flag em produção só é validável com os aplicativos reais dos provedores.
- A aba Segurança do formulário de usuário e o login são código da DMTE-550; os tickets desta entrega partem da `main` com ela integrada.

**Avaliação de design (a registrar na etapa de implementação das telas)**
- Telas de login, definição de senha, Minha Conta e formulário de usuário reusam o DS e os tokens (`apps/web/src/components/ds`); novos componentes reutilizáveis, se surgirem, precisam de story ou exceção documentada. As skills de design (`impeccable` e `web-design-guidelines`) são lidas antes do primeiro código de tela. Aceite visual é de Alfredo.

**Matriz de validação**
- AC-01 a AC-07: testes de API, da regra pura e das páginas.
- AC-08 a AC-16: testes de API (incluindo vetores RFC 6238), das páginas e E2E isolado.
- AC-17 a AC-23: testes de API com provedor simulado e das páginas; AC-23 também por busca de segredo no diff.
- AC-24: teste de API sobre o `AppModule` real (sem montar providers à mão), que é o seam que pega módulo sem a flag injetada.
- AC-25: teste da página de login (`LoginPage.icons.test.tsx`) com a API simulada; a aparência do logo é aceite visual de Alfredo.
- Validação real em staging com SMTP e provedores configurados: passo de Alfredo, fora dos testes automatizados.
