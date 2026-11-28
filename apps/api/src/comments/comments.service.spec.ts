import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CommentsService } from './comments.service';
import { MaskAccess } from './mask-access';
import { legacyMaskAccess } from './mask-access.testing';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

describe('CommentsService', () => {
  let service: CommentsService;
  let mockPrismaService: {
    ticket: {
      findUnique: jest.Mock;
    };
    comment: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };

  const clientUser: CurrentUserPayload = { id: 'client-1', role: Role.CLIENT };
  const otherClient: CurrentUserPayload = { id: 'client-2', role: Role.CLIENT };
  const agentUser: CurrentUserPayload = { id: 'agent-1', role: Role.AGENT };
  const adminUser: CurrentUserPayload = { id: 'admin-1', role: Role.ADMIN };

  const ownedTicket = { id: 'ticket-1', requesterId: 'client-1' };

  beforeEach(async () => {
    mockPrismaService = {
      comment: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      ticket: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: MaskAccess, useValue: legacyMaskAccess() },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a comment on a ticket owned by the CLIENT caller', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.create.mockImplementation(({ data }) => ({
        id: 'comment-1',
        createdAt: new Date(),
        ...data,
      }));

      const dto = { content: 'Any update on this?' };
      const result = await service.create('ticket-1', dto, clientUser);

      expect(mockPrismaService.comment.create).toHaveBeenCalledWith({
        data: {
          content: dto.content,
          isInternal: false,
          ticketId: 'ticket-1',
          authorId: 'client-1',
        },
        include: { author: { select: { email: true } } }
      });
      expect(result.isInternal).toBe(false);
    });

    it('should default isInternal to false for AGENT when the DTO omits it', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.create.mockImplementation(({ data }) => data);

      await service.create('ticket-1', { content: 'Looking into it' }, agentUser);

      expect(mockPrismaService.comment.create).toHaveBeenCalledWith({
        include: expect.any(Object),
        data: expect.objectContaining({ isInternal: false }),
      });
    });

    it.each([[Role.AGENT], [Role.ADMIN]])(
      'should let %s create an internal comment (isInternal: true)',
      async (role) => {
        mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
        mockPrismaService.comment.create.mockImplementation(({ data }) => data);

        const user: CurrentUserPayload = { id: `${role}-user`, role };
        await service.create(
          'ticket-1',
          { content: 'Internal note', isInternal: true },
          user,
        );

        expect(mockPrismaService.comment.create).toHaveBeenCalledWith({
          include: expect.any(Object),
          data: expect.objectContaining({
            isInternal: true,
            authorId: `${role}-user`,
          }),
        });
      },
    );

    it('should force isInternal to false when a CLIENT sends isInternal: true (never trust the client-supplied flag)', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.create.mockImplementation(({ data }) => data);

      await service.create(
        'ticket-1',
        { content: 'Sneaky', isInternal: true },
        clientUser,
      );

      expect(mockPrismaService.comment.create).toHaveBeenCalledWith({
        include: expect.any(Object),
        data: expect.objectContaining({ isInternal: false }),
      });
    });

    it('should throw NotFoundException when the ticket does not exist', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.create('nope', { content: 'hi' }, agentUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.comment.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException (not Forbidden) when a CLIENT comments on a ticket they do not own', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);

      await expect(
        service.create('ticket-1', { content: 'hi' }, otherClient),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.comment.create).not.toHaveBeenCalled();
    });

    it('should let an AGENT comment on a ticket they do not own', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.create.mockImplementation(({ data }) => data);

      await service.create('ticket-1', { content: 'Agent reply' }, agentUser);

      expect(mockPrismaService.comment.create).toHaveBeenCalledWith({
        include: expect.any(Object),
        data: expect.objectContaining({ authorId: 'agent-1' }),
      });
    });

    it('blocks unlisted agents from internal comments when listedGroupsOnly', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue({
        ...ownedTicket,
        serviceDesk: {
          listedGroupsOnly: true,
          agents: [],
          agentGroups: [],
        },
      });

      await expect(
        service.create(
          'ticket-1',
          { content: 'Internal note', isInternal: true },
          agentUser,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.comment.create).not.toHaveBeenCalled();
    });
  });

  describe('findByTicket', () => {
    const authorSelect = { select: { id: true, name: true, role: true } };
    const agentAuthor = { id: 'agent-1', name: 'Ana Agente', role: Role.AGENT };
    const clientAuthor = { id: 'client-1', name: 'Carla Cliente', role: Role.CLIENT };

    it('should return all comments (including internal) for AGENT, with the author resolved', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      const comments = [
        { id: 'c1', isInternal: false, author: clientAuthor },
        { id: 'c2', isInternal: true, author: agentAuthor },
      ];
      mockPrismaService.comment.findMany.mockResolvedValue(comments);

      const result = await service.findByTicket('ticket-1', agentUser);

      expect(mockPrismaService.comment.findMany).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1' },
        orderBy: { createdAt: 'asc' },
        include: { author: authorSelect },
      });
      expect(result).toEqual(comments);
    });

    it('should return all comments (including internal) for ADMIN', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.findMany.mockResolvedValue([]);

      await service.findByTicket('ticket-1', adminUser);

      expect(mockPrismaService.comment.findMany).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1' },
        orderBy: { createdAt: 'asc' },
        include: { author: authorSelect },
      });
    });

    it('should filter out internal comments for a CLIENT reader (isInternal: false in the query)', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.findMany.mockResolvedValue([
        { id: 'c1', isInternal: false, author: clientAuthor },
      ]);

      const result = await service.findByTicket('ticket-1', clientUser);

      expect(mockPrismaService.comment.findMany).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1', isInternal: false },
        orderBy: { createdAt: 'asc' },
        include: { author: authorSelect },
      });
      expect(result).toEqual([
        { id: 'c1', isInternal: false, author: clientAuthor },
      ]);
    });

    it('should expose only id, name and role of the author, never any other user field', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.findMany.mockResolvedValue([
        {
          id: 'c1',
          isInternal: false,
          author: {
            ...agentAuthor,
            email: 'ana@example.test',
            phone: '000',
            password: 'hash',
            organizationId: 'org-1',
          },
        },
      ]);

      const result = await service.findByTicket('ticket-1', agentUser);

      expect(Object.keys(result[0].author!).sort()).toEqual(['id', 'name', 'role']);
    });

    it('should hide the name of team authors from a CLIENT reader but keep id and role', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.findMany.mockResolvedValue([
        { id: 'c1', isInternal: false, author: agentAuthor },
        { id: 'c2', isInternal: false, author: { id: 'm-1', name: 'Mario Master', role: Role.AGENT_MASTER } },
        { id: 'c3', isInternal: false, author: { id: 'a-1', name: 'Alice Admin', role: Role.ADMIN } },
        { id: 'c4', isInternal: false, author: clientAuthor },
        { id: 'c5', isInternal: false, author: { id: 'cm-1', name: 'Cleo Master', role: Role.CLIENT_MASTER } },
      ]);

      const result = await service.findByTicket('ticket-1', clientUser);

      expect(result.map((c) => c.author)).toEqual([
        { id: 'agent-1', name: null, role: Role.AGENT },
        { id: 'm-1', name: null, role: Role.AGENT_MASTER },
        { id: 'a-1', name: null, role: Role.ADMIN },
        clientAuthor,
        { id: 'cm-1', name: 'Cleo Master', role: Role.CLIENT_MASTER },
      ]);
    });

    it('should keep team author names for AGENT readers', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.findMany.mockResolvedValue([
        { id: 'c1', isInternal: false, author: agentAuthor },
      ]);

      const result = await service.findByTicket('ticket-1', agentUser);

      expect(result[0].author).toEqual(agentAuthor);
    });

    it('should return author null (not crash) when the author is missing', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);
      mockPrismaService.comment.findMany.mockResolvedValue([
        { id: 'c1', isInternal: false, author: null },
        { id: 'c2', isInternal: false },
      ]);

      const result = await service.findByTicket('ticket-1', agentUser);

      expect(result.map((c) => c.author)).toEqual([null, null]);
    });

    it('should throw NotFoundException when the ticket does not exist', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.findByTicket('nope', agentUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.comment.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException (not Forbidden) when a CLIENT reads comments on a ticket they do not own', async () => {
      mockPrismaService.ticket.findUnique.mockResolvedValue(ownedTicket);

      await expect(
        service.findByTicket('ticket-1', otherClient),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.comment.findMany).not.toHaveBeenCalled();
    });
  });
});
