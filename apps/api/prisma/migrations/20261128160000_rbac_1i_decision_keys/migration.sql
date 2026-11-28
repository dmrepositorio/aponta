-- Fase 1i do tracker #523 (#588): registra as chaves das decisoes abertas e as atribui aos
-- grupos padrao, preservando o comportamento de hoje:
--   RELEASE_PENDING_APPROVAL_TICKETS (ticket-status-transitions.ts libera PENDING_APPROVAL):
--     Administrador, Gerente de Atendimento e Cliente Master.
--   VIEW_ALLOWED_STATUSES (TicketsService.findOne devolve allowedStatuses a todo perfil menos
--     CLIENT): Administrador, Gerente, Atendente e Cliente Master.
--   CREATE_APPOINTMENTS_ON_AGENDA (AgendaService.create barra CLIENT, e o controller exige
--     CREATE_TICKET_SCHEDULING, que o Cliente Master nao tem): Administrador, Gerente e Atendente.
-- Cliente nao recebe nenhuma. Comportamento efetivo inalterado: nenhum codigo de decisao
-- consulta as chaves ainda.
-- Aditiva e idempotente: cada grupo e localizado por defaultKey (nunca por nome), so
-- acrescenta o que falta e a guarda NOT (@>) impede qualquer escrita numa segunda
-- execucao. Sem remocao nem insercao de linhas; grupos personalizados nao sao tocados.
-- Pre-requisito: a migracao 1b (defaultKey) ja rodou.

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['RELEASE_PENDING_APPROVAL_TICKETS', 'VIEW_ALLOWED_STATUSES', 'CREATE_APPOINTMENTS_ON_AGENDA']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-admin'
  AND NOT ("permissions" @> ARRAY['RELEASE_PENDING_APPROVAL_TICKETS', 'VIEW_ALLOWED_STATUSES', 'CREATE_APPOINTMENTS_ON_AGENDA']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['RELEASE_PENDING_APPROVAL_TICKETS', 'VIEW_ALLOWED_STATUSES', 'CREATE_APPOINTMENTS_ON_AGENDA']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-agent-master'
  AND NOT ("permissions" @> ARRAY['RELEASE_PENDING_APPROVAL_TICKETS', 'VIEW_ALLOWED_STATUSES', 'CREATE_APPOINTMENTS_ON_AGENDA']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_ALLOWED_STATUSES', 'CREATE_APPOINTMENTS_ON_AGENDA']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-agent'
  AND NOT ("permissions" @> ARRAY['VIEW_ALLOWED_STATUSES', 'CREATE_APPOINTMENTS_ON_AGENDA']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['RELEASE_PENDING_APPROVAL_TICKETS', 'VIEW_ALLOWED_STATUSES']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-client-master'
  AND NOT ("permissions" @> ARRAY['RELEASE_PENDING_APPROVAL_TICKETS', 'VIEW_ALLOWED_STATUSES']::text[]);
