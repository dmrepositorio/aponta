-- DMTE-551 T6: trilha de eventos de segurança; tabela nova e aditiva.
CREATE TABLE "SecurityEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityEvent_subjectId_idx" ON "SecurityEvent"("subjectId");
