import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Role } from '@prisma/client';
import { DEFAULT_PERMISSION_GROUPS, GROUP_ONLY_KEYS, ROLE_GROUP_NAME } from './default-permission-groups';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from './permission-catalog';

/**
 * Fase 1a do tracker #523 (#532): catálogo de permissões novas e migração dos
 * grupos padrão. Aditivo: nenhuma chave nova é consultada ainda por código de
 * decisão; cada grupo padrão mantém exatamente o que já podia (matriz da Fase 0).
 */

const NEW_KEYS = [
  'VIEW_TEAM_MEMBER_NAMES',
  'VIEW_REQUESTER_CONTACT_INFO',
  'POST_INTERNAL_NOTES',
  'ASSIGN_TICKETS',
  'OPEN_TICKETS_ON_BEHALF',
  'USE_INTERNAL_SERVICE_DESKS',
  'LAUNCH_WORKLOG_ON_BEHALF',
  'DELETE_ANY_WORKLOG',
  'AUTHORIZE_WORKLOG_BONUS',
  'SET_WORKLOG_MANUAL_VALUE',
  'VIEW_CONTRACT_FINANCIALS',
  'VIEW_COMMERCIAL_RESULT',
  'DELETE_KNOWLEDGE_ARTICLES',
  'VIEW_ALL_KNOWLEDGE_ARTICLES',
];

/** Cópia literal das listas dos grupos padrão ANTES da Fase 1a (exceto ADMIN, derivado do catálogo). */
const PREVIOUS: Record<Exclude<Role, 'ADMIN'>, string[]> = {
  [Role.AGENT_MASTER]: [
    'VIEW_AND_OPEN_TICKETS', 'CREATE_EDIT_WORKLOGS', 'EDIT_TICKETS', 'EDIT_ALL_WORKLOGS',
    'VIEW_ADD_INTERNAL_COMMUNICATION', 'MANAGE_KNOWLEDGE_BASE', 'PAUSE_RESUME_SLA', 'ACCESS_CHAT',
    'VIEW_AGENT_REPORTS', 'VIEW_USERS_IN_AGENT_REPORTS', 'VIEW_ALL_SCHEDULES', 'CREATE_TICKET_SCHEDULING',
    'VIEW_PASSWORD_VAULT', 'VIEW_CONTRACTS_ADMIN', 'MANAGE_CHECKLISTS', 'ADD_SLA_TIME',
    'MANAGE_SERVICE_CATALOGS', 'MANAGE_SERVICE_DESKS',
  ],
  [Role.AGENT]: [
    'VIEW_AND_OPEN_TICKETS', 'CREATE_EDIT_WORKLOGS', 'EDIT_TICKETS', 'VIEW_ADD_INTERNAL_COMMUNICATION',
    'ACCESS_CHAT', 'VIEW_ALL_SCHEDULES', 'CREATE_TICKET_SCHEDULING', 'VIEW_PASSWORD_VAULT',
    'MANAGE_CHECKLISTS', 'MANAGE_KNOWLEDGE_BASE', 'VIEW_AGENT_REPORTS', 'VIEW_CONTRACTS_ADMIN',
    'ADD_SLA_TIME', 'MANAGE_SERVICE_CATALOGS',
  ],
  [Role.CLIENT_MASTER]: [
    'ACCESS_CLIENT_PORTAL', 'VIEW_ALL_CLIENT_TICKETS', 'UPLOAD_TICKET_ATTACHMENTS', 'VIEW_ALL_SCHEDULES',
    'VIEW_CONTRACTS_CLIENT', 'VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_LAST_30_DAYS_TICKETS_WIDGET',
    'VIEW_WORKLOG_INFO',
  ],
  [Role.CLIENT]: ['ACCESS_CLIENT_PORTAL', 'UPLOAD_TICKET_ATTACHMENTS', 'VIEW_LAST_30_DAYS_TICKETS_WIDGET'],
};

const TEAM_KEYS = [
  'VIEW_TEAM_MEMBER_NAMES',
  'VIEW_REQUESTER_CONTACT_INFO',
  'POST_INTERNAL_NOTES',
  'ASSIGN_TICKETS',
  'USE_INTERNAL_SERVICE_DESKS',
];

/** O que cada perfil já podia fazer hoje, expresso nas chaves novas (decisão do dono: CLIENT_MASTER sem nomes da equipe nem notas internas). */
const NEW_FOR_ROLE: Record<Role, string[]> = {
  [Role.ADMIN]: NEW_KEYS,
  [Role.AGENT_MASTER]: TEAM_KEYS,
  [Role.AGENT]: TEAM_KEYS,
  [Role.CLIENT_MASTER]: ['VIEW_CONTRACT_FINANCIALS'],
  [Role.CLIENT]: [],
};

const sorted = (list: readonly string[]) => [...list].sort();

describe('Fase 1a: catálogo (#532)', () => {
  it.each(NEW_KEYS)('%s está no catálogo, uma vez só, com rótulo e categoria', (key) => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === key);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label.trim().length).toBeGreaterThan(3);
    expect(entries[0]?.category).toBeTruthy();
  });

  it('nenhuma chave nova é GROUP_ONLY (todas valem para o grupo Administrador)', () => {
    for (const key of NEW_KEYS) expect(GROUP_ONLY_KEYS).not.toContain(key);
  });
});

describe('Fase 1a: grupos padrão = conjunto anterior + novas chaves equivalentes (#532)', () => {
  it.each([Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const)('%s', (role) => {
    expect(sorted(DEFAULT_PERMISSION_GROUPS[role].permissions)).toEqual(sorted([...PREVIOUS[role], ...NEW_FOR_ROLE[role]]));
  });

  it('ADMIN recebe todas as chaves do catálogo exceto GROUP_ONLY_KEYS (sem bypass futuro)', () => {
    const expected = PERMISSION_KEYS.filter((k) => !GROUP_ONLY_KEYS.includes(k));
    expect(sorted(DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions)).toEqual(sorted(expected));
    for (const key of NEW_KEYS) expect(DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions).toContain(key);
  });

  it('CLIENT_MASTER e CLIENT não recebem VIEW_TEAM_MEMBER_NAMES nem POST_INTERNAL_NOTES (decisão do dono)', () => {
    for (const role of [Role.CLIENT_MASTER, Role.CLIENT]) {
      expect(DEFAULT_PERMISSION_GROUPS[role].permissions).not.toContain('VIEW_TEAM_MEMBER_NAMES');
      expect(DEFAULT_PERMISSION_GROUPS[role].permissions).not.toContain('POST_INTERNAL_NOTES');
    }
  });

  it('AGENT e AGENT_MASTER não ganham o que era só do ADMIN (financeiro, apontamento de outro, artigos)', () => {
    const adminOnly = NEW_KEYS.filter((k) => !TEAM_KEYS.includes(k));
    for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
      for (const key of adminOnly) {
        expect({ role, key, has: DEFAULT_PERMISSION_GROUPS[role].permissions.includes(key) }).toEqual({ role, key, has: false });
      }
    }
  });
});

const migrationsDir = resolve(__dirname, '../../prisma/migrations');

function findMigration(): { name: string; sql: string } | undefined {
  if (!existsSync(migrationsDir)) return undefined;
  return readdirSync(migrationsDir)
    .map((name) => ({ name, file: join(migrationsDir, name, 'migration.sql') }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, 'utf8') }))
    .find(({ sql }) => sql.includes('VIEW_TEAM_MEMBER_NAMES'));
}

function statements(sql: string): string[] {
  return sql.split(/;\s*\r?\n/);
}

/** Chaves que o UPDATE do grupo `name` acrescenta, lidas do SQL. */
function keysAddedTo(sql: string, name: string): string[] {
  const block = statements(sql).find((stmt) => stmt.includes(`"name" = '${name}'`));
  if (!block) return [];
  const first = [...block.matchAll(/ARRAY\[([^\]]*)\]/g)][0]?.[1] ?? '';
  return [...first.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
}

describe('Fase 1a: migração idempotente dos grupos padrão (#532)', () => {
  it('existe uma migração que acrescenta as chaves novas', () => {
    expect(findMigration()?.name).toMatch(/^\d{14}_/);
  });

  it.each(Object.values(Role))('acrescenta ao grupo padrão de %s exatamente as chaves novas esperadas', (role) => {
    const sql = findMigration()?.sql ?? '';
    expect(sql).not.toBe('');
    expect(sorted(keysAddedTo(sql, ROLE_GROUP_NAME[role]))).toEqual(sorted(NEW_FOR_ROLE[role]));
  });

  it('é idempotente (só atualiza quando falta chave) e nunca remove permissão', () => {
    const sql = findMigration()?.sql ?? '';
    expect(sql).not.toBe('');
    const updates = statements(sql).filter((stmt) => /\bUPDATE\b/i.test(stmt));
    expect(updates.length).toBeGreaterThan(0);
    for (const stmt of updates) {
      expect(stmt).toMatch(/NOT \("permissions" @> ARRAY\[/);
    }
    expect(sql).not.toMatch(/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b/i);
  });

  it('cada UPDATE acrescenta ao array existente (SET "permissions" = "permissions" || ARRAY(...)), nunca o substitui', () => {
    const updates = statements(findMigration()?.sql ?? '').filter((stmt) => /\bUPDATE\b/i.test(stmt));
    expect(updates).toHaveLength(4);
    for (const stmt of updates) {
      expect(stmt).toMatch(/SET "permissions" = "permissions" \|\| ARRAY\(/);
    }
  });

  it('em cada UPDATE a lista da guarda @> é igual, como conjunto, à lista do unnest', () => {
    const updates = statements(findMigration()?.sql ?? '').filter((stmt) => /\bUPDATE\b/i.test(stmt));
    expect(updates).toHaveLength(4);
    const keys = (list: string) => sorted([...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string));
    for (const stmt of updates) {
      const unnest = /unnest\(ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
      const guard = /@> ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
      expect(keys(unnest).length).toBeGreaterThan(0);
      expect(keys(guard)).toEqual(keys(unnest));
    }
  });
});
