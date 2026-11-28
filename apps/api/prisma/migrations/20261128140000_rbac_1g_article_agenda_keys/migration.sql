-- Fase 1g do tracker #523 (#571): registra as chaves complementares do lote 2a5 (artigos e agenda)
-- e as atribui aos grupos padrao: EDIT_ALL_KNOWLEDGE_ARTICLES so ao Administrador;
-- VIEW_OTHER_USERS_APPOINTMENTS ao Administrador e ao Gerente de Atendimento;
-- VIEW_INTERNAL_ABSENCES ao Administrador, ao Gerente e ao Atendente. Cliente Master e
-- Cliente nao recebem nenhuma. Comportamento efetivo inalterado: nenhum codigo de decisao
-- consulta as chaves ainda.
-- Aditiva e idempotente: cada grupo e localizado por defaultKey (nunca por nome), so
-- acrescenta o que falta e a guarda NOT (@>) impede qualquer escrita numa segunda
-- execucao. Sem remocao nem insercao de linhas; grupos personalizados nao sao tocados.
-- Pre-requisito: a migracao 1b (defaultKey) ja rodou.

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['EDIT_ALL_KNOWLEDGE_ARTICLES', 'VIEW_OTHER_USERS_APPOINTMENTS', 'VIEW_INTERNAL_ABSENCES']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-admin'
  AND NOT ("permissions" @> ARRAY['EDIT_ALL_KNOWLEDGE_ARTICLES', 'VIEW_OTHER_USERS_APPOINTMENTS', 'VIEW_INTERNAL_ABSENCES']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_OTHER_USERS_APPOINTMENTS', 'VIEW_INTERNAL_ABSENCES']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-agent-master'
  AND NOT ("permissions" @> ARRAY['VIEW_OTHER_USERS_APPOINTMENTS', 'VIEW_INTERNAL_ABSENCES']::text[]);

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_INTERNAL_ABSENCES']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-agent'
  AND NOT ("permissions" @> ARRAY['VIEW_INTERNAL_ABSENCES']::text[]);
