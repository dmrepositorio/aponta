-- DMTE-527 T2: preferências de tela por usuário (uma linha por usuário e por tela), tabela nova e aditiva.
CREATE TABLE "UserScreenPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "screen" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserScreenPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserScreenPreference_userId_screen_key" ON "UserScreenPreference"("userId", "screen");

ALTER TABLE "UserScreenPreference" ADD CONSTRAINT "UserScreenPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
