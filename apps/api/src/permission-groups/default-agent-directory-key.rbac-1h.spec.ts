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
 * Fase 1h do tracker #523 (#577): VIEW_AGENT_DIRECTORY (lista de agentes sem escopo de mesa,
 * hoje `currentUser.role === ADMIN` em UsersService.findAgents) entra no catálogo e só no grupo
 * Administrador. MANAGE_SERVICE_DESKS não serve: o Gerente de Atendimento também a tem e é
 * escopado. Migração aditiva e idempotente. Comportamento efetivo inalterado: nenhum código de
 * decisão consulta a chave ainda.
 */

const KEY = 'VIEW_AGENT_DIRECTORY';
const ADDED_FOR_ROLE: Record<Role, string[]> = {
  [Role.ADMIN]: [KEY],
  [Role.AGENT_MASTER]: [],
  [Role.AGENT]: [],
  [Role.CLIENT_MASTER]: [],
  [Role.CLIENT]: [],
};

const sorted = (list: readonly string[]) => [...list].sort();

describe('Fase 1h: catálogo (#577)', () => {
  it('VIEW_AGENT_DIRECTORY está no catálogo, uma vez só, com rótulo e categoria', () => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === KEY);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label.trim().length).toBeGreaterThan(3);
    expect(entries[0]?.category).toBeTruthy();
  });

  it('VIEW_AGENT_DIRECTORY não é GROUP_ONLY (vale para o grupo Administrador)', () => {
    expect(GROUP_ONLY_KEYS).not.toContain(KEY);
  });
});

describe('Fase 1h: grupos padrão (#577)', () => {
  it.each(Object.values(Role))('%s tem VIEW_AGENT_DIRECTORY só se for o Administrador', (role) => {
    const has = DEFAULT_PERMISSION_GROUPS[role].permissions.includes(KEY);
    expect({ role, has }).toEqual({ role, has: ADDED_FOR_ROLE[role].includes(KEY) });
  });

  it('Gerente de Atendimento (que tem MANAGE_SERVICE_DESKS) não recebe a chave', () => {
    expect(DEFAULT_PERMISSION_GROUPS[Role.AGENT_MASTER].permissions).toContain('MANAGE_SERVICE_DESKS');
    expect(DEFAULT_PERMISSION_GROUPS[Role.AGENT_MASTER].permissions).not.toContain(KEY);
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
    .filter((name) => /^\d{14}_rbac_1h_/.test(name))
    .map((name) => ({ name, file: join(migrationsDir, name, 'migration.sql') }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }))[0];
}

const statements = (sql: string) => sql.split(/;\s*\n/).filter((s) => /\bUPDATE\b/i.test(s));
const keysIn = (list: string) => [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
const defaultKeyOf = (stmt: string) => /WHERE "defaultKey" = '([a-z-]+)'/.exec(stmt)?.[1];
const unnestOf = (stmt: string) => /unnest\(ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
const guardOf = (stmt: string) => /NOT \("permissions" @> ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';

/** Todas as regras da migração, em um só lugar: devolve as violações (vazio = correta). */
function violations(sql: string): string[] {
  const out: string[] = [];
  const updates = statements(sql);
  if (updates.length !== 1) out.push(`quantidade de UPDATE: ${updates.length}`);
  const stmt = updates[0] ?? '';
  if (defaultKeyOf(stmt) !== DEFAULT_GROUP_KEY[Role.ADMIN]) out.push('UPDATE não é do Administrador por defaultKey');
  if (JSON.stringify(sorted(keysIn(unnestOf(stmt)))) !== JSON.stringify([KEY])) out.push('unnest diferente de VIEW_AGENT_DIRECTORY');
  if (JSON.stringify(sorted(keysIn(guardOf(stmt)))) !== JSON.stringify(sorted(keysIn(unnestOf(stmt))))) out.push('guarda diferente do unnest');
  if (!/SET "permissions" = "permissions" \|\| ARRAY\(/.test(stmt)) out.push('SET sem "permissions" ||');
  if (!/WHERE k <> ALL\("permissions"\)/.test(stmt)) out.push('sem WHERE k <> ALL');
  if (!/AND NOT \("permissions" @> ARRAY\[/.test(stmt)) out.push('sem guarda NOT (@>)');
  if (!/"updatedAt" = CURRENT_TIMESTAMP/.test(stmt)) out.push('sem updatedAt');
  if (/"name"\s*=/.test(stmt)) out.push('localizado por nome');
  if (/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b|\bALTER\b/i.test(sql)) out.push('comando destrutivo ou de inserção');
  return out;
}

describe('Fase 1h: migração aditiva e idempotente (#577)', () => {
  const sql = () => findMigration()?.sql ?? '';

  it('existe uma migração rbac_1h', () => {
    expect(findMigration()?.name).toMatch(/^\d{14}_rbac_1h_/);
  });

  it('é posterior à migração do 1g', () => {
    expect((findMigration()?.name ?? '') > '20261128140000_rbac_1g_article_agenda_keys').toBe(true);
  });

  it('tem um UPDATE só, no grupo Administrador, localizado por defaultKey e não por nome', () => {
    expect(sql()).not.toBe('');
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(defaultKeyOf(updates[0] as string)).toBe(DEFAULT_GROUP_KEY[Role.ADMIN]);
    expect(updates[0]).not.toMatch(/"name"\s*=/);
  });

  it('o UPDATE acrescenta exatamente VIEW_AGENT_DIRECTORY', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(sorted(keysIn(unnestOf(updates[0] as string)))).toEqual([KEY]);
  });

  it('o UPDATE acrescenta ao array existente (SET "permissions" = "permissions" || ARRAY(...)), só o que falta', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/SET "permissions" = "permissions" \|\| ARRAY\(/);
    expect(updates[0]).toMatch(/WHERE k <> ALL\("permissions"\)/);
  });

  it('a lista da guarda NOT (@>) é igual, como conjunto, à lista do unnest', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(keysIn(unnestOf(updates[0] as string)).length).toBeGreaterThan(0);
    expect(sorted(keysIn(guardOf(updates[0] as string)))).toEqual(sorted(keysIn(unnestOf(updates[0] as string))));
  });

  it('nunca remove, apaga ou insere e atualiza o updatedAt', () => {
    expect(sql()).not.toBe('');
    expect(sql()).not.toMatch(/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b|\bALTER\b/i);
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/"updatedAt" = CURRENT_TIMESTAMP/);
  });

  it('a chave da migração está no grupo padrão do código (migração = seed)', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(1);
    for (const key of keysIn(unnestOf(updates[0] as string))) {
      expect(DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions).toContain(key);
    }
  });
});

describe('Fase 1h: o validador pega mutações da migração (#577)', () => {
  const real = () => findMigration()?.sql ?? '';
  const mutate = (fn: (stmt: string) => string) => {
    const target = statements(real())[0] ?? '';
    return real().replace(target, fn(target));
  };
  const expectCaught = (mutated: string) => {
    expect(mutated).not.toBe(real());
    expect(violations(mutated).length).toBeGreaterThan(0);
  };

  it('o SQL real não tem violação', () => {
    expect(real()).not.toBe('');
    expect(violations(real())).toEqual([]);
  });

  it('mutação: SET sem "permissions" ||', () => {
    expectCaught(mutate((s) => s.replace('"permissions" || ARRAY(', 'ARRAY(')));
  });

  it('mutação: guarda encurtada (lista vazia)', () => {
    expectCaught(mutate((s) => s.replace(/(NOT \("permissions" @> )ARRAY\[[^\]]*\]/, '$1ARRAY[]')));
  });

  it('mutação: guarda com outra chave', () => {
    expectCaught(mutate((s) => s.replace(/(NOT \("permissions" @> ARRAY\[)'[A-Z_]+'/, "$1'MANAGE_SERVICE_DESKS'")));
  });

  it('mutação: lista do unnest vazia', () => {
    expectCaught(mutate((s) => s.replace(/(unnest\()ARRAY\[[^\]]*\]/, '$1ARRAY[]')));
  });

  it('mutação: guarda e unnest esvaziados juntos (iguais entre si, mas incompletos)', () => {
    expectCaught(mutate((s) => s.replace(/(unnest\(|@> )ARRAY\[[^\]]*\]/g, '$1ARRAY[]')));
  });

  it('mutação: unnest e guarda trocados juntos por outra chave (iguais entre si)', () => {
    expectCaught(mutate((s) => s.replace(/ARRAY\['VIEW_AGENT_DIRECTORY'\]/g, "ARRAY['MANAGE_SERVICE_DESKS']")));
  });

  it('mutação: chave extra no unnest e na guarda', () => {
    expectCaught(mutate((s) => s.replace(/ARRAY\['VIEW_AGENT_DIRECTORY'\]/g, "ARRAY['VIEW_AGENT_DIRECTORY', 'MANAGE_SERVICE_DESKS']")));
  });

  it('mutação: UPDATE sem o WHERE k <> ALL', () => {
    expectCaught(mutate((s) => s.replace(' WHERE k <> ALL("permissions")', '')));
  });

  it('mutação: UPDATE sem o updatedAt', () => {
    expectCaught(mutate((s) => s.replace(/,\s*"updatedAt" = CURRENT_TIMESTAMP/, '')));
  });

  it('mutação: guarda sem o NOT', () => {
    expectCaught(mutate((s) => s.replace('NOT ("permissions" @>', '("permissions" @>')));
  });

  it('mutação: sem a guarda inteira', () => {
    expectCaught(mutate((s) => s.replace(/\s*AND NOT \("permissions" @> ARRAY\[[^\]]*\]::text\[\]\)/, '')));
  });

  it('mutação: localizado por nome', () => {
    expectCaught(mutate((s) => s.replace(`"defaultKey" = 'default-admin'`, `"name" = 'Administrador'`)));
  });

  it('mutação: defaultKey do Gerente de Atendimento', () => {
    expectCaught(mutate((s) => s.replace(`'default-admin'`, `'default-agent-master'`)));
  });

  it('mutação: UPDATE sem WHERE por defaultKey (atinge todos os grupos)', () => {
    expectCaught(mutate((s) => s.replace(/WHERE "defaultKey" = 'default-admin'\n\s*AND /, 'WHERE ')));
  });

  it('mutação: UPDATE a mais para o Gerente de Atendimento', () => {
    const extra = `UPDATE "PermissionGroup"\nSET "permissions" = "permissions" || ARRAY(\n      SELECT k FROM unnest(ARRAY['VIEW_AGENT_DIRECTORY']::text[]) AS k WHERE k <> ALL("permissions")\n    ),\n    "updatedAt" = CURRENT_TIMESTAMP\nWHERE "defaultKey" = 'default-agent-master'\n  AND NOT ("permissions" @> ARRAY['VIEW_AGENT_DIRECTORY']::text[]);\n`;
    expectCaught(`${real().trimEnd()}\n\n${extra}`);
  });

  it('mutação: UPDATE do Administrador removido', () => {
    const target = statements(real())[0] ?? '';
    expectCaught(real().replace(`${target};`, ''));
  });

  it.each(['DELETE FROM "PermissionGroup" WHERE false;', 'DROP TABLE "Foo";', `INSERT INTO "PermissionGroup" ("id") VALUES ('x');`, `UPDATE "PermissionGroup" SET "permissions" = array_remove("permissions", 'X');`])(
    'mutação: comando proibido acrescentado (%s)',
    (extra) => {
      expect(violations(`${real().trimEnd()}\n\n${extra}\n`).length).toBeGreaterThan(0);
    },
  );
});
