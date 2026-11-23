import * as converter from '../html-to-search-text';
import {
  parseBackfillArgs,
  runBackfill,
  type BackfillOptions,
  type BackfillStore,
  type BackfillUpdate,
  type PendingRow,
} from './backfill-ticket-description-text';

interface Row {
  id: string;
  description: string;
  descriptionText: string | null;
}

/** Banco em memória com a mesma semântica de cursor e de guarda do store Prisma. */
class FakeStore implements BackfillStore {
  rows: Row[];
  readSizes: number[] = [];
  writeSizes: number[] = [];
  writes = 0;
  /** Roda entre a leitura e a escrita de cada lote (simula edição concorrente). */
  beforeWrite?: (rows: Row[]) => void;

  constructor(rows: Row[]) {
    this.rows = rows.map((r) => ({ ...r }));
  }

  async countTotal() {
    return this.rows.length;
  }

  async countPending() {
    return this.rows.filter((r) => r.descriptionText === null).length;
  }

  async readBatch({ afterId, take, all }: { afterId: string | null; take: number; all: boolean }) {
    this.readSizes.push(take);
    return this.rows
      .filter((r) => (all || r.descriptionText === null) && (afterId === null || r.id > afterId))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, take)
      .map<PendingRow>((r) => ({ id: r.id, description: r.description }));
  }

  async writeBatch(updates: BackfillUpdate[], all: boolean) {
    this.writeSizes.push(updates.length);
    this.beforeWrite?.(this.rows);
    let written = 0;
    for (const u of updates) {
      const row = this.rows.find((r) => r.id === u.id);
      const guard = all ? row?.description === u.description : row?.descriptionText === null;
      if (row && guard) {
        row.descriptionText = u.descriptionText;
        written++;
        this.writes++;
      }
    }
    return written;
  }
}

const id = (n: number) => `t-${String(n).padStart(3, '0')}`;
const legacy = (n: number, description: string): Row => ({
  id: id(n),
  description,
  descriptionText: null,
});
const opts = (o: Partial<BackfillOptions> = {}): BackfillOptions => ({
  dryRun: false,
  batchSize: 500,
  all: false,
  ...o,
});

describe('parseBackfillArgs (GH-370 AC-06)', () => {
  it('usa os padrões: sem dry-run, lote de 500, só pendentes, sem limite', () => {
    expect(parseBackfillArgs([])).toEqual({ dryRun: false, batchSize: 500, all: false });
  });

  it('lê --dry-run, --batch-size, --all e --limit (com = ou valor separado)', () => {
    expect(parseBackfillArgs(['--dry-run', '--all', '--batch-size', '50', '--limit=120'])).toEqual({
      dryRun: true,
      batchSize: 50,
      all: true,
      limit: 120,
    });
  });

  it.each([
    [['--batch-size', '0']],
    [['--batch-size', 'abc']],
    [['--limit', '-1']],
    [['--limit']],
    [['--nao-existe']],
  ])('recusa argumento inválido %j', (argv) => {
    expect(() => parseBackfillArgs(argv)).toThrow();
  });
});

describe('runBackfill', () => {
  const four = () => [
    legacy(1, '<p><strong>Erro</strong> na nota</p>'),
    legacy(2, 'texto puro a < b'),
    legacy(3, ''),
    legacy(4, '<div>x</div><div>y</div>'),
  ];

  it('AC-06: preenche pendentes (HTML, texto puro e vazio) e termina com restantes = 0', async () => {
    const store = new FakeStore(four());
    const lines: string[] = [];

    const report = await runBackfill(store, opts(), (l) => lines.push(l));

    expect(store.rows.map((r) => r.descriptionText)).toEqual(['Erro na nota', 'texto puro a < b', '', 'x y']);
    expect(report).toMatchObject({ total: 4, pending: 4, processed: 4, remaining: 0 });
    expect(lines.join('\n')).toMatch(/restantes = 0/);
  });

  it('AC-06: imprime total, pendentes, processados e restantes', async () => {
    const lines: string[] = [];
    await runBackfill(new FakeStore(four()), opts(), (l) => lines.push(l));
    const out = lines.join('\n');
    expect(out).toMatch(/total = 4/);
    expect(out).toMatch(/pendentes = 4/);
    expect(out).toMatch(/processados = 4/);
    expect(out).toMatch(/restantes = 0/);
  });

  it('AC-06: nunca grava mais que batch-size linhas por transação e anda por cursor', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => legacy(i + 1, `<p>n${i + 1}</p>`));
    const store = new FakeStore(rows);

    const report = await runBackfill(store, opts({ batchSize: 3 }));

    expect(store.writeSizes).toEqual([3, 3, 1]);
    expect(Math.max(...store.readSizes)).toBeLessThanOrEqual(3);
    expect(report.batches).toBe(3);
    expect(store.rows.map((r) => r.descriptionText)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
  });

  it('AC-06: é idempotente (segunda execução não grava nada)', async () => {
    const store = new FakeStore(four());
    await runBackfill(store, opts());
    const before = JSON.stringify(store.rows);
    const writesBefore = store.writes;

    const second = await runBackfill(store, opts());

    expect(store.writes).toBe(writesBefore);
    expect(JSON.stringify(store.rows)).toBe(before);
    expect(second).toMatchObject({ pending: 0, processed: 0, remaining: 0 });
  });

  it('AC-06: é retomável (limit interrompe e a execução seguinte termina pelos restantes)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => legacy(i + 1, `<p>n${i + 1}</p>`));
    const store = new FakeStore(rows);

    const first = await runBackfill(store, opts({ batchSize: 2, limit: 3 }));
    expect(first).toMatchObject({ examined: 3, processed: 3, remaining: 2 });

    const second = await runBackfill(store, opts({ batchSize: 2 }));
    expect(second).toMatchObject({ pending: 2, processed: 2, remaining: 0 });
  });

  it('AC-06: --dry-run não escreve e imprime as contagens', async () => {
    const store = new FakeStore(four());
    const lines: string[] = [];

    const report = await runBackfill(store, opts({ dryRun: true }), (l) => lines.push(l));

    expect(store.writes).toBe(0);
    expect(store.writeSizes).toEqual([]);
    expect(store.rows.every((r) => r.descriptionText === null)).toBe(true);
    expect(report).toMatchObject({ total: 4, pending: 4, examined: 4, processed: 0, remaining: 4, dryRun: true });
    expect(lines.join('\n')).toMatch(/dry-run/i);
    expect(lines.join('\n')).toMatch(/pendentes = 4/);
  });

  it('AC-07: não sobrescreve valor gravado por edição concorrente (guarda IS NULL)', async () => {
    const store = new FakeStore(four());
    store.beforeWrite = (rows) => {
      rows[0].descriptionText = 'valor-da-edicao-nova';
    };

    const report = await runBackfill(store, opts());

    expect(store.rows[0].descriptionText).toBe('valor-da-edicao-nova');
    expect(report.skipped).toBe(1);
    expect(report.processed).toBe(3);
    expect(report.remaining).toBe(0);
  });

  it('AC-07: --all recalcula inclusive linhas prontas e corrige defasagem', async () => {
    const store = new FakeStore([
      { id: id(1), description: '<p>novo</p>', descriptionText: 'defasado' },
      { id: id(2), description: 'puro', descriptionText: 'puro' },
      legacy(3, '<p>c</p>'),
    ]);

    const report = await runBackfill(store, opts({ all: true }));

    expect(store.rows.map((r) => r.descriptionText)).toEqual(['novo', 'puro', 'c']);
    expect(report).toMatchObject({ total: 3, processed: 3, remaining: 0 });
  });

  it('AC-07: --all não sobrescreve se a descrição mudou entre a leitura e a escrita', async () => {
    const store = new FakeStore([{ id: id(1), description: '<p>velha</p>', descriptionText: 'velha' }]);
    store.beforeWrite = (rows) => {
      rows[0].description = '<p>editada</p>';
      rows[0].descriptionText = 'editada';
    };

    const report = await runBackfill(store, opts({ all: true }));

    expect(store.rows[0].descriptionText).toBe('editada');
    expect(report.skipped).toBe(1);
  });

  it('falha de conversão numa linha aponta o id do ticket, sem o conteúdo, e deixa o que já foi gravado (retomável)', async () => {
    const secret = 'conteudo-sensivel-789';
    const store = new FakeStore([
      legacy(1, '<p>a</p>'),
      legacy(2, secret),
      legacy(3, '<p>c</p>'),
    ]);
    const real = converter.htmlToSearchText;
    jest.spyOn(converter, 'htmlToSearchText').mockImplementation((html) => {
      if (html === secret) throw new Error(`parser falhou com ${secret}`);
      return real(html);
    });

    let caught: unknown;
    try {
      await runBackfill(store, opts({ batchSize: 1 }));
    } catch (error) {
      caught = error;
    } finally {
      jest.restoreAllMocks();
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(id(2));
    expect(message).not.toContain(secret);
    expect(store.rows.map((r) => r.descriptionText)).toEqual(['a', null, null]);
    // reexecutar (agora sem falha) termina o trabalho
    const second = await runBackfill(store, opts({ batchSize: 1 }));
    expect(second.remaining).toBe(0);
  });
});
