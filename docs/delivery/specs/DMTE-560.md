Entrega DMTE-560, issue dmrepositorio/aponta#336, Tier 3, pai Multica `01a1eaa2-4d5a-7509-9e9f-3e5c3852f2a7`. Base `35b982f`. Origem: pedido do responsável ("habilite a deleção de clientes, com uma lixeira do DS; deixe deletar se o cliente não tem ticket lançado nem vínculo com mesa; analise se esqueci de algum vínculo forte; o pop-up explica exatamente o problema e se dá para resolver"). Decisões confirmadas pelo responsável no card Multica, rodadas 1 a 4 (Q1 a Q17).

## Problem Statement

Na tela Clientes, a lixeira não apaga o cliente: desde a DMTE-481 ela só inativa, pede confirmação com `window.confirm` e mostra a recusa num alerta solto. Quem cadastra um cliente por engano, ou quer limpar um cliente de teste, não consegue removê-lo. Quando a ação é recusada, o usuário não sabe qual vínculo impede nem se tem como resolver. Além disso, a checagem atual olha só contrato ativo e ticket aberto: não olha mesa, usuários, cofre, agenda nem o histórico, e a exclusão física esbarraria em chaves estrangeiras do banco.

## Solution

A lixeira passa a **excluir** o cliente de verdade, e só quando ele não tem vínculo forte. Antes de confirmar, um pop-up do DS consulta o servidor e mostra tudo o que impede a exclusão, com a quantidade e uma linha dizendo se o usuário consegue resolver ("como resolver") ou se a saída é inativar o cliente. Sem bloqueio, o pop-up avisa o que sai junto e pede a confirmação. Para o ticket deixar de ser um beco sem saída, nasce a exclusão de ticket, com permissão própria (`DELETE_TICKETS`), que só vale quando o ticket não tem apontamento nem sub-tickets e não foi aberto por um usuário do cliente. Inativar continua pelo campo Ativo/Inativo do cadastro.

## User Stories

1. Como administrador de clientes, quero excluir um cliente cadastrado por engano, para que a lista só tenha clientes reais.
2. Como administrador de clientes, quero que a lixeira abra um pop-up do DS em vez do `window.confirm`, para que a ação tenha o mesmo padrão visual das demais exclusões (Contratos, DMTE-540).
3. Como administrador de clientes, quero ver no pop-up todos os vínculos que impedem a exclusão de uma vez, para não descobrir um por tentativa.
4. Como administrador de clientes, quero que cada bloqueio traga a quantidade e alguns exemplos, para achar os registros que preciso resolver.
5. Como administrador de clientes, quero saber se um bloqueio dá para resolver (e onde), ou se a única saída é inativar o cliente, para decidir sem pedir ajuda.
6. Como administrador de clientes, quero que o cliente com mesa vinculada seja bloqueado e o pop-up diga para desvincular em Clientes > Relacionamentos, para resolver sozinho.
7. Como administrador de clientes, quero que contrato (ativo ou inativo), usuário do cliente, credencial ou pasta do cofre e compromisso de agenda bloqueiem a exclusão, para não perder histórico por acidente.
8. Como administrador de clientes, quero ser avisado do que sai junto (endereços, contatos, grupos, vínculos com grupos técnicos, compartilhamentos de artigo, histórico de mesa), para confirmar sabendo o efeito.
9. Como administrador de clientes, quero selecionar vários clientes e ver cada um como "pode excluir" ou "bloqueado: motivo", para excluir em lote só os livres.
10. Como administrador de clientes, quero cancelar o pop-up (botão ou Esc) sem nada ser excluído, para desistir com segurança.
11. Como administrador de clientes, quero que o botão Confirmar fique desabilitado durante a exclusão, para não enviar duas vezes.
12. Como atendente com a permissão `DELETE_TICKETS`, quero excluir um ticket sem apontamento aberto por um atendente em nome do cliente, para limpar tickets criados por engano e liberar a exclusão do cliente.
13. Como gestor, quero que a exclusão de ticket exija a permissão no grupo (mesmo para ADMIN), para que poucas pessoas possam apagar tickets.
14. Como gestor, quero que ticket aberto pelo próprio cliente nunca seja excluído, para preservar o que o cliente registrou.
15. Como atendente, quero que a exclusão de ticket recuse quando houver apontamento, para não perder horas lançadas ou faturamento.
16. Como administrador de clientes, quero que a API recuse a exclusão (409 com a mesma lista) mesmo se chamada fora da tela, para que a regra não dependa do navegador.

## Implementation Decisions

**Vocabulário.** "Cliente" é o termo da tela e do domínio ("parceiro", do pedido, é o mesmo conceito). A exclusão física substitui a regra da DMTE-481 ("excluir só inativa"); a DMTE-481 deixa de valer para a lixeira. Inativar continua disponível no cadastro e é a saída oferecida quando o bloqueio não tem solução.

**Vínculos que impedem a exclusão de cliente** (cada um com um código estável, quantidade, até 5 itens de exemplo e indicação de "dá para resolver"):

| Código | O que bloqueia | Dá para resolver? | Como |
|---|---|---|---|
| TICKETS | qualquer ticket do cliente, em qualquer status (cliente comercial ou solicitante pertencente ao cliente) | depende do ticket: resolve se todos puderem ser excluídos pelo usuário; não resolve se algum for aberto pelo cliente ou se o usuário não tem `DELETE_TICKETS` | excluir os tickets em Tickets e tentar de novo |
| SERVICE_DESKS | vínculo atual com mesa | sim | desvincular: abrir o cliente e usar a aba Relacionamentos, ou abrir a mesa em Mesas e usar a aba Clientes (AC-28) |
| CONTRACTS | contrato ativo ou inativo | sim | excluir o contrato em Contratos |
| USERS | usuário vinculado ao cliente | sim (AC-26, rodada 3: o responsável confirmou em produção que desvincular resolve) | em Usuários, abrir o usuário e deixar o campo Cliente em branco (não há exclusão de usuário) |
| VAULT | credencial ou pasta do cofre | sim | excluir no cofre |
| APPOINTMENTS | compromisso de agenda ligado ao cliente | sim | excluir o compromisso na agenda |

Por ticket, o motivo de não poder ser excluído também é informado: aberto pelo cliente (não resolve), sem permissão `DELETE_TICKETS` (não resolve; pedir liberação no grupo), com apontamento ou pré-apontamento ativo (resolve removendo, mas só um ADMIN ou o autor remove: para os demais, "tem apontamento de outro usuário", sem saída), com apontamento anulado (não resolve: fica registrado para auditoria; o apontamento faturado removido só é anulado), com sub-tickets (resolve excluindo ou desvinculando os filhos). Ticket aberto pelo cliente, mesmo cancelado ou fechado, continua existindo e bloqueando; o item do ticket mostra o motivo "aberto pelo cliente" e o bloqueio mostra "Não é possível resolver: inative o cliente".

**O que sai junto com o cliente, sem bloquear:** endereços, contatos, grupos de atendentes do cliente, vínculos com grupos técnicos, compartilhamentos de artigo e o histórico de vínculo com mesa. O histórico de vínculo é apagado explicitamente na mesma transação (a chave estrangeira o impediria); os demais saem por cascata do banco. Os registros de auditoria do cofre, que não têm chave estrangeira, ficam como estão.

**Contrato da API de cliente.**
- `POST /organizations/deletion-check`, corpo `{ ids: string[] }` (de 1 a 50), permissão `MANAGE_CLIENTS_AND_RESOURCE_GROUPS`. Resposta: uma entrada por cliente com `id`, `name`, `canDelete`, `blockers` e `cascade` (contagem do que sairia junto). Cada bloqueio traz `code`, `message`, `count`, `items` (até 5, com `id` e rótulo), `resolvable` e `howToResolve` (texto ou nulo). Id inexistente responde 404.
- `DELETE /organizations/:id`, mesma permissão: apaga o cliente e o que sai junto numa única transação e responde 200 com `{ id }`. Com bloqueios responde 409 com `message` e a mesma lista `blockers`. A checagem é refeita dentro da transação, com trava na linha do cliente (padrão já usado ao vincular mesa); uma violação de chave estrangeira por gravação concorrente vira 409 genérico, nunca 500. A exclusão grava um registro de log com o id do cliente e do usuário, sem dados pessoais.
- O módulo de regras de bloqueio é um só e serve às duas rotas, para que a consulta e a exclusão nunca divirjam.

**Contrato da API de ticket.**
- `DELETE /tickets/:id`: apaga o ticket em qualquer status e responde 200 com `{ id }`. Regras: usuário com `DELETE_TICKETS` (sem bypass de ADMIN, como `VIEW_TICKET_VALUES`); ticket visível ao usuário pela mesma regra de acesso do `GET /tickets/:id` (senão 404); solicitante que não seja usuário de um cliente; sem apontamento nem pré-apontamento ativos e sem apontamento anulado (motivos `HAS_WORKLOGS` e `HAS_VOIDED_WORKLOGS`); sem sub-tickets. Recusa com 409 (`message` e `reasons`, até 5 exemplos e a contagem). Comentários, auditoria, checklist, anexos e compromissos de agenda do ticket saem na mesma transação. Registro de log com protocolo e usuário.
- `DELETE_TICKETS` ("Excluir tickets") entra no catálogo na categoria Administrativo, fora dos grupos padrão de qualquer papel (junto das demais chaves só de grupo); grupos existentes não a recebem. `GET /auth/me` passa a devolver `canDeleteTickets`, calculado sem bypass de ADMIN.

**Tela Clientes.** A lixeira (cliente da grade selecionado, vários ou o cliente aberto) chama `deletion-check` e abre um `EzDialog` `variant="danger"`. Cliente livre: título "Excluir cliente" (ou "Excluir N clientes"), "Esta ação não pode ser desfeita" e o que sai junto, com contagens. Cliente bloqueado: cada bloqueio com quantidade, exemplos ("e mais N" além de 5) e "Como resolver: …" ou "Não é possível resolver: inative o cliente". Com vários clientes, cada um aparece como "pode excluir" ou "bloqueado: motivo"; Confirmar exclui só os livres, tira da seleção os excluídos e mantém os que falharem com a mensagem do servidor. Sem nenhum livre, Confirmar fica desabilitado e o botão de saída vira "Fechar". Cancelar e Esc fecham sem excluir; Confirmar fica desabilitado durante a exclusão. O `EzAlert` solto de erro de exclusão e o `window.confirm` saem. O pop-up não exclui ticket: orienta a excluir em Tickets e tentar de novo.

**Tela do ticket.** Botão "Excluir ticket" só para quem tem `canDeleteTickets`, com `EzDialog` `variant="danger"` citando o protocolo; a recusa da API aparece no próprio diálogo; sucesso volta à lista de Tickets.

**Design system.** Reuso de `EzDialog` (com `children`, `confirmLabel`, `cancelLabel`, `confirmDisabled`, entregue na DMTE-540), `EzButton` e `EzAlert`. Nenhum componente nem token novo, então nenhuma story nova; avaliação de DS registrada no manifest.

## Perfis, tenant e RBAC

- Exclusão e consulta de cliente: `MANAGE_CLIENTS_AND_RESOURCE_GROUPS` (ADMIN tem o bypass normal do guard, como nas demais rotas de cliente). Usuário CLIENT não acessa.
- Exclusão de ticket: `DELETE_TICKETS` por grupo, sem bypass de ADMIN; visibilidade do ticket pela regra do `GET /tickets/:id`. Cliente (portal) nunca exclui ticket.
- A checagem de bloqueios roda no servidor; a tela só reflete o resultado.

## Testing Decisions

Um bom teste observa o comportamento externo (resposta, estado do banco, o que o usuário vê), não a implementação. Seams, confirmados pelo responsável (Q16):
1. **API, controller e serviço com Prisma simulado.** Prior art: `organizations.service.spec.ts`, `organizations.controller.spec.ts`, `tickets.service.spec.ts`, `tickets.controller.spec.ts`, `permission-catalog.users.spec.ts` (grupos padrão).
2. **Web, a página pela Testing Library.** Prior art: `OrganizationsPage.test.tsx`, `ContractsPage.test.tsx` (pop-up da DMTE-540), `TicketDetailPage.test.tsx`.
3. **E2E com banco real isolado** (`scripts/e2e_isolated.sh`, `apps/web-e2e`): um arquivo com poucos cenários, para provar chaves estrangeiras e cascata que o Prisma simulado não prova.

Os testes da DMTE-481 que afirmam "a exclusão só inativa" são substituídos, não mantidos.

## Out of Scope

- Cancelamento de ticket como status novo (hoje `POST /tickets/:id/cancel` fecha o ticket; continua igual).
- Exclusão de usuário; exclusão de tickets em massa a partir do pop-up de cliente; qualquer ação de resolução dentro do pop-up (ele só orienta).
- Migração ou limpeza de dados já gravados; recuperação de cliente ou ticket excluído (a exclusão é definitiva).
- Mudar a regra de ADMIN para as demais permissões.

## Further Notes

- Rodada 2 (QA independente rejeitou o SHA `9d283fe`): apontamento anulado não é apagado junto com o ticket (guarda o estorno de apontamento faturado); decisão pendente do responsável se a exclusão de ticket deve passar a apagá-lo também. Decisão do implementador: bloquear e dizer a verdade, reversível por nova entrega. Limite conhecido: pré-apontamento travado pelo sistema (`lockedReason`) só sai com `canEditWorklogStartTime`, e o `deletion-check` não leva isso em conta ao dizer "resolvível".

- Decisão que muda um comportamento já entregue: DMTE-481 (#199, #201) definiu "excluir só inativa"; esta SPEC a substitui por pedido do responsável.
- Vínculo que o pedido não citava e que a análise do schema encontrou: sub-tickets (bloqueiam a exclusão do ticket), histórico de vínculo com mesa, contrato inativo, usuários, cofre, agenda e apontamento.
- Não há ADR: a troca da regra está registrada aqui e a decisão é reversível por nova entrega.

## Acceptance criteria

Ticket T1, exclusão de ticket:
- AC-01: `DELETE /tickets/:id` apaga o ticket (qualquer status) e responde 200 com `{ id }` quando o usuário tem `DELETE_TICKETS`, não há apontamento, pré-apontamento nem sub-tickets e o solicitante não é usuário de um cliente; comentários, auditoria, checklist, anexos e compromissos de agenda do ticket saem na mesma transação.
- AC-02: com apontamento ou pré-apontamento ativo (o anulado é o AC-22), responde 409 com mensagem e a lista de até 5 itens com a contagem, e não apaga nada.
- AC-03: com solicitante que é usuário de um cliente, responde 409 ("aberto pelo cliente") mesmo para quem tem a permissão, e não apaga nada.
- AC-04: com sub-tickets, responde 409 e não apaga nada.
- AC-05: sem `DELETE_TICKETS` responde 403, inclusive para ADMIN; ticket que o usuário não enxerga pela regra do `GET /tickets/:id` responde 404; inexistente responde 404.
- AC-06: `DELETE_TICKETS` está no catálogo (Administrativo, "Excluir tickets"), não está em nenhum grupo padrão de papel, grupos existentes não a ganham, e `GET /auth/me` devolve `canDeleteTickets` verdadeiro só quando a chave está num grupo do usuário (ADMIN sem a chave recebe falso).
- AC-07: na tela do ticket, "Excluir ticket" só aparece com `canDeleteTickets`; abre `EzDialog` danger com o protocolo, nada é excluído antes de Confirmar, Confirmar fica desabilitado durante o envio, a mensagem de recusa da API aparece no diálogo, e o sucesso leva à lista de Tickets.

Ticket T2, exclusão de cliente na API:
- AC-08: `POST /organizations/deletion-check` com `ids` (1 a 50) devolve, por cliente, `canDelete`, `blockers` e `cascade`; exige `MANAGE_CLIENTS_AND_RESOURCE_GROUPS` (403 sem ela) e responde 404 para id inexistente.
- AC-09: cada um destes vínculos gera o bloqueio com o código correspondente, de forma independente: ticket de qualquer status (cliente comercial ou solicitante do cliente) = TICKETS; vínculo atual com mesa = SERVICE_DESKS; contrato ativo ou inativo = CONTRACTS; usuário do cliente = USERS; credencial ou pasta do cofre = VAULT; compromisso de agenda do cliente = APPOINTMENTS.
- AC-10: todos os bloqueios do cliente voltam numa só resposta, cada um com `code`, `message`, `count`, até 5 `items`, `resolvable` e `howToResolve`; USERS é resolvível (AC-26), os demais dependem do item.
- AC-11: em TICKETS, cada ticket traz seus motivos (aberto pelo cliente, sem permissão `DELETE_TICKETS`, com apontamento, com sub-tickets); `resolvable` é falso se algum ticket tem motivo sem solução (aberto pelo cliente, sem permissão, apontamento anulado ou apontamento que o usuário não pode remover: AC-22 e AC-23) e verdadeiro caso contrário.
- AC-12: `DELETE /organizations/:id` de cliente sem bloqueios apaga o cliente e o que sai junto (histórico de vínculo com mesa, endereços, contatos, grupos de atendentes, vínculos com grupos técnicos, compartilhamentos de artigo) numa única transação, responde 200 com `{ id }` e não apenas inativa.
- AC-13: com bloqueios, responde 409 com `message` e a mesma lista `blockers` da consulta, e nada é apagado; a checagem é refeita dentro da transação, com trava na linha do cliente, e uma violação de chave estrangeira concorrente vira 409, não 500.
- AC-14: `DELETE /organizations/:id` exige `MANAGE_CLIENTS_AND_RESOURCE_GROUPS` (403 sem ela) e responde 404 para id inexistente; a exclusão grava log com o id do cliente e do usuário, sem dados pessoais.
- AC-15: com banco real, um cliente sem vínculos é excluído e deixa de aparecer na lista, os registros que saem junto somem, e um cliente com mesa, ticket, contrato, usuário, cofre ou agenda é recusado e continua cadastrado.

Ticket T3, pop-up na tela Clientes:
- AC-16: a lixeira (clientes selecionados na grade ou cliente aberto) chama `deletion-check` e abre `EzDialog` danger; nenhuma exclusão é enviada antes de Confirmar; `window.confirm` não é mais usado.
- AC-17: cliente livre: o pop-up mostra o título "Excluir cliente" (ou "Excluir N clientes"), "Esta ação não pode ser desfeita" e o que sai junto com as contagens; Confirmar chama `DELETE /organizations/:id` para cada cliente livre.
- AC-18: cliente bloqueado: cada bloqueio aparece com a mensagem e a quantidade, até 5 exemplos ("e mais N" além disso; os tickets com o motivo de cada um) e "Como resolver: …" quando dá para resolver ou "Não é possível resolver: inative o cliente" quando não dá; ticket aberto pelo cliente mostra o motivo "aberto pelo cliente".
- AC-19: com vários clientes, cada um aparece como "pode excluir" ou "bloqueado: motivo"; Confirmar exclui só os livres; os excluídos saem da seleção e da lista; os que falharem ficam selecionados com a mensagem do servidor; sem nenhum livre, Confirmar fica desabilitado e o botão de saída é "Fechar".
- AC-20: Cancelar e Esc fecham sem excluir; Confirmar fica desabilitado durante a exclusão; falha da consulta mostra a mensagem e não oferece Confirmar.
- AC-21: o pop-up não exclui ticket: para tickets que bloqueiam, orienta a excluir em Tickets e tentar de novo.

Correções da revisão independente (rodada 2):
- AC-22: apontamento anulado (estornado, que fica no banco para auditoria) não conta como removível: o ticket continua sem poder ser excluído, com o motivo `HAS_VOIDED_WORKLOGS` (409 na exclusão do ticket) e "tem apontamento anulado (fica registrado para auditoria)" no `deletion-check`, que o marca sem saída; apontamento ativo continua sendo o motivo `HAS_WORKLOGS`, e o apontamento anulado não entra na contagem dele.
- AC-23: no `deletion-check`, o bloqueio TICKETS só é resolvível por quem remove os apontamentos e pré-apontamentos ativos do ticket: um ADMIN ou o autor de todos eles; para os demais o motivo é "tem apontamento de outro usuário (só o autor ou um administrador remove)" e não há saída.
- AC-24: na exclusão do ticket, uma gravação concorrente que quebre uma chave estrangeira (P2003) responde 409 ("apontamento ou sub-ticket"), não 500, sem apagar nada nem os arquivos dos anexos.
- AC-26 (rodada 3, teste do responsável em produção): USERS é resolvível: `resolvable=true` e `howToResolve` manda abrir o usuário em Usuários e deixar o campo Cliente em branco. Substitui a parte de AC-10 que dizia `resolvable=false`.
- AC-27 (rodada 3): a aba Clientes da mesa mostra todos os clientes vinculados (N:N, `organizations`), ou "Mesa compartilhada (sem cliente)" quando não há nenhum; ao editar, é possível desvincular cada cliente e adicionar outro, e Salvar envia `organizationIds` sem o campo legado `organizationId` (a API o recusa por `forbidNonWhitelisted`).
- AC-28 (rodada 3): em SERVICE_DESKS, `howToResolve` dá o caminho completo: abrir o cliente e usar a aba Relacionamentos, ou abrir a mesa em Mesas e usar a aba Clientes.
- AC-25: o `deletion-check` não devolve título de ticket nem nome de credencial ou pasta do cofre: o ticket aparece pelo protocolo, o cofre pelo tipo ("Credencial", "Pasta") e o compromisso de agenda como "Compromisso na agenda".

## Matriz AC → verificação

| AC | Seam | Verificação |
|---|---|---|
| AC-01 a AC-05 | API, Prisma simulado | `apps/api/src/tickets/tickets.service.spec.ts` e `tickets.controller.spec.ts` (novos casos de exclusão) |
| AC-06 | API | `permission-catalog.users.spec.ts`, `auth.controller.spec.ts` |
| AC-07 | Web | `apps/web/src/pages/TicketDetailPage.test.tsx` |
| AC-08 a AC-14 | API, Prisma simulado | `apps/api/src/organizations/organizations.service.spec.ts`, `organizations.controller.spec.ts` |
| AC-26, AC-28 | API, Prisma simulado | `organizations.service.spec.ts` |
| AC-27 | Web | `apps/web/src/pages/ServiceDesksPage.test.tsx` |
| AC-22 a AC-25 | API, Prisma simulado | `tickets.service.spec.ts` (AC-22, AC-24) e `organizations.service.spec.ts` (AC-22, AC-23, AC-25) |
| AC-15 | E2E, banco real | `apps/web-e2e/src/organization-delete.spec.ts` via `scripts/e2e_isolated.sh` |
| AC-16 a AC-21 | Web | `apps/web/src/pages/OrganizationsPage.test.tsx` (substitui os casos da DMTE-481) |

## Riscos

- **Perda de dado irreversível.** Mitigação: bloqueio por todos os vínculos fortes, confirmação em pop-up com o que sai junto, checagem repetida na transação, permissão `MANAGE_CLIENTS_AND_RESOURCE_GROUPS`; log de cada exclusão.
- **Corrida entre a consulta e a exclusão** (ticket novo criado no intervalo): a transação com trava e a chave estrangeira do banco recusam; o resultado é 409.
- **Cascata do banco** apagar mais do que o previsto: o e2e com banco real (AC-15) cobre as tabelas que saem junto; qualquer nova tabela ligada ao cliente com cascata exige atualizar a lista do pop-up.
- **Bypass de ADMIN em `DELETE_TICKETS`:** evitado por checagem direta no serviço, como `VIEW_TICKET_VALUES`; coberto por AC-05 e AC-06.
- **Vínculo novo no futuro** (tabela nova ligada ao cliente) pode escapar da lista: a chave estrangeira sem cascata ainda impede a exclusão, e o 409 genérico trata o caso até a lista ser atualizada.
- **Auditoria do cofre** de credenciais já excluídas fica com o id do cliente apagado (sem chave estrangeira, por desenho).
