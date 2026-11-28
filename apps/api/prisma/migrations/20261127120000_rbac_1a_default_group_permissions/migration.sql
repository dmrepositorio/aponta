-- Fase 1a do tracker #523 (#532): acrescenta as permissões novas aos grupos padrão
-- para que cada perfil mantenha exatamente o que já podia (matriz de caracterização
-- da Fase 0). Aditiva e idempotente: só acrescenta o que falta, nunca remove, e uma
-- segunda execução não altera nenhuma linha (o WHERE exclui grupos já completos).
-- CLIENT_MASTER não recebe VIEW_TEAM_MEMBER_NAMES nem POST_INTERNAL_NOTES (decisão do dono).
-- O grupo "Cliente" não recebe nenhuma chave nova. Nenhuma chave nova é GROUP_ONLY.

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_TEAM_MEMBER_NAMES', 'VIEW_REQUESTER_CONTACT_INFO', 'POST_INTERNAL_NOTES', 'ASSIGN_TICKETS', 'OPEN_TICKETS_ON_BEHALF', 'USE_INTERNAL_SERVICE_DESKS', 'LAUNCH_WORKLOG_ON_BEHALF', 'DELETE_ANY_WORKLOG', 'AUTHORIZE_WORKLOG_BONUS', 'SET_WORKLOG_MANUAL_VALUE', 'VIEW_CONTRACT_FINANCIALS', 'VIEW_COMMERCIAL_RESULT', 'DELETE_KNOWLEDGE_ARTICLES', 'VIEW_ALL_KNOWLEDGE_ARTICLES']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Administrador'
  AND NOT ("permissions" @> ARRAY['VIEW_TEAM_MEMBER_NAMES', 'VIEW_REQUESTER_CONTACT_INFO', 'POST_INTERNAL_NOTES', 'ASSIGN_TICKETS', 'OPEN_TICKETS_ON_BEHALF', 'USE_INTERNAL_SERVICE_DESKS', 'LAUNCH_WORKLOG_ON_BEHALF', 'DELETE_ANY_WORKLOG', 'AUTHORIZE_WORKLOG_BONUS', 'SET_WORKLOG_MANUAL_VALUE', 'VIEW_CONTRACT_FINANCIALS', 'VIEW_COMMERCIAL_RESULT', 'DELETE_KNOWLEDGE_ARTICLES', 'VIEW_ALL_KNOWLEDGE_ARTICLES']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_TEAM_MEMBER_NAMES', 'VIEW_REQUESTER_CONTACT_INFO', 'POST_INTERNAL_NOTES', 'ASSIGN_TICKETS', 'USE_INTERNAL_SERVICE_DESKS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Gerente de Atendimento'
  AND NOT ("permissions" @> ARRAY['VIEW_TEAM_MEMBER_NAMES', 'VIEW_REQUESTER_CONTACT_INFO', 'POST_INTERNAL_NOTES', 'ASSIGN_TICKETS', 'USE_INTERNAL_SERVICE_DESKS']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_TEAM_MEMBER_NAMES', 'VIEW_REQUESTER_CONTACT_INFO', 'POST_INTERNAL_NOTES', 'ASSIGN_TICKETS', 'USE_INTERNAL_SERVICE_DESKS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Atendente'
  AND NOT ("permissions" @> ARRAY['VIEW_TEAM_MEMBER_NAMES', 'VIEW_REQUESTER_CONTACT_INFO', 'POST_INTERNAL_NOTES', 'ASSIGN_TICKETS', 'USE_INTERNAL_SERVICE_DESKS']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_CONTRACT_FINANCIALS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Cliente Master'
  AND NOT ("permissions" @> ARRAY['VIEW_CONTRACT_FINANCIALS']::text[]);
