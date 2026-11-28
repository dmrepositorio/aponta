import { Role } from '@prisma/client';
import { UserAccess } from './user-access';

/**
 * Lote 2g (#551): quem entra na lista de atendentes e qual grupo protege o ultimo
 * administrador, nos dois modos da flag `rbac-permission-only`.
 */
const build = (flagOn: boolean) => new UserAccess({ isRbacPermissionOnly: () => flagOn } as any);

describe('UserAccess.agentsWhere', () => {
  it('flag desligada: lista por perfil (AGENT, AGENT_MASTER, ADMIN)', () => {
    expect(build(false).agentsWhere()).toEqual({ role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] } });
  });

  it('flag ligada: lista por CREATE_EDIT_WORKLOGS, direto ou pelo grupo de atendentes, sem olhar o perfil', () => {
    const group = { permissionGroup: { permissions: { has: 'CREATE_EDIT_WORKLOGS' } } };
    const where = build(true).agentsWhere();
    expect(where).toEqual({ OR: [{ permissionGroupLinks: { some: group } }, { technicalGroup: { permissionGroupLinks: { some: group } } }] });
    expect(JSON.stringify(where)).not.toContain('role');
  });
});

describe('UserAccess.protectedAdminWhere', () => {
  it('flag desligada: sem grupo protegido (a regra segue por perfil)', () => {
    expect(build(false).protectedAdminWhere()).toBeUndefined();
  });

  it('flag ligada: usuario ativo no grupo padrao Administrador, localizado por defaultKey e nao por nome', () => {
    const where = build(true).protectedAdminWhere();
    expect(where).toEqual({ active: true, permissionGroupLinks: { some: { permissionGroup: { defaultKey: 'default-admin' } } } });
    expect(JSON.stringify(where)).not.toContain('role');
    expect(JSON.stringify(where)).not.toContain('name');
  });
});
