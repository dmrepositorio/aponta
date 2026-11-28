import { ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UserAccess } from '../users/user-access';
import { DEFAULT_GROUP_KEY, GROUP_ONLY_KEYS } from './default-permission-groups';
import { PERMISSION_KEYS } from './permission-catalog';
import { PermissionGroupsService } from './permission-groups.service';

/**
 * Lote 2i (#583): o grupo Administrador (`defaultKey='default-admin'`) nunca fica sem as chaves
 * de gestao de grupos e usuarios nem menor que o catalogo (menos `GROUP_ONLY_KEYS`), e nunca
 * perde o `defaultKey`. E seguranca: vale com a flag `rbac-permission-only` ligada e desligada.
 */
const ADMIN_KEY = DEFAULT_GROUP_KEY[Role.ADMIN];
const REQUIRED = PERMISSION_KEYS.filter((k) => !GROUP_ONLY_KEYS.includes(k));
const ESSENTIAL = ['MANAGE_PERMISSION_GROUPS', 'MANAGE_USERS', 'CREATE_USERS', 'ACTIVATE_DEACTIVATE_USERS', 'SEND_USER_INVITES_AND_RESETS', 'DISABLE_USER_TWO_FACTOR'];
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

type GroupRow = { id: string; name: string; defaultKey: string | null; description: string | null; permissions: string[] };

const build = (flagOn: boolean, adminPermissions: string[] = REQUIRED) => {
  const groups: GroupRow[] = [
    { id: 'g-admin', name: 'Administrador', defaultKey: ADMIN_KEY, description: 'Acesso total', permissions: [...adminPermissions] },
    { id: 'g-agent', name: 'Atendente', defaultKey: DEFAULT_GROUP_KEY[Role.AGENT], description: null, permissions: ['VIEW_AND_OPEN_TICKETS'] },
    { id: 'g-custom', name: 'Financeiro', defaultKey: null, description: null, permissions: ['MANAGE_BILLING'] },
  ];
  const writes: any[] = [];
  const prisma: any = {
    permissionGroup: {
      findUnique: async ({ where }: any) => groups.find((g) => g.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        writes.push(data);
        const g = groups.find((x) => x.id === where.id)!;
        Object.assign(g, data);
        return g;
      },
      create: async ({ data }: any) => {
        writes.push(data);
        return { id: 'g-new', ...data };
      },
    },
  };
  const access = new UserAccess({ isRbacPermissionOnly: () => flagOn } as any);
  const service = new PermissionGroupsService(prisma, access);
  return { groups, writes, service, admin: () => groups.find((g) => g.id === 'g-admin')! };
};

describe('chaves essenciais existem no catalogo', () => {
  it.each(ESSENTIAL)('%s esta em PERMISSION_KEYS e nao e exclusiva de grupo', (key) => {
    expect(PERMISSION_KEYS).toContain(key);
    expect(GROUP_ONLY_KEYS).not.toContain(key);
  });
});

describe.each(modes)('grupo Administrador: %s', (_label, flagOn) => {
  describe('updatePermissions', () => {
    it('barra esvaziar o grupo', async () => {
      const { service, admin } = build(flagOn);
      await expect(service.updatePermissions('g-admin', { permissions: [] })).rejects.toThrow(ConflictException);
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it.each(ESSENTIAL)('barra remover a chave essencial %s e nomeia a chave na mensagem', async (key) => {
      const { service, admin } = build(flagOn);
      await expect(service.updatePermissions('g-admin', { permissions: REQUIRED.filter((k) => k !== key) })).rejects.toThrow(new RegExp(`essenciais.*${key}`));
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it('barra substituir por uma lista menor', async () => {
      const { service, admin } = build(flagOn);
      await expect(service.updatePermissions('g-admin', { permissions: REQUIRED.slice(0, 10) })).rejects.toThrow(ConflictException);
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it('barra remover uma chave nao essencial do catalogo', async () => {
      const { service, admin } = build(flagOn);
      await expect(service.updatePermissions('g-admin', { permissions: REQUIRED.filter((k) => k !== 'MANAGE_BILLING') })).rejects.toThrow('MANAGE_BILLING');
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it('mantendo as essenciais e perdendo so nao essenciais a mensagem e a do catalogo, nao a das essenciais', async () => {
      const { service } = build(flagOn);
      const next = REQUIRED.filter((k) => k !== 'MANAGE_BILLING');
      await expect(service.updatePermissions('g-admin', { permissions: next })).rejects.toThrow('deve conter todas as permissões do catálogo');
    });

    it('acrescentar uma chave exclusiva de grupo mantendo o resto passa', async () => {
      const { service, admin } = build(flagOn);
      await service.updatePermissions('g-admin', { permissions: [...REQUIRED, 'VIEW_TICKET_VALUES'] });
      expect(admin().permissions).toContain('VIEW_TICKET_VALUES');
      expect(admin().permissions).toHaveLength(REQUIRED.length + 1);
    });

    it('reenviar a mesma lista, em outra ordem, passa', async () => {
      const { service, admin } = build(flagOn);
      await service.updatePermissions('g-admin', { permissions: [...REQUIRED].reverse() });
      expect(admin().permissions).toEqual([...REQUIRED].reverse());
    });

    it('tirar so uma chave exclusiva de grupo que o Administrador tinha passa', async () => {
      const { service, admin } = build(flagOn, [...REQUIRED, 'DELETE_TICKETS']);
      await service.updatePermissions('g-admin', { permissions: REQUIRED });
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it('grupo Administrador defasado (sem uma chave nova) so aceita a lista que a restaura', async () => {
      const defasado = REQUIRED.filter((k) => k !== 'MANAGE_BILLING');
      const { service, admin } = build(flagOn, defasado);
      await expect(service.updatePermissions('g-admin', { permissions: defasado })).rejects.toThrow(ConflictException);
      await service.updatePermissions('g-admin', { permissions: REQUIRED });
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it('grupo padrao de outro papel e grupo personalizado seguem editaveis, ate vazios', async () => {
      const { service, groups } = build(flagOn);
      await service.updatePermissions('g-agent', { permissions: [] });
      await service.updatePermissions('g-custom', { permissions: [] });
      expect(groups.find((g) => g.id === 'g-agent')!.permissions).toEqual([]);
      expect(groups.find((g) => g.id === 'g-custom')!.permissions).toEqual([]);
    });
  });

  describe('update (nome, descricao, defaultKey)', () => {
    it('renomear o Administrador passa e o defaultKey continua', async () => {
      const { service, admin, writes } = build(flagOn);
      await service.update('g-admin', { name: 'Superusuarios' });
      expect(admin().name).toBe('Superusuarios');
      expect(admin().defaultKey).toBe(ADMIN_KEY);
      expect(writes[0]).toEqual({ name: 'Superusuarios', description: undefined });
    });

    it('atualizar a descricao do Administrador passa', async () => {
      const { service, admin } = build(flagOn);
      await service.update('g-admin', { description: 'Nova' });
      expect(admin().description).toBe('Nova');
      expect(admin().name).toBe('Administrador');
    });

    it('barra tirar o defaultKey do Administrador pelo update', async () => {
      const { service, admin } = build(flagOn);
      await expect(service.update('g-admin', { defaultKey: null } as any)).rejects.toThrow(ConflictException);
      expect(admin().defaultKey).toBe(ADMIN_KEY);
    });

    it('barra trocar o defaultKey do Administrador por outro valor', async () => {
      const { service, admin } = build(flagOn);
      await expect(service.update('g-admin', { defaultKey: 'outro' } as any)).rejects.toThrow('defaultKey');
      expect(admin().defaultKey).toBe(ADMIN_KEY);
    });

    it('barra nome em branco no Administrador', async () => {
      const { service, admin } = build(flagOn);
      await expect(service.update('g-admin', { name: '   ' })).rejects.toThrow(ConflictException);
      expect(admin().name).toBe('Administrador');
    });

    it('o update nunca grava permissoes: lista no corpo e ignorada', async () => {
      const { service, admin, writes } = build(flagOn);
      await service.update('g-admin', { name: 'X', permissions: [] } as any);
      expect(writes[0]).not.toHaveProperty('permissions');
      expect(admin().permissions).toEqual(REQUIRED);
    });

    it('o update de outro grupo nao grava defaultKey nem permissoes vindos no corpo', async () => {
      const { service, groups, writes } = build(flagOn);
      await service.update('g-custom', { name: 'Fin', defaultKey: ADMIN_KEY, permissions: [] } as any);
      expect(writes[0]).toEqual({ name: 'Fin', description: undefined });
      expect(groups.find((g) => g.id === 'g-custom')!.defaultKey).toBeNull();
    });

    it('editar nome e descricao de outro grupo passa', async () => {
      const { service, groups } = build(flagOn);
      await service.update('g-custom', { name: 'Fin', description: 'd' });
      expect(groups.find((g) => g.id === 'g-custom')).toMatchObject({ name: 'Fin', description: 'd' });
    });
  });

  describe('create', () => {
    it('nunca grava defaultKey vindo no corpo (nao da para forjar um segundo Administrador)', async () => {
      const { service, writes } = build(flagOn);
      await service.create({ name: 'Falso', defaultKey: ADMIN_KEY } as any);
      expect(writes[0]).not.toHaveProperty('defaultKey');
    });
  });
});
