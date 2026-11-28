-- Fase 1h do tracker #523 (#577): registra VIEW_AGENT_DIRECTORY (lista de agentes sem escopo
-- de mesa, hoje restrita ao ADMIN em UsersService.findAgents) e a atribui so ao grupo
-- Administrador. Comportamento efetivo inalterado: nenhum codigo de decisao consulta a
-- chave ainda.
-- Aditiva e idempotente: o grupo e localizado por defaultKey (nunca por nome), so
-- acrescenta o que falta e a guarda NOT (@>) impede qualquer escrita numa segunda
-- execucao. Sem remocao nem insercao de linhas; grupos personalizados nao sao tocados.
-- Pre-requisito: a migracao 1b (defaultKey) ja rodou.

UPDATE "PermissionGroup"
SET "permissions" = "permissions" || ARRAY(
      SELECT k FROM unnest(ARRAY['VIEW_AGENT_DIRECTORY']::text[]) AS k WHERE k <> ALL("permissions")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultKey" = 'default-admin'
  AND NOT ("permissions" @> ARRAY['VIEW_AGENT_DIRECTORY']::text[]);
