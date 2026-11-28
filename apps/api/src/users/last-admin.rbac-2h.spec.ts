import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DEFAULT_GROUP_KEY } from '../permission-groups/default-permission-groups';
import { PermissionGroupsService } from '../permission-groups/permission-groups.service';
import { UserAccess } from './user-access';
import { UsersService } from './users.service';

/**
 * Lote 2h (#578): o sistema nunca fica sem administrador ativo por nenhum caminho que remove o
 * vinculo ao grupo Administrador (`defaultKey='default-admin'`). Os dois modos da flag
 * `rbac-permission-only`: ligada guarda por grupo; desligada guarda por perfil E grupo juntos
 * (mais estrito que antes, mudanca intencional). O prisma e uma tabela em memoria que avalia o
 * `where` de verdade e aplica as escritas; formato nao suportado falha o teste.
 */
const ADMIN_KEY = DEFAULT_GROUP_KEY[Role.ADMIN];
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

type UserRow = { id: string; role: Role; active: boolean; groups: string[]; name: string; email: string; password: string | null };
type GroupRow = { id: string; name: string; defaultKey: string | null };

const user = (id: string, groups: string[], extra: Partial<UserRow> = {}): UserRow => ({
  id, role: Role.AGENT, active: true, groups, name: id, email: `${id}@exemplo.test`, password: 'hash-de-fixture', ...extra,
});
const GROUPS: GroupRow[] = [
  { id: 'g-admin', name: 'Administrador', defaultKey: ADMIN_KEY },
  { id: 'g-agent', name: 'Atendente', defaultKey: DEFAULT_GROUP_KEY[Role.AGENT] },
  { id: 'g-custom', name: 'Financeiro', defaultKey: null },
];

const build = (flagOn: boolean, users: UserRow[], technicalLinks: { permissionGroupId: string; technicalGroupId: string }[] = []) => {
  const db = { users: users.map((u) => ({ ...u, groups: [...u.groups] })), groups: GROUPS.map((g) => ({ ...g })), technicalLinks: [...technicalLinks] };
  const keyOf = (groupId: string) => db.groups.find((g) => g.id === groupId)?.defaultKey ?? null;
  const matches = (u: UserRow, where: any): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      switch (k) {
        case 'active': return u.active === v;
        case 'role': return u.role === v;
        case 'id': return v.in ? v.in.includes(u.id) : v.notIn ? !v.notIn.includes(u.id) : false;
        case 'permissionGroupLinks': return u.groups.some((g) => keyOf(g) === v.some.permissionGroup.defaultKey);
        default: throw new Error(`where nao suportado: ${k}`);
      }
    });
  const view = (u: UserRow) => ({ ...u, technicalGroup: null, twoFactor: null, permissionGroupLinks: u.groups.map((g) => ({ permissionGroup: { id: g, name: g } })) });
  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.email) return null;
        const u = db.users.find((x) => x.id === where.id);
        return u ? view(u) : null;
      },
      findFirst: async () => null,
      count: async ({ where }: any) => db.users.filter((u) => matches(u, where)).length,
      update: async ({ where, data }: any) => {
        const u = db.users.find((x) => x.id === where.id)!;
        const { permissionGroupLinks, ...fields } = data;
        Object.assign(u, fields);
        if (permissionGroupLinks) u.groups = permissionGroupLinks.create.map((c: any) => c.permissionGroupId);
        return u;
      },
    },
    permissionGroup: {
      count: async ({ where }: any) => db.groups.filter((g) => where.id.in.includes(g.id)).length,
      findUnique: async ({ where }: any) => db.groups.find((g) => (where.id ? g.id === where.id : g.defaultKey === where.defaultKey)) ?? null,
      delete: async ({ where }: any) => {
        db.groups = db.groups.filter((g) => g.id !== where.id);
        db.users.forEach((u) => (u.groups = u.groups.filter((g) => g !== where.id)));
        return { id: where.id };
      },
    },
    permissionGroupUser: {
      upsert: async ({ create }: any) => {
        const u = db.users.find((x) => x.id === create.userId)!;
        if (!u.groups.includes(create.permissionGroupId)) u.groups.push(create.permissionGroupId);
        return create;
      },
      delete: async ({ where }: any) => {
        const { permissionGroupId, userId } = where.permissionGroupId_userId;
        const u = db.users.find((x) => x.id === userId)!;
        u.groups = u.groups.filter((g) => g !== permissionGroupId);
        return where.permissionGroupId_userId;
      },
    },
    permissionGroupTechnicalGroup: {
      delete: async ({ where }: any) => {
        const { permissionGroupId, technicalGroupId } = where.permissionGroupId_technicalGroupId;
        db.technicalLinks = db.technicalLinks.filter((l) => !(l.permissionGroupId === permissionGroupId && l.technicalGroupId === technicalGroupId));
        return where.permissionGroupId_technicalGroupId;
      },
    },
  };
  prisma.$transaction = (fn: any) => fn(prisma);
  const access = new UserAccess({ isRbacPermissionOnly: () => flagOn } as any);
  return { db, users: new UsersService(prisma, access), groups: new PermissionGroupsService(prisma, access) };
};
const groupsOf = (db: { users: UserRow[] }, id: string) => db.users.find((u) => u.id === id)!.groups;

describe.each(modes)('ultimo administrador: %s', (_label, flagOn) => {
  describe('UsersService.update com permissionGroupIds', () => {
    it('barra tirar o ultimo administrador ativo do grupo (lista vazia)', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin'])]);
      await expect(users.update('a', { permissionGroupIds: [] }, false)).rejects.toThrow(ConflictException);
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('barra trocar o grupo do ultimo administrador por outro grupo', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin'])]);
      await expect(users.update('a', { permissionGroupIds: ['g-custom'] }, false)).rejects.toThrow('Não é possível remover o último administrador ativo.');
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('com dois administradores ativos, tirar um passa', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'])]);
      await users.update('a', { permissionGroupIds: [] }, false);
      expect(groupsOf(db, 'a')).toEqual([]);
      expect(groupsOf(db, 'b')).toEqual(['g-admin']);
    });

    it('administrador inativo nao conta como o que sobra', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'], { active: false })]);
      await expect(users.update('a', { permissionGroupIds: ['g-custom'] }, false)).rejects.toThrow(ConflictException);
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('tirar um administrador inativo passa (ele nao sustenta o sistema)', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'], { active: false })]);
      await users.update('b', { permissionGroupIds: [] }, false);
      expect(groupsOf(db, 'b')).toEqual([]);
    });

    it('manter o grupo Administrador junto com outros passa', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin'])]);
      await users.update('a', { permissionGroupIds: ['g-admin', 'g-custom'] }, false);
      expect(groupsOf(db, 'a').sort()).toEqual(['g-admin', 'g-custom']);
    });

    it('sem permissionGroupIds no corpo nao ha guarda: so os campos mudam', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin'])]);
      await users.update('a', { name: 'Novo nome' }, false);
      expect(db.users[0].name).toBe('Novo nome');
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('fluxo legitimo: usuario que nao e administrador troca de grupo livremente', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin']), user('x', ['g-agent'], { role: Role.AGENT })]);
      await users.update('x', { permissionGroupIds: ['g-custom'] }, false);
      expect(groupsOf(db, 'x')).toEqual(['g-custom']);
    });

    it('fluxo legitimo: adicionar um segundo administrador e depois tirar o primeiro', async () => {
      const { db, users } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-agent'], { role: Role.ADMIN })]);
      await users.update('b', { permissionGroupIds: ['g-admin'] }, false);
      await users.update('a', { permissionGroupIds: ['g-custom'] }, false);
      expect(groupsOf(db, 'a')).toEqual(['g-custom']);
      expect(groupsOf(db, 'b')).toEqual(['g-admin']);
    });

    it('quem so administra por grupo tecnico nao sustenta o sistema: o vinculo direto e o que conta', async () => {
      const { db, users } = build(
        flagOn,
        [user('a', ['g-admin']), user('t', [], { role: Role.AGENT })],
        [{ permissionGroupId: 'g-admin', technicalGroupId: 'tg-1' }],
      );
      await expect(users.update('a', { permissionGroupIds: [] }, false)).rejects.toThrow(ConflictException);
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });
  });

  describe('PermissionGroupsService', () => {
    it('barra excluir o grupo Administrador, mesmo com varios membros', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'])]);
      await expect(groups.remove('g-admin')).rejects.toThrow('O grupo Administrador não pode ser excluído.');
      expect(db.groups.some((g) => g.id === 'g-admin')).toBe(true);
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('exclui um grupo personalizado normalmente', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin', 'g-custom'])]);
      await groups.remove('g-custom');
      expect(db.groups.some((g) => g.id === 'g-custom')).toBe(false);
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('exclui um grupo padrao que nao e o Administrador (Atendente)', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin'])]);
      await groups.remove('g-agent');
      expect(db.groups.some((g) => g.id === 'g-agent')).toBe(false);
    });

    it('barra remover o ultimo membro ativo do grupo Administrador', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin'])]);
      await expect(groups.removeUser('g-admin', 'a')).rejects.toThrow('Não é possível remover o último administrador ativo.');
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('com dois administradores ativos, remover um passa', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'])]);
      await groups.removeUser('g-admin', 'a');
      expect(groupsOf(db, 'a')).toEqual([]);
    });

    it('administrador inativo nao conta como o que sobra', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'], { active: false })]);
      await expect(groups.removeUser('g-admin', 'a')).rejects.toThrow(ConflictException);
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('remover um membro inativo passa', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-admin'], { active: false })]);
      await groups.removeUser('g-admin', 'b');
      expect(groupsOf(db, 'b')).toEqual([]);
    });

    it('remover o unico administrador de um grupo que nao e o Administrador passa', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin', 'g-custom'])]);
      await groups.removeUser('g-custom', 'a');
      expect(groupsOf(db, 'a')).toEqual(['g-admin']);
    });

    it('fluxo legitimo: adicionar um segundo administrador e depois remover o primeiro', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin']), user('b', ['g-agent'])]);
      await groups.addUser('g-admin', 'b');
      await groups.removeUser('g-admin', 'a');
      expect(groupsOf(db, 'a')).toEqual([]);
      expect(groupsOf(db, 'b')).toEqual(['g-agent', 'g-admin']);
    });

    it('grupo inexistente segue como 404 (a guarda nao mascara o erro)', async () => {
      const { groups } = build(flagOn, [user('a', ['g-admin'])]);
      await expect(groups.removeUser('g-nao-existe', 'a')).rejects.toThrow(NotFoundException);
      await expect(groups.remove('g-nao-existe')).rejects.toThrow(NotFoundException);
    });

    it('desvincular o grupo tecnico do Administrador nao e barrado: ele nao define quem e administrador', async () => {
      const { db, groups } = build(flagOn, [user('a', ['g-admin'])], [{ permissionGroupId: 'g-admin', technicalGroupId: 'tg-1' }]);
      await groups.removeTechnicalGroup('g-admin', 'tg-1');
      expect(db.technicalLinks).toEqual([]);
    });
  });
});

describe('modo desligado: perfil OU grupo (uniao), o sistema so trava se nao sobrar nenhum dos dois', () => {
  const admin = (id: string, groups: string[], extra: Partial<UserRow> = {}) => user(id, groups, { role: Role.ADMIN, ...extra });

  it('A e ADMIN fora do grupo e B e ADMIN no grupo: remover B do grupo passa (A sustenta pelo perfil)', async () => {
    const { db, groups } = build(false, [admin('a', []), admin('b', ['g-admin'])]);
    await groups.removeUser('g-admin', 'b');
    expect(groupsOf(db, 'b')).toEqual([]);
  });

  it('A e ADMIN fora do grupo e B e ADMIN no grupo: rebaixar B passa', async () => {
    const { db, users } = build(false, [admin('a', []), admin('b', ['g-admin'])]);
    await users.update('b', { role: Role.AGENT }, true);
    expect(db.users[1].role).toBe(Role.AGENT);
  });

  it('A e ADMIN fora do grupo e B e ADMIN no grupo: rebaixar B e tira-lo do grupo passa', async () => {
    const { db, users } = build(false, [admin('a', []), admin('b', ['g-admin'])]);
    await users.update('b', { role: Role.AGENT, permissionGroupIds: [] }, true);
    expect(groupsOf(db, 'b')).toEqual([]);
  });

  it('quem esta no grupo com perfil AGENT sustenta o sistema', async () => {
    const { db, users } = build(false, [admin('a', ['g-admin']), user('b', ['g-admin'])]);
    await users.update('a', { role: Role.AGENT, permissionGroupIds: [] }, true);
    expect(groupsOf(db, 'a')).toEqual([]);
  });

  it('unico administrador: tirar do grupo mantendo o perfil ADMIN passa (segue administrador pelo perfil)', async () => {
    const { db, users } = build(false, [admin('a', ['g-admin'])]);
    await users.update('a', { permissionGroupIds: [] }, true);
    expect(groupsOf(db, 'a')).toEqual([]);
  });

  it('unico administrador: rebaixar mantendo o grupo passa (segue administrador pelo grupo)', async () => {
    const { db, users } = build(false, [admin('a', ['g-admin'])]);
    await users.update('a', { role: Role.AGENT }, true);
    expect(db.users[0].role).toBe(Role.AGENT);
  });

  it('unico administrador: rebaixar E tirar do grupo e barrado', async () => {
    const { db, users } = build(false, [admin('a', ['g-admin'])]);
    await expect(users.update('a', { role: Role.AGENT, permissionGroupIds: [] }, true)).rejects.toThrow(ConflictException);
    expect(db.users[0].role).toBe(Role.ADMIN);
    expect(groupsOf(db, 'a')).toEqual(['g-admin']);
  });

  it('unico administrador so por perfil (sem grupo): reenviar role ADMIN passa', async () => {
    const { db, users } = build(false, [admin('a', [])]);
    await users.update('a', { name: 'Novo nome', role: Role.ADMIN }, true);
    expect(db.users[0].name).toBe('Novo nome');
  });

  it('unico administrador so por perfil (sem grupo): rebaixar e barrado', async () => {
    const { db, users } = build(false, [admin('a', [])]);
    await expect(users.update('a', { role: Role.AGENT }, true)).rejects.toThrow('Não é possível remover o último administrador ativo.');
    expect(db.users[0].role).toBe(Role.ADMIN);
  });

  it('administrador inativo por perfil nao sustenta: remover o unico ativo do grupo e barrado', async () => {
    const { db, groups } = build(false, [user('a', ['g-admin']), admin('b', [], { active: false })]);
    await expect(groups.removeUser('g-admin', 'a')).rejects.toThrow(ConflictException);
    expect(groupsOf(db, 'a')).toEqual(['g-admin']);
  });

  it('trocar o perfil de um administrador com outro ativo passa', async () => {
    const { db, users } = build(false, [admin('a', ['g-admin']), admin('b', ['g-admin'])]);
    await users.update('a', { role: Role.AGENT, permissionGroupIds: [] }, true);
    expect(db.users[0].role).toBe(Role.AGENT);
  });
});

describe('modo ligado: so o grupo conta, o perfil e rotulo', () => {
  const admin = (id: string, groups: string[], extra: Partial<UserRow> = {}) => user(id, groups, { role: Role.ADMIN, ...extra });

  it('quem esta no grupo sustenta o sistema mesmo com perfil AGENT', async () => {
    const { db, users } = build(true, [admin('a', ['g-admin']), user('b', ['g-admin'])]);
    await users.update('a', { permissionGroupIds: [] }, false);
    expect(groupsOf(db, 'a')).toEqual([]);
  });

  it('trocar o perfil do ultimo administrador nao e barrado (rotulo), o grupo segue', async () => {
    const { db, users } = build(true, [admin('a', ['g-admin'])]);
    await users.update('a', { role: Role.AGENT }, true);
    expect(db.users[0].role).toBe(Role.AGENT);
    expect(groupsOf(db, 'a')).toEqual(['g-admin']);
  });

  it('reenviar o mesmo perfil ADMIN do ultimo administrador, sem tirar do grupo, passa', async () => {
    const { db, users } = build(true, [admin('a', ['g-admin'])]);
    await users.update('a', { name: 'Novo nome', role: Role.ADMIN }, true);
    expect(db.users[0].name).toBe('Novo nome');
    expect(groupsOf(db, 'a')).toEqual(['g-admin']);
  });

  it('A e ADMIN fora do grupo e B e ADMIN no grupo: remover B do grupo e barrado (o perfil nao conta)', async () => {
    const { db, groups } = build(true, [admin('a', []), admin('b', ['g-admin'])]);
    await expect(groups.removeUser('g-admin', 'b')).rejects.toThrow(ConflictException);
    expect(groupsOf(db, 'b')).toEqual(['g-admin']);
  });

  it('unico administrador so por perfil (sem grupo): nao e protegido, rebaixar passa', async () => {
    const { db, users } = build(true, [admin('a', [])]);
    await users.update('a', { role: Role.AGENT }, true);
    expect(db.users[0].role).toBe(Role.AGENT);
  });

  it('quem tem o perfil ADMIN sem o grupo nao sustenta o sistema', async () => {
    const { db, users } = build(true, [admin('a', ['g-admin']), admin('b', [])]);
    await expect(users.update('a', { permissionGroupIds: [] }, false)).rejects.toThrow(ConflictException);
    expect(groupsOf(db, 'a')).toEqual(['g-admin']);
  });
});
