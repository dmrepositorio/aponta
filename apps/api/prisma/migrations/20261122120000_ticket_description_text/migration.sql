-- GH-370 T1: texto buscável derivado da descrição; coluna nova, nulável, sem default.
-- lock_timeout (de sessão, `SET LOCAL` não vale fora de transação): se uma transação
-- longa segurar `Ticket`, o deploy falha em 5s em vez de travar a tabela e se repete.
SET lock_timeout = '5s';
ALTER TABLE "Ticket" ADD COLUMN "descriptionText" TEXT;
RESET lock_timeout;
