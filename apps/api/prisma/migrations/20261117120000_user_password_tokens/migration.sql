-- DMTE-550: convite pendente (senha nula), tokens de definição de senha e permissões novas do cadastro de usuário.
ALTER TABLE "User"
  ALTER COLUMN "password" DROP NOT NULL;

CREATE TYPE "PasswordTokenPurpose" AS ENUM ('INVITE', 'RESET');

CREATE TABLE "PasswordToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "PasswordTokenPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordToken_tokenHash_key" ON "PasswordToken"("tokenHash");
CREATE INDEX "PasswordToken_userId_purpose_idx" ON "PasswordToken"("userId", "purpose");

ALTER TABLE "PasswordToken" ADD CONSTRAINT "PasswordToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quem já gerencia usuários continua podendo tudo no dia da entrega. Idempotente: só acrescenta o que falta.
UPDATE "PermissionGroup" AS pg
SET "permissions" = ARRAY(
  SELECT DISTINCT k
  FROM unnest(
    pg."permissions" || ARRAY['CREATE_USERS', 'CHANGE_USER_ROLE', 'ACTIVATE_DEACTIVATE_USERS', 'SEND_USER_INVITES_AND_RESETS']
  ) AS k
)
WHERE 'MANAGE_USERS' = ANY (pg."permissions")
  AND NOT (pg."permissions" @> ARRAY['CREATE_USERS', 'CHANGE_USER_ROLE', 'ACTIVATE_DEACTIVATE_USERS', 'SEND_USER_INVITES_AND_RESETS']);
