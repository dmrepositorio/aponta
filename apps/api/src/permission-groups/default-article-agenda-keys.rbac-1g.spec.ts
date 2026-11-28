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
 * Fase 1g do tracker #523 (#571): chaves complementares do lote 2a5 (artigos e agenda).
 *  - EDIT_ALL_KNOWLEDGE_ARTICLES: só Administrador.
 *  - VIEW_OTHER_USERS_APPOINTMENTS: Administrador e Gerente de Atendimento.
 *  - VIEW_INTERNAL_ABSENCES: Administrador, Gerente e Atendente.
 * Migração aditiva e idempotente. Comportamento efetivo inalterado: nenhum código de
 * decisão consulta as chaves ainda.
 */

const EDIT_ALL_ARTICLES = 'EDIT_ALL_KNOWLEDGE_ARTICLES';
const VIEW_OTHER_APPOINTMENTS = 'VIEW_OTHER_USERS_APPOINTMENTS';
const VIEW_ABSENCES = 'VIEW_INTERNAL_ABSENCES';
const ALL_KEYS = [EDIT_ALL_ARTICLES, VIEW_OTHER_APPOINTMENTS, VIEW_ABSENCES];

const ADDED_FOR_ROLE: Record<Role, string[]> = {
  [Role.ADMIN]: [EDIT_ALL_ARTICLES, VIEW_OTHER_APPOINTMENTS, VIEW_ABSENCES],
  [Role.AGENT_MASTER]: [VIEW_OTHER_APPOINTMENTS, VIEW_ABSENCES],
  [Role.AGENT]: [VIEW_ABSENCES],
  [Role.CLIENT_MASTER]: [],
  [Role.CLIENT]: [],
};
const ROLES_WITH_UPDATE = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT] as const;

const sorted = (list: readonly string[]) => [...list].sort();
const relevant = (permissions: readonly string[]) => permissions.filter((k) => ALL_KEYS.includes(k));

describe('Fase 1g: catálogo (#571)', () => {
  it.each(ALL_KEYS)('%s está no catálogo, uma vez só, com rótulo e categoria', (key) => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === key);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label.trim().length).toBeGreaterThan(3);
    expect(entries[0]?.category).toBeTruthy();
  });

  it('nenhuma das chaves é GROUP_ONLY (valem para o grupo Administrador)', () => {
    for (const key of ALL_KEYS) expect(GROUP_ONLY_KEYS).not.toContain(key);
  });
});

describe('Fase 1g: grupos padrão (#571)', () => {
  it.each(Object.values(Role))('%s tem exatamente as chaves do 1g esperadas', (role) => {
    expect(sorted(relevant(DEFAULT_PERMISSION_GROUPS[role].permissions))).toEqual(sorted(ADDED_FOR_ROLE[role]));
  });

  it('Cliente Master e Cliente não recebem nenhuma das três chaves', () => {
    for (const role of [Role.CLIENT_MASTER, Role.CLIENT]) {
      for (const key of ALL_KEYS) expect(DEFAULT_PERMISSION_GROUPS[role].permissions).not.toContain(key);
    }
  });

  it('Atendente não recebe a agenda de outro usuário nem a edição de todos os artigos', () => {
    expect(DEFAULT_PERMISSION_GROUPS[Role.AGENT].permissions).not.toContain(VIEW_OTHER_APPOINTMENTS);
    expect(DEFAULT_PERMISSION_GROUPS[Role.AGENT].permissions).not.toContain(EDIT_ALL_ARTICLES);
  });

  it('Gerente de Atendimento não recebe a edição de todos os artigos', () => {
    expect(DEFAULT_PERMISSION_GROUPS[Role.AGENT_MASTER].permissions).not.toContain(EDIT_ALL_ARTICLES);
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
    .filter((name) => /^\d{14}_rbac_1g_/.test(name))
    .map((name) => ({ name, file: join(migrationsDir, name, 'migration.sql') }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }))[0];
}

const statements = (sql: string) => sql.split(/;\s*\n/).filter((s) => /\bUPDATE\b/i.test(s));
const keysIn = (list: string) => [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
const defaultKeyOf = (stmt: string) => /WHERE "defaultKey" = '([a-z-]+)'/.exec(stmt)?.[1];
const unnestOf = (stmt: string) => /unnest\(ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
const guardOf = (stmt: string) => /NOT \("permissions" @> ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
const stmtFor = (sql: string, role: Role) => statements(sql).filter((s) => defaultKeyOf(s) === DEFAULT_GROUP_KEY[role]);

/** Todas as regras da migração, em um só lugar: devolve as violações (vazio = correta). */
function violations(sql: string): string[] {
  const out: string[] = [];
  const updates = statements(sql);
  if (updates.length !== ROLES_WITH_UPDATE.length) out.push(`quantidade de UPDATE: ${updates.length}`);
  for (const role of Object.values(Role)) {
    const found = stmtFor(sql, role);
    const expected = ADDED_FOR_ROLE[role];
    if (expected.length === 0) {
      if (found.length !== 0) out.push(`${role} não deveria ter UPDATE`);
      continue;
    }
    if (found.length !== 1) {
      out.push(`${role}: UPDATE por defaultKey = ${found.length}`);
      continue;
    }
    const stmt = found[0] as string;
    if (JSON.stringify(sorted(keysIn(unnestOf(stmt)))) !== JSON.stringify(sorted(expected))) out.push(`${role}: unnest diferente`);
    if (keysIn(guardOf(stmt)).length === 0 || JSON.stringify(sorted(keysIn(guardOf(stmt)))) !== JSON.stringify(sorted(keysIn(unnestOf(stmt))))) {
      out.push(`${role}: guarda diferente do unnest`);
    }
    if (!/SET "permissions" = "permissions" \|\| ARRAY\(/.test(stmt)) out.push(`${role}: SET sem "permissions" ||`);
    if (!/WHERE k <> ALL\("permissions"\)/.test(stmt)) out.push(`${role}: sem WHERE k <> ALL`);
    if (!/AND NOT \("permissions" @> ARRAY\[/.test(stmt)) out.push(`${role}: sem guarda NOT (@>)`);
    if (!/"updatedAt" = CURRENT_TIMESTAMP/.test(stmt)) out.push(`${role}: sem updatedAt`);
    if (/"name"\s*=/.test(stmt)) out.push(`${role}: localizado por nome`);
  }
  if (/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b|\bALTER\b/i.test(sql)) out.push('comando destrutivo ou de inserção');
  return out;
}

/** Aplica `fn` ao UPDATE do grupo do papel e devolve o SQL mutado. */
function mutateStmt(sql: string, role: Role, fn: (stmt: string) => string): string {
  const target = stmtFor(sql, role)[0] ?? '';
  return sql.replace(target, fn(target));
}

const dropLastKey = (list: string) => list.replace(/,\s*'[A-Z_]+'(?=\])/, '').replace(/^ARRAY\['[A-Z_]+'\]/, 'ARRAY[]');

describe('Fase 1g: migração aditiva e idempotente (#571)', () => {
  const sql = () => findMigration()?.sql ?? '';

  it('existe uma migração rbac_1g', () => {
    expect(findMigration()?.name).toMatch(/^\d{14}_rbac_1g_/);
  });

  it('é posterior à migração do 1f', () => {
    expect((findMigration()?.name ?? '') > '20261128130000_rbac_1f_audit_worklogs').toBe(true);
  });

  it('tem um UPDATE por grupo que recebe chave (Administrador, Gerente e Atendente), por defaultKey e não por nome', () => {
    expect(sql()).not.toBe('');
    const updates = statements(sql());
    expect(updates).toHaveLength(ROLES_WITH_UPDATE.length);
    expect(sorted(updates.map((s) => defaultKeyOf(s) ?? 'ausente'))).toEqual(sorted(ROLES_WITH_UPDATE.map((r) => DEFAULT_GROUP_KEY[r])));
    for (const stmt of updates) expect(stmt).not.toMatch(/"name"\s*=/);
  });

  it.each(ROLES_WITH_UPDATE)('o UPDATE do grupo de %s acrescenta exatamente as chaves esperadas', (role) => {
    const found = stmtFor(sql(), role);
    expect(found).toHaveLength(1);
    expect(sorted(keysIn(unnestOf(found[0] as string)))).toEqual(sorted(ADDED_FOR_ROLE[role]));
  });

  it('Cliente Master e Cliente não têm UPDATE', () => {
    for (const role of [Role.CLIENT_MASTER, Role.CLIENT]) expect(stmtFor(sql(), role)).toHaveLength(0);
  });

  it('cada UPDATE acrescenta ao array existente (SET "permissions" = "permissions" || ARRAY(...)), só o que falta', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(ROLES_WITH_UPDATE.length);
    for (const stmt of updates) {
      expect(stmt).toMatch(/SET "permissions" = "permissions" \|\| ARRAY\(/);
      expect(stmt).toMatch(/WHERE k <> ALL\("permissions"\)/);
    }
  });

  it('a lista da guarda NOT (@>) é igual, como conjunto, à lista do unnest em cada UPDATE', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(ROLES_WITH_UPDATE.length);
    for (const stmt of updates) {
      expect(keysIn(unnestOf(stmt)).length).toBeGreaterThan(0);
      expect(sorted(keysIn(guardOf(stmt)))).toEqual(sorted(keysIn(unnestOf(stmt))));
    }
  });

  it('nunca remove, apaga ou insere e atualiza o updatedAt', () => {
    expect(sql()).not.toBe('');
    expect(sql()).not.toMatch(/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b|\bALTER\b/i);
    const updates = statements(sql());
    expect(updates).toHaveLength(ROLES_WITH_UPDATE.length);
    for (const stmt of updates) expect(stmt).toMatch(/"updatedAt" = CURRENT_TIMESTAMP/);
  });

  it('as chaves de cada UPDATE estão no grupo padrão do código (migração = seed)', () => {
    for (const role of ROLES_WITH_UPDATE) {
      const found = stmtFor(sql(), role);
      expect(found).toHaveLength(1);
      for (const key of keysIn(unnestOf(found[0] as string))) {
        expect(DEFAULT_PERMISSION_GROUPS[role].permissions).toContain(key);
      }
    }
  });
});

describe('Fase 1g: o validador pega mutações da migração (#571)', () => {
  const real = () => findMigration()?.sql ?? '';

  it('o SQL real não tem violação', () => {
    expect(real()).not.toBe('');
    expect(violations(real())).toEqual([]);
  });

  it.each(ROLES_WITH_UPDATE)('mutação: SET sem "permissions" || no UPDATE de %s', (role) => {
    const mutated = mutateStmt(real(), role, (s) => s.replace('"permissions" || ARRAY(', 'ARRAY('));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it.each(ROLES_WITH_UPDATE)('mutação: guarda encurtada no UPDATE de %s', (role) => {
    const mutated = mutateStmt(real(), role, (s) =>
      s.replace(/(NOT \("permissions" @> )(ARRAY\[[^\]]*\])/, (_m, a: string, b: string) => `${a}${dropLastKey(b)}`),
    );
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it.each(ROLES_WITH_UPDATE)('mutação: lista do unnest encurtada no UPDATE de %s', (role) => {
    const mutated = mutateStmt(real(), role, (s) =>
      s.replace(/(unnest\()(ARRAY\[[^\]]*\])/, (_m, a: string, b: string) => `${a}${dropLastKey(b)}`),
    );
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it.each(ROLES_WITH_UPDATE)('mutação: guarda e unnest encurtados juntos no UPDATE de %s (iguais entre si, mas incompletos)', (role) => {
    const mutated = mutateStmt(real(), role, (s) =>
      s.replace(/(unnest\(|@> )(ARRAY\[[^\]]*\])/g, (_m, a: string, b: string) => `${a}${dropLastKey(b)}`),
    );
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it.each(ROLES_WITH_UPDATE)('mutação: UPDATE de %s sem o WHERE k <> ALL', (role) => {
    const mutated = mutateStmt(real(), role, (s) => s.replace(' WHERE k <> ALL("permissions")', ''));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it.each(ROLES_WITH_UPDATE)('mutação: UPDATE de %s sem o updatedAt', (role) => {
    const mutated = mutateStmt(real(), role, (s) => s.replace(/,\s*"updatedAt" = CURRENT_TIMESTAMP/, ''));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it('mutação: guarda sem o NOT no UPDATE do Administrador', () => {
    const mutated = mutateStmt(real(), Role.ADMIN, (s) => s.replace('NOT ("permissions" @>', '("permissions" @>'));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it('mutação: UPDATE do Administrador localizado por nome', () => {
    const mutated = mutateStmt(real(), Role.ADMIN, (s) => s.replace(`"defaultKey" = 'default-admin'`, `"name" = 'Administrador'`));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it('mutação: UPDATE do Atendente aponta para o defaultKey do Gerente', () => {
    const mutated = mutateStmt(real(), Role.AGENT, (s) => s.replace(`'default-agent'`, `'default-agent-master'`));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it('mutação: chave extra no unnest e na guarda do Atendente (VIEW_OTHER_USERS_APPOINTMENTS)', () => {
    const mutated = mutateStmt(real(), Role.AGENT, (s) => s.replace(/ARRAY\['VIEW_INTERNAL_ABSENCES'\]/g, `ARRAY['VIEW_INTERNAL_ABSENCES', 'VIEW_OTHER_USERS_APPOINTMENTS']`));
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it('mutação: UPDATE a mais para o Cliente Master', () => {
    const mutated = `${real().trimEnd()}\n\nUPDATE "PermissionGroup"\nSET "permissions" = "permissions" || ARRAY(\n      SELECT k FROM unnest(ARRAY['VIEW_INTERNAL_ABSENCES']::text[]) AS k WHERE k <> ALL("permissions")\n    ),\n    "updatedAt" = CURRENT_TIMESTAMP\nWHERE "defaultKey" = 'default-client-master'\n  AND NOT ("permissions" @> ARRAY['VIEW_INTERNAL_ABSENCES']::text[]);\n`;
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it('mutação: UPDATE do Atendente removido', () => {
    const target = stmtFor(real(), Role.AGENT)[0] ?? '';
    const mutated = real().replace(`${target};`, '');
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  });

  it.each(['DELETE FROM "PermissionGroup" WHERE false;', 'DROP TABLE "Foo";', `INSERT INTO "PermissionGroup" ("id") VALUES ('x');`, `UPDATE "PermissionGroup" SET "permissions" = array_remove("permissions", 'X');`])(
    'mutação: comando proibido acrescentado (%s)',
    (extra) => {
      const mutated = `${real().trimEnd()}\n\n${extra}\n`;
      expect(violations(mutated).length).toBeGreaterThan(0);
    },
  );
});
