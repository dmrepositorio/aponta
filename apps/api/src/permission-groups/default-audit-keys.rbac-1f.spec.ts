import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Role } from '@prisma/client';
import {
  DEFAULT_GROUP_KEY,
  DEFAULT_PERMISSION_GROUPS,
  GROUP_ONLY_KEYS,
} from './default-permission-groups';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from './permission-catalog';

/**
 * Fase 1f do tracker #523 (#566): chaves complementares encontradas na Fase 2.
 * AUDIT_WORKLOGS (auditoria de apontamentos por ticket, hoje ADMIN em
 * worklogs.service.ts auditByTicket) entra no catálogo e só no grupo Administrador.
 * Migração aditiva e idempotente. Comportamento efetivo inalterado: nenhum código de
 * decisão consulta a chave ainda.
 */

const KEY = 'AUDIT_WORKLOGS';
const ADDED_FOR_ROLE: Record<Role, string[]> = {
  [Role.ADMIN]: [KEY],
  [Role.AGENT_MASTER]: [],
  [Role.AGENT]: [],
  [Role.CLIENT_MASTER]: [],
  [Role.CLIENT]: [],
};

const sorted = (list: readonly string[]) => [...list].sort();

describe('Fase 1f: catálogo (#566)', () => {
  it('AUDIT_WORKLOGS está no catálogo, uma vez só, com rótulo e categoria', () => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === KEY);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label.trim().length).toBeGreaterThan(3);
    expect(entries[0]?.category).toBeTruthy();
  });

  it('AUDIT_WORKLOGS não é GROUP_ONLY (vale para o grupo Administrador)', () => {
    expect(GROUP_ONLY_KEYS).not.toContain(KEY);
  });
});

describe('Fase 1f: grupos padrão (#566)', () => {
  it.each(Object.values(Role))('%s tem AUDIT_WORKLOGS só se for o Administrador', (role) => {
    const has = DEFAULT_PERMISSION_GROUPS[role].permissions.includes(KEY);
    expect({ role, has }).toEqual({ role, has: ADDED_FOR_ROLE[role].includes(KEY) });
  });

  it('ADMIN continua com todo o catálogo exceto GROUP_ONLY_KEYS', () => {
    const expected = PERMISSION_KEYS.filter((k) => !GROUP_ONLY_KEYS.includes(k));
    expect(sorted(DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions)).toEqual(sorted(expected));
  });

  it('nenhum grupo padrão repete chave', () => {
    for (const role of Object.values(Role)) {
      const list = DEFAULT_PERMISSION_GROUPS[role].permissions;
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

const migrationsDir = resolve(__dirname, '../../prisma/migrations');

function findMigration(): { name: string; sql: string } | undefined {
  if (!existsSync(migrationsDir)) return undefined;
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_rbac_1f_/.test(name))
    .map((name) => ({ name, file: join(migrationsDir, name, 'migration.sql') }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }))[0];
}

const statements = (sql: string) => sql.split(/;\s*\n/).filter((s) => /\bUPDATE\b/i.test(s));
const keysIn = (list: string) => [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
const defaultKeyOf = (stmt: string) => /WHERE "defaultKey" = '([a-z-]+)'/.exec(stmt)?.[1];
const unnestOf = (stmt: string) => /unnest\(ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
const guardOf = (stmt: string) => /NOT \("permissions" @> ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';

describe('Fase 1f: migração aditiva e idempotente (#566)', () => {
  const sql = () => findMigration()?.sql ?? '';

  it('existe uma migração rbac_1f', () => {
    expect(findMigration()?.name).toMatch(/^\d{14}_rbac_1f_/);
  });

  it('é posterior à migração do 1e', () => {
    expect((findMigration()?.name ?? '') > '20261128120000_rbac_1e_default_group_scope_keys').toBe(true);
  });

  it('tem um UPDATE só, no grupo Administrador, localizado por defaultKey e não por nome', () => {
    expect(sql()).not.toBe('');
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(defaultKeyOf(updates[0] as string)).toBe(DEFAULT_GROUP_KEY[Role.ADMIN]);
    expect(updates[0]).not.toMatch(/"name"\s*=/);
  });

  it('o UPDATE acrescenta exatamente AUDIT_WORKLOGS', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(sorted(keysIn(unnestOf(updates[0] as string)))).toEqual([KEY]);
  });

  it('cada UPDATE acrescenta ao array existente (SET "permissions" = "permissions" || ARRAY(...)), só o que falta', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    for (const stmt of updates) {
      expect(stmt).toMatch(/SET "permissions" = "permissions" \|\| ARRAY\(/);
      expect(stmt).toMatch(/WHERE k <> ALL\("permissions"\)/);
    }
  });

  it('a lista da guarda NOT (@>) é igual, como conjunto, à lista do unnest', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    for (const stmt of updates) {
      expect(keysIn(unnestOf(stmt)).length).toBeGreaterThan(0);
      expect(sorted(keysIn(guardOf(stmt)))).toEqual(sorted(keysIn(unnestOf(stmt))));
    }
  });

  it('nunca remove, apaga ou insere e atualiza o updatedAt', () => {
    expect(sql()).not.toBe('');
    expect(sql()).not.toMatch(/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b|\bALTER\b/i);
    for (const stmt of statements(sql())) expect(stmt).toMatch(/"updatedAt" = CURRENT_TIMESTAMP/);
  });

  it('as chaves da migração estão no grupo padrão do código (migração = seed)', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    for (const key of keysIn(unnestOf(updates[0] as string))) {
      expect(DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions).toContain(key);
    }
  });
});
