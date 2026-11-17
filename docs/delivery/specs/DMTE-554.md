# Clientes: salvar falha sem mensagem de erro

Identidade: DMTE-554, issue dmrepositorio/aponta#309, Tier 1, pai Multica `01a1e971-54cb-7da8-86f4-39d96df92cad`. Origem: relato do usuário Miller em produção ("não deixa salvar e não mostra erro").

## Situação atual (código observado na base `bba2762`)

- `OrganizationsPage.tsx`: `createMutation` não tem `onError`; recusa da API não aparece.
- O formulário envia `cnpj: ''` e `cpf: ''` quando vazios; `Organization.cnpj` e `Organization.cpf` são `@unique`, então o segundo cliente sem documento (ou um CNPJ repetido) viola a unicidade.
- `organizations.service.ts`: `create` e `update` deixam o `P2002` do Prisma virar 500 genérico.
- Log de produção: sem acesso nesta execução (regra do projeto: sem SSH nem Docker de produção). A causa acima é inferida do código e reproduzida em teste, não vista no log.

## Decisões

1. **API.** `cnpj` e `cpf` em branco nos DTOs viram `undefined` na criação e `null` na atualização (`@Transform`). O serviço traduz `P2002` em `ConflictException` com mensagem legível ("Já existe um cliente com este CNPJ." / "CPF."), em `create` e `update`.
2. **Web.** `updateOrgMutation` (edição de cliente já cadastrado) tinha a mesma falha silenciosa: passa a usar o `inlineError` da página. `createMutation` ganha `onError` que mostra a mensagem da API (ou "Não foi possível cadastrar o cliente.") num `EzAlert variant="error"` (`role="alert"`) dentro do formulário, que mantém o que foi digitado. O payload deixa de enviar `cnpj`/`cpf` vazios.
3. **Fora do escopo:** dado de produção já gravado com `cnpj = ''` (precisa de migração/limpeza decidida pelo responsável); consulta aos logs de produção; novos campos.

## Acceptance criteria

- AC-01: com a API recusando o cadastro com mensagem, o formulário mostra essa mensagem num alerta (`role="alert"`) e mantém o nome digitado.
- AC-02: com a API falhando sem mensagem (erro de rede) ou com 5xx (texto técnico "Internal server error"), o formulário mostra "Não foi possível cadastrar o cliente."; com 400 do `ValidationPipe` (`message` em lista), mostra todas as mensagens juntas.
- AC-03: o cadastro sem CNPJ/CPF não envia `cnpj` nem `cpf` em branco à API.
- AC-04: nos DTOs de cliente, `cnpj` e `cpf` em branco viram `undefined` na criação e `null` na atualização; valor preenchido é mantido.
- AC-05: `create` e `update` de cliente respondem 409 com mensagem legível quando `cnpj` ou `cpf` já existe; outros erros de banco seguem como estão. O `P2002` é lido nos dois formatos do Prisma 7: `meta.target` e `meta.driverAdapterError.cause.constraint` (`index`/`fields`), que é o que o `@prisma/adapter-pg` do projeto entrega.
- AC-06: com a API recusando a edição de um cliente já cadastrado, a tela mostra a mensagem da API num alerta (`role="alert"`).

## Testes (seams: a página pela Testing Library; os DTOs pelo `ValidationPipe` real; o serviço com Prisma simulado)

- AC-01, AC-02, AC-03: `apps/web/src/pages/OrganizationsPage.test.tsx`, bloco "cadastro manual: falha ao salvar (DMTE-554)"; 5xx, lista de validação e CNPJ preenchido (achados do code-review) em `OrganizationsPage.update-error.test.tsx`.
- AC-04: `apps/api/src/organizations/dto/organization-document.dto.spec.ts`.
- AC-05: `apps/api/src/organizations/organizations.service.spec.ts` e, para o formato do adapter-pg, `organizations.duplicate-document.spec.ts`.
- AC-06: `apps/web/src/pages/OrganizationsPage.update-error.test.tsx`.
- Banco real: não há seam de integração com Postgres no projeto para este fluxo; a unicidade é coberta pelo teste do serviço com `PrismaClientKnownRequestError` P2002.

## Avaliação de design

Reuso de `EzAlert` (variante `error`, já usado nesta página); nenhum componente, prop ou token novo, sem story nova.

## Riscos

- Cliente antigo com `cnpj = ''` no banco continua ocupando a unicidade do `''`; a correção impede novos e o erro agora aparece, mas a limpeza do legado é decisão do responsável.
- Sem impacto em RBAC nem tenant: as rotas mantêm `MANAGE_CLIENTS_AND_RESOURCE_GROUPS`.
