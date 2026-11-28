import { Role } from '@prisma/client';
import { MaskAccess } from './mask-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2c (#547): decisão de nota interna, nome da equipe e contato do solicitante
 * nos dois modos da flag `rbac-permission-only`. Desligada: por perfil. Ligada: só por permissão.
 * Única diferença com os grupos padrão: CLIENT_MASTER deixa de ver e gravar nota interna
 * e de ver o nome da equipe (decisão do dono, vale só com a flag ligada).
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const build = (flagOn: boolean, grants: Record<string, string[]>) => {
  const hasPermission = jest.fn(async (userId: string, ...keys: string[]) => (grants[userId] ?? []).some((k) => keys.includes(k)));
  const access = new MaskAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any);
  return { access, hasPermission };
};

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const user = (role: Role) => ({ id: `u-${role}`, role });

const team = { ADMIN: true, AGENT_MASTER: true, AGENT: true, CLIENT: false } as const;

describe('MaskAccess: grupos padrão', () => {
  describe.each(modes)('%s', (_label, flagOn) => {
    // Intencional: CLIENT_MASTER perde nota interna e nome da equipe só com a flag ligada.
    const expectedFor = (role: Role) => (role === Role.CLIENT_MASTER ? !flagOn : team[role as keyof typeof team]);

    it.each(roles)('%s: postar nota interna', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canPostInternalNotes(user(role))).toBe(expectedFor(role));
    });

    it.each(roles)('%s: ler nota interna', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canViewInternalNotes(user(role))).toBe(expectedFor(role));
    });

    it.each(roles)('%s: ver o nome da equipe', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canViewTeamMemberNames(user(role))).toBe(expectedFor(role));
    });

    it.each(roles)('%s: telefone e ramal do solicitante', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canViewRequesterContact(user(role))).toBe(role !== Role.CLIENT_MASTER && role !== Role.CLIENT);
    });
  });
});

describe('MaskAccess: flag desligada não consulta permissão', () => {
  it.each(roles)('%s: decide só por perfil', async (role) => {
    const { access, hasPermission } = build(false, { [`u-${role}`]: [] });
    await access.canPostInternalNotes(user(role));
    await access.canViewInternalNotes(user(role));
    await access.canViewTeamMemberNames(user(role));
    await access.canViewRequesterContact(user(role));
    expect(hasPermission).not.toHaveBeenCalled();
  });
});

describe('MaskAccess: flag ligada decide só por permissão', () => {
  it.each([
    ['canPostInternalNotes', 'POST_INTERNAL_NOTES'],
    ['canViewInternalNotes', 'VIEW_ADD_INTERNAL_COMMUNICATION'],
    ['canViewTeamMemberNames', 'VIEW_TEAM_MEMBER_NAMES'],
    ['canViewRequesterContact', 'VIEW_REQUESTER_CONTACT_INFO'],
  ] as const)('%s segue a chave %s, sem olhar o perfil', async (method, key) => {
    for (const role of roles) {
      const granted = build(true, { [`u-${role}`]: [key] });
      expect(await granted.access[method](user(role))).toBe(true);
      const denied = build(true, { [`u-${role}`]: ['OUTRA_CHAVE'] });
      expect(await denied.access[method](user(role))).toBe(false);
    }
  });

  it.each(roles)('%s: usuário sem grupo não recebe nada', async (role) => {
    const { access } = build(true, {});
    expect(await access.canPostInternalNotes(user(role))).toBe(false);
    expect(await access.canViewInternalNotes(user(role))).toBe(false);
    expect(await access.canViewTeamMemberNames(user(role))).toBe(false);
    expect(await access.canViewRequesterContact(user(role))).toBe(false);
  });

  it('as chaves são independentes entre si', async () => {
    const { access } = build(true, { 'u-AGENT': ['POST_INTERNAL_NOTES'] });
    expect(await access.canPostInternalNotes(user(Role.AGENT))).toBe(true);
    expect(await access.canViewInternalNotes(user(Role.AGENT))).toBe(false);
    expect(await access.canViewTeamMemberNames(user(Role.AGENT))).toBe(false);
    expect(await access.canViewRequesterContact(user(Role.AGENT))).toBe(false);
  });
});
