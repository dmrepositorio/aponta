-- Fase 1f do tracker #523 (#566): registra AUDIT_WORKLOGS (auditoria de apontamentos por
-- ticket, hoje restrita ao ADMIN em worklogs.service.ts auditByTicket) e a atribui so ao
-- grupo Administrador. Comportamento efetivo inalterado: nenhum codigo de decisao
-- consulta a chave ainda.
-- Aditiva e idempotente: o grupo e localizado por defaultKey (nunca por nome), so
-- acrescenta o que falta e a guarda NOT (@>) impede qualquer escrita numa segunda
-- execucao. Sem remocao nem insercao de linhas; grupos personalizados nao sao tocados.
-- Pre-requisito: a migracao 1b (defaultKey) ja rodou.

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['AUDIT_WORKLOGS']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-admin'
  AND NOT ("permissions" @> ARRAY['AUDIT_WORKLOGS']::text[]);
