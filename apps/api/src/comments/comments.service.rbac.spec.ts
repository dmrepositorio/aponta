import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CommentsService } from './comments.service';
import { legacyMaskAccess } from './mask-access.testing';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Fase 0b-2 (#526), tracker #523: caracterização por perfil do CommentsService.
 * Trava o comportamento ATUAL; nenhum teste aqui corrige ou aprova o que é risco.
 */
describe('CommentsService: matriz por perfil (caracterização)', () => {
  const ALL_ROLES: Role[] = [
    Role.ADMIN,
    Role.AGENT_MASTER,
    Role.AGENT,
    Role.CLIENT_MASTER,
    Role.CLIENT,
  ];
  const user = (role: Role, extra: Partial<CurrentUserPayload> = {}): CurrentUserPayload => ({
    id: `${role.toLowerCase()}-1`,
    role,
    ...extra,
  });

  let prisma: {
    ticket: { findUnique: jest.Mock };
    comment: { create: jest.Mock; findMany: jest.Mock };
  };
  let emit: jest.Mock;
  let service: CommentsService;

  /** Chamado cujo solicitante NÃO é nenhum dos usuários da matriz. */
  const foreignTicket = (extra: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    requesterId: 'someone-else',
    serviceDesk: null,
    ...extra,
  });
  const listedDesk = { listedGroupsOnly: true, agents: [], agentGroups: [] };

  beforeEach(() => {
    prisma = {
      ticket: { findUnique: jest.fn() },
      comment: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 'c-1', ...data, author: { email: 'a@x' } })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    emit = jest.fn();
    service = new CommentsService(prisma as never, { emit } as never, legacyMaskAccess());
  });

  describe('create: isInternal por perfil', () => {
    it.each([
      [Role.ADMIN, true],
      [Role.AGENT_MASTER, true],
      [Role.AGENT, true],
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      [Role.CLIENT_MASTER, true],
      [Role.CLIENT, false],
    ])('%s pedindo isInternal=true grava isInternal=%s', async (role, expected) => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ requesterId: user(role).id }));
      const result = await service.create('ticket-1', { content: 'nota', isInternal: true }, user(role));
      expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(expected);
      expect(result.isInternal).toBe(expected);
    });

    it.each(ALL_ROLES)('%s sem informar isInternal grava comentário público', async (role) => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ requesterId: user(role).id }));
      await service.create('ticket-1', { content: 'oi' }, user(role));
      expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(false);
    });

    it('grava o autor como o usuário logado, nunca um id do corpo', async () => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket());
      await service.create('ticket-1', { content: 'oi' }, user(Role.AGENT));
      expect(prisma.comment.create.mock.calls[0][0].data.authorId).toBe('agent-1');
    });
  });

  describe('create: mesa com listedGroupsOnly (comentário interno)', () => {
    it.each([Role.AGENT, Role.AGENT_MASTER])('%s fora da lista da mesa é barrado no comentário interno', async (role) => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: listedDesk }));
      await expect(service.create('ticket-1', { content: 'x', isInternal: true }, user(role))).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s listado diretamente na mesa publica comentário interno', async (role) => {
      const desk = { ...listedDesk, agents: [{ id: user(role).id }] };
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: desk }));
      await service.create('ticket-1', { content: 'x', isInternal: true }, user(role));
      expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(true);
    });

    it('agente listado por grupo da mesa publica comentário interno', async () => {
      const desk = { ...listedDesk, agentGroups: [{ members: [{ id: 'agent-1' }] }] };
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: desk }));
      await service.create('ticket-1', { content: 'x', isInternal: true }, user(Role.AGENT));
      expect(prisma.comment.create).toHaveBeenCalledTimes(1);
    });

    it('ADMIN fora da lista publica comentário interno', async () => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: listedDesk }));
      await service.create('ticket-1', { content: 'x', isInternal: true }, user(Role.ADMIN));
      expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(true);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s fora da lista ainda publica comentário PÚBLICO (a trava é só do interno)', async (role) => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: listedDesk }));
      await service.create('ticket-1', { content: 'x', isInternal: false }, user(role));
      expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(false);
    });

    it('mesa sem listedGroupsOnly não barra agente fora da lista no comentário interno', async () => {
      const desk = { ...listedDesk, listedGroupsOnly: false };
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: desk }));
      await service.create('ticket-1', { content: 'x', isInternal: true }, user(Role.AGENT));
      expect(prisma.comment.create).toHaveBeenCalledTimes(1);
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('CLIENT_MASTER publica interno em mesa listada: assertListedAgentMayMutate ignora papel de cliente', async () => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ serviceDesk: listedDesk }));
      await service.create('ticket-1', { content: 'x', isInternal: true }, user(Role.CLIENT_MASTER));
      expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(true);
    });
  });

  describe('assertTicketVisibleTo (via create e findByTicket)', () => {
    it('chamado inexistente: NotFound para todos os perfis, em create e em findByTicket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);
      for (const role of ALL_ROLES) {
        await expect(service.create('x', { content: 'a' }, user(role))).rejects.toThrow(NotFoundException);
        await expect(service.findByTicket('x', user(role))).rejects.toThrow(NotFoundException);
      }
    });

    it('CLIENT em chamado de outro solicitante recebe NotFound (não Forbidden) em create e findByTicket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket());
      await expect(service.create('ticket-1', { content: 'a' }, user(Role.CLIENT))).rejects.toThrow(NotFoundException);
      await expect(service.findByTicket('ticket-1', user(Role.CLIENT))).rejects.toThrow(NotFoundException);
      expect(prisma.comment.create).not.toHaveBeenCalled();
      expect(prisma.comment.findMany).not.toHaveBeenCalled();
    });

    it('CLIENT no próprio chamado passa', async () => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ requesterId: 'client-1' }));
      await expect(service.findByTicket('ticket-1', user(Role.CLIENT))).resolves.toEqual([]);
    });

    it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT])(
      '%s passa em chamado de outro solicitante',
      async (role) => {
        prisma.ticket.findUnique.mockResolvedValue(foreignTicket());
        await expect(service.findByTicket('ticket-1', user(role))).resolves.toEqual([]);
      },
    );

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('CLIENT_MASTER de OUTRA organização lê e comenta chamado alheio: só CLIENT é barrado', async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        foreignTicket({ requester: { organizationId: 'org-b' } }),
      );
      const master = user(Role.CLIENT_MASTER, { organizationId: 'org-a' });
      await expect(service.findByTicket('ticket-1', master)).resolves.toEqual([]);
      await expect(service.create('ticket-1', { content: 'a' }, master)).resolves.toBeDefined();
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('AGENT sem vínculo com a mesa do chamado (mesa não listada) lê e comenta: sem checagem de acesso à mesa', async () => {
      prisma.ticket.findUnique.mockResolvedValue(
        foreignTicket({ serviceDesk: { listedGroupsOnly: false, agents: [], agentGroups: [] } }),
      );
      await expect(service.findByTicket('ticket-1', user(Role.AGENT))).resolves.toEqual([]);
      await expect(service.create('ticket-1', { content: 'a' }, user(Role.AGENT))).resolves.toBeDefined();
    });

    it('a busca do chamado traz os dados da mesa que a regra de lista precisa', async () => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket());
      await service.findByTicket('ticket-1', user(Role.ADMIN));
      expect(prisma.ticket.findUnique.mock.calls[0][0]).toMatchObject({
        where: { id: 'ticket-1' },
        include: {
          serviceDesk: {
            select: {
              listedGroupsOnly: true,
              agents: { select: { id: true } },
              agentGroups: { select: { members: { select: { id: true } } } },
            },
          },
        },
      });
    });
  });

  describe('findByTicket: filtro de comentários internos', () => {
    beforeEach(() => {
      prisma.ticket.findUnique.mockImplementation(() => Promise.resolve(foreignTicket({ requesterId: 'client-1' })));
    });

    it('CLIENT filtra internos na consulta (isInternal=false)', async () => {
      await service.findByTicket('ticket-1', user(Role.CLIENT));
      expect(prisma.comment.findMany.mock.calls[0][0].where).toEqual({ ticketId: 'ticket-1', isInternal: false });
    });

    it.each([
      [Role.ADMIN],
      [Role.AGENT_MASTER],
      [Role.AGENT],
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      [Role.CLIENT_MASTER],
    ])('%s NÃO filtra internos: a consulta traz todos (comments.service.ts:116)', async (role) => {
      await service.findByTicket('ticket-1', user(role));
      expect(prisma.comment.findMany.mock.calls[0][0].where).toEqual({ ticketId: 'ticket-1' });
    });

    it('ordena cronologicamente para todos', async () => {
      for (const role of ALL_ROLES) {
        await service.findByTicket('ticket-1', user(role));
      }
      for (const call of prisma.comment.findMany.mock.calls) {
        expect(call[0].orderBy).toEqual({ createdAt: 'asc' });
      }
    });
  });

  describe('findByTicket: nome do autor da equipe', () => {
    const rows = [
      { id: 'k1', author: { id: 'u-admin', name: 'Adm', role: Role.ADMIN } },
      { id: 'k2', author: { id: 'u-am', name: 'AgM', role: Role.AGENT_MASTER } },
      { id: 'k3', author: { id: 'u-ag', name: 'Ag', role: Role.AGENT } },
      { id: 'k4', author: { id: 'u-cm', name: 'CliM', role: Role.CLIENT_MASTER } },
      { id: 'k5', author: { id: 'u-c', name: 'Cli', role: Role.CLIENT } },
    ];
    beforeEach(() => {
      prisma.ticket.findUnique.mockResolvedValue(foreignTicket({ requesterId: 'client-1' }));
      prisma.comment.findMany.mockResolvedValue(rows);
    });
    const names = (list: Array<{ author: { name: string | null } | null }>) => list.map((c) => c.author?.name);

    it('CLIENT vê nome só de autores cliente; equipe vem com nome nulo, id e papel preservados', async () => {
      const list = await service.findByTicket('ticket-1', user(Role.CLIENT));
      expect(names(list)).toEqual([null, null, null, 'CliM', 'Cli']);
      expect(list[0].author).toEqual({ id: 'u-admin', name: null, role: Role.ADMIN });
    });

    it.each([
      [Role.ADMIN],
      [Role.AGENT_MASTER],
      [Role.AGENT],
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      [Role.CLIENT_MASTER],
    ])('%s vê o nome de todos os autores, inclusive da equipe', async (role) => {
      const list = await service.findByTicket('ticket-1', user(role));
      expect(names(list)).toEqual(['Adm', 'AgM', 'Ag', 'CliM', 'Cli']);
    });

    it('autor ausente vira null para qualquer perfil', async () => {
      prisma.comment.findMany.mockResolvedValue([{ id: 'k9', author: null }]);
      for (const role of ALL_ROLES) {
        const [row] = await service.findByTicket('ticket-1', user(role, { id: 'client-1' }));
        expect(row.author).toBeNull();
      }
    });
  });

  describe('create: evento de comentário', () => {
    it('emite ticket.commented com e-mails de autor, solicitante e responsável', async () => {
      prisma.ticket.findUnique
        .mockResolvedValueOnce(foreignTicket())
        .mockResolvedValueOnce({ id: 'ticket-1', requester: { email: 'r@x' }, agent: { email: 'g@x' } });
      await service.create('ticket-1', { content: 'x' }, user(Role.AGENT));
      expect(emit).toHaveBeenCalledWith(
        'ticket.commented',
        expect.objectContaining({ authorEmail: 'a@x', requesterEmail: 'r@x', agentEmail: 'g@x' }),
      );
    });
  });
});
