import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Role } from '@prisma/client';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { ScopeResolver, SCOPE_KEYS } from '../core/security/scope-resolver';
import { TenantHelper } from '../core/security/tenant.helper';
import {
  DEFAULT_GROUP_KEY,
  DEFAULT_PERMISSION_GROUPS,
  GROUP_ONLY_KEYS,
} from './default-permission-groups';
import { PERMISSION_CATALOG } from './permission-catalog';

/**
 * Fase 1e do tracker #523 (#540): as chaves de SCOPE_KEYS entram no catálogo e
 * nos grupos padrão (migração aditiva e idempotente). Além delas, AGENT_MASTER e
 * AGENT recebem REMOVE_TICKET_ATTACHMENTS, porque hoje já removem anexo de outra
 * pessoa (attachments.service.ts) e só o Administrador tinha a chave.
 * Comportamento efetivo inalterado: nenhum caller consulta as chaves ainda.
 */

const K = SCOPE_KEYS;
const ALL_SCOPE_KEYS: string[] = Object.values(K);
const REMOVE_ATTACHMENTS = 'REMOVE_TICKET_ATTACHMENTS';

const AGENT_SCOPE = [
  K.TICKETS_DESKS,
  K.SERVICE_DESKS_ASSIGNED,
  K.CREDENTIALS_ALL,
  K.CONTRACTS_DESKS,
  K.APPOINTMENTS_OWN,
];

/** Chaves que a migração acrescenta a cada grupo padrão (escopo da issue #540 + REMOVE_TICKET_ATTACHMENTS dos atendentes). */
const ADDED_FOR_ROLE: Record<Role, string[]> = {
  [Role.ADMIN]: ALL_SCOPE_KEYS,
  [Role.AGENT_MASTER]: [...AGENT_SCOPE, REMOVE_ATTACHMENTS],
  [Role.AGENT]: [...AGENT_SCOPE, REMOVE_ATTACHMENTS],
  [Role.CLIENT_MASTER]: [
    K.TICKETS_ORGANIZATION,
    K.TICKETS_OWN,
    K.SERVICE_DESKS_ORGANIZATION,
    K.CONTRACTS_ORGANIZATION,
    K.APPOINTMENTS_ORGANIZATION,
  ],
  [Role.CLIENT]: [K.TICKETS_OWN, K.SERVICE_DESKS_ORGANIZATION],
};

const sorted = (list: readonly string[]) => [...list].sort();
const relevant = (permissions: readonly string[]) =>
  permissions.filter((k) => ALL_SCOPE_KEYS.includes(k) || k === REMOVE_ATTACHMENTS);

describe('Fase 1e: catálogo (#540)', () => {
  it.each(ALL_SCOPE_KEYS)('%s está no catálogo, uma vez só, com rótulo e categoria', (key) => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === key);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label.trim().length).toBeGreaterThan(3);
    expect(entries[0]?.category).toBeTruthy();
  });

  it('nenhuma chave de escopo é GROUP_ONLY (todas valem para o grupo Administrador)', () => {
    for (const key of [...ALL_SCOPE_KEYS, REMOVE_ATTACHMENTS]) expect(GROUP_ONLY_KEYS).not.toContain(key);
  });
});

describe('Fase 1e: grupos padrão recebem as chaves novas (#540)', () => {
  it.each(Object.values(Role))('%s tem exatamente as chaves de escopo (e de anexo) esperadas', (role) => {
    const expected = role === Role.ADMIN ? [...ADDED_FOR_ROLE[role], REMOVE_ATTACHMENTS] : ADDED_FOR_ROLE[role];
    expect(sorted(relevant(DEFAULT_PERMISSION_GROUPS[role].permissions))).toEqual(sorted(expected));
  });

  it('Cliente Master e Cliente não removem anexo de outra pessoa', () => {
    for (const role of [Role.CLIENT_MASTER, Role.CLIENT]) {
      expect(DEFAULT_PERMISSION_GROUPS[role].permissions).not.toContain(REMOVE_ATTACHMENTS);
    }
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
    .filter((name) => /^\d{14}_rbac_1e_/.test(name))
    .map((name) => ({ name, file: join(migrationsDir, name, 'migration.sql') }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }))[0];
}

const statements = (sql: string) => sql.split(/;\s*\n/).filter((s) => /\bUPDATE\b/i.test(s));
const keysIn = (list: string) => [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
const defaultKeyOf = (stmt: string) => /WHERE "defaultKey" = '([a-z-]+)'/.exec(stmt)?.[1];
const roleOfKey = (key: string | undefined) => Object.values(Role).find((r) => DEFAULT_GROUP_KEY[r] === key);
const unnestOf = (stmt: string) => /unnest\(ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
const stmtFor = (sql: string, role: Role) => statements(sql).find((s) => defaultKeyOf(s) === DEFAULT_GROUP_KEY[role]) ?? '';

describe('Fase 1e: migração aditiva e idempotente (#540)', () => {
  const sql = () => findMigration()?.sql ?? '';

  it('existe uma migração rbac_1e', () => {
    expect(findMigration()?.name).toMatch(/^\d{14}_rbac_1e_/);
  });

  it('é posterior à migração do 1b', () => {
    expect((findMigration()?.name ?? '') > '20261127130000_rbac_1b_default_group_key').toBe(true);
  });

  it('tem um UPDATE por grupo padrão, localizado por defaultKey e não por nome', () => {
    expect(sql()).not.toBe('');
    const updates = statements(sql());
    expect(updates).toHaveLength(Object.values(Role).length);
    expect(sorted(updates.map((s) => defaultKeyOf(s) ?? 'ausente'))).toEqual(sorted(Object.values(DEFAULT_GROUP_KEY)));
    for (const stmt of updates) expect(stmt).not.toMatch(/"name"\s*=/);
  });

  it.each(Object.values(Role))('o UPDATE do grupo de %s acrescenta exatamente as chaves esperadas', (role) => {
    const stmt = stmtFor(sql(), role);
    expect(stmt).not.toBe('');
    expect(sorted(keysIn(unnestOf(stmt)))).toEqual(sorted(ADDED_FOR_ROLE[role]));
  });

  it('cada UPDATE acrescenta ao array existente (SET "permissions" = "permissions" || ARRAY(...)), só o que falta', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(Object.values(Role).length);
    for (const stmt of updates) {
      expect(stmt).toMatch(/SET "permissions" = "permissions" \|\| ARRAY\(/);
      expect(stmt).toMatch(/WHERE k <> ALL\("permissions"\)/);
    }
  });

  it('em cada UPDATE a lista da guarda NOT (@>) é igual, como conjunto, à lista do unnest', () => {
    const updates = statements(sql());
    expect(updates).toHaveLength(Object.values(Role).length);
    for (const stmt of updates) {
      const guard = /NOT \("permissions" @> ARRAY\[([^\]]*)\]/.exec(stmt)?.[1] ?? '';
      expect(keysIn(unnestOf(stmt)).length).toBeGreaterThan(0);
      expect(sorted(keysIn(guard))).toEqual(sorted(keysIn(unnestOf(stmt))));
    }
  });

  it('só atualiza o grupo do defaultKey e nunca remove, apaga ou insere', () => {
    expect(sql()).not.toBe('');
    expect(sql()).not.toMatch(/array_remove|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b|\bALTER\b/i);
    for (const stmt of statements(sql())) {
      expect(roleOfKey(defaultKeyOf(stmt))).toBeDefined();
      expect(stmt).toMatch(/"updatedAt" = CURRENT_TIMESTAMP/);
    }
  });

  it('as chaves da migração estão nos grupos padrão do código (migração = seed)', () => {
    for (const role of Object.values(Role)) {
      const stmt = stmtFor(sql(), role);
      expect(stmt).not.toBe('');
      for (const key of keysIn(unnestOf(stmt))) {
        expect({ role, key, has: DEFAULT_PERMISSION_GROUPS[role].permissions.includes(key) }).toEqual({ role, key, has: true });
      }
    }
  });
});

describe('Fase 1e: equivalência ScopeResolver (chaves do grupo padrão) = TenantHelper (#540)', () => {
  const orgs: Array<string | null | undefined> = ['org-a', null, undefined, ''];
  const cases = Object.values(Role).flatMap((role) => orgs.map((org) => ({ role, org })));

  it.each(cases)('perfil $role, organizationId=$org: mesmo where em todas as entidades', ({ role, org }) => {
    const user: CurrentUserPayload = { id: 'u1', role, organizationId: org };
    const perms = DEFAULT_PERMISSION_GROUPS[role].permissions;
    expect(ScopeResolver.getTicketWhere(user, perms)).toEqual(TenantHelper.getTicketWhere(user));
    expect(ScopeResolver.getServiceDeskWhere(user, perms)).toEqual(TenantHelper.getServiceDeskWhere(user));
    expect(ScopeResolver.getCredentialWhere(user, perms)).toEqual(TenantHelper.getCredentialWhere(user));
    expect(ScopeResolver.getContractWhere(user, perms)).toEqual(TenantHelper.getContractWhere(user));
    expect(ScopeResolver.getAppointmentWhere(user, perms)).toEqual(TenantHelper.getAppointmentWhere(user));
  });
});
