-- Fase 1e do tracker #523 (#540): acrescenta as chaves de escopo (SCOPE_KEYS) aos grupos
-- padrao, e REMOVE_TICKET_ATTACHMENTS a Gerente de Atendimento e Atendente (hoje ja
-- removem anexo de outra pessoa; so o Administrador tinha a chave). Comportamento
-- efetivo inalterado: nenhum codigo de decisao consulta as chaves ainda.
-- Aditiva e idempotente: cada grupo e localizado por defaultKey (nunca por nome),
-- so acrescenta o que falta e a guarda NOT (@>) impede qualquer escrita numa segunda
-- execucao. Sem remocao nem insercao de linhas; grupos personalizados nao sao tocados.
-- Cliente Master e Cliente nao recebem REMOVE_TICKET_ATTACHMENTS.
-- Pre-requisito: a migracao 1b (defaultKey) ja rodou.

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_ALL_TICKETS', 'VIEW_DESK_TICKETS', 'VIEW_OWN_TICKETS', 'VIEW_ALL_SERVICE_DESKS', 'VIEW_ORGANIZATION_SERVICE_DESKS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_CREDENTIALS', 'VIEW_ALL_CONTRACTS', 'VIEW_ORGANIZATION_CONTRACTS', 'VIEW_ASSIGNED_DESK_CONTRACTS', 'VIEW_ALL_APPOINTMENTS', 'VIEW_ORGANIZATION_APPOINTMENTS', 'VIEW_OWN_APPOINTMENTS', 'VIEW_ALL_CLIENT_TICKETS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-admin'
  AND NOT ("permissions" @> ARRAY['VIEW_ALL_TICKETS', 'VIEW_DESK_TICKETS', 'VIEW_OWN_TICKETS', 'VIEW_ALL_SERVICE_DESKS', 'VIEW_ORGANIZATION_SERVICE_DESKS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_CREDENTIALS', 'VIEW_ALL_CONTRACTS', 'VIEW_ORGANIZATION_CONTRACTS', 'VIEW_ASSIGNED_DESK_CONTRACTS', 'VIEW_ALL_APPOINTMENTS', 'VIEW_ORGANIZATION_APPOINTMENTS', 'VIEW_OWN_APPOINTMENTS', 'VIEW_ALL_CLIENT_TICKETS']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_DESK_TICKETS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_CREDENTIALS', 'VIEW_ASSIGNED_DESK_CONTRACTS', 'VIEW_OWN_APPOINTMENTS', 'REMOVE_TICKET_ATTACHMENTS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-agent-master'
  AND NOT ("permissions" @> ARRAY['VIEW_DESK_TICKETS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_CREDENTIALS', 'VIEW_ASSIGNED_DESK_CONTRACTS', 'VIEW_OWN_APPOINTMENTS', 'REMOVE_TICKET_ATTACHMENTS']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_DESK_TICKETS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_CREDENTIALS', 'VIEW_ASSIGNED_DESK_CONTRACTS', 'VIEW_OWN_APPOINTMENTS', 'REMOVE_TICKET_ATTACHMENTS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-agent'
  AND NOT ("permissions" @> ARRAY['VIEW_DESK_TICKETS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_CREDENTIALS', 'VIEW_ASSIGNED_DESK_CONTRACTS', 'VIEW_OWN_APPOINTMENTS', 'REMOVE_TICKET_ATTACHMENTS']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_ALL_CLIENT_TICKETS', 'VIEW_OWN_TICKETS', 'VIEW_ORGANIZATION_SERVICE_DESKS', 'VIEW_ORGANIZATION_CONTRACTS', 'VIEW_ORGANIZATION_APPOINTMENTS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-client-master'
  AND NOT ("permissions" @> ARRAY['VIEW_ALL_CLIENT_TICKETS', 'VIEW_OWN_TICKETS', 'VIEW_ORGANIZATION_SERVICE_DESKS', 'VIEW_ORGANIZATION_CONTRACTS', 'VIEW_ORGANIZATION_APPOINTMENTS']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_OWN_TICKETS', 'VIEW_ORGANIZATION_SERVICE_DESKS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-client'
  AND NOT ("permissions" @> ARRAY['VIEW_OWN_TICKETS', 'VIEW_ORGANIZATION_SERVICE_DESKS']::text[]);
