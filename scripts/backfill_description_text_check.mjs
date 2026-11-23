// GH-370 T2: roda o backfill empacotado contra um banco real, com fixtures
// sintéticas legadas (HTML, texto puro, vazio, tag colada), e confere
// dry-run, lotes, `restantes = 0`, idempotência, `--all`, que `updatedAt` não
// muda e que a guarda não sobrescreve valor já preenchido.
//
// Pré-requisitos (feitos por `scripts/e2e_isolated.sh` e pelo job E2E do CI):
// migrações aplicadas, seed rodado (precisa de ao menos um Ticket para copiar
// as chaves estrangeiras) e `pnpm exec nx run api:build` gerado. Usa só o
// DATABASE_URL do ambiente: banco descartável do E2E, nunca produção.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const ARTIFACT = resolve('dist/apps/api/backfill-ticket-description-text.js');
const PREFIX = 'bf370-';

// Este script INSERE e APAGA linhas de Ticket. Antes de qualquer conexão ou escrita,
// recusa banco que não seja local/descartável: 127.0.0.1, localhost ou ::1 (o Postgres
// do job E2E do CI e do scripts/e2e_isolated.sh). Outro host só com o opt-in nomeado
// abaixo, que NUNCA entra no CI nem no e2e_isolated. Nunca imprime a URL nem credencial.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const OPT_IN = 'BACKFILL_CHECK_ALLOW_DESTRUCTIVE';
function refuse(reason) {
  console.error(
    `recusado: ${reason}. Este check insere e apaga linhas de Ticket; rode só contra banco local/descartável ` +
      `(127.0.0.1 ou localhost). Para forçar contra outro host, defina ${OPT_IN}=1 por sua conta e risco.`,
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}
if (process.env[OPT_IN] !== '1') {
  let host;
  try {
    host = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    refuse('DATABASE_URL não é uma URL válida');
  }
  if (!LOCAL_HOSTS.has(host)) refuse(`o host "${host}" não é local`);
}
if (!existsSync(ARTIFACT)) throw new Error(`artefato ausente: ${ARTIFACT} (rode api:build)`);

const connectionString = process.env.DATABASE_URL.replace(/\?.*$/, '');

// Uma conexão por operação: o backfill abre a sua enquanto o script espera, e
// assim nada aqui segura sessão aberta durante a execução do comando.
async function withClient(fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const query = (sql, params) => withClient((c) => c.query(sql, params));

const FIXTURES = [
  { n: 1, description: '<p><strong>Erro</strong> na nota</p>', expected: 'Erro na nota' },
  { n: 2, description: 'texto puro a < b & c', expected: 'texto puro a < b & c' },
  { n: 3, description: '', expected: '' },
  { n: 4, description: '<div>R&amp;D</div><div>fim</div>', expected: 'R&D fim' },
  { n: 5, description: 'a<b && c>d', expected: 'ad' },
  { n: 6, description: '<p>um</p>', expected: 'um' },
  { n: 7, description: '<p>dois</p>', expected: 'dois' },
];
const ids = FIXTURES.map((f) => `${PREFIX}${f.n}`);

function fail(message) {
  console.error(`FALHOU: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
function check(condition, message) {
  if (!condition) fail(message);
  console.log(`ok: ${message}`);
}

function runBackfill(...args) {
  const out = execFileSync('node', [ARTIFACT, ...args], {
    env: { ...process.env },
    encoding: 'utf8',
  });
  process.stdout.write(out);
  return out;
}

async function pendingFixtures() {
  const r = await query(
    'SELECT count(*)::int AS n FROM "Ticket" WHERE id = ANY($1) AND "descriptionText" IS NULL',
    [ids],
  );
  return r.rows[0].n;
}
async function pendingTotal() {
  const r = await query('SELECT count(*)::int AS n FROM "Ticket" WHERE "descriptionText" IS NULL');
  return r.rows[0].n;
}
async function texts() {
  const r = await query(
    `SELECT id, "descriptionText" AS t, ("updatedAt" = '2020-01-01 00:00:00'::timestamp) AS frozen FROM "Ticket" WHERE id = ANY($1) ORDER BY id`,
    [ids],
  );
  return r.rows;
}

try {
  await query('DELETE FROM "Ticket" WHERE id LIKE $1', [`${PREFIX}%`]);
  const base = await query('SELECT count(*)::int AS n FROM "Ticket"');
  check(base.rows[0].n > 0, 'há ao menos um ticket (seed) para copiar as chaves');

  // Linhas legadas: copiadas de um ticket existente (mesmas colunas e chaves),
  // com descrição própria e descriptionText nulo.
  await withClient(async (c) => {
    await c.query('DROP TABLE IF EXISTS pg_temp.bf_tpl');
    await c.query('CREATE TEMP TABLE bf_tpl AS SELECT * FROM "Ticket" LIMIT 1');
    for (const f of FIXTURES) {
      await c.query(
        `UPDATE bf_tpl SET id = $1, protocol = $2, description = $3, "descriptionText" = NULL`,
        [`${PREFIX}${f.n}`, `${PREFIX}${f.n}`, f.description],
      );
      await c.query('INSERT INTO "Ticket" SELECT * FROM bf_tpl');
    }
  });
  // Congela updatedAt para provar que o backfill não o toca.
  await query(`UPDATE "Ticket" SET "updatedAt" = '2020-01-01 00:00:00' WHERE id = ANY($1)`, [ids]);
  // O ticket do seed (gravado pelo código novo) também vira legado.
  await query(`UPDATE "Ticket" SET "descriptionText" = NULL WHERE id NOT LIKE $1`, [`${PREFIX}%`]);

  const pendingBefore = await pendingTotal();
  check(pendingBefore >= FIXTURES.length, `há ${pendingBefore} linhas pendentes antes do backfill`);

  // --dry-run: não escreve.
  const dry = runBackfill('--dry-run');
  check(/dry-run/i.test(dry) && dry.includes(`pendentes = ${pendingBefore}`), 'dry-run imprime as contagens');
  check((await pendingTotal()) === pendingBefore, 'dry-run não escreveu nada');

  // Execução real em lotes pequenos.
  const run = runBackfill('--batch-size', '2');
  check(/restantes = 0/.test(run), 'execução termina com restantes = 0');
  check((await pendingTotal()) === 0, 'nenhuma linha com descriptionText nulo');
  const rows = await texts();
  for (const f of FIXTURES) {
    const row = rows.find((r) => r.id === `${PREFIX}${f.n}`);
    check(row && row.t === f.expected, `fixture ${f.n} -> ${JSON.stringify(f.expected)}`);
    check(row.frozen === true, `fixture ${f.n}: updatedAt intacto`);
  }

  // Idempotência.
  const again = runBackfill();
  check(/processados = 0/.test(again) && /restantes = 0/.test(again), 'segunda execução não processa nada');

  // --all corrige defasagem e não deixa nulo.
  await query(`UPDATE "Ticket" SET "descriptionText" = 'defasado' WHERE id = ANY($1)`, [ids]);
  const all = runBackfill('--all', '--batch-size', '3');
  check(/restantes = 0/.test(all), '--all termina com restantes = 0');
  const fixed = await texts();
  for (const f of FIXTURES) {
    check(fixed.find((r) => r.id === `${PREFIX}${f.n}`).t === f.expected, `--all recalculou a fixture ${f.n}`);
  }
  console.log('backfill (banco real): tudo verde');
} finally {
  await query('DELETE FROM "Ticket" WHERE id LIKE $1', [`${PREFIX}%`]).catch(() => undefined);
}
