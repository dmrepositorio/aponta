# CNPJ obrigatório e sem repetição no cadastro de clientes

Identidade: DMTE-559, Tier 2, pai Multica `01a1eaa0-38a3-7b1f-84c9-895f4b4e420a`. Origem: relato do usuário com um print da lista de Clientes (três linhas "Refrigeração Mota", duas sem Razão Social e sem CNPJ válido) e a informação de que o sistema aceita o mesmo CNPJ mais de uma vez.

## Situação atual (código observado na base `35b982f`)

- `Organization.cnpj` é `String? @unique` (`apps/api/prisma/schema.prisma`). A unicidade compara o texto exato.
- `CreateOrganizationDto` e `UpdateOrganizationDto` aceitam qualquer string em `cnpj`; vazio vira `undefined` (criação) ou `null` (edição) (`dto/blank-document.transform.ts`, DMTE-554). Vários clientes sem CNPJ convivem de propósito desde o DMTE-554.
- Nada normaliza o CNPJ: `07.671.166/0001-89` e `07671166000189` são textos diferentes e passam os dois. A edição direta na grade (`OrganizationsPage.tsx`, coluna `document`) grava só dígitos, o cadastro manual grava o que foi digitado, e a grade mostra os dois do mesmo jeito (`formatCnpj`).
- A grade também aceita qualquer quantidade de dígitos (no print, uma linha tem 15) e deixa limpar o CNPJ.
- `organizations.service.ts` só converte o P2002 em 409 (`rethrowDuplicateDocument`, DMTE-554), o que cobre apenas o texto idêntico. O formulário mostra o 409 num alerta, não num pop-up.

## Causa (hipótese confirmada pelo código, sem banco real)

Três brechas somadas: CNPJ opcional (nulo nunca colide), formato livre (a mesma empresa grava com texto diferente) e nenhuma checagem de tamanho. A restrição única do banco só barra o texto idêntico.

## Decisões

Origem: pedido do usuário (a) CNPJ obrigatório, (b) pop-up e bloqueio quando o CNPJ já existe. Os itens 3 a 7 são minhas escolhas para fechar lacunas, a confirmar pelo usuário na revisão.

1. **CNPJ obrigatório** no cadastro de cliente com `documentType` CNPJ (padrão do schema). Cliente PF (`documentType = CPF`) continua sem CNPJ obrigatório; exigir CPF fica fora (item 7).
2. **Pop-up** (`EzModal` do DS) quando a API responde 409 por CNPJ repetido, no cadastro e na edição. O formulário e o que foi digitado ficam como estão.
3. **Formato canônico: 14 dígitos.** A API tira a pontuação antes de validar e gravar; fora de 14 dígitos responde 400 "CNPJ é obrigatório e deve ter 14 dígitos." Dígito verificador não é validado (a consulta na Receita já cobre; ver DMTE-556).
4. **Detecção de duplicidade na API**, antes de gravar: procura outro cliente com o CNPJ em dígitos ou no formato `00.000.000/0000-00`, para pegar também os cadastros antigos gravados com pontuação. O índice único do banco continua como proteção final (409 já existente).
5. **Edição:** não é possível limpar o CNPJ (vazio dá 400). Editar um cliente antigo sem CNPJ, sem mexer no CNPJ, continua permitido; só quem informar um CNPJ passa pela validação.
6. **Dados existentes não são alterados.** Clientes já sem CNPJ ou com CNPJ inválido (como as linhas do print) ficam como estão até alguém corrigi-los na tela; não há migração de dados nesta entrega.
7. **Fora do escopo:** tornar Razão Social obrigatória (o relato diz que o responsável não sabe se deve; fica como está), exigir CPF para PF, validar dígito verificador, migração/limpeza dos cadastros atuais, mesclar duplicados já existentes.

## Acceptance criteria

- AC-01: `CreateOrganizationDto` sem `cnpj` (ou `cnpj` em branco), com `documentType` CNPJ ou ausente, é recusado com a mensagem "CNPJ é obrigatório e deve ter 14 dígitos.".
- AC-02: `CreateOrganizationDto` e `UpdateOrganizationDto` com `cnpj` pontuado (`19.131.243/0001-97`) entregam só os 14 dígitos; com menos ou mais de 14 dígitos são recusados com a mesma mensagem.
- AC-03: `UpdateOrganizationDto` com `cnpj` em branco é recusado (não limpa o CNPJ); sem a chave `cnpj` é aceito.
- AC-04: criar cliente PF (`documentType` CPF) sem `cnpj` é aceito.
- AC-05: `OrganizationsService.create` com CNPJ já usado por outro cliente, gravado em dígitos ou pontuado, lança `ConflictException` "Já existe um cliente com este CNPJ." e não chama `organization.create`.
- AC-06: `OrganizationsService.update` com CNPJ de outro cliente lança o mesmo `ConflictException`; o cliente que já tem esse CNPJ pode salvá-lo de novo sem conflito.
- AC-07: no cadastro manual, com tipo CNPJ e o campo vazio, a página mostra "CNPJ é obrigatório" no campo e não envia `POST /organizations`.
- AC-08: quando `POST /organizations` responde 409, a página abre um pop-up (`role="dialog"`) com o título "CNPJ já cadastrado" e a mensagem da API; fechá-lo mantém o formulário preenchido.
- AC-09: quando o `PATCH /organizations/:id` da edição direta do CNPJ na grade responde 409, a página abre o mesmo pop-up.

## Testes (seams: DTO pelo `ValidationPipe`, como em `organization-document.dto.spec.ts`; serviço com Prisma simulado, como em `organizations.service.spec.ts`; página pela Testing Library, como em `OrganizationsPage.update-error.test.tsx`)

- AC-01 a AC-04: `apps/api/src/organizations/dto/organization-document.dto.spec.ts`.
- AC-05 e AC-06: `apps/api/src/organizations/organizations.service.spec.ts`.
- AC-07 a AC-09: `apps/web/src/pages/OrganizationsPage.update-error.test.tsx`.
- Dados sintéticos; o CNPJ de referência é o já usado nos specs atuais.
- Sem banco real no ambiente do planejamento: a unicidade no Postgres não é exercitada, e a checagem da API é o que se testa. Teste em banco isolado (`scripts/e2e_isolated.sh`) fica a critério do QA.

## Avaliação de design

Reuso: `EzModal` e `EzButton` do DS e o `message` de `EzTextInput`; sem componente, prop ou token novo, sem story nova. O pop-up é um diálogo de aviso com um botão "Entendi", título e texto curtos, foco no botão ao abrir.

## Riscos

- Cadastros antigos com formatação fora do padrão `00.000.000/0000-00` e fora de 14 dígitos não são detectados como repetidos; só a limpeza dos dados resolve (fora do escopo, item 6).
- Quem hoje cadastra cliente sem CNPJ passa a ser barrado; é o pedido, mas muda um fluxo que o DMTE-554 deixou aberto de propósito.
- Sem impacto em RBAC nem tenant: as rotas mantêm a permissão atual; a mensagem de conflito não revela o nome do outro cliente.
