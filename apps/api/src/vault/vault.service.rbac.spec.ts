import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { VaultService } from './vault.service';
import { VaultAccess } from './vault-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2b (#546): gestao do cofre e trilha de auditoria nos dois modos da flag
 * `rbac-permission-only`. Desligada: so ADMIN. Ligada: so as chaves do controller.
 * Fixtures sao marcadores inertes; nada de segredo real.
 */
const FAKE = { user: 'fixture-user', pass: 'fixture-pass' };
const MANAGE = 'MANAGE_PASSWORD_VAULT';
const AUDIT = 'VIEW_PASSWORD_VAULT_AUDIT';

const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const build = (flagOn: boolean, grants: Record<string, string[]>) => {
  const prisma: any = {
    credential: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null, username: FAKE.user, password: FAKE.pass }),
      findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null }),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null }),
      update: jest.fn().mockResolvedValue({ id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null, username: FAKE.user, password: FAKE.pass }),
      delete: jest.fn().mockResolvedValue({}),
    },
    credentialFolder: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'f1', name: 'Pasta', organizationId: 'org-1', _count: { credentials: 0 } }),
      create: jest.fn().mockResolvedValue({ id: 'f1', name: 'Pasta', organizationId: 'org-1' }),
      update: jest.fn().mockResolvedValue({ id: 'f1', name: 'Pasta' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    credentialAuditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Ator' }) },
  };
  const hasPermission = jest.fn(async (userId: string, ...keys: string[]) => (grants[userId] ?? []).some((k) => keys.includes(k)));
  const access = new VaultAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any);
  const touched = () =>
    [prisma.credential, prisma.credentialFolder, prisma.credentialAuditLog].some((model) =>
      Object.values(model).some((fn) => (fn as jest.Mock).mock.calls.length > 0),
    );
  return { service: new VaultService(prisma, access), prisma, hasPermission, touched };
};

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const user = (role: Role, id = `u-${role}`) => ({ id, email: 'x@example.com', role, organizationId: 'org-1' }) as any;

type Run = (service: VaultService, u: any) => Promise<unknown>;
const manageActions: Array<[string, Run]> = [
  ['createFolder', (s, u) => s.createFolder({ name: 'Pasta' } as any, u)],
  ['updateFolder', (s, u) => s.updateFolder('f1', { name: 'Novo' } as any, u)],
  ['removeFolder', (s, u) => s.removeFolder('f1', u)],
  ['createCredential', (s, u) => s.createCredential({ name: 'Cred', username: FAKE.user, password: FAKE.pass } as any, u)],
  ['updateCredential', (s, u) => s.updateCredential('c1', { name: 'Novo' } as any, u)],
  ['removeCredential', (s, u) => s.removeCredential('c1', u)],
];
const auditAction: [string, Run] = ['findAudit', (s, u) => s.findAudit({} as any, u)];
const allActions: Array<[string, Run, string]> = [
  ...manageActions.map(([n, r]) => [n, r, MANAGE] as [string, Run, string]),
  [auditAction[0], auditAction[1], AUDIT],
];

describe('VaultService: grupos padrao dao o mesmo resultado nos dois modos', () => {
  const allowed = { ADMIN: true, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: false, CLIENT: false } as const;

  describe.each(modes)('%s', (_label, flagOn) => {
    describe.each(allActions)('%s', (_name, run) => {
      it.each(roles)('%s conforme o grupo padrao', async (role) => {
        const { service, touched } = build(flagOn, defaultGrants());
        const result = run(service, user(role));
        if (allowed[role]) {
          await expect(result).resolves.toBeDefined();
        } else {
          await expect(result).rejects.toBeInstanceOf(ForbiddenException);
          expect(touched()).toBe(false);
        }
      });
    });
  });

  it('so o grupo Administrador tem as chaves de gestao e de auditoria (nenhum grupo padrao nao-admin amplia acesso)', () => {
    for (const role of roles) {
      const keys = DEFAULT_PERMISSION_GROUPS[role].permissions;
      expect(keys.includes(MANAGE)).toBe(role === Role.ADMIN);
      expect(keys.includes(AUDIT)).toBe(role === Role.ADMIN);
    }
  });
});

describe('VaultService: flag desligada decide so por perfil', () => {
  it.each(allActions)('%s: grupo customizado com a chave nao libera AGENT e a permissao nem e consultada', async (_name, run, key) => {
    const { service, hasPermission, touched } = build(false, { 'u-AGENT': [key] });
    await expect(run(service, user(Role.AGENT))).rejects.toBeInstanceOf(ForbiddenException);
    expect(touched()).toBe(false);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it.each(allActions)('%s: ADMIN passa sem consultar permissao', async (_name, run) => {
    const { service, hasPermission } = build(false, {});
    await expect(run(service, user(Role.ADMIN))).resolves.toBeDefined();
    expect(hasPermission).not.toHaveBeenCalled();
  });
});

describe('VaultService: flag ligada decide so por permissao', () => {
  it.each(allActions)('%s: grupo customizado com a chave libera qualquer perfil', async (_name, run, key) => {
    for (const role of roles) {
      const { service, hasPermission } = build(true, { [`u-${role}`]: [key] });
      await expect(run(service, user(role))).resolves.toBeDefined();
      expect(hasPermission).toHaveBeenCalledWith(`u-${role}`, key);
    }
  });

  it.each(allActions)('%s: ADMIN sem a chave e barrado (sem bypass de perfil)', async (_name, run) => {
    const { service, touched } = build(true, { 'u-ADMIN': ['VIEW_PASSWORD_VAULT'] });
    await expect(run(service, user(Role.ADMIN))).rejects.toBeInstanceOf(ForbiddenException);
    expect(touched()).toBe(false);
  });

  it.each(manageActions)('%s: a chave de auditoria nao libera a gestao', async (_name, run) => {
    const { service, touched } = build(true, { 'u-AGENT': [AUDIT] });
    await expect(run(service, user(Role.AGENT))).rejects.toBeInstanceOf(ForbiddenException);
    expect(touched()).toBe(false);
  });

  it('findAudit: a chave de gestao nao libera a auditoria', async () => {
    const { service, touched } = build(true, { 'u-AGENT': [MANAGE] });
    await expect(service.findAudit({} as any, user(Role.AGENT))).rejects.toBeInstanceOf(ForbiddenException);
    expect(touched()).toBe(false);
  });

  it('a chave de leitura (VIEW_PASSWORD_VAULT) nao libera gestao nem auditoria', async () => {
    const { service } = build(true, { 'u-AGENT': ['VIEW_PASSWORD_VAULT'] });
    await expect(service.createFolder({ name: 'P' } as any, user(Role.AGENT))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findAudit({} as any, user(Role.AGENT))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('usuario sem grupo algum e barrado', async () => {
    const { service } = build(true, {});
    await expect(service.removeCredential('c1', user(Role.AGENT_MASTER))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('VaultService: auditoria e mascaramento seguem iguais com a flag ligada', () => {
  it('createCredential por grupo customizado audita o ator e nao devolve segredo cru', async () => {
    const { service, prisma } = build(true, { 'u-AGENT': [MANAGE] });
    const res: any = await service.createCredential({ name: 'Cred', username: FAKE.user, password: FAKE.pass } as any, user(Role.AGENT));
    expect(res).toMatchObject({ hasUsername: true, hasPassword: true });
    expect(JSON.stringify(res)).not.toContain(FAKE.pass);
    expect(prisma.credentialAuditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: 'u-AGENT' });
  });
});
