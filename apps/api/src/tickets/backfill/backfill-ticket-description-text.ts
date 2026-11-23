import { htmlToSearchText } from '../html-to-search-text';

/**
 * Backfill de `Ticket.descriptionText` (GH-370 T2). Lógica pura sobre um
 * `BackfillStore`; o acesso ao banco fica em
 * `backfill-ticket-description-text.cli.ts`, que é o ponto de entrada
 * empacotado (`dist/apps/api/backfill-ticket-description-text.js`).
 *
 * - Lotes por cursor de `id` (`id > cursor ORDER BY id LIMIT N`); cada lote é
 *   escrito numa transação curta, nunca com mais de `batchSize` linhas.
 * - Por padrão só processa linhas com `descriptionText IS NULL`, e a escrita
 *   mantém essa guarda: uma edição concorrente (que já grava o texto) ganha.
 *   Com `--all` recalcula tudo; a guarda passa a ser `description` igual à
 *   lida, para não sobrescrever uma edição feita entre a leitura e a escrita.
 * - Idempotente e retomável: reexecutar recomeça pelos nulos restantes.
 */
export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  all: boolean;
  limit?: number;
}

export interface PendingRow {
  id: string;
  description: string;
}

export interface BackfillUpdate extends PendingRow {
  descriptionText: string;
}

export interface BackfillStore {
  countTotal(): Promise<number>;
  /** Linhas com `descriptionText IS NULL`. */
  countPending(): Promise<number>;
  readBatch(args: { afterId: string | null; take: number; all: boolean }): Promise<PendingRow[]>;
  /** Uma transação; devolve quantas linhas passaram pela guarda e foram gravadas. */
  writeBatch(rows: BackfillUpdate[], all: boolean): Promise<number>;
}

export interface BackfillReport {
  total: number;
  pending: number;
  examined: number;
  processed: number;
  skipped: number;
  remaining: number;
  batches: number;
  dryRun: boolean;
}

export const DEFAULT_BATCH_SIZE = 500;

function positiveInt(flag: string, raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`${flag} exige um inteiro maior que zero`);
  }
  return Number(raw);
}

export function parseBackfillArgs(argv: string[]): BackfillOptions {
  const options: BackfillOptions = { dryRun: false, batchSize: DEFAULT_BATCH_SIZE, all: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--all':
        options.all = true;
        break;
      case '--batch-size':
        options.batchSize = positiveInt(flag, value());
        break;
      case '--limit':
        options.limit = positiveInt(flag, value());
        break;
      default:
        throw new Error(`argumento desconhecido: ${argv[i]}`);
    }
  }
  return options;
}

export async function runBackfill(
  store: BackfillStore,
  options: BackfillOptions,
  log: (line: string) => void = () => undefined,
): Promise<BackfillReport> {
  const total = await store.countTotal();
  const pending = await store.countPending();
  log(
    `backfill descriptionText${options.dryRun ? ' (dry-run: nada será escrito)' : ''}` +
      `${options.all ? ' [--all]' : ''}: total = ${total}, pendentes = ${pending}`,
  );

  let afterId: string | null = null;
  let examined = 0;
  let processed = 0;
  let skipped = 0;
  let batches = 0;

  for (;;) {
    const room = options.limit === undefined ? options.batchSize : options.limit - examined;
    const take = Math.min(options.batchSize, room);
    if (take <= 0) break;

    const rows = await store.readBatch({ afterId, take, all: options.all });
    if (rows.length === 0) break;

    batches++;
    examined += rows.length;
    afterId = rows[rows.length - 1].id;

    if (!options.dryRun) {
      const written = await store.writeBatch(
        rows.map((row) => ({ ...row, descriptionText: htmlToSearchText(row.description) })),
        options.all,
      );
      processed += written;
      skipped += rows.length - written;
    }
    log(
      `lote ${batches}: lidas = ${rows.length}, processados = ${processed}, ` +
        `ignoradas por edição concorrente = ${skipped}`,
    );
    if (rows.length < take) break;
  }

  const remaining = options.dryRun ? pending : await store.countPending();
  const report: BackfillReport = {
    total,
    pending,
    examined,
    processed,
    skipped,
    remaining,
    batches,
    dryRun: options.dryRun,
  };
  log(
    `fim: total = ${total}, pendentes = ${pending}, processados = ${processed}, ` +
      `ignoradas = ${skipped}, restantes = ${remaining}`,
  );
  return report;
}
