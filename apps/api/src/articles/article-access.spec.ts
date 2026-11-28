import { Role } from '@prisma/client';
import { ArticleAccess } from './article-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a5 (#545): decisao de acesso aos artigos nos dois modos da flag
 * `rbac-permission-only`. Desligada: por perfil. Ligada: so por permissao.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const build = (flagOn: boolean, grants: Record<string, string[]>) => {
  const hasPermission = jest.fn(async (userId: string, ...keys: string[]) => (grants[userId] ?? []).some((k) => keys.includes(k)));
  const access = new ArticleAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any);
  return { access, hasPermission };
};

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const user = (role: Role) => ({ id: `u-${role}`, role });
const onlyAdmin = { ADMIN: true, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: false, CLIENT: false } as const;

describe('ArticleAccess: grupos padrao dao o mesmo resultado nos dois modos', () => {
  describe.each(modes)('%s', (_label, flagOn) => {
    it.each(roles)('%s: ver todos os artigos e excluir de outro autor (so ADMIN)', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canViewAll(user(role))).toBe(onlyAdmin[role]);
      expect(await access.canDeleteOthers(user(role))).toBe(onlyAdmin[role]);
    });

    it('anonimo nunca ve todos os artigos', async () => {
      const { access } = build(flagOn, { 'u-ADMIN': ['VIEW_ALL_KNOWLEDGE_ARTICLES'] });
      expect(await access.canViewAll(undefined)).toBe(false);
    });
  });

  it.each(roles)('%s: editar artigo de outro autor segue por perfil (lacuna #566)', (role) => {
    expect(build(true, defaultGrants()).access.canEditOthers(user(role))).toBe(onlyAdmin[role]);
  });
});

describe('ArticleAccess: flag ligada decide so por permissao', () => {
  it.each([
    ['canViewAll', 'VIEW_ALL_KNOWLEDGE_ARTICLES'],
    ['canDeleteOthers', 'DELETE_KNOWLEDGE_ARTICLES'],
  ] as const)('%s segue a chave %s e ignora o perfil', async (method, key) => {
    const withKey = build(true, { 'u-CLIENT': [key] });
    expect(await withKey.access[method](user(Role.CLIENT))).toBe(true);
    expect(withKey.hasPermission).toHaveBeenCalledWith('u-CLIENT', key);

    const withoutKey = build(true, { 'u-ADMIN': [] });
    expect(await withoutKey.access[method](user(Role.ADMIN))).toBe(false);
  });
});

describe('ArticleAccess: flag desligada decide so por perfil', () => {
  it.each(['canViewAll', 'canDeleteOthers'] as const)('%s ignora as permissoes e nao as consulta', async (method) => {
    const { access, hasPermission } = build(false, { 'u-CLIENT': ['VIEW_ALL_KNOWLEDGE_ARTICLES', 'DELETE_KNOWLEDGE_ARTICLES'], 'u-ADMIN': [] });
    expect(await access[method](user(Role.CLIENT))).toBe(false);
    expect(await access[method](user(Role.ADMIN))).toBe(true);
    expect(hasPermission).not.toHaveBeenCalled();
  });
});
