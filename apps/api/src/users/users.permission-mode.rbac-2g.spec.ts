import { ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DEFAULT_GROUP_KEY, DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import { UserAccess } from './user-access';
import { UsersService } from './users.service';

/**
 * Lote 2g (#551): lista de atendentes e protecao do ultimo administrador nos dois modos da
 * flag `rbac-permission-only`, com os grupos padrao reais. O prisma e uma tabela em memoria que
 * avalia o `where` de verdade (so os formatos que o service usa; qualquer outro falha o teste).
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

type Row = { id: string; name: string; email: string; role: Role; active: boolean; password: string | null; groupKeys: string[]; techGroupKeys: string[] };
const GROUPS: Record<string, string[]> = {
  ...Object.fromEntries(roles.map((r) => [DEFAULT_GROUP_KEY[r], DEFAULT_PERMISSION_GROUPS[r].permissions])),
  'custom-worklogs': ['CREATE_EDIT_WORKLOGS'],
};

const row = (id: string, role: Role, extra: Partial<Row> = {}): Row => ({
  id, name: id, email: `${id}@exemplo.test`, role, active: true, password: 'hash-de-fixture',
  groupKeys: [DEFAULT_GROUP_KEY[role]], techGroupKeys: [], ...extra,
});
const everyRole = () => roles.map((r) => row(`u-${r}`, r));

const linkMatches = (keys: string[], cond: any): boolean =>
  keys.some((k) => {
    const pg = cond.some.permissionGroup;
    if (pg.defaultKey !== undefined) return k === pg.defaultKey;
    if (pg.permissions?.has !== undefined) return GROUPS[k].includes(pg.permissions.has);
    throw new Error(`where nao suportado: ${JSON.stringify(cond)}`);
  });

const matches = (u: Row, where: any): boolean =>
  Object.entries(where).every(([k, v]: [string, any]) => {
    switch (k) {
      case 'active': return u.active === v;
      case 'password': return v.not === null ? u.password !== null : false;
      case 'role': return typeof v === 'string' ? u.role === v : v.in.includes(u.role);
      case 'id': return v.in ? v.in.includes(u.id) : v.notIn ? !v.notIn.includes(u.id) : false;
      case 'OR': return v.some((w: any) => matches(u, w));
      case 'permissionGroupLinks': return linkMatches(u.groupKeys, v);
      case 'technicalGroup': return linkMatches(u.techGroupKeys, v.permissionGroupLinks);
      default: throw new Error(`where nao suportado: ${k}`);
    }
  });

const build = (flagOn: boolean, table: Row[]) => {
  const user = {
    findMany: jest.fn(async ({ where }: any) => table.filter((u) => matches(u, where))),
    count: jest.fn(async ({ where }: any) => table.filter((u) => matches(u, where)).length),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const prisma: any = { user, serviceDesk: { findMany: jest.fn(async () => []) }, $transaction: (fn: any) => fn({ user }) };
  const service = new UsersService(prisma, new UserAccess({ isRbacPermissionOnly: () => flagOn } as any));
  return { service, user };
};
const admin = { id: 'u-ADMIN', role: Role.ADMIN };
const idsOf = (list: { id: string }[]) => list.map((u) => u.id).sort();

describe('UsersService.findAgents: grupos padrao dao o mesmo resultado nos dois modos', () => {
  describe.each(modes)('%s', (_label, flagOn) => {
    it.each(roles)('%s: entra na lista so quem e atendente (ADMIN, AGENT_MASTER, AGENT)', async (role) => {
      const { service } = build(flagOn, everyRole());
      const listed = idsOf(await service.findAgents(admin)).includes(`u-${role}`);
      expect(listed).toBe(role === Role.ADMIN || role === Role.AGENT_MASTER || role === Role.AGENT);
    });

    it('inativo e convite pendente nao entram', async () => {
      const { service } = build(flagOn, [row('ok', Role.AGENT), row('off', Role.AGENT, { active: false }), row('convite', Role.AGENT, { password: null })]);
      expect(idsOf(await service.findAgents(admin))).toEqual(['ok']);
    });
  });

  it('flag ligada: a lista segue a permissao, nao o rotulo do perfil', async () => {
    const table = [
      row('rotulo-agent-sem-grupo', Role.AGENT, { groupKeys: [] }),
      row('cliente-com-permissao', Role.CLIENT, { groupKeys: ['custom-worklogs'] }),
      row('cliente-via-grupo-tecnico', Role.CLIENT, { groupKeys: [], techGroupKeys: ['custom-worklogs'] }),
    ];
    const { service } = build(true, table);
    expect(idsOf(await service.findAgents(admin))).toEqual(['cliente-com-permissao', 'cliente-via-grupo-tecnico']);
  });

  it('flag desligada: a lista segue o rotulo do perfil, nao a permissao', async () => {
    const table = [
      row('rotulo-agent-sem-grupo', Role.AGENT, { groupKeys: [] }),
      row('cliente-com-permissao', Role.CLIENT, { groupKeys: ['custom-worklogs'] }),
    ];
    const { service } = build(false, table);
    expect(idsOf(await service.findAgents(admin))).toEqual(['rotulo-agent-sem-grupo']);
  });

  it('flag ligada: quem nao e ADMIN segue com o escopo por mesa e a lista por permissao', async () => {
    const { service, user } = build(true, everyRole());
    await service.findAgents({ id: 'u-AGENT', role: Role.AGENT });
    expect(user.findMany.mock.calls[0][0].where).toMatchObject({ OR: expect.any(Array), id: { in: [] } });
  });
});

describe('UsersService.setActiveMany: protecao do ultimo administrador ativo', () => {
  const inactivate = (service: UsersService, ids: string[], actor = 'u-outro') => service.setActiveMany(ids, false, actor);

  describe.each(modes)('%s: perfil e grupo coincidem (grupos padrao)', (_label, flagOn) => {
    it('um unico administrador ativo: 409 e nada gravado', async () => {
      const { service, user } = build(flagOn, [row('adm-1', Role.ADMIN), row('ag', Role.AGENT)]);
      await expect(inactivate(service, ['adm-1'])).rejects.toThrow(ConflictException);
      expect(user.updateMany).not.toHaveBeenCalled();
    });

    it('dois administradores ativos: inativar um e permitido', async () => {
      const { service, user } = build(flagOn, [row('adm-1', Role.ADMIN), row('adm-2', Role.ADMIN)]);
      await inactivate(service, ['adm-1']);
      expect(user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['adm-1'] } }, data: { active: false } });
    });

    it('dois administradores ativos: inativar os dois no mesmo lote e 409', async () => {
      const { service, user } = build(flagOn, [row('adm-1', Role.ADMIN), row('adm-2', Role.ADMIN)]);
      await expect(inactivate(service, ['adm-1', 'adm-2'])).rejects.toThrow(ConflictException);
      expect(user.updateMany).not.toHaveBeenCalled();
    });

    it('o outro administrador esta inativo: o unico ativo fica protegido', async () => {
      const { service } = build(flagOn, [row('adm-1', Role.ADMIN), row('adm-2', Role.ADMIN, { active: false })]);
      await expect(inactivate(service, ['adm-1'])).rejects.toThrow(ConflictException);
    });

    it('administrador ja inativo: inativar de novo nao e barrado', async () => {
      const { service, user } = build(flagOn, [row('adm-1', Role.ADMIN), row('adm-2', Role.ADMIN, { active: false })]);
      await inactivate(service, ['adm-2']);
      expect(user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('quem nao e administrador inativa livre, mesmo havendo um unico administrador', async () => {
      const { service, user } = build(flagOn, [row('adm-1', Role.ADMIN), row('ag', Role.AGENT)]);
      await inactivate(service, ['ag']);
      expect(user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('ninguem inativa a si mesmo', async () => {
      const { service } = build(flagOn, [row('adm-1', Role.ADMIN), row('adm-2', Role.ADMIN)]);
      await expect(inactivate(service, ['adm-1'], 'adm-1')).rejects.toThrow(ConflictException);
    });

    it('ativar nao sofre a protecao', async () => {
      const { service, user } = build(flagOn, [row('adm-1', Role.ADMIN, { active: false })]);
      await service.setActiveMany(['adm-1'], true, 'u-outro');
      expect(user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['adm-1'] } }, data: { active: true } });
    });
  });

  describe('o criterio muda com a flag', () => {
    const rotuloAdminSemGrupo = () => row('rotulo-admin', Role.ADMIN, { groupKeys: [] });
    const agenteNoGrupoAdmin = (id = 'agente-no-grupo') => row(id, Role.AGENT, { groupKeys: [DEFAULT_GROUP_KEY[Role.ADMIN]] });

    it('flag desligada: perfil ADMIN sem o grupo e protegido', async () => {
      const { service } = build(false, [rotuloAdminSemGrupo()]);
      await expect(inactivate(service, ['rotulo-admin'])).rejects.toThrow(ConflictException);
    });

    it('flag ligada: perfil ADMIN sem o grupo e so rotulo, nao e protegido', async () => {
      const { service, user } = build(true, [rotuloAdminSemGrupo()]);
      await inactivate(service, ['rotulo-admin']);
      expect(user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('flag ligada: perfil AGENT no grupo Administrador, sendo o ultimo, fica protegido', async () => {
      const { service } = build(true, [agenteNoGrupoAdmin()]);
      await expect(inactivate(service, ['agente-no-grupo'])).rejects.toThrow(ConflictException);
    });

    it('flag desligada: perfil AGENT no grupo Administrador nao e protegido', async () => {
      const { service, user } = build(false, [agenteNoGrupoAdmin()]);
      await inactivate(service, ['agente-no-grupo']);
      expect(user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('flag ligada: o rotulo ADMIN fora do grupo nao conta como "outro administrador"', async () => {
      const { service } = build(true, [row('adm-1', Role.ADMIN), rotuloAdminSemGrupo()]);
      await expect(inactivate(service, ['adm-1'])).rejects.toThrow(ConflictException);
    });

    it('flag ligada: com dois membros do grupo Administrador (qualquer perfil), inativar um e permitido', async () => {
      const { service, user } = build(true, [agenteNoGrupoAdmin('a'), agenteNoGrupoAdmin('b')]);
      await inactivate(service, ['a']);
      expect(user.updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
