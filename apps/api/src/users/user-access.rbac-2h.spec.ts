import { ConflictException } from '@nestjs/common';
import { UserAccess } from './user-access';

/** Lote 2h (#578): a guarda do ultimo administrador, isolada do prisma. */
const build = (flagOn: boolean) => new UserAccess({ isRbacPermissionOnly: () => flagOn } as any);
const adminGroup = { permissionGroupLinks: { some: { permissionGroup: { defaultKey: 'default-admin' } } } };

describe('UserAccess.lastAdminWhere', () => {
  it('flag ligada: ativo no grupo Administrador (por defaultKey), sem olhar o perfil', () => {
    const where = build(true).lastAdminWhere();
    expect(where).toEqual({ active: true, ...adminGroup });
    expect(JSON.stringify(where)).not.toContain('role');
  });

  it('flag desligada: ativo, com perfil ADMIN e no grupo Administrador juntos', () => {
    expect(build(false).lastAdminWhere()).toEqual({ active: true, role: 'ADMIN', ...adminGroup });
  });
});

describe('UserAccess.assertAdminRemains', () => {
  const dbWith = (counts: { leaving: number; remaining: number }) => ({
    user: {
      count: jest.fn(async ({ where }: any) => (where.id.in ? counts.leaving : counts.remaining)),
    },
  });

  it.each([true, false])('flag %s: sai um administrador e ninguem sobra, barra', async (flagOn) => {
    const db = dbWith({ leaving: 1, remaining: 0 });
    await expect(build(flagOn).assertAdminRemains(db as any, ['a'])).rejects.toThrow(ConflictException);
  });

  it.each([true, false])('flag %s: sai um administrador e sobra outro, passa', async (flagOn) => {
    await expect(build(flagOn).assertAdminRemains(dbWith({ leaving: 1, remaining: 1 }) as any, ['a'])).resolves.toBeUndefined();
  });

  it.each([true, false])('flag %s: quem sai nao e administrador, passa sem olhar quem sobra', async (flagOn) => {
    const db = dbWith({ leaving: 0, remaining: 0 });
    await expect(build(flagOn).assertAdminRemains(db as any, ['x'])).resolves.toBeUndefined();
  });

  it('lote: consulta quem sai por id e quem sobra por id fora do lote, com a mesma regra de administrador', async () => {
    const db = dbWith({ leaving: 2, remaining: 0 });
    await expect(build(true).assertAdminRemains(db as any, ['a', 'b'])).rejects.toThrow('Não é possível remover o último administrador ativo.');
    expect(db.user.count).toHaveBeenNthCalledWith(1, { where: { active: true, ...adminGroup, id: { in: ['a', 'b'] } } });
    expect(db.user.count).toHaveBeenNthCalledWith(2, { where: { active: true, ...adminGroup, id: { notIn: ['a', 'b'] } } });
  });
});

describe('UserAccess.assertGroupDeletable', () => {
  it.each([true, false])('flag %s: o grupo Administrador nao pode ser excluido', (flagOn) => {
    expect(() => build(flagOn).assertGroupDeletable({ defaultKey: 'default-admin' })).toThrow('O grupo Administrador não pode ser excluído.');
  });

  it.each([null, 'default-agent'])('grupo com defaultKey %s pode ser excluido', (defaultKey) => {
    expect(() => build(true).assertGroupDeletable({ defaultKey })).not.toThrow();
  });
});
