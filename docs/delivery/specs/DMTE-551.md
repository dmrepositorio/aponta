# Login: redefinição de senha por e-mail, login social (Google, GitHub, Facebook) e autenticação em dois fatores

Identidade: DMTE-551, issue dmrepositorio/aponta#310, pai Multica `01a1e7d3-5980-779f-8b61-200fa5eac492`, Tier 3, ciclo 2026-11-09/2026-11-22. Pedido de Alfredo em 17/11/2026. Decisões confirmadas por Alfredo no pai (Q1 a Q9 e confirmação do entendimento, "Certo, pode prosseguir"). Base de planejamento: `main` em `bba2762`.

## Problem Statement

Quem usa o Aponta (administrador, atendente ou cliente) só entra com e-mail e senha. Quem esquece a senha não tem como recuperá-la sozinho. Não há login com contas que a pessoa já usa (Google, GitHub, Facebook) e não há segundo fator: uma senha vazada basta para entrar. A regra de senha é só "8 caracteres" e permite senhas óbvias, como o nome da pessoa com um número.

## Solution

Na tela de login, a pessoa pode pedir a redefinição da senha por e-mail, receber um link de uso único e definir uma senha nova que cumpre uma regra de complexidade mais forte, que também passa a valer no cadastro e na troca de senha. Pode entrar com Google, GitHub ou Facebook, desde que já tenha conta no Aponta. Em Minha Conta, pode ativar a autenticação em dois fatores com um aplicativo autenticador; quem ativa passa a informar um código a cada entrada, seja por senha ou por login social. Um administrador consegue desativar o segundo fator de quem perdeu o aplicativo e os códigos de recuperação.

## User Stories

1. Como usuário que esqueceu a senha, quero pedir a redefinição pela tela de login, para voltar a entrar sem depender de um administrador.
2. Como usuário, quero que o aviso depois do pedido seja o mesmo exista ou não a conta, para que ninguém descubra quem tem cadastro.
3. Como usuário, quero receber por e-mail um link que vale 30 minutos e só uma vez, para que um e-mail antigo não permita trocar minha senha.
4. Como usuário, quero ver a regra da senha e o que falta cumprir enquanto digito, para acertar de primeira.
5. Como usuário, quero que a senha não possa ser meu nome, meu e-mail ou o domínio dele, mesmo com números ou símbolos colados, para que minha senha não seja adivinhada.
6. Como usuário que redefiniu a senha, quero que as sessões abertas antes deixem de valer, para que quem estava com a senha antiga seja desconectado.
7. Como usuário, quero a mesma regra de senha no cadastro, na troca de senha e na redefinição, para não haver caminho mais fraco.
8. Como administrador, quero que contas inativas não recebam link de redefinição, para que um usuário desativado não volte por esse caminho.
9. Como administrador, quero que o pedido de redefinição seja limitado por e-mail e por origem, para que o recurso não vire envio de spam nem tentativa de força bruta.
10. Como usuário, quero entrar com minha conta Google, para não precisar lembrar outra senha.
11. Como usuário, quero entrar com minha conta GitHub, para não precisar lembrar outra senha.
12. Como usuário, quero entrar com minha conta Facebook, para não precisar lembrar outra senha.
13. Como administrador, quero que o login social só entre em conta que já existe no Aponta e está ativa, para que ele não seja uma segunda porta de cadastro.
14. Como administrador, quero que a conta social seja ligada pelo e-mail verificado do provedor, para que ninguém assuma a conta de outra pessoa com um e-mail não verificado.
15. Como usuário que tenta entrar pelo Facebook sem e-mail verificado, quero uma mensagem clara do que fazer, para não ficar sem saber por que falhou.
16. Como administrador, quero que o botão de cada provedor só apareça quando o provedor está configurado e a funcionalidade está ligada, para não oferecer um login que não funciona.
17. Como usuário, quero ativar o segundo fator em Minha Conta, escaneando um QR com meu aplicativo autenticador e confirmando com um código, para que a ativação só valha depois de eu provar que o aplicativo funciona.
18. Como usuário, quero receber 10 códigos de recuperação uma única vez na ativação, para ter uma saída se perder o aplicativo.
19. Como usuário com segundo fator, quero informar o código depois da senha, para que a senha sozinha não baste.
20. Como usuário com segundo fator, quero ser desafiado também depois de entrar com GitHub, Google ou Facebook, para que o login social não pule o segundo fator.
21. Como usuário sem segundo fator, quero continuar entrando direto, como hoje, porque o segundo fator é opcional.
22. Como usuário, quero usar um código de recuperação no lugar do código do aplicativo, e que ele só funcione uma vez, para sair de uma perda do aparelho.
23. Como usuário, quero desativar o segundo fator informando minha senha atual e um código, para que ninguém com minha sessão aberta consiga desativá-lo.
24. Como administrador, quero desativar o segundo fator de um usuário que perdeu o aplicativo e os códigos, e que isso fique registrado (quem, quem foi afetado, quando), para recuperar o acesso dele com rastreio.
25. Como administrador, quero ligar e desligar cada parte (redefinição, segundo fator, cada provedor) por feature flag, para liberar aos poucos em cada ambiente.
26. Como responsável pelo deploy, quero que as credenciais de SMTP, dos provedores e a chave de cifra fiquem só nas variáveis de ambiente e nunca no repositório, nos logs ou nos testes.
27. Como usuário de API ou do servidor MCP, quero que meus tokens de API continuem funcionando sem segundo fator, porque não passam pela tela de login.

## Implementation Decisions

Divisão em três blocos, entregues nesta ordem: A (redefinição de senha), B (segundo fator), C (login social). Uma SPEC, vários tickets.

**Regra de senha (A)**
- Uma única implementação da regra, usada por cadastro, troca de senha e redefinição. Mínimo de 10 caracteres, com maiúscula, minúscula, número e símbolo.
- Recusa a senha que contiver, sem diferenciar maiúsculas, acentos ou números e símbolos colados: qualquer parte do nome do usuário com 3 letras ou mais, a parte do e-mail antes do `@` ou o domínio do e-mail.
- Senhas atuais continuam válidas até a próxima troca. Ninguém é forçado a trocar.
- Segurança contra injeção: nenhum SQL cru nos fluxos novos, acesso a dados só pelo ORM parametrizado, toda entrada validada por DTO com tamanho máximo. Símbolos e aspas na senha não são proibidos.

**Redefinição (A)**
- Pedido público com resposta sempre igual. Conta inativa ou inexistente não recebe e-mail. Limite de 3 pedidos por e-mail por hora e limite por origem como o login já tem.
- Token aleatório de alta entropia, guardado só como hash, uso único, validade de 30 minutos; pedido novo invalida o anterior.
- Ao redefinir, o usuário ganha uma versão de senha nova. O JWT passa a levar a versão de senha e a estratégia JWT, que já consulta o usuário a cada requisição, recusa token com versão diferente. Troca de senha em Minha Conta também incrementa a versão, e a sessão que fez a troca recebe um token novo.
- Link montado a partir de uma variável de ambiente com a URL pública do web (`APP_PUBLIC_URL`).
- O envio de e-mail exige TLS quando a porta não é a 465. Sem SMTP configurado, o pedido responde igual e nada é enviado.

**Segundo fator (B)**
- TOTP (RFC 6238), compatível com aplicativos autenticadores comuns. Ativação em Minha Conta: o servidor gera um segredo pendente, o usuário confirma com um código válido, só então o segundo fator fica ativo e os 10 códigos de recuperação são mostrados uma única vez.
- Segredo guardado cifrado com chave vinda de variável de ambiente (`TWO_FACTOR_ENCRYPTION_KEY`); códigos de recuperação guardados só como hash e de uso único. Chave ausente com o recurso ligado impede a ativação, não o login.
- Login em dois passos: senha (ou login social) correta de quem tem segundo fator devolve um token curto, que serve apenas para o desafio; o JWT completo só sai com um código do aplicativo ou de recuperação válido. Tentativas de código limitadas a 5 por minuto, como o login.
- O desafio vale para quem já ativou mesmo que a feature flag seja desligada depois; a flag controla apenas a ativação.
- Desativar exige senha atual e um código. ADMIN pode desativar o de outro usuário; o evento é gravado numa tabela de eventos de segurança (quem, afetado, quando, tipo). Não há outro caminho de recuperação.
- Tokens de API e MCP não mudam e não passam pelo desafio.

**Login social (C)**
- Fluxo OAuth 2.0 com código de autorização: o web leva a pessoa ao provedor, o servidor recebe o retorno, troca o código, lê o e-mail e se ele é verificado. Estado de uso único e de curta duração contra CSRF, PKCE onde o provedor aceita, `nonce` quando o provedor é OIDC (Google).
- O servidor não devolve JWT na URL: entrega ao web um código de troca de uso único e vida curta, que o web troca por JWT (ou pelo token de desafio, se houver segundo fator).
- Só entra em conta existente e ativa. Liga a identidade do provedor ao usuário pelo e-mail verificado na primeira vez; depois, a ligação é pelo identificador do provedor. Papel e organização do usuário não mudam. Sem e-mail verificado, falha com mensagem clara. Desvincular provedor fica de fora.
- Cada provedor tem feature flag própria e variáveis de ambiente próprias (identificador e segredo do aplicativo). Sem as variáveis, o botão fica oculto e a rota recusa.
- Implementação sem biblioteca de OAuth de terceiros se for possível com a plataforma e a biblioteca padrão; qualquer dependência nova passa antes pela skill `development-dependencies`.

**Dados e contratos**
- Novas estruturas: token de redefinição (hash, validade, uso), estado do segundo fator do usuário (segredo cifrado, ativo, códigos de recuperação com hash), identidade externa (provedor, identificador no provedor, usuário), evento de segurança e versão de senha no usuário. Migração só aditiva e reversível pelo aplicativo anterior.
- Endpoints públicos novos limitados e com resposta uniforme; endpoints de segundo fator autenticados; desativação por administrador só para `ADMIN`.
- Feature flags registradas no registro existente com dono `alfredo`, padrão desligado e data de remoção 2027-01-31: `redefinicao-senha-email`, `autenticacao-dois-fatores`, `login-social-google`, `login-social-github`, `login-social-facebook`. Datas e padrão podem ser ajustados por Alfredo na aprovação dos tickets.
- Web: "Esqueci a senha" e página de redefinição, botões de provedor e desafio de código no login, seção Segurança em Minha Conta e botão de administrador na tela de usuários. Reusar componentes e tokens do DS; sem Carbon nem Next.js.

**Configuração de ambiente (sem valores no repositório)**
- `APP_PUBLIC_URL`, `TWO_FACTOR_ENCRYPTION_KEY`, identificador e segredo por provedor, e as variáveis `SMTP_*` já existentes. Os valores reais ficam nos segredos de cada ambiente, sob gestão de Alfredo. A senha SMTP que apareceu em comentário do pai deve ser trocada por Alfredo depois da configuração; este plano não a copia.

## Acceptance criteria

Bloco A: senha e redefinição
- AC-01: a regra de senha recusa senha com menos de 10 caracteres ou sem maiúscula, minúscula, número ou símbolo, e aceita uma que cumpre tudo.
- AC-02: a regra recusa senha que contém parte do nome (3 letras ou mais), a parte local do e-mail ou o domínio, sem diferenciar maiúsculas, acentos ou números e símbolos colados (`joao2026`, `Joao!123`, `JOÃO_1`).
- AC-03: cadastro, troca de senha e redefinição aplicam a mesma regra e recusam com 400 e mensagem que diz o que falta; senhas existentes continuam entrando.
- AC-04: o pedido de redefinição responde igual (mesmo status e corpo) para e-mail existente, inexistente e de conta inativa; só a conta existente e ativa recebe e-mail.
- AC-05: o link guarda só o hash do token, vale 30 minutos, vale uma vez, e um pedido novo invalida o anterior; token expirado, usado, inventado ou de pedido substituído é recusado com a mesma resposta.
- AC-06: depois da redefinição, um JWT emitido antes é recusado e o login com a senha nova funciona; a troca de senha em Minha Conta também invalida os outros tokens e mantém a sessão que trocou.
- AC-07: o pedido é limitado a 3 por e-mail por hora e pelo limite por origem; o excesso responde 429 sem enviar e-mail.
- AC-08: o link do e-mail usa `APP_PUBLIC_URL`; sem SMTP configurado o pedido responde igual e nenhum e-mail sai; com porta diferente de 465 o transporte exige TLS.
- AC-09: payloads de injeção (aspas, `;`, `--`, `' OR '1'='1`) em e-mail, token e senha não alteram o resultado nem causam erro 500 nos endpoints novos, e nenhum deles usa SQL cru.
- AC-10: a flag `redefinicao-senha-email` desligada esconde "Esqueci a senha" e faz os endpoints recusarem sem enviar e-mail.
- AC-11: no web, a tela de login tem "Esqueci a senha", a página de pedido e a de redefinição mostram a regra e os erros, e o fluxo completo funciona com a API simulada.

Bloco B: segundo fator
- AC-12: a ativação gera segredo pendente, só ativa com um código TOTP válido (conferido contra os vetores do RFC 6238) e mostra 10 códigos de recuperação uma única vez; segredo e códigos não aparecem em resposta posterior nem em log.
- AC-13: o segredo fica cifrado e os códigos de recuperação ficam como hash; sem `TWO_FACTOR_ENCRYPTION_KEY` a ativação é recusada e o login de quem não tem segundo fator segue normal.
- AC-14: quem tem segundo fator, ao entrar com a senha correta, recebe só um token de desafio (que não acessa nenhuma outra rota) e o JWT completo só sai com código válido do aplicativo ou de recuperação; quem não tem entra direto.
- AC-15: um código de recuperação funciona uma vez; código TOTP repetido na mesma janela é recusado; mais de 5 tentativas por minuto recebem 429.
- AC-16: desativar o segundo fator exige senha atual e código válido; sem os dois, recusa.
- AC-17: `ADMIN` desativa o segundo fator de outro usuário e o evento (quem, afetado, quando, tipo) é gravado; qualquer outro papel recebe 403.
- AC-18: o desafio continua valendo para quem já ativou mesmo com a flag `autenticacao-dois-fatores` desligada; a flag só esconde e recusa a ativação.
- AC-19: tokens de API e do servidor MCP continuam autenticando sem segundo fator.
- AC-20: no web, Minha Conta tem a seção Segurança (ativar, mostrar QR e códigos, desativar), o login mostra o campo de código com opção de código de recuperação, e a tela de usuários tem a ação de administrador.

Bloco C: login social
- AC-21: com provedor simulado, o retorno com e-mail verificado de conta existente e ativa liga a identidade, devolve o código de troca de uso único e o web o troca por JWT; o JWT nunca aparece na URL.
- AC-22: o login social nunca cria usuário; conta inexistente, inativa ou e-mail sem verificação (inclusive Facebook sem e-mail verificado) falha com mensagem clara e sem ligar identidade.
- AC-23: estado inválido, reutilizado ou expirado, `nonce` divergente (Google) e código de troca reutilizado são recusados.
- AC-24: depois de ligada, a entrada é pelo identificador do provedor, não mais pelo e-mail; papel e organização do usuário não mudam.
- AC-25: quem tem segundo fator é desafiado depois do login social do mesmo modo que depois da senha.
- AC-26: cada provedor tem sua flag e variáveis; sem elas o botão não aparece e a rota recusa; as três flags são independentes.
- AC-27: nenhum segredo de provedor, de SMTP ou chave de cifra aparece no repositório, em fixtures, em log ou na resposta de qualquer endpoint.

## Testing Decisions

- Um bom teste verifica o comportamento externo (resposta HTTP, e-mail enviado, token aceito ou recusado, tela vista), não o modo como o serviço é montado.
- Seams, na ordem de preferência: (1) controllers de autenticação por HTTP com Prisma de teste (estilo do `auth-rate-limit.integration.spec.ts`), com `MailService` e provedores OAuth simulados por um servidor falso em memória; (2) a regra de senha como função pura, com tabela de casos; (3) páginas do web com Testing Library (login, redefinição, Minha Conta) e API simulada; (4) E2E por `scripts/e2e_isolated.sh`, sem provedor real.
- Prior art: `auth.controller.spec.ts`, `auth.service.spec.ts`, `auth-rate-limit.integration.spec.ts`, `LoginPage.test.tsx`, `MyAccountPage.test.tsx`, `feature-flags.spec.ts`.
- TOTP conferido contra os vetores de teste do RFC 6238. Testes de injeção com payloads fixos nos campos de e-mail, token, código e senha.
- Provedores reais (Google, GitHub, Facebook) e SMTP real não entram em teste automatizado; a validação nos provedores é um passo de Alfredo com os aplicativos criados, em staging.
- RED/GREEN reais por ticket com o coletor do projeto; evidência por ticket no manifest.

## Out of Scope

- SMS ou e-mail como segundo fator; segundo fator obrigatório por administrador.
- Cadastro automático por login social; desvincular provedor; troca de provedor.
- Regra de senha configurável por administrador; forçar a troca das senhas atuais.
- Resposta de e-mail por webhook (mencionada no comentário do SMTP, sem relação com esta demanda).
- Mudança nos tokens de API e do servidor MCP.
- Criação dos aplicativos nos provedores, dos segredos e a configuração de SMTP e DNS de produção: são de Alfredo. Merge e deploy seguem o contrato do projeto.

## Further Notes

**Situação atual (código observado na base `bba2762`)**
- A API tem `POST /auth/login` (5 por minuto), `POST /auth/register`, `POST /auth/change-password` e `GET /auth/me`; `login` assina JWT de 1 dia só com `sub`, e-mail, papel e organização.
- `JwtStrategy.validate` consulta o usuário a cada requisição; é o ponto onde a versão de senha é conferida sem custo novo.
- O `MailService` (nodemailer) só envia com `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS`, e hoje só define conexão segura na porta 465.
- O web guarda a sessão no navegador (store persistido) e a rota de login é pública. Não há tabela de auditoria de usuário; `TicketAudit` e `CredentialAuditLog` são de outros domínios.
- Não há OAuth, segundo fator nem redefinição por e-mail.

**Riscos**
- Segurança de autenticação: erro de lógica aqui expõe contas. O QA examina RBAC, resposta uniforme, expiração, uso único, `state`/`nonce`, tentativas e a ausência de segredo em log.
- Facebook nem sempre devolve e-mail verificado; parte dos usuários não consegue usar esse login, por decisão (mensagem clara, sem cadastro).
- Perda de acesso: quem perde o aplicativo e os códigos depende de um ADMIN. Se o único ADMIN perder o segundo fator, a recuperação exige intervenção no banco, fora do aplicativo.
- A chave de cifra do segredo do segundo fator, se trocada, invalida todos os segredos guardados; a rotação de chave fica fora desta entrega e precisa de decisão própria.
- O JWT de 1 dia sem revogação por token continua; a versão de senha cobre só troca e redefinição de senha.
- Migração aditiva: o aplicativo anterior ignora as colunas e tabelas novas, o que mantém o rollback seguro.
- O primeiro login depois de ligar uma flag em produção só é validável com os aplicativos reais dos provedores.

**Avaliação de design (a registrar na etapa de implementação das telas)**
- Telas de login, redefinição e Minha Conta reusam o DS e os tokens (`apps/web/src/components/ds`); novos componentes reutilizáveis, se surgirem, precisam de story ou exceção documentada. As skills de design (`impeccable` e `web-design-guidelines`) são lidas antes do primeiro código de tela. Aceite visual é de Alfredo.

**Matriz de validação**
- AC-01 a AC-11: testes de API, da regra pura e das páginas.
- AC-12 a AC-20: testes de API (incluindo vetores RFC 6238), das páginas e E2E isolado.
- AC-21 a AC-27: testes de API com provedor simulado e das páginas; AC-27 também por busca de segredo no diff.
- Validação real em staging com SMTP e provedores configurados: passo de Alfredo, fora dos testes automatizados.
