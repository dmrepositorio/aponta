import { ForbiddenException } from '@nestjs/common';
import { CredentialAction, Role } from '@prisma/client';
import { VaultService } from './vault.service';
import { VaultAccess } from './vault-access';
import { VaultController } from './vault.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permission.decorator';

/**
 * Caracterização por perfil do cofre (#527, Fase 0b-3 do tracker #523).
 * Só trava QUEM passa e QUEM é barrado no service; não toca revelação,
 * mascaramento, auditoria nem criptografia. Valores de fixture são marcadores
 * inertes (nunca segredos reais) e nada é logado.
 */
const FAKE = { user: 'fixture-user', pass: 'fixture-pass' };

const actors = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
  client: { id: 'u-client', role: Role.CLIENT },
};

describe('VaultService: matriz por perfil (caracterização)', () => {
  let prisma: any;
  let service: VaultService;

  beforeEach(() => {
    prisma = {
      credential: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null, username: FAKE.user, password: FAKE.pass }),
        findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null, username: FAKE.user, password: FAKE.pass }),
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
    service = new VaultService(prisma, new VaultAccess({ isRbacPermissionOnly: () => false } as any, { hasPermission: jest.fn() } as any));
  });

  const touchedAnything = () =>
    [prisma.credential, prisma.credentialFolder, prisma.credentialAuditLog].some((model) =>
      Object.values(model).some((fn) => (fn as jest.Mock).mock.calls.length > 0),
    );

  // As 7 ações protegidas por assertAdmin (vault.service.ts).
  const adminOnly: Array<[string, (u: any) => Promise<unknown>]> = [
    ['createFolder', (u) => service.createFolder({ name: 'Pasta' } as any, u)],
    ['updateFolder', (u) => service.updateFolder('f1', { name: 'Novo' } as any, u)],
    ['removeFolder', (u) => service.removeFolder('f1', u)],
    ['createCredential', (u) => service.createCredential({ name: 'Cred', username: FAKE.user, password: FAKE.pass } as any, u)],
    ['updateCredential', (u) => service.updateCredential('c1', { name: 'Novo' } as any, u)],
    ['removeCredential', (u) => service.removeCredential('c1', u)],
    ['findAudit', (u) => service.findAudit({} as any, u)],
  ];

  describe.each(adminOnly)('%s (assertAdmin)', (_name, run) => {
    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s: 403 sem tocar em nenhum dado do cofre', async (_label, user) => {
      await expect(run(user)).rejects.toThrow(ForbiddenException);
      expect(touchedAnything()).toBe(false);
    });

    it('ADMIN: passa da checagem de perfil', async () => {
      await expect(run(actors.admin)).resolves.toBeDefined();
    });
  });

  // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
  describe('service ADMIN-only contra controller por permissão', () => {
    const write = ['createFolder', 'updateFolder', 'removeFolder', 'createCredential', 'updateCredential', 'removeCredential'] as const;

    it('o controller exige PERMISSÃO (MANAGE_PASSWORD_VAULT), não perfil, nas escritas e na auditoria', () => {
      for (const name of write) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, VaultController.prototype[name])).toEqual(['MANAGE_PASSWORD_VAULT']);
      }
      expect(Reflect.getMetadata(PERMISSIONS_KEY, VaultController.prototype.findAudit)).toEqual(['VIEW_PASSWORD_VAULT_AUDIT']);
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s com a permissão do grupo ainda leva 403 do service: a regra efetiva é ADMIN-only', async (_label, user) => {
      // O service ignora grupos de permissão; só o perfil ADMIN passa.
      await expect(service.createCredential({ name: 'Cred' } as any, user)).rejects.toThrow(ForbiddenException);
      await expect(service.findAudit({} as any, user)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertVaultAccess: leitura e revelação (ADMIN, AGENT_MASTER, AGENT); clientes fail-closed', () => {
    const readers: Array<[string, (u: any) => Promise<unknown>]> = [
      ['findFolders', (u) => service.findFolders(u)],
      ['findCredentials', (u) => service.findCredentials({}, u)],
      ['reveal', (u) => service.reveal('c1', { field: 'password', intent: 'reveal' } as any, u)],
    ];

    describe.each(readers)('%s', (_name, run) => {
      it.each([
        ['ADMIN', actors.admin],
        ['AGENT_MASTER', actors.agentMaster],
        ['AGENT', actors.agent],
      ])('%s: permitido', async (_label, user) => {
        await expect(run(user)).resolves.toBeDefined();
      });

      it.each([
        ['CLIENT_MASTER', actors.clientMaster],
        ['CLIENT', actors.client],
      ])('%s: 403 sem tocar em dado do cofre', async (_label, user) => {
        await expect(run(user)).rejects.toThrow(ForbiddenException);
        expect(touchedAnything()).toBe(false);
      });
    });

    it('findCredentials: a listagem nunca devolve usuário/senha crus a nenhum perfil que a lê', async () => {
      prisma.credential.findMany.mockResolvedValue([
        { id: 'c1', name: 'Cred', organizationId: 'org-1', folderId: null, username: FAKE.user, password: FAKE.pass },
      ]);
      for (const user of [actors.admin, actors.agentMaster, actors.agent]) {
        const res: any = await service.findCredentials({}, user);
        expect(res.data[0]).toMatchObject({ hasUsername: true, hasPassword: true });
        expect(JSON.stringify(res)).not.toContain(FAKE.pass);
        expect(JSON.stringify(res)).not.toContain(FAKE.user);
      }
    });

    it('reveal: AGENT e AGENT_MASTER revelam e a ação fica auditada com o perfil ator', async () => {
      for (const user of [actors.agentMaster, actors.agent]) {
        prisma.credentialAuditLog.create.mockClear();
        await service.reveal('c1', { field: 'password', intent: 'reveal' } as any, user);
        expect(prisma.credentialAuditLog.create.mock.calls[0][0].data).toMatchObject({
          action: CredentialAction.REVEAL_CREDENTIAL,
          actorId: user.id,
        });
      }
    });
  });
});
