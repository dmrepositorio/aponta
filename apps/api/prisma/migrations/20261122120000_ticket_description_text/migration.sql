-- GH-370 T1: texto buscável derivado da descrição; coluna nova, nulável, sem default.
-- lock_timeout (de sessão, `SET LOCAL` não vale fora de transação): se uma transação
-- longa segurar `Ticket`, o ALTER falha em 5s em vez de travar as escritas; o Prisma marca
-- a migração como falha e o deploy seguinte recusa com P3009 até `prisma migrate resolve
-- --rolled-back` (docs/delivery/RELEASE.md, 'Migração que falha').
SET lock_timeout = '5s';
ALTER TABLE "Ticket" ADD COLUMN "descriptionText" TEXT;
RESET lock_timeout;
