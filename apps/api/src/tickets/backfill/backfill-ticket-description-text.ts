/**
 * Stub neutro do RED (GH-370 T2): importável, sem comportamento. A lógica real
 * entra no commit GREEN.
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
  countPending(): Promise<number>;
  readBatch(args: { afterId: string | null; take: number; all: boolean }): Promise<PendingRow[]>;
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

export function parseBackfillArgs(_argv: string[]): BackfillOptions {
  return { dryRun: false, batchSize: 500, all: false };
}

export async function runBackfill(
  _store: BackfillStore,
  _options: BackfillOptions,
  _log: (line: string) => void = () => undefined,
): Promise<BackfillReport> {
  return {
    total: 0,
    pending: 0,
    examined: 0,
    processed: 0,
    skipped: 0,
    remaining: 0,
    batches: 0,
    dryRun: _options.dryRun,
  };
}
