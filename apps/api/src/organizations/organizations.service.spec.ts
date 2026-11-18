import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(callback=>callback(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      organizationDeskEvent: {create:jest.fn(), deleteMany: jest.fn()},
      organization: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      article: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      ticket: { findFirst: jest.fn().mockResolvedValue(null) },
      organizationAddress: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      organizationContact: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      serviceDesk: {
        findUnique: jest.fn(),
      },
      agentGroup: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new OrganizationsService(mockPrisma as any);
  });

  describe('create', () => {
    it('creates the organization with the given dto', async () => {
      const dto = { name: 'Acme Corp' } as any;
      mockPrisma.organization.create.mockResolvedValue({ id: 'org-1', ...dto });

      const result = await service.create(dto);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual({ id: 'org-1', ...dto });
    });

    it('creates organization with quarterly billing and billing preferences', async () => {
      const dto = {
        name: 'Financeira XYZ',
        quarterlyBilling: true,
        billingEmails: 'financeiro@xyz.com,contato@xyz.com',
        billingDueDay: 15,
        billingMethod: 'BOLETO',
        billingNotes: 'Enviar nota fiscal com 5 dias de antecedência',
      };
      mockPrisma.organization.create.mockResolvedValue({ id: 'org-1', ...dto });

      const result = await service.create(dto);
      expect(mockPrisma.organization.create).toHaveBeenCalledWith({ data: dto });
      expect(result.quarterlyBilling).toBe(true);
      expect(result.billingDueDay).toBe(15);
    });

    it('includes articles with autoShareWithNewOrganizations=true, connecting them to the new organization (DMTE-88)', async () => {
      const dto = { name: 'Nova Cliente' } as any;
      mockPrisma.organization.create.mockResolvedValue({ id: 'org-1', ...dto });
      mockPrisma.article.findMany.mockResolvedValue([{ id: 'article-1' }, { id: 'article-2' }]);
      mockPrisma.organization.update.mockResolvedValue({ id: 'org-1' });

      const result = await service.create(dto);

      expect(mockPrisma.article.findMany).toHaveBeenCalledWith({
        where: { autoShareWithNewOrganizations: true },
        select: { id: true },
      });
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: {
          articlesSharedWith: {
            connect: [{ id: 'article-1' }, { id: 'article-2' }],
          },
        },
      });
      expect(result).toEqual({ id: 'org-1', ...dto });
    });

    // DMTE-554: cnpj e cpf são @unique; a violação virava 500 e o formulário não mostrava nada.
    it.each([
      ['cnpj', 'Já existe um cliente com este CNPJ.'],
      ['cpf', 'Já existe um cliente com este CPF.'],
    ])('answers 409 with a readable message when the %s is already registered (DMTE-554)', async (field, message) => {
      mockPrisma.organization.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
          meta: { target: [field] },
        }),
      );

      const error = await service.create({ name: 'Dup', [field]: '123' } as any).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(message);
    });

    it('keeps unexpected database errors as they are (DMTE-554)', async () => {
      const boom = new Error('connection lost');
      mockPrisma.organization.create.mockRejectedValue(boom);

      await expect(service.create({ name: 'X' } as any)).rejects.toBe(boom);
    });

    it('does not call organization.update when there are no auto-share articles', async () => {
      const dto = { name: 'Outra Cliente' } as any;
      mockPrisma.organization.create.mockResolvedValue({ id: 'org-2', ...dto });
      mockPrisma.article.findMany.mockResolvedValue([]);

      await service.create(dto);

      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns all organizations with a user count when no filter is given', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([{ id: 'org-1', _count: { users: 3 } }]);

      const result = await service.findAll();

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith({
        where: undefined,
        include: {
          _count: { select: { users: true } },
          agentGroups: { select: { id: true, name: true, active: true } },
        },
      });
      expect(result).toEqual([{ id: 'org-1', _count: { users: 3 } }]);
    });

    it('filters by active=true when requested (Tiflux-parity, issue #56)', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([{ id: 'org-1', active: true }]);

      const result = await service.findAll(true);

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith({
        where: { active: true },
        include: {
          _count: { select: { users: true } },
          agentGroups: { select: { id: true, name: true, active: true } },
        },
      });
      expect(result).toEqual([{ id: 'org-1', active: true }]);
    });

    it('filters by active=false when requested', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([{ id: 'org-2', active: false }]);

      const result = await service.findAll(false);

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith({
        where: { active: false },
        include: {
          _count: { select: { users: true } },
          agentGroups: { select: { id: true, name: true, active: true } },
        },
      });
      expect(result).toEqual([{ id: 'org-2', active: false }]);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the organization with its users when it exists', async () => {
      const org = { id: 'org-1', users: [{ id: 'u1', name: 'Jane', email: 'j@x.com', role: 'CLIENT' }] };
      mockPrisma.organization.findUnique.mockResolvedValue(org);

      const result = await service.findOne('org-1');

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        include: {
          users: { select: { id: true, name: true, email: true, role: true } },
          addresses: true,
          contacts: true,
          serviceDesks: { select: { id: true, name: true } },
          agentGroups: {
            include: { members: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      expect(result).toEqual(org);
    });
  });

  describe('update', () => {
    it('throws NotFoundException without updating when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.update('missing-id', { name: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('updates the organization when it exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.organization.update.mockResolvedValue({ id: 'org-1', name: 'New Name' });

      const result = await service.update('org-1', { name: 'New Name' } as any);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'New Name' },
      });
      expect(result).toEqual({ id: 'org-1', name: 'New Name' });
    });

    it('answers 409 with a readable message when the new cnpj belongs to another client (DMTE-554)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.organization.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
          meta: { target: ['cnpj'] },
        }),
      );

      const error = await service.update('org-1', { cnpj: '123' } as any).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe('Já existe um cliente com este CNPJ.');
    });

    it('updates quarterly billing and billing preferences', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      const billingUpdate = {
        quarterlyBilling: true,
        billingEmails: 'faturamento@empresa.com',
        billingDueDay: 10,
        billingMethod: 'PIX',
      };
      mockPrisma.organization.update.mockResolvedValue({ id: 'org-1', ...billingUpdate });

      const result = await service.update('org-1', billingUpdate as any);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: billingUpdate,
      });
      expect(result.quarterlyBilling).toBe(true);
    });
  });

  const counts = {
    addresses: 0, contacts: 0, agentGroups: 0, technicalGroupLinks: 0, articlesSharedWith: 0, deskEvents: 0,
    serviceDesks: 0, contracts: 0, users: 0, credentials: 0, credentialFolders: 0, appointments: 0,
  };
  const orgRow = (over: Record<string, unknown> = {}, count: Partial<typeof counts> = {}) => ({
    id: 'org-1',
    name: 'Acme',
    _count: { ...counts, ...count },
    serviceDesks: [], contracts: [], users: [], credentials: [], credentialFolders: [], appointments: [],
    ...over,
  });
  const ticketRow = (over: Record<string, unknown> = {}, count: Record<string, unknown> = {}) => ({
    id: 'tk-1', protocol: 'TCK-1', title: 'Impressora',
    requester: { organizationId: null },
    worklogs: [], preAppointments: [],
    _count: { subTickets: 0, ...count },
    ...over,
  });
  const blockerOf = (result: any[], code: string, index = 0) => result[index].blockers.find((b: any) => b.code === code);

  const admin = { id: 'admin-1', role: 'ADMIN' as never };
  const checkOne = async (canDeleteTickets: boolean, user = admin) => {
    const result = await service.deletionCheck(['org-1'], canDeleteTickets, user);
    expect(result).toHaveLength(1);
    return result[0] as any;
  };

  describe('deletionCheck (DMTE-560 T2)', () => {
    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow());
      mockPrisma.ticket.findMany = jest.fn().mockResolvedValue([]);
    });

    it('AC-08: devolve por cliente id, nome, canDelete, bloqueios e o que sairia junto; cliente livre pode excluir', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        orgRow({}, { addresses: 2, contacts: 1, agentGroups: 3, technicalGroupLinks: 4, articlesSharedWith: 5, deskEvents: 6 }),
      );

      const result = await service.deletionCheck(['org-1'], true, admin);

      expect(result).toEqual([
        {
          id: 'org-1', name: 'Acme', canDelete: true, blockers: [],
          cascade: { addresses: 2, contacts: 1, agentGroups: 3, technicalGroups: 4, sharedArticles: 5, deskEvents: 6 },
        },
      ]);
    });

    it('AC-08: cliente inexistente responde 404', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.deletionCheck(['missing'], true)).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['TICKETS', () => mockPrisma.ticket.findMany.mockResolvedValue([ticketRow()]), {}],
      ['SERVICE_DESKS', null, { serviceDesks: 1 }],
      ['CONTRACTS', null, { contracts: 1 }],
      ['USERS', null, { users: 1 }],
      ['VAULT', null, { credentials: 1 }],
      ['VAULT', null, { credentialFolders: 1 }],
      ['APPOINTMENTS', null, { appointments: 1 }],
    ])('AC-09: %s bloqueia sozinho a exclusão', async (code, setup, count) => {
      if (setup) (setup as () => void)();
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow({}, count as never));

      const entry = await checkOne(true);

      expect(entry.canDelete).toBe(false);
      expect(entry.blockers.map((b: any) => b.code)).toEqual([code]);
      expect(blockerOf([entry], code).count).toBe(1);
    });

    it('AC-09: pergunta ao banco por ticket de qualquer status, do cliente comercial ou de solicitante do cliente', async () => {
      await service.deletionCheck(['org-1'], true, admin);

      expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ commercialOrganizationId: 'org-1' }, { requester: { organizationId: 'org-1' } }] } }),
      );
    });

    it('AC-10: devolve todos os bloqueios numa resposta, com contagem, até 5 itens e a saída de cada um', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        orgRow(
          {
            serviceDesks: [{ id: 'd1', name: 'Mesa N1' }],
            contracts: [{ id: 'c1', name: 'Contrato A' }, { id: 'c2', name: null }],
            users: [{ id: 'u1', name: 'Ana' }],
            credentials: [{ id: 'k1', name: 'VPN' }],
            credentialFolders: [{ id: 'f1', name: 'Servidores' }],
            appointments: [{ id: 'a1', title: 'Visita' }],
          },
          { serviceDesks: 1, contracts: 9, users: 1, credentials: 1, credentialFolders: 1, appointments: 1 },
        ),
      );

      const entry = await checkOne(true);

      expect(entry.blockers.map((b: any) => b.code)).toEqual(['SERVICE_DESKS', 'CONTRACTS', 'USERS', 'VAULT', 'APPOINTMENTS']);
      expect(blockerOf([entry], 'CONTRACTS')).toMatchObject({
        count: 9,
        items: [{ id: 'c1', label: 'Contrato A' }, { id: 'c2', label: 'Contrato sem nome' }],
        resolvable: true,
        howToResolve: expect.stringMatching(/contrato/i),
        message: expect.stringMatching(/9.*contrato/i),
      });
      expect(blockerOf([entry], 'SERVICE_DESKS')).toMatchObject({ resolvable: true, howToResolve: expect.stringMatching(/aba Relacionamentos.*aba Clientes/i) });
      expect(blockerOf([entry], 'VAULT')).toMatchObject({
        count: 2,
        items: [{ id: 'k1', label: 'Credencial' }, { id: 'f1', label: 'Pasta' }],
        resolvable: true,
        howToResolve: expect.stringMatching(/cofre/i),
      });
      expect(blockerOf([entry], 'APPOINTMENTS')).toMatchObject({ resolvable: true, howToResolve: expect.stringMatching(/agenda/i) });
    });

    it('AC-26: USERS é resolvível: desvincular o usuário do cliente em Usuários (não existe exclusão de usuário)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow({ users: [{ id: 'u1', name: 'Ana' }] }, { users: 1 }));

      const entry = await checkOne(true);

      expect(blockerOf([entry], 'USERS')).toMatchObject({
        resolvable: true,
        howToResolve: expect.stringMatching(/Usuários.*campo Cliente em branco/i),
      });
    });

    it('AC-10: pede ao banco no máximo 5 itens de cada vínculo', async () => {
      await service.deletionCheck(['org-1'], true, admin);

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledTimes(1);
      const select = mockPrisma.organization.findUnique.mock.calls[0][0].select;
      for (const key of ['serviceDesks', 'contracts', 'users', 'credentials', 'credentialFolders', 'appointments']) {
        expect(select[key]).toMatchObject({ take: 5 });
      }
    });

    it('AC-11: ticket sem motivo, com permissão, é resolvível: basta excluí-lo em Tickets', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([ticketRow()]);

      const entry = await checkOne(true);

      expect(blockerOf([entry], 'TICKETS')).toMatchObject({
        count: 1,
        items: [{ id: 'tk-1', label: 'TCK-1', reasons: [] }],
        resolvable: true,
        howToResolve: expect.stringMatching(/exclua.*Tickets/i),
      });
    });

    it('AC-11: apontamento e sub-tickets são motivos que se resolvem (o ticket continua resolvível)', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([
        ticketRow({ worklogs: [{ authorId: 'admin-1', voidedAt: null }] }),
        ticketRow({ id: 'tk-2', protocol: 'TCK-2' }, { subTickets: 1 }),
      ]);

      const entry = await checkOne(true);
      const tickets = blockerOf([entry], 'TICKETS');

      expect(tickets.items.map((i: any) => i.reasons)).toEqual([['tem apontamento'], ['tem sub-tickets']]);
      expect(tickets.resolvable).toBe(true);
    });

    it('AC-11: ticket aberto pelo cliente não se resolve; o motivo aparece no item e não há saída', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([ticketRow({ requester: { organizationId: 'org-1' } })]);

      const entry = await checkOne(true);

      expect(blockerOf([entry], 'TICKETS')).toMatchObject({
        items: [{ reasons: ['aberto pelo cliente'] }],
        resolvable: false,
        howToResolve: null,
      });
    });

    it('AC-11: sem DELETE_TICKETS o usuário não resolve os tickets, mesmo os livres', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([ticketRow()]);

      const entry = await checkOne(false);

      expect(blockerOf([entry], 'TICKETS')).toMatchObject({
        items: [{ reasons: ['sem permissão para excluir tickets'] }],
        resolvable: false,
        howToResolve: null,
      });
    });

    it('AC-11: mostra só 5 tickets, mas conta todos e decide a saída olhando todos', async () => {
      const many = Array.from({ length: 6 }, (_, i) => ticketRow({ id: `tk-${i}`, protocol: `TCK-${i}`, requester: { organizationId: i === 5 ? 'org-1' : null } }));
      mockPrisma.ticket.findMany.mockResolvedValue(many);

      const entry = await checkOne(true);
      const tickets = blockerOf([entry], 'TICKETS');

      expect(tickets.count).toBe(6);
      expect(tickets.items).toHaveLength(5);
      expect(tickets.resolvable).toBe(false);
    });

    it('AC-25: o cofre e os tickets não vazam nomes: credencial e pasta aparecem só pelo tipo e o ticket só pelo protocolo', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        orgRow({ credentials: [{ id: 'k1', name: 'Senha do banco' }], credentialFolders: [{ id: 'f1', name: 'Servidores' }] }, { credentials: 1, credentialFolders: 1 }),
      );
      mockPrisma.ticket.findMany.mockResolvedValue([ticketRow({ title: 'Segredo do cliente' })]);

      const entry = await checkOne(true);
      const json = JSON.stringify(entry);

      expect(json).not.toContain('Senha do banco');
      expect(json).not.toContain('Servidores');
      expect(json).not.toContain('Segredo do cliente');
      expect(blockerOf([entry], 'TICKETS').items[0].label).toBe('TCK-1');
    });

    it('AC-22: apontamento anulado do ticket é motivo sem saída: o ticket e o cliente ficam sem solução, e o texto diz que o registro fica para auditoria', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([ticketRow({ worklogs: [{ authorId: 'admin-1', voidedAt: new Date('2026-11-12T10:00:00Z') }] })]);

      const entry = await checkOne(true);

      expect(blockerOf([entry], 'TICKETS')).toMatchObject({
        items: [{ reasons: ['tem apontamento anulado (fica registrado para auditoria)'] }],
        resolvable: false,
        howToResolve: null,
      });
    });

    it('AC-23: apontamento ativo de outro usuário só se remove por ADMIN ou pelo autor: para quem não é, não há saída e o motivo diz isso', async () => {
      const agent = { id: 'agent-7', role: 'AGENT' as never };
      mockPrisma.ticket.findMany.mockResolvedValue([ticketRow({ worklogs: [{ authorId: 'agent-8', voidedAt: null }] })]);

      const other = await checkOne(true, agent);
      expect(blockerOf([other], 'TICKETS')).toMatchObject({
        items: [{ reasons: ['tem apontamento de outro usuário (só o autor ou um administrador remove)'] }],
        resolvable: false,
        howToResolve: null,
      });

      const asAdmin = await checkOne(true, admin);
      expect(blockerOf([asAdmin], 'TICKETS')).toMatchObject({ items: [{ reasons: ['tem apontamento'] }], resolvable: true });
    });

    it('AC-23: o autor de todos os apontamentos e pré-apontamentos resolve sozinho', async () => {
      const author = { id: 'agent-7', role: 'AGENT' as never };
      mockPrisma.ticket.findMany.mockResolvedValue([
        ticketRow({ worklogs: [{ authorId: 'agent-7', voidedAt: null }], preAppointments: [{ authorId: 'agent-7' }] }),
      ]);

      const entry = await checkOne(true, author);

      expect(blockerOf([entry], 'TICKETS')).toMatchObject({ items: [{ reasons: ['tem apontamento'] }], resolvable: true });
    });

    it('AC-08: consulta vários clientes de uma vez, na ordem pedida', async () => {
      mockPrisma.organization.findUnique
        .mockResolvedValueOnce(orgRow({ id: 'org-1' }))
        .mockResolvedValueOnce(orgRow({ id: 'org-2', name: 'Beta' }, { contracts: 1 }));

      const result = await service.deletionCheck(['org-1', 'org-2'], true, admin);

      expect(result.map((r: any) => [r.id, r.canDelete])).toEqual([['org-1', true], ['org-2', false]]);
    });
  });

  describe('remove (DMTE-560 T2)', () => {
    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue(orgRow());
      mockPrisma.ticket.findMany = jest.fn().mockResolvedValue([]);
      mockPrisma.organizationDeskEvent.deleteMany = jest.fn();
    });

    it('AC-12: sem bloqueios apaga o cliente (e o histórico de mesa) de verdade, numa transação, e não apenas inativa', async () => {
      const result = await service.remove('org-1', true, admin);

      expect(result).toEqual({ id: 'org-1' });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.organizationDeskEvent.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } });
      expect(mockPrisma.organization.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('AC-13: trava a linha do cliente antes de checar e de apagar', async () => {
      await service.remove('org-1', true, admin);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      const lock = mockPrisma.$queryRaw.mock.invocationCallOrder[0];
      expect(lock).toBeLessThan(mockPrisma.organization.findUnique.mock.invocationCallOrder[0]);
      expect(lock).toBeLessThan(mockPrisma.organization.delete.mock.invocationCallOrder[0]);
    });

    it('AC-13: com bloqueios responde 409 com a mesma lista da consulta e não apaga nada', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        orgRow({ contracts: [{ id: 'c1', name: 'Contrato A' }] }, { contracts: 1, serviceDesks: 1 }),
      );
      const expected = await checkOne(true);

      const error = await service.remove('org-1', true, admin).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ message: expect.stringMatching(/não é possível excluir/i), blockers: expected.blockers });
      expect(mockPrisma.organizationDeskEvent.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.organization.delete).not.toHaveBeenCalled();
    });

    it('AC-13: violação de chave estrangeira por gravação concorrente vira 409, não 500', async () => {
      mockPrisma.organization.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: '7.10.0' }),
      );

      const error = await service.remove('org-1', true, admin).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toMatch(/vínculo/i);
    });

    it('AC-14: cliente inexistente responde 404 sem apagar', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id', true, admin)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organization.delete).not.toHaveBeenCalled();
    });

    it('AC-14: registra em log o id do cliente e do usuário, sem o nome nem outros dados do cliente', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await service.remove('org-1', true, admin);

      const line = log.mock.calls.map((call) => String(call[0])).join('\n');
      expect(line).toContain('org-1');
      expect(line).toContain('admin-1');
      expect(line).not.toContain('Acme');
      log.mockRestore();
    });
  });

  describe('addAddress', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.addAddress('missing-id', { city: 'SP' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.organizationAddress.create).not.toHaveBeenCalled();
    });

    it('creates the address linked to the organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      const dto = { city: 'Sao Paulo' } as any;
      mockPrisma.organizationAddress.create.mockResolvedValue({ id: 'addr-1', organizationId: 'org-1', ...dto });

      const result = await service.addAddress('org-1', dto);

      expect(mockPrisma.organizationAddress.create).toHaveBeenCalledWith({
        data: { ...dto, organizationId: 'org-1' },
      });
      expect(result).toEqual({ id: 'addr-1', organizationId: 'org-1', ...dto });
    });
  });

  describe('removeAddress', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.removeAddress('missing-org', 'addr-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organizationAddress.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the address does not belong to the organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.organizationAddress.findUnique.mockResolvedValue({ id: 'addr-1', organizationId: 'org-2' });

      await expect(service.removeAddress('org-1', 'addr-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organizationAddress.delete).not.toHaveBeenCalled();
    });

    it('deletes the address when it belongs to the organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.organizationAddress.findUnique.mockResolvedValue({ id: 'addr-1', organizationId: 'org-1' });
      mockPrisma.organizationAddress.delete.mockResolvedValue({ id: 'addr-1' });

      const result = await service.removeAddress('org-1', 'addr-1');

      expect(mockPrisma.organizationAddress.delete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
      expect(result).toEqual({ id: 'addr-1' });
    });
  });

  describe('addContact', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.addContact('missing-id', { name: 'Jane' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.organizationContact.create).not.toHaveBeenCalled();
    });

    it('creates the contact linked to the organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      const dto = { name: 'Jane' } as any;
      mockPrisma.organizationContact.create.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1', ...dto });

      const result = await service.addContact('org-1', dto);

      expect(mockPrisma.organizationContact.create).toHaveBeenCalledWith({
        data: { ...dto, organizationId: 'org-1' },
      });
      expect(result).toEqual({ id: 'contact-1', organizationId: 'org-1', ...dto });
    });
  });

  describe('removeContact', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.removeContact('missing-org', 'contact-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organizationContact.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the contact does not belong to the organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.organizationContact.findUnique.mockResolvedValue({ id: 'contact-1', organizationId: 'org-2' });

      await expect(service.removeContact('org-1', 'contact-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organizationContact.delete).not.toHaveBeenCalled();
    });

    it('deletes the contact when it belongs to the organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.organizationContact.findUnique.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });
      mockPrisma.organizationContact.delete.mockResolvedValue({ id: 'contact-1' });

      const result = await service.removeContact('org-1', 'contact-1');

      expect(mockPrisma.organizationContact.delete).toHaveBeenCalledWith({ where: { id: 'contact-1' } });
      expect(result).toEqual({ id: 'contact-1' });
    });
  });

  describe('linkServiceDesk', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.linkServiceDesk('missing-org', 'desk-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the service desk does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      mockPrisma.serviceDesk.findUnique.mockResolvedValue(null);

      await expect(service.linkServiceDesk('org-1', 'missing-desk')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('connects the service desk to the organization (N:N)', async () => {
      mockPrisma.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1', users: [] })
        .mockResolvedValueOnce({ id: 'org-1', serviceDesks: [{ id: 'desk-1' }] });
      mockPrisma.serviceDesk.findUnique.mockResolvedValue({ id: 'desk-1' });
      mockPrisma.organization.update.mockResolvedValue({ id: 'org-1' });

      const result = await service.linkServiceDesk('org-1', 'desk-1');

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { serviceDesks: { connect: { id: 'desk-1' } } },
      });
      expect(result).toEqual({ id: 'org-1', serviceDesks: [{ id: 'desk-1' }] });
      expect(mockPrisma.organizationDeskEvent.create).toHaveBeenCalledWith({data:{organizationId:'org-1',serviceDeskId:'desk-1',linked:true}});
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.organization.update.mock.invocationCallOrder[0]);
    });
  });

  describe('unlinkServiceDesk', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.unlinkServiceDesk('missing-org', 'desk-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('disconnects the service desk from the organization', async () => {
      mockPrisma.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1', users: [] })
        .mockResolvedValueOnce({ id: 'org-1', serviceDesks: [] });
      mockPrisma.organization.update.mockResolvedValue({ id: 'org-1' });

      const result = await service.unlinkServiceDesk('org-1', 'desk-1');

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { serviceDesks: { disconnect: { id: 'desk-1' } } },
      });
      expect(result).toEqual({ id: 'org-1', serviceDesks: [] });
      expect(mockPrisma.organizationDeskEvent.create).toHaveBeenCalledWith({data:{organizationId:'org-1',serviceDeskId:'desk-1',linked:false}});
    });
  });

  describe('createAgentGroup', () => {
    it('throws NotFoundException when the organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.createAgentGroup('missing-org', { name: 'Consultor' })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentGroup.create).not.toHaveBeenCalled();
    });

    it('creates the agent group linked to the organization, with members', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', users: [] });
      const expected = { id: 'group-1', name: 'Consultor', organizationId: 'org-1', members: [] };
      mockPrisma.agentGroup.create.mockResolvedValue(expected);

      const result = await service.createAgentGroup('org-1', { name: 'Consultor', memberIds: ['u1', 'u2'] });

      expect(mockPrisma.agentGroup.create).toHaveBeenCalledWith({
        data: {
          name: 'Consultor',
          organizationId: 'org-1',
          members: { connect: [{ id: 'u1' }, { id: 'u2' }] },
        },
        include: { members: { select: { id: true, name: true, email: true } } },
      });
      expect(result).toEqual(expected);
    });
  });

  describe('updateAgentGroup', () => {
    it('throws NotFoundException when the agent group does not exist', async () => {
      mockPrisma.agentGroup.findUnique.mockResolvedValue(null);

      await expect(service.updateAgentGroup('org-1', 'missing-group', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentGroup.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the agent group belongs to another organization', async () => {
      mockPrisma.agentGroup.findUnique.mockResolvedValue({ id: 'group-1', organizationId: 'org-2' });

      await expect(service.updateAgentGroup('org-1', 'group-1', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentGroup.update).not.toHaveBeenCalled();
    });

    it('updates the agent group name and members', async () => {
      mockPrisma.agentGroup.findUnique.mockResolvedValue({ id: 'group-1', organizationId: 'org-1' });
      const expected = { id: 'group-1', name: 'Novo nome', members: [] };
      mockPrisma.agentGroup.update.mockResolvedValue(expected);

      const result = await service.updateAgentGroup('org-1', 'group-1', { name: 'Novo nome', memberIds: ['u1'] });

      expect(mockPrisma.agentGroup.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { name: 'Novo nome', members: { set: [{ id: 'u1' }] } },
        include: { members: { select: { id: true, name: true, email: true } } },
      });
      expect(result).toEqual(expected);
    });
  });

  describe('removeAgentGroup', () => {
    it('throws NotFoundException when the agent group does not exist', async () => {
      mockPrisma.agentGroup.findUnique.mockResolvedValue(null);

      await expect(service.removeAgentGroup('org-1', 'missing-group')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.agentGroup.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the agent group belongs to another organization', async () => {
      mockPrisma.agentGroup.findUnique.mockResolvedValue({ id: 'group-1', organizationId: 'org-2' });

      await expect(service.removeAgentGroup('org-1', 'group-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.agentGroup.delete).not.toHaveBeenCalled();
    });

    it('deletes the agent group when it belongs to the organization', async () => {
      mockPrisma.agentGroup.findUnique.mockResolvedValue({ id: 'group-1', organizationId: 'org-1' });
      mockPrisma.agentGroup.delete.mockResolvedValue({ id: 'group-1' });

      const result = await service.removeAgentGroup('org-1', 'group-1');

      expect(mockPrisma.agentGroup.delete).toHaveBeenCalledWith({ where: { id: 'group-1' } });
      expect(result).toEqual({ id: 'group-1' });
    });
  });
});
