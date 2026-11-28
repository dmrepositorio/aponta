import { Role } from '@prisma/client';
import { AgendaAccess } from './agenda-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a5 (#545): decisao de acesso da agenda nos dois modos da flag
 * `rbac-permission-only`. Desligada: por perfil. Ligada: so por permissao.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const build = (flagOn: boolean, grants: Record<string, string[]>) => {
  const hasPermission = jest.fn(async (userId: string, ...keys: string[]) => (grants[userId] ?? []).some((k) => keys.includes(k)));
  const access = new AgendaAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any);
  return { access, hasPermission };
};

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const user = (role: Role) => ({ id: `u-${role}`, role });

describe('AgendaAccess: grupos padrao dao o mesmo resultado nos dois modos', () => {
  const expected = {
    manage: { ADMIN: true, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: false, CLIENT: false },
    orgScoped: { ADMIN: false, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: true, CLIENT: false },
  } as const;

  describe.each(modes)('%s', (_label, flagOn) => {
    it.each(roles)('%s: gerir agenda de outros e ficar preso a organizacao', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canManageSchedules(user(role))).toBe(expected.manage[role]);
      expect(await access.isOrganizationScoped(user(role))).toBe(expected.orgScoped[role]);
    });
  });
});

describe('AgendaAccess: flag ligada decide so por permissao', () => {
  it('isOrganizationScoped: o escopo mais amplo vence (VIEW_ALL_APPOINTMENTS solta a organizacao)', async () => {
    const both = build(true, { 'u-CLIENT': ['VIEW_ORGANIZATION_APPOINTMENTS', 'VIEW_ALL_APPOINTMENTS'] });
    expect(await both.access.isOrganizationScoped(user(Role.CLIENT))).toBe(false);
    const onlyAll = build(true, { 'u-CLIENT': ['VIEW_ALL_APPOINTMENTS'] });
    expect(await onlyAll.access.isOrganizationScoped(user(Role.CLIENT))).toBe(false);
  });

  it.each([
    ['canManageSchedules', 'MANAGE_SCHEDULES_ADMIN'],
    ['isOrganizationScoped', 'VIEW_ORGANIZATION_APPOINTMENTS'],
  ] as const)('%s segue a chave %s e ignora o perfil', async (method, key) => {
    const withKey = build(true, { 'u-CLIENT': [key] });
    expect(await withKey.access[method](user(Role.CLIENT))).toBe(true);
    expect(withKey.hasPermission).toHaveBeenCalledWith('u-CLIENT', key);

    const withoutKey = build(true, { 'u-ADMIN': [], 'u-CLIENT_MASTER': [] });
    expect(await withoutKey.access[method](user(Role.ADMIN))).toBe(false);
    expect(await withoutKey.access[method](user(Role.CLIENT_MASTER))).toBe(false);
  });
});

describe('AgendaAccess: flag desligada decide so por perfil', () => {
  it.each(['canManageSchedules', 'isOrganizationScoped'] as const)('%s ignora as permissoes e nao as consulta', async (method) => {
    const { access, hasPermission } = build(false, { 'u-CLIENT': ['MANAGE_SCHEDULES_ADMIN', 'VIEW_ORGANIZATION_APPOINTMENTS'], 'u-ADMIN': [], 'u-CLIENT_MASTER': [] });
    expect(await access[method](user(Role.CLIENT))).toBe(false);
    expect(await access[method](user(method === 'canManageSchedules' ? Role.ADMIN : Role.CLIENT_MASTER))).toBe(true);
    expect(hasPermission).not.toHaveBeenCalled();
  });
});
