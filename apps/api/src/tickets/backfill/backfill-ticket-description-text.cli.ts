/**
 * Ponto de entrada do backfill (GH-370 T2), empacotado como
 * `dist/apps/api/backfill-ticket-description-text.js` (segundo ponto de
 * entrada do webpack da API). Roda na imagem de produção com `node`.
 *
 * Cria o próprio PrismaClient (sem o `omit` do PrismaService, que esconde
 * `descriptionText`) e usa uma conexão só. Nunca imprime a DATABASE_URL.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  parseBackfillArgs,
  runBackfill,
  type BackfillStore,
} from './backfill-ticket-description-text';

function createStore(prisma: PrismaClient): BackfillStore {
  return {
    countTotal: () => prisma.ticket.count(),
    countPending: () => prisma.ticket.count({ where: { descriptionText: null } }),
    readBatch: ({ afterId, take, all }) =>
      prisma.ticket.findMany({
        where: {
          ...(all ? {} : { descriptionText: null }),
          ...(afterId === null ? {} : { id: { gt: afterId } }),
        },
        orderBy: { id: 'asc' },
        take,
        select: { id: true, description: true },
      }),
    // SQL direto: `updateMany` tocaria `updatedAt` (@updatedAt) em toda linha
    // preenchida. A guarda vai no WHERE e a contagem devolvida é a das linhas
    // que a passaram; o lote inteiro é uma transação.
    writeBatch: async (rows, all) => {
      if (rows.length === 0) return 0;
      const counts = await prisma.$transaction(
        rows.map((row) =>
          all
            ? prisma.$executeRaw`UPDATE "Ticket" SET "descriptionText" = ${row.descriptionText} WHERE "id" = ${row.id} AND "description" = ${row.description}`
            : prisma.$executeRaw`UPDATE "Ticket" SET "descriptionText" = ${row.descriptionText} WHERE "id" = ${row.id} AND "descriptionText" IS NULL`,
        ),
      );
      return counts.reduce((sum, n) => sum + n, 0);
    },
  };
}

async function main(): Promise<number> {
  if (process.argv.includes('--help')) {
    console.log(
      'uso: node backfill-ticket-description-text.js [--dry-run] [--batch-size N] [--all] [--limit N]',
    );
    return 0;
  }
  let options;
  try {
    options = parseBackfillArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`erro: ${(error as Error).message}`);
    return 1;
  }
  if (!process.env['DATABASE_URL']) {
    console.error('erro: DATABASE_URL não definida');
    return 1;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'], max: 1 }),
  });
  try {
    const report = await runBackfill(createStore(prisma), options, console.log);
    if (!options.dryRun && report.remaining > 0 && options.limit === undefined) {
      console.error(`restantes = ${report.remaining}: linhas pendentes depois da execução; reexecute`);
      return 2;
    }
    return 0;
  } catch (error) {
    console.error(`erro: ${(error as Error).message}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
