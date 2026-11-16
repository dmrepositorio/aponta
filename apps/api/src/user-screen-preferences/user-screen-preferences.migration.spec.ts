import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const prismaDir = resolve(__dirname, '../../prisma');
const migrationsDir = join(prismaDir, 'migrations');

/** SQL das migrações que mencionam a tabela (lista vazia se a migração ainda não existe, sem lançar). */
function migrationsForTable(): { name: string; sql: string }[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .map((name) => ({ name, file: join(migrationsDir, name, 'migration.sql') }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, 'utf8') }))
    .filter(({ sql }) => sql.includes('"UserScreenPreference"'));
}

describe('UserScreenPreference: migração e schema (DMTE-527 T2, AC-10)', () => {
  it('AC-10: existe exatamente uma migração que cria a tabela "UserScreenPreference"', () => {
    const found = migrationsForTable();
    expect(found.map((m) => m.name)).toHaveLength(1);
    expect(found[0]?.sql ?? '').toMatch(/CREATE TABLE "UserScreenPreference"/);
  });

  it('AC-10: a tabela tem userId, screen, data (JSONB) e updatedAt', () => {
    const sql = migrationsForTable()[0]?.sql ?? '';
    expect(sql).toMatch(/"userId" TEXT NOT NULL/);
    expect(sql).toMatch(/"screen" TEXT NOT NULL/);
    expect(sql).toMatch(/"data" JSONB NOT NULL/);
    expect(sql).toMatch(/"updatedAt" TIMESTAMP\(3\) NOT NULL/);
  });

  it('AC-10: é único por (userId, screen)', () => {
    const sql = migrationsForTable()[0]?.sql ?? '';
    expect(sql).toMatch(/CREATE UNIQUE INDEX "UserScreenPreference_userId_screen_key" ON "UserScreenPreference"\("userId", "screen"\)/);
  });

  it('AC-10: a chave estrangeira para "User" é ON DELETE CASCADE', () => {
    const sql = migrationsForTable()[0]?.sql ?? '';
    expect(sql).toMatch(/FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  });

  it('AC-10: é aditiva: só cria a tabela nova (sem DROP, sem backfill, sem ALTER em outra tabela)', () => {
    const sql = migrationsForTable()[0]?.sql ?? '';
    expect(sql).not.toBe('');
    expect(sql).not.toMatch(/\bDROP\b|\bINSERT\b|\bUPDATE\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
    const alters = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(alters.every((table) => table === 'UserScreenPreference')).toBe(true);
    const creates = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(creates).toEqual(['UserScreenPreference']);
  });

  it('AC-10: o schema.prisma tem o model com @@unique([userId, screen]) e onDelete: Cascade', () => {
    const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
    const model = schema.match(/model UserScreenPreference \{[^}]*\}/)?.[0] ?? '';
    expect(model).not.toBe('');
    expect(model).toMatch(/@@unique\(\[userId, screen\]\)/);
    expect(model).toMatch(/onDelete: Cascade/);
    expect(model).toMatch(/data\s+Json/);
    expect(model).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
  });
});
