-- Fase 1b do tracker #523 (#533): chave estavel (defaultKey) para os grupos padrao.
-- Expand aditiva: coluna anulavel + indice unico, sem alterar nenhuma outra coluna
-- nem linha alem de preencher defaultKey. Nenhum DROP, DELETE ou INSERT.
-- Idempotente: ADD COLUMN/CREATE INDEX usam IF NOT EXISTS e cada UPDATE so age
-- quando o grupo ainda nao tem chave E a chave ainda nao foi usada por outro grupo,
-- entao uma segunda execucao nao altera nenhuma linha.
-- Grupos personalizados nao sao tocados: se houver mais de um grupo com o mesmo
-- nome padrao, so o mais antigo (createdAt, desempate por id) recebe a chave; os
-- demais ficam com defaultKey nulo. Os grupos padrao ausentes continuam sendo
-- criados sob demanda (UsersService e seed), ja com a chave.
-- As migracoes anteriores que ligam grupo por nome continuam como estao.
-- Reversao manual (Prisma nao tem down): DROP INDEX IF EXISTS "PermissionGroup_defaultKey_key";
-- ALTER TABLE "PermissionGroup" DROP COLUMN IF EXISTS "defaultKey";

ALTER TABLE "PermissionGroup" ADD COLUMN IF NOT EXISTS "defaultKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PermissionGroup_defaultKey_key" ON "PermissionGroup"("defaultKey");

UPDATE "PermissionGroup"
SET "defaultKey" = 'default-admin'
WHERE "id" = (SELECT "id" FROM "PermissionGroup" WHERE "name" = 'Administrador' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND "defaultKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "PermissionGroup" WHERE "defaultKey" = 'default-admin');

UPDATE "PermissionGroup"
SET "defaultKey" = 'default-agent-master'
WHERE "id" = (SELECT "id" FROM "PermissionGroup" WHERE "name" = 'Gerente de Atendimento' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND "defaultKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "PermissionGroup" WHERE "defaultKey" = 'default-agent-master');

UPDATE "PermissionGroup"
SET "defaultKey" = 'default-agent'
WHERE "id" = (SELECT "id" FROM "PermissionGroup" WHERE "name" = 'Atendente' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND "defaultKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "PermissionGroup" WHERE "defaultKey" = 'default-agent');

UPDATE "PermissionGroup"
SET "defaultKey" = 'default-client-master'
WHERE "id" = (SELECT "id" FROM "PermissionGroup" WHERE "name" = 'Cliente Master' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND "defaultKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "PermissionGroup" WHERE "defaultKey" = 'default-client-master');

UPDATE "PermissionGroup"
SET "defaultKey" = 'default-client'
WHERE "id" = (SELECT "id" FROM "PermissionGroup" WHERE "name" = 'Cliente' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND "defaultKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "PermissionGroup" WHERE "defaultKey" = 'default-client');
