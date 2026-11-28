import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AttachmentsService } from './attachments.service';
import { AttachmentAccess } from './attachment-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a1 (#541): remocao de anexo de ticket nos dois modos da flag
 * `rbac-permission-only`. Desligada: por perfil. Ligada: so por REMOVE_TICKET_ATTACHMENTS.
 */
jest.mock('fs/promises', () => ({ unlink: jest.fn().mockResolvedValue(undefined) }));

const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;
const KEY = 'REMOVE_TICKET_ATTACHMENTS';

const build = (flagOn: boolean, grants: Record<string, string[]>, uploaderId = 'uploader') => {
  const prisma = {
    ticketAttachment: {
      findUnique: jest.fn(async () => (uploaderId === 'none' ? null : { id: 'att-1', filename: 'f.pdf', uploaderId })),
      delete: jest.fn(async () => ({})),
    },
  };
  const hasPermission = jest.fn(async (userId: string, ...keys: string[]) => (grants[userId] ?? []).some((k) => keys.includes(k)));
  const access = new AttachmentAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any);
  return { service: new AttachmentsService(prisma as any, access), prisma, hasPermission };
};

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const user = (role: Role, id = `u-${role}`) => ({ id, email: 'x@example.com', role, organizationId: null }) as any;

describe('AttachmentsService.remove: grupos padrao dao o mesmo resultado nos dois modos', () => {
  const canRemoveOthers = { ADMIN: true, AGENT_MASTER: true, AGENT: true, CLIENT_MASTER: false, CLIENT: false } as const;

  describe.each(modes)('%s', (_label, flagOn) => {
    it.each(roles)('%s remove anexo de outra pessoa conforme o grupo padrao', async (role) => {
      const { service, prisma } = build(flagOn, defaultGrants());
      const result = service.remove('att-1', user(role));
      if (canRemoveOthers[role]) {
        await expect(result).resolves.toEqual({ success: true });
        expect(prisma.ticketAttachment.delete).toHaveBeenCalledTimes(1);
      } else {
        await expect(result).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
      }
    });

    it.each(roles)('%s remove o proprio anexo', async (role) => {
      const { service } = build(flagOn, defaultGrants(), `u-${role}`);
      await expect(service.remove('att-1', user(role))).resolves.toEqual({ success: true });
    });

    it('anexo inexistente continua 404', async () => {
      const { service } = build(flagOn, defaultGrants(), 'none');
      await expect(service.remove('att-1', user(Role.ADMIN))).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('AttachmentsService.remove: flag ligada decide so por permissao', () => {
  it.each([Role.CLIENT, Role.CLIENT_MASTER] as const)('%s com a chave remove anexo de outra pessoa', async (role) => {
    const { service, hasPermission } = build(true, { [`u-${role}`]: [KEY] });
    await expect(service.remove('att-1', user(role))).resolves.toEqual({ success: true });
    expect(hasPermission).toHaveBeenCalledWith(`u-${role}`, KEY);
  });

  it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT] as const)('%s sem a chave nao remove anexo de outra pessoa (sem bypass de perfil)', async (role) => {
    const { service, prisma } = build(true, { [`u-${role}`]: [] });
    await expect(service.remove('att-1', user(role))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
  });

  it('o dono remove o proprio anexo sem a chave e sem consultar permissao', async () => {
    const { service, hasPermission } = build(true, {}, 'u-CLIENT');
    await expect(service.remove('att-1', user(Role.CLIENT))).resolves.toEqual({ success: true });
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('so a chave REMOVE_TICKET_ATTACHMENTS conta', async () => {
    const { service } = build(true, { 'u-AGENT': ['UPLOAD_TICKET_ATTACHMENTS', 'EDIT_TICKETS'] });
    await expect(service.remove('att-1', user(Role.AGENT))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AttachmentsService.remove: flag desligada decide so por perfil', () => {
  it('nao consulta permissao', async () => {
    const { service, hasPermission } = build(false, {});
    await service.remove('att-1', user(Role.AGENT));
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it.each([Role.CLIENT, Role.CLIENT_MASTER] as const)('%s com a chave no grupo continua sem poder (comportamento de hoje)', async (role) => {
    const { service } = build(false, { [`u-${role}`]: [KEY] });
    await expect(service.remove('att-1', user(role))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
