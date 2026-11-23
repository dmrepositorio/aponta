import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * AC-07: todo escritor de Ticket.description usa ticketDescriptionFields.
 * Varre os .ts de apps/api/src, apps/api/prisma/seed.ts e scripts e falha se
 * uma chamada ticket.create|update|upsert|createMany|updateMany grava
 * `description` fora do spread do helper, ou se alguem atribui
 * `data.description =` direto.
 */
const REPO_ROOT = resolve(__dirname, '../../../..');
const WRITE_CALL_RE = /ticket\s*\.\s*(create|update|upsert|createMany|updateMany)\s*\(/g;
const DIRECT_ASSIGN_RE = /\bdata\s*\.\s*description(Text)?\s*=/g;
const HELPER_SPREAD_RE = /\.\.\.\s*ticketDescriptionFields\s*\([^)]*\)/g;

function extractBlock(source: string, openIndex: number): string {
  if (openIndex < 0) return '';
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

/** Um trecho por escrita de Ticket.description feita fora do helper. */
export function findRawDescriptionWrites(source: string): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(WRITE_CALL_RE)) {
    const callStart = (match.index ?? 0) + match[0].length;
    const args = extractBlock(source, source.indexOf('{', callStart));
    const withoutHelper = args.replace(HELPER_SPREAD_RE, '');
    // GH-370: `descriptionText` também só sai do helper (o spread já o traz).
    if (/\bdescription(Text)?\s*[:,}]/.test(withoutHelper)) {
      offenders.push(`${match[0]} ${args.slice(0, 80)}`);
    }
  }
  for (const match of source.matchAll(DIRECT_ASSIGN_RE)) {
    offenders.push(match[0]);
  }
  return offenders;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__fixtures__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('varredura de escritores de Ticket.description (AC-07)', () => {
  describe('detector', () => {
    it('pega description cru em ticket.create', () => {
      expect(
        findRawDescriptionWrites('await tx.ticket.create({ data: { title: t, description: x } })'),
      ).toHaveLength(1);
    });

    it('pega description em update e atribuição direta em data', () => {
      expect(
        findRawDescriptionWrites(
          'this.prisma.ticket.update({ where: { id }, data: { description: dto.description } })',
        ),
      ).toHaveLength(1);
      expect(findRawDescriptionWrites('data.description = dto.description;')).toHaveLength(1);
    });

    it('aceita o spread do helper', () => {
      expect(
        findRawDescriptionWrites(
          'await tx.ticket.create({ data: { title: t, ...ticketDescriptionFields(dto.description) } })',
        ),
      ).toHaveLength(0);
    });

    it('GH-370 AC-04: pega descriptionText gravado fora do helper', () => {
      expect(
        findRawDescriptionWrites('await tx.ticket.create({ data: { title: t, descriptionText: x } })'),
      ).toHaveLength(1);
      expect(
        findRawDescriptionWrites(
          'this.prisma.ticket.update({ where: { id }, data: { descriptionText: texto } })',
        ),
      ).toHaveLength(1);
      expect(findRawDescriptionWrites('data.descriptionText = texto;')).toHaveLength(1);
    });

    it('GH-370 AC-04: o spread do helper continua aceito', () => {
      expect(
        findRawDescriptionWrites(
          'await tx.ticket.update({ where: { id }, data: { ...ticketDescriptionFields(d) } })',
        ),
      ).toHaveLength(0);
    });

    it('ignora escritas sem description (SLA, CSAT)', () => {
      expect(
        findRawDescriptionWrites(
          'await this.prisma.ticket.update({ where: { id }, data: { slaPausedAt: null } })',
        ),
      ).toHaveLength(0);
    });
  });

  it('nenhum arquivo de produção grava Ticket.description fora do helper', () => {
    const files = [
      ...listTsFiles(join(REPO_ROOT, 'apps/api/src')),
      join(REPO_ROOT, 'apps/api/prisma/seed.ts'),
      ...listTsFiles(join(REPO_ROOT, 'scripts')),
    ].filter((f) => !f.endsWith('ticket-description-fields.ts'));

    const offenders = files.flatMap((file) =>
      findRawDescriptionWrites(readFileSync(file, 'utf8')).map((o) => `${file}: ${o}`),
    );
    expect(offenders).toEqual([]);
  });

  it('o serviço e o seed usam o helper', () => {
    const service = readFileSync(join(REPO_ROOT, 'apps/api/src/tickets/tickets.service.ts'), 'utf8');
    const seed = readFileSync(join(REPO_ROOT, 'apps/api/prisma/seed.ts'), 'utf8');
    expect(service).toContain('ticketDescriptionFields(');
    expect(seed).toContain('ticketDescriptionFields(');
  });
});
