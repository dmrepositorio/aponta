import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppointmentType, Role } from '@prisma/client';
import { AgendaService } from './agenda.service';
import { legacyAgendaAccess } from './agenda-access.testing';

/**
 * Caracterização por perfil da agenda (#527, Fase 0b-3 do tracker #523).
 * Trava o comportamento ATUAL; nenhuma mudança de produção.
 */

const DENIED = '00000000-0000-0000-0000-000000000000';

const actors = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
  clientMasterNoOrg: { id: 'u-client-master-2', role: Role.CLIENT_MASTER },
  client: { id: 'u-client', role: Role.CLIENT },
};

const start = '2030-05-01T10:00:00Z';
const end = '2030-05-01T11:00:00Z';

describe('AgendaService: matriz por perfil (caracterização)', () => {
  let prisma: any;
  let hasPermission: jest.Mock;
  let service: AgendaService;

  beforeEach(() => {
    prisma = {
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn().mockResolvedValue({ id: 'a1' }),
        delete: jest.fn().mockResolvedValue({ id: 'a1' }),
      },
      ticket: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    hasPermission = jest.fn().mockResolvedValue(false);
    service = new AgendaService(prisma, { hasPermission } as any, legacyAgendaAccess());
  });

  const whereOfFindAll = () => prisma.appointment.findMany.mock.calls[0][0].where;

  describe('findAll: escopo base por perfil (TenantHelper.getAppointmentWhere)', () => {
    it('ADMIN: sem filtro de escopo', async () => {
      await service.findAll({}, actors.admin);
      expect(whereOfFindAll()).toEqual({});
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
    ])('%s: só os próprios compromissos', async (_label, user) => {
      await service.findAll({}, user);
      expect(whereOfFindAll()).toEqual({ userId: user.id });
    });

    it('CLIENT_MASTER: compromissos da própria organização, exceto ausências', async () => {
      await service.findAll({}, actors.clientMaster);
      expect(whereOfFindAll()).toEqual({ organizationId: 'org-1', type: { not: AppointmentType.ABSENCE } });
    });

    it.each([
      ['CLIENT', actors.client],
      ['CLIENT_MASTER sem organização', actors.clientMasterNoOrg],
    ])('%s: fail-closed pelo id sentinela (não lança, não devolve dados)', async (_label, user) => {
      await service.findAll({}, user);
      expect(whereOfFindAll()).toEqual({ id: DENIED });
    });
  });

  describe('findAll: filtros de consulta dependem do perfil', () => {
    it.each([
      ['ADMIN', actors.admin],
      ['AGENT_MASTER', actors.agentMaster],
    ])('%s: query.userId é aplicado', async (_label, user) => {
      await service.findAll({ userId: 'u-outro' }, user);
      expect(whereOfFindAll().userId).toBe('u-outro');
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('AGENT_MASTER: query.userId substitui o escopo próprio e expõe a agenda de outro usuário', async () => {
      await service.findAll({ userId: 'u-outro' }, actors.agentMaster);
      expect(whereOfFindAll()).toEqual({ userId: 'u-outro' });
    });

    it.each([
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s: query.userId é ignorado (escopo base preservado)', async (_label, user) => {
      await service.findAll({ userId: 'u-outro' }, user);
      expect(whereOfFindAll().userId).not.toBe('u-outro');
    });

    it.each([
      ['ADMIN', actors.admin],
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s: query.organizationId é aplicado', async (_label, user) => {
      await service.findAll({ organizationId: 'org-9' }, user);
      expect(whereOfFindAll().organizationId).toBe('org-9');
    });

    it('CLIENT_MASTER: query.organizationId é ignorado (fica na própria organização)', async () => {
      await service.findAll({ organizationId: 'org-9' }, actors.clientMaster);
      expect(whereOfFindAll().organizationId).toBe('org-1');
    });

    it('CLIENT_MASTER pedindo type=ABSENCE: lista vazia sem consultar o banco', async () => {
      await expect(service.findAll({ type: AppointmentType.ABSENCE }, actors.clientMaster)).resolves.toEqual([]);
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['ADMIN', actors.admin],
      ['AGENT', actors.agent],
    ])('%s pedindo type=ABSENCE: o filtro é aplicado normalmente', async (_label, user) => {
      await service.findAll({ type: AppointmentType.ABSENCE }, user);
      expect(whereOfFindAll().type).toBe(AppointmentType.ABSENCE);
    });
  });

  describe('findOne: mesmo escopo do perfil; fora do escopo responde 404', () => {
    it.each([
      ['AGENT', actors.agent, { id: 'a1', userId: 'u-agent' }],
      ['AGENT_MASTER', actors.agentMaster, { id: 'a1', userId: 'u-agent-master' }],
      ['CLIENT_MASTER', actors.clientMaster, { id: 'a1', organizationId: 'org-1', type: { not: AppointmentType.ABSENCE } }],
    ])('%s: busca com o escopo do perfil', async (_label, user, expected) => {
      prisma.appointment.findFirst.mockResolvedValue({ id: 'a1' });
      await service.findOne('a1', user);
      expect(prisma.appointment.findFirst.mock.calls[0][0].where).toEqual(expected);
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s: compromisso fora do escopo é 404', async (_label, user) => {
      await expect(service.findOne('a1', user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = { title: 'Reunião', startTime: start, endTime: end };

    it('CLIENT: 403 sem gravar', async () => {
      await expect(service.create(dto as any, actors.client)).rejects.toThrow(ForbiddenException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('ADMIN: pode agendar em nome de outro usuário (dto.userId)', async () => {
      await service.create({ ...dto, userId: 'u-outro' } as any, actors.admin);
      expect(prisma.appointment.create.mock.calls[0][0].data.userId).toBe('u-outro');
    });

    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s: dto.userId é ignorado; o compromisso é do próprio usuário', async (_label, user) => {
      await service.create({ ...dto, userId: 'u-outro' } as any, user);
      expect(prisma.appointment.create.mock.calls[0][0].data.userId).toBe(user.id);
    });

    it('CLIENT_MASTER: a organização é forçada para a própria, ignorando dto.organizationId', async () => {
      await service.create({ ...dto, organizationId: 'org-9' } as any, actors.clientMaster);
      expect(prisma.appointment.create.mock.calls[0][0].data.organizationId).toBe('org-1');
    });

    it('CLIENT_MASTER sem organização: organizationId fica indefinido, não vem do dto', async () => {
      await service.create({ ...dto, organizationId: 'org-9' } as any, actors.clientMasterNoOrg);
      expect(prisma.appointment.create.mock.calls[0][0].data.organizationId).toBeUndefined();
    });

    it.each([
      ['ADMIN', actors.admin],
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s: dto.organizationId é respeitado', async (_label, user) => {
      await service.create({ ...dto, organizationId: 'org-9' } as any, user);
      expect(prisma.appointment.create.mock.calls[0][0].data.organizationId).toBe('org-9');
    });

    it.each([
      ['ADMIN', actors.admin],
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s: ignoresWorklogRule exige a permissão RELEASE_WORKLOG_WITHOUT_SCHEDULE, sem desvio por perfil (nem ADMIN)', async (_label, user) => {
      await expect(service.create({ ...dto, ignoresWorklogRule: true } as any, user)).rejects.toThrow(ForbiddenException);
      expect(hasPermission).toHaveBeenCalledWith(user.id, 'RELEASE_WORKLOG_WITHOUT_SCHEDULE');
      expect(prisma.appointment.create).not.toHaveBeenCalled();

      hasPermission.mockResolvedValue(true);
      await service.create({ ...dto, ignoresWorklogRule: true } as any, user);
      expect(prisma.appointment.create.mock.calls[0][0].data.ignoresWorklogRule).toBe(true);
    });

    it('vínculo com chamado: usa o escopo de chamados do perfil e responde 404 se não alcança', async () => {
      await expect(service.create({ ...dto, ticketId: 't1' } as any, actors.agent)).rejects.toThrow(NotFoundException);
      expect(prisma.ticket.findFirst.mock.calls[0][0].where.id).toBe('t1');
      expect(prisma.ticket.findFirst.mock.calls[0][0].where.serviceDesk).toBeDefined();
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });
  });

  describe('update e remove: só ADMIN ou o dono (findOne já restringe ao escopo do perfil)', () => {
    const mine = (userId: string) => ({ id: 'a1', userId, ignoresWorklogRule: false, startTime: new Date(start), endTime: new Date(end) });

    it('ADMIN: altera e exclui compromisso de outro usuário; pode reatribuir (dto.userId)', async () => {
      prisma.appointment.findFirst.mockResolvedValue(mine('u-outro'));
      await service.update('a1', { title: 'X', userId: 'u-novo' } as any, actors.admin);
      expect(prisma.appointment.update.mock.calls[0][0].data.userId).toBe('u-novo');
      await service.remove('a1', actors.admin);
      expect(prisma.appointment.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    });

    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s: altera e exclui o próprio compromisso, sem poder reatribuir', async (_label, user) => {
      prisma.appointment.findFirst.mockResolvedValue(mine(user.id));
      await service.update('a1', { title: 'X', userId: 'u-novo' } as any, user);
      expect(prisma.appointment.update.mock.calls[0][0].data.userId).toBeUndefined();
      await service.remove('a1', user);
      expect(prisma.appointment.delete).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s: compromisso que o escopo não alcança é 404 em update e remove', async (_label, user) => {
      await expect(service.update('a1', { title: 'X' } as any, user)).rejects.toThrow(NotFoundException);
      await expect(service.remove('a1', user)).rejects.toThrow(NotFoundException);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(prisma.appointment.delete).not.toHaveBeenCalled();
    });

    it('CLIENT_MASTER: enxerga o compromisso da organização mas não é dono, então 403 em update e remove', async () => {
      prisma.appointment.findFirst.mockResolvedValue(mine('u-agent'));
      await expect(service.update('a1', { title: 'X' } as any, actors.clientMaster)).rejects.toThrow(ForbiddenException);
      await expect(service.remove('a1', actors.clientMaster)).rejects.toThrow(ForbiddenException);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(prisma.appointment.delete).not.toHaveBeenCalled();
    });

    it('update: alterar compromisso que já ignora a regra exige a permissão, mesmo para o dono', async () => {
      prisma.appointment.findFirst.mockResolvedValue({ ...mine('u-agent'), ignoresWorklogRule: true });
      await expect(service.update('a1', { title: 'X' } as any, actors.agent)).rejects.toThrow(ForbiddenException);
      expect(hasPermission).toHaveBeenCalledWith('u-agent', 'RELEASE_WORKLOG_WITHOUT_SCHEDULE');
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });
  });
});
