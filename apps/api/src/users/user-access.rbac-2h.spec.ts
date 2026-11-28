import { ConflictException } from '@nestjs/common';
import { UserAccess } from './user-access';

/** Lote 2h (#578): a guarda do ultimo administrador, isolada do prisma. */
const build = (flagOn: boolean) => new UserAccess({ isRbacPermissionOnly: () => flagOn } as any);
const inAdminGroup = { permissionGroupLinks: { some: { permissionGroup: { defaultKey: 'default-admin' } } } };

describe('UserAccess.lastAdminWhere', () => {
  it('flag ligada: ativo no grupo Administrador (por defaultKey), sem olhar o perfil', () => {
    const where = build(true).lastAdminWhere();
    expect(where).toEqual({ active: true, ...inAdminGroup });
    expect(JSON.stringify(where)).not.toContain('role');
  });

  it('flag desligada: ativo com perfil ADMIN OU no grupo Administrador (uniao)', () => {
    expect(build(false).lastAdminWhere()).toEqual({ active: true, OR: [{ role: 'ADMIN' }, inAdminGroup] });
  });
});

describe('UserAccess.assertAdminRemains', () => {
  const both = { group: true, role: true };
  /** Responde as contagens na ordem: quem sai e administrador? sobra algum fora do lote? algum do lote segue administrador? */
  const dbWith = (...counts: number[]) => {
    const count = jest.fn();
    counts.forEach((c) => count.mockResolvedValueOnce(c));
    return { user: { count } };
  };

  it.each([true, false])('flag %s: quem sai nao e administrador, passa sem olhar quem sobra', async (flagOn) => {
    const db = dbWith(0);
    await expect(build(flagOn).assertAdminRemains(db as any, ['x'], both)).resolves.toBeUndefined();
    expect(db.user.count).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('flag %s: sai um administrador e sobra outro fora do lote, passa', async (flagOn) => {
    const db = dbWith(1, 1);
    await expect(build(flagOn).assertAdminRemains(db as any, ['a'], both)).resolves.toBeUndefined();
    expect(db.user.count).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('flag %s: perde grupo e perfil e ninguem sobra, barra sem consultar o lote de novo', async (flagOn) => {
    const db = dbWith(1, 0);
    await expect(build(flagOn).assertAdminRemains(db as any, ['a'], both)).rejects.toThrow(ConflictException);
    expect(db.user.count).toHaveBeenCalledTimes(2);
  });

  it('lote: consulta quem sai por id e quem sobra por id fora do lote, com a mesma regra de administrador', async () => {
    const db = dbWith(2, 0);
    await expect(build(true).assertAdminRemains(db as any, ['a', 'b'], both)).rejects.toThrow('Não é possível remover o último administrador ativo.');
    expect(db.user.count).toHaveBeenNthCalledWith(1, { where: { active: true, ...inAdminGroup, id: { in: ['a', 'b'] } } });
    expect(db.user.count).toHaveBeenNthCalledWith(2, { where: { active: true, ...inAdminGroup, id: { notIn: ['a', 'b'] } } });
  });

  it('flag ligada: perde so o perfil, o grupo segue e sustenta', async () => {
    const db = dbWith(1, 0, 1);
    await expect(build(true).assertAdminRemains(db as any, ['a'], { group: false, role: true })).resolves.toBeUndefined();
    expect(db.user.count).toHaveBeenNthCalledWith(3, { where: { active: true, OR: [inAdminGroup], id: { in: ['a'] } } });
  });

  it('flag ligada: perde o grupo e o perfil nao conta, barra', async () => {
    const db = dbWith(1, 0);
    await expect(build(true).assertAdminRemains(db as any, ['a'], { group: true, role: false })).rejects.toThrow(ConflictException);
    expect(db.user.count).toHaveBeenCalledTimes(2);
  });

  it('flag desligada: perde so o grupo, o perfil ADMIN segue e sustenta', async () => {
    const db = dbWith(1, 0, 1);
    await expect(build(false).assertAdminRemains(db as any, ['a'], { group: true, role: false })).resolves.toBeUndefined();
    expect(db.user.count).toHaveBeenNthCalledWith(3, { where: { active: true, OR: [{ role: 'ADMIN' }], id: { in: ['a'] } } });
  });

  it('flag desligada: perde so o perfil, o grupo segue e sustenta', async () => {
    const db = dbWith(1, 0, 1);
    await expect(build(false).assertAdminRemains(db as any, ['a'], { group: false, role: true })).resolves.toBeUndefined();
    expect(db.user.count).toHaveBeenNthCalledWith(3, { where: { active: true, OR: [inAdminGroup], id: { in: ['a'] } } });
  });

  it('flag desligada: nada do que ficaria no lote e administrador, barra', async () => {
    const db = dbWith(1, 0, 0);
    await expect(build(false).assertAdminRemains(db as any, ['a'], { group: false, role: false })).rejects.toThrow(ConflictException);
  });

  it('sem terceiro argumento perde grupo e perfil (padrao conservador)', async () => {
    const db = dbWith(1, 0);
    await expect(build(false).assertAdminRemains(db as any, ['a'])).rejects.toThrow(ConflictException);
    expect(db.user.count).toHaveBeenCalledTimes(2);
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
