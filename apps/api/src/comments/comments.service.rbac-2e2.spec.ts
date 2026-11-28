import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CommentsService } from './comments.service';
import { legacyMaskAccess } from './mask-access.testing';
import { ScopeAccess } from '../core/security/scope-access';
import { SCOPE_KEYS } from '../core/security/scope-resolver';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import type { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2e2 do tracker #523 (#584): CommentsService.assertTicketVisibleTo sobre o ScopeAccess.
 * Hoje so o CLIENT e barrado (nao e dono do chamado). Os casos CARACTERIZACAO (CLIENT_MASTER de
 * outra organizacao e AGENT sem vinculo leem e comentam) NAO sao corrigidos aqui: dependem de decisao do dono.
 */
const K = SCOPE_KEYS;
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const userOf = (role: Role, organizationId?: string | null, id = `u-${role}`): CurrentUserPayload => ({ id, role, organizationId });
const scopeOf = (flagOn: boolean, grants: Record<string, string[]>) => {
  const getEffectivePermissions = jest.fn(async (id: string) => new Set(grants[id] ?? []));
  return {
    scope: new ScopeAccess({ isRbacPermissionOnly: () => flagOn } as any, { getEffectivePermissions } as any),
    getEffectivePermissions,
  };
};
const defaults = (): Record<string, string[]> =>
  Object.fromEntries(roles.map((r) => [`u-${r}`, DEFAULT_PERMISSION_GROUPS[r].permissions]));

const makeService = (requesterId: string, scope?: ScopeAccess) => {
  const prisma: any = {
    ticket: { findUnique: jest.fn().mockResolvedValue({ id: 't1', requesterId, serviceDesk: null }) },
    comment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }) => Promise.resolve({ id: 'c1', ...data, author: { email: 'a@x' } })),
    },
  };
  const service = new CommentsService(prisma, { emit: jest.fn() } as never, legacyMaskAccess(), undefined, scope);
  return { prisma, service };
};

describe.each(modes)('CommentsService.assertTicketVisibleTo (%s)', (_label, flagOn) => {
  it.each(roles)('grupo padrao de %s: so o CLIENT e barrado em chamado alheio (listar e comentar)', async (role) => {
    const { scope } = scopeOf(flagOn, defaults());
    const { service, prisma } = makeService('someone-else', scope);
    const user = userOf(role, 'org-a');
    if (role === Role.CLIENT) {
      await expect(service.findByTicket('t1', user)).rejects.toThrow(NotFoundException);
      await expect(service.create('t1', { content: 'oi' }, user)).rejects.toThrow(NotFoundException);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    } else {
      await expect(service.findByTicket('t1', user)).resolves.toEqual([]);
      await expect(service.create('t1', { content: 'oi' }, user)).resolves.toMatchObject({ id: 'c1' });
    }
  });

  it('CLIENT le e comenta o proprio chamado', async () => {
    const { scope } = scopeOf(flagOn, defaults());
    const user = userOf(Role.CLIENT, 'org-a');
    const { service } = makeService(user.id, scope);
    await expect(service.findByTicket('t1', user)).resolves.toEqual([]);
    await expect(service.create('t1', { content: 'oi' }, user)).resolves.toMatchObject({ id: 'c1' });
  });

  it('chamado inexistente: NotFound em qualquer perfil', async () => {
    const { scope } = scopeOf(flagOn, defaults());
    const { service, prisma } = makeService('x', scope);
    prisma.ticket.findUnique.mockResolvedValue(null);
    for (const role of roles) await expect(service.findByTicket('t1', userOf(role))).rejects.toThrow(NotFoundException);
  });

  it('CARACTERIZACAO preservada: CLIENT_MASTER de outra organizacao le e comenta (nao corrigido)', async () => {
    const { scope } = scopeOf(flagOn, defaults());
    const { service } = makeService('requester-de-org-b', scope);
    const master = userOf(Role.CLIENT_MASTER, 'org-a');
    await expect(service.findByTicket('t1', master)).resolves.toEqual([]);
    await expect(service.create('t1', { content: 'oi' }, master)).resolves.toMatchObject({ id: 'c1' });
  });

  it('CARACTERIZACAO preservada: CLIENT_MASTER sem organizacao tambem le (nao corrigido)', async () => {
    const { scope } = scopeOf(flagOn, defaults());
    const { service } = makeService('alguem', scope);
    await expect(service.findByTicket('t1', userOf(Role.CLIENT_MASTER, null))).resolves.toEqual([]);
  });

  it('CARACTERIZACAO preservada: AGENT sem vinculo a mesa le e comenta (nao corrigido)', async () => {
    const { scope } = scopeOf(flagOn, defaults());
    const { service } = makeService('alguem', scope);
    const agent = userOf(Role.AGENT);
    await expect(service.findByTicket('t1', agent)).resolves.toEqual([]);
    await expect(service.create('t1', { content: 'oi' }, agent)).resolves.toMatchObject({ id: 'c1' });
  });

  it('desligada nao consulta permissoes; ligada consulta as do usuario', async () => {
    const { scope, getEffectivePermissions } = scopeOf(flagOn, defaults());
    const { service } = makeService('alguem', scope);
    await service.findByTicket('t1', userOf(Role.AGENT));
    if (flagOn) expect(getEffectivePermissions).toHaveBeenCalledWith('u-AGENT');
    else expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('ADMIN sem chave de escopo: so a flag ligada nega (fail-closed)', async () => {
    const { scope } = scopeOf(flagOn, { 'u-ADMIN': [] });
    const { service } = makeService('alguem', scope);
    const result = service.findByTicket('t1', userOf(Role.ADMIN));
    if (flagOn) await expect(result).rejects.toThrow(NotFoundException);
    else await expect(result).resolves.toEqual([]);
  });

  it('CLIENT com VIEW_ALL_TICKETS: so a flag ligada le chamado alheio', async () => {
    const { scope } = scopeOf(flagOn, { 'u-CLIENT': [K.TICKETS_OWN, K.TICKETS_ALL] });
    const { service } = makeService('alguem', scope);
    const result = service.findByTicket('t1', userOf(Role.CLIENT));
    if (flagOn) await expect(result).resolves.toEqual([]);
    else await expect(result).rejects.toThrow(NotFoundException);
  });

  it('AGENT so com VIEW_OWN_TICKETS: so a flag ligada barra chamado alheio', async () => {
    const { scope } = scopeOf(flagOn, { 'u-AGENT': [K.TICKETS_OWN] });
    const { service } = makeService('alguem', scope);
    const result = service.findByTicket('t1', userOf(Role.AGENT));
    if (flagOn) await expect(result).rejects.toThrow(NotFoundException);
    else await expect(result).resolves.toEqual([]);
  });

  it('usuario com so VIEW_OWN_TICKETS le o proprio chamado', async () => {
    const { scope } = scopeOf(flagOn, { 'u-AGENT': [K.TICKETS_OWN] });
    const { service } = makeService('u-AGENT', scope);
    await expect(service.findByTicket('t1', userOf(Role.AGENT))).resolves.toEqual([]);
  });
});

describe('CommentsService.withTransaction propaga o ScopeAccess (flag ligada, permissao diferente do perfil)', () => {
  it('findByTicket e create da copia transacional barram pelas permissoes, nao pelo perfil', async () => {
    const { scope } = scopeOf(true, { 'u-ADMIN': [] });
    const base = makeService('alguem', scope).service;
    const tx = makeService('alguem', undefined).prisma;
    const copy = base.withTransaction(tx as never, []);
    await expect(copy.findByTicket('t1', userOf(Role.ADMIN))).rejects.toThrow(NotFoundException);
    await expect(copy.create('t1', { content: 'oi' }, userOf(Role.ADMIN))).rejects.toThrow(NotFoundException);
    expect(tx.comment.create).not.toHaveBeenCalled();
  });
});
