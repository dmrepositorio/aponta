-- DMTE-551 T2: versão da senha do usuário; coluna nova e aditiva (o aplicativo anterior a ignora).
ALTER TABLE "User" ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 0;
