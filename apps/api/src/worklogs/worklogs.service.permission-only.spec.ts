import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, ValuationType } from '@prisma/client';
import { WorklogsService } from './worklogs.service';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import type { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2a2 (#542), tracker #523: decisão de apontamentos por permissão atrás da flag
 * `rbac-permission-only`. Desligada = decisão por `user.role` (hoje); ligada = por
 * `PermissionsService.hasPermission`. Com os grupos padrão, os dois modos decidem igual
 * para todos os perfis; só a permissão fora do padrão diferencia o modo ligado.
 */
const ALL_ROLES: Role[] = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const TECH_ROLES: Role[] = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT];
const NON_TECH_ROLES: Role[] = [Role.CLIENT_MASTER, Role.CLIENT];
const NOT_ADMIN: Role[] = [Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const idOf = (role: Role, n = 1) => `${role.toLowerCase()}-${n}`;
const user = (role: Role): CurrentUserPayload => ({ id: idOf(role), role });
const defaultsOf = (role: Role) => new Set(DEFAULT_PERMISSION_GROUPS[role].permissions);

describe.each([false, true])('WorklogsService por permissão (rbac-permission-only=%s)', (permissionOnly) => {
  const dto = { startTime: '2026-10-17T12:00:00Z', endTime: '2026-10-17T13:00:00Z', description: 'Trabalho', contractId: 'contract' };
  const term = {
    id: 'term', approved: true, active: true, effectiveFrom: new Date('2026-10-01T00:00:00Z'), type: 'HOURLY',
    serviceDeskIds: ['desk'], hourlyRateCents: 15000, includedMinutes: null, excessHourlyRateCents: null,
    monthlyFeeCents: null, fixedPriceCents: null, estimatedMinutes: null,
  };
  const contract = {
    id: 'contract', organizationId: 'org', approved: true, active: true, type: 'HOURLY', name: 'Avulso',
    startsAt: new Date('2026-01-01'), endsAt: null, serviceDesks: [{ id: 'desk' }], terms: [term],
    includedMinutes: null, hoursLimit: null, excessHourlyRateCents: 9900,
    lifecycleEvents: [{ approved: true, active: true, startsAt: new Date('2026-01-01'), endsAt: null, effectiveFrom: new Date('2026-01-01') }],
  };
  const baseTicket = {
    id: 'ticket', serviceDeskId: 'desk', commercialOrganizationId: 'org',
    commercialOrganization: { id: 'org', name: 'Cliente' },
    requester: { organizationId: 'org', organization: { id: 'org', name: 'Cliente' } },
    serviceDesk: { listedGroupsOnly: false, agents: [], agentGroups: [] },
  };
  const guarantee = { ...dto, valuationType: ValuationType.GUARANTEE, bonusReason: 'Retrabalho' };
  const bonus = { ...dto, valuationType: ValuationType.BONUS, bonusReason: 'Cortesia' };
  const manual = { ...dto, valuationType: ValuationType.MANUAL, value: 50 };
  const timer = (authorId: string) => ({
    id: 'timer', ticketId: 'ticket', authorId, beginning: new Date('2026-10-17T12:00:00Z'), ending: null,
    pausedAt: null, pausedMs: 0, lockedReason: null,
  });
  const worklogOf = (authorId: string) => ({
    id: 'log', ticketId: 'ticket', authorId, contractId: null, voidedAt: null, valuationSnapshot: { version: 2 },
  });

  let db: any;
  let service: WorklogsService;
  let granted: Map<string, Set<string>>;
  let hasPermission: jest.Mock;
  let canViewTicketValues: jest.Mock;

  /** Permissões efetivas: o que foi dado ao id; senão o grupo padrão do perfil que o id carrega (ex.: agent_master-2). */
  const grantsOf = (id: string) => granted.get(id) ?? defaultsOf(ALL_ROLES.find((role) => id.startsWith(`${role.toLowerCase()}-`)) as Role);
  const give = (u: { id: string }, ...keys: string[]) => granted.set(u.id, new Set(keys));

  beforeEach(() => {
    granted = new Map();
    db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((fn: any) => fn(db)),
      ticket: { findUnique: jest.fn().mockResolvedValue(baseTicket), update: jest.fn().mockResolvedValue({ commercialOrganizationId: 'new-org' }) },
      user: { findUnique: jest.fn() },
      serviceDesk: { findFirst: jest.fn().mockResolvedValue({ id: 'desk' }) },
      contract: { findMany: jest.fn().mockResolvedValue([contract]), findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      technicianCostRate: { findMany: jest.fn().mockResolvedValue([{ id: 'cost', effectiveFrom: new Date('2026-01-01'), hourlyCostCents: 10000 }]) },
      worklog: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'log', ...data })),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: 'log', ...data })),
        delete: jest.fn().mockResolvedValue({ id: 'log' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: 0 } }),
      },
      preAppointment: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'timer', ...data })),
        delete: jest.fn().mockResolvedValue({ id: 'timer' }),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: 'timer', ...data })),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    hasPermission = jest.fn(async (id: string, ...keys: string[]) => keys.some((key) => grantsOf(id).has(key)));
    canViewTicketValues = jest.fn().mockResolvedValue(true);
    const permissions = { canViewTicketValues, canEditWorklogStartTime: jest.fn().mockResolvedValue(true), hasPermission };
    const flags = { isEnabled: jest.fn().mockReturnValue(false), isRbacPermissionOnly: jest.fn().mockReturnValue(permissionOnly) };
    service = new WorklogsService(db, {} as any, {} as any, permissions as any, flags as any, { notifyPending: jest.fn() } as any);
  });

  describe('com os grupos padrão, os dois modos decidem como hoje', () => {
    it.each(TECH_ROLES)('operar: %s lança, lista, vê contratos e opera cronômetro', async (role) => {
      const u = user(role);
      await expect(service.create('ticket', dto, u)).resolves.toBeDefined();
      await expect(service.findByTicket('ticket', u)).resolves.toBeDefined();
      await expect(service.eligibleContracts('ticket', dto.startTime, dto.endTime, u)).resolves.toBeDefined();
      await expect(service.createPreAppointment('ticket', {}, u)).resolves.toBeDefined();
    });

    it.each(NON_TECH_ROLES)('operar: %s é barrado em tudo e nada é gravado', async (role) => {
      const u = user(role);
      await expect(service.create('ticket', dto, u)).rejects.toThrow(ForbiddenException);
      await expect(service.findByTicket('ticket', u)).rejects.toThrow(ForbiddenException);
      await expect(service.eligibleContracts('ticket', dto.startTime, dto.endTime, u)).rejects.toThrow(ForbiddenException);
      await expect(service.createPreAppointment('ticket', {}, u)).rejects.toThrow(ForbiddenException);
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it.each(TECH_ROLES)('lançar para outro autor: ADMIN lança para o alvo %s', async (targetRole) => {
      db.user.findUnique.mockResolvedValue({ id: idOf(targetRole, 2), role: targetRole });
      await expect(service.create('ticket', { ...dto, authorId: idOf(targetRole, 2) }, user(Role.ADMIN))).resolves.toMatchObject({ authorId: idOf(targetRole, 2) });
    });

    it.each(NON_TECH_ROLES)('lançar para outro autor: o alvo %s não é técnico (BadRequest)', async (targetRole) => {
      db.user.findUnique.mockResolvedValue({ id: idOf(targetRole, 2), role: targetRole });
      await expect(service.create('ticket', { ...dto, authorId: idOf(targetRole, 2) }, user(Role.ADMIN))).rejects.toThrow(BadRequestException);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('lançar para outro autor: %s recebe Forbidden sem consultar o alvo', async (role) => {
      await expect(service.create('ticket', { ...dto, authorId: 'tech-2' }, user(role))).rejects.toThrow(ForbiddenException);
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it('garantia: ADMIN lança; AGENT e AGENT_MASTER sem a chave recebem Forbidden', async () => {
      await expect(service.create('ticket', guarantee, user(Role.ADMIN))).resolves.toMatchObject({ valuationType: ValuationType.GUARANTEE });
      for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
        await expect(service.create('ticket', guarantee, user(role))).rejects.toThrow(/garantia/i);
      }
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('garantia: %s com a chave lança nos dois modos', async (role) => {
      give(user(role), 'CREATE_EDIT_WORKLOGS', 'LAUNCH_WORKLOG_GUARANTEE');
      await expect(service.create('ticket', guarantee, user(role))).resolves.toMatchObject({ valuationType: ValuationType.GUARANTEE });
    });

    it('bonificação: só ADMIN autoriza', async () => {
      await expect(service.create('ticket', bonus, user(Role.ADMIN))).resolves.toMatchObject({ valuationType: ValuationType.BONUS });
      for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
        await expect(service.create('ticket', bonus, user(role))).rejects.toThrow(/admin/i);
      }
    });

    it('valor manual: ADMIN com ver valores grava; sem ver valores ou outro perfil, Forbidden', async () => {
      await expect(service.create('ticket', manual, user(Role.ADMIN))).resolves.toMatchObject({ valueCents: 5000 });
      for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
        await expect(service.create('ticket', manual, user(role))).rejects.toThrow(/valor manual/i);
      }
      canViewTicketValues.mockResolvedValue(false);
      await expect(service.create('ticket', manual, user(Role.ADMIN))).rejects.toThrow(ForbiddenException);
    });

    it('empresa comercial: só ADMIN regulariza', async () => {
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, commercialOrganizationId: 'org' });
      await expect(service.setCommercialOrganization('ticket', 'new-org', user(Role.ADMIN))).resolves.toBeDefined();
      for (const role of NOT_ADMIN) {
        await expect(service.setCommercialOrganization('ticket', 'new-org', user(role))).rejects.toThrow(ForbiddenException);
      }
    });

    it('remover apontamento alheio: ADMIN remove; AGENT e AGENT_MASTER (mesmo com EDIT_ALL_WORKLOGS) recebem Forbidden', async () => {
      db.worklog.findUnique.mockResolvedValue(worklogOf('someone-else'));
      await expect(service.delete('ticket', 'log', user(Role.ADMIN))).resolves.toBeDefined();
      for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
        await expect(service.delete('ticket', 'log', user(role))).rejects.toThrow(/outro usuário/);
      }
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('remover apontamento: %s remove o próprio', async (role) => {
      db.worklog.findUnique.mockResolvedValue(worklogOf(user(role).id));
      await expect(service.delete('ticket', 'log', user(role))).resolves.toBeDefined();
    });

    it('cronômetro de outro autor: ADMIN opera; AGENT e AGENT_MASTER recebem Forbidden', async () => {
      db.preAppointment.findUnique.mockResolvedValue(timer('someone-else'));
      const admin = user(Role.ADMIN);
      await expect(service.pausePreAppointment('ticket', 'timer', admin)).resolves.toBeDefined();
      await expect(service.stopPreAppointment('ticket', 'timer', { ending: '2026-10-17T13:00:00Z' }, admin)).resolves.toBeDefined();
      await expect(service.deletePreAppointment('ticket', 'timer', admin)).resolves.toBeDefined();
      for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
        await expect(service.stopPreAppointment('ticket', 'timer', {}, user(role))).rejects.toThrow(/outro usuário/);
        await expect(service.pausePreAppointment('ticket', 'timer', user(role))).rejects.toThrow(/outro usuário/);
        await expect(service.deletePreAppointment('ticket', 'timer', user(role))).rejects.toThrow(/outro usuário/);
      }
    });

    it('tarifa de excesso: só ADMIN, e só com ver valores', async () => {
      const rate = async (role: Role) => (await service.eligibleContracts('ticket', dto.startTime, dto.endTime, user(role)))[0].excessHourlyRateCents;
      expect(await rate(Role.ADMIN)).toBe(9900);
      expect(await rate(Role.AGENT_MASTER)).toBeNull();
      expect(await rate(Role.AGENT)).toBeNull();
      canViewTicketValues.mockResolvedValue(false);
      expect(await rate(Role.ADMIN)).toBeNull();
    });

    it('auditoria continua restrita ao ADMIN com ver valores (fica por perfil até existir a chave própria)', async () => {
      await expect(service.auditByTicket('ticket', user(Role.ADMIN))).resolves.toBeDefined();
      for (const role of NOT_ADMIN) {
        await expect(service.auditByTicket('ticket', user(role))).rejects.toThrow(ForbiddenException);
      }
    });
  });

  // Fora do padrão: no modo ligado a permissão decide, não o perfil. No desligado vale o perfil.
  describe('permissão fora do padrão', () => {
    const agent = user(Role.AGENT);
    const admin = user(Role.ADMIN);
    /** Aplica a expectativa do modo: `onPermission` quando ligado, `onRole` quando desligado. */
    const byMode = async (attempt: Promise<unknown>, onPermission: 'ok' | RegExp | typeof ForbiddenException | typeof BadRequestException, onRole: typeof onPermission) => {
      const expected = permissionOnly ? onPermission : onRole;
      if (expected === 'ok') await expect(attempt).resolves.toBeDefined();
      else await expect(attempt).rejects.toThrow(expected as never);
    };

    it('quem tem CREATE_EDIT_WORKLOGS opera mesmo sem ser técnico de perfil', async () => {
      give(user(Role.CLIENT), 'CREATE_EDIT_WORKLOGS');
      await byMode(service.create('ticket', dto, user(Role.CLIENT)), 'ok', ForbiddenException);
    });

    it('ADMIN sem CREATE_EDIT_WORKLOGS é barrado', async () => {
      give(admin);
      await byMode(service.create('ticket', dto, admin), ForbiddenException, 'ok');
    });

    it('LAUNCH_WORKLOG_ON_BEHALF deixa o AGENT lançar para outro técnico (alvo com CREATE_EDIT_WORKLOGS)', async () => {
      give(agent, 'CREATE_EDIT_WORKLOGS', 'LAUNCH_WORKLOG_ON_BEHALF');
      db.user.findUnique.mockResolvedValue({ id: idOf(Role.AGENT_MASTER, 2), role: Role.AGENT_MASTER });
      await byMode(service.create('ticket', { ...dto, authorId: idOf(Role.AGENT_MASTER, 2) }, agent), 'ok', ForbiddenException);
    });

    it('o alvo do lançamento é validado por CREATE_EDIT_WORKLOGS, não pelo perfil', async () => {
      give({ id: idOf(Role.CLIENT_MASTER, 2) }, 'CREATE_EDIT_WORKLOGS');
      db.user.findUnique.mockResolvedValue({ id: idOf(Role.CLIENT_MASTER, 2), role: Role.CLIENT_MASTER });
      await byMode(service.create('ticket', { ...dto, authorId: idOf(Role.CLIENT_MASTER, 2) }, admin), 'ok', BadRequestException);
    });

    it('ADMIN sem LAUNCH_WORKLOG_ON_BEHALF não lança para outro autor', async () => {
      give(admin, 'CREATE_EDIT_WORKLOGS');
      db.user.findUnique.mockResolvedValue({ id: idOf(Role.AGENT, 2), role: Role.AGENT });
      await byMode(service.create('ticket', { ...dto, authorId: idOf(Role.AGENT, 2) }, admin), ForbiddenException, 'ok');
    });

    it('ADMIN sem LAUNCH_WORKLOG_GUARANTEE não lança garantia', async () => {
      give(admin, 'CREATE_EDIT_WORKLOGS');
      await byMode(service.create('ticket', guarantee, admin), /garantia/i, 'ok');
    });

    it('AUTHORIZE_WORKLOG_BONUS deixa o AGENT autorizar bonificação', async () => {
      give(agent, 'CREATE_EDIT_WORKLOGS', 'AUTHORIZE_WORKLOG_BONUS');
      await byMode(service.create('ticket', bonus, agent), 'ok', /admin/i);
    });

    it('ADMIN sem AUTHORIZE_WORKLOG_BONUS não autoriza bonificação', async () => {
      give(admin, 'CREATE_EDIT_WORKLOGS');
      await byMode(service.create('ticket', bonus, admin), /admin/i, 'ok');
    });

    it('SET_WORKLOG_MANUAL_VALUE deixa o AGENT informar valor manual, mas ainda exige ver valores', async () => {
      give(agent, 'CREATE_EDIT_WORKLOGS', 'SET_WORKLOG_MANUAL_VALUE');
      await byMode(service.create('ticket', manual, agent), 'ok', ForbiddenException);
      canViewTicketValues.mockResolvedValue(false);
      await expect(service.create('ticket', manual, agent)).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN sem SET_WORKLOG_MANUAL_VALUE não informa valor manual', async () => {
      give(admin, 'CREATE_EDIT_WORKLOGS');
      await byMode(service.create('ticket', manual, admin), ForbiddenException, 'ok');
    });

    it('MANAGE_BILLING deixa o AGENT regularizar a empresa comercial', async () => {
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, commercialOrganizationId: 'org' });
      give(agent, 'MANAGE_BILLING');
      await byMode(service.setCommercialOrganization('ticket', 'new-org', agent), 'ok', ForbiddenException);
    });

    it('ADMIN sem MANAGE_BILLING não regulariza a empresa comercial', async () => {
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, commercialOrganizationId: 'org' });
      give(admin);
      await byMode(service.setCommercialOrganization('ticket', 'new-org', admin), ForbiddenException, 'ok');
    });

    it('DELETE_ANY_WORKLOG deixa o AGENT remover apontamento alheio', async () => {
      db.worklog.findUnique.mockResolvedValue(worklogOf('someone-else'));
      give(agent, 'CREATE_EDIT_WORKLOGS', 'DELETE_ANY_WORKLOG');
      await byMode(service.delete('ticket', 'log', agent), 'ok', /outro usuário/);
    });

    it('ADMIN sem DELETE_ANY_WORKLOG não remove apontamento alheio, mas remove o próprio', async () => {
      db.worklog.findUnique.mockResolvedValue(worklogOf('someone-else'));
      give(admin, 'CREATE_EDIT_WORKLOGS');
      await byMode(service.delete('ticket', 'log', admin), /outro usuário/, 'ok');
      db.worklog.findUnique.mockResolvedValue(worklogOf(admin.id));
      await expect(service.delete('ticket', 'log', admin)).resolves.toBeDefined();
    });

    it('EDIT_ALL_WORKLOGS não basta para remover apontamento alheio', async () => {
      db.worklog.findUnique.mockResolvedValue(worklogOf('someone-else'));
      give(agent, 'CREATE_EDIT_WORKLOGS', 'EDIT_ALL_WORKLOGS');
      await expect(service.delete('ticket', 'log', agent)).rejects.toThrow(/outro usuário/);
    });

    it('MANAGE_PRE_WORKLOGS deixa o AGENT operar cronômetro alheio', async () => {
      db.preAppointment.findUnique.mockResolvedValue(timer('someone-else'));
      give(agent, 'CREATE_EDIT_WORKLOGS', 'MANAGE_PRE_WORKLOGS');
      await byMode(service.pausePreAppointment('ticket', 'timer', agent), 'ok', /outro usuário/);
      await byMode(service.deletePreAppointment('ticket', 'timer', agent), 'ok', /outro usuário/);
    });

    it('ADMIN sem MANAGE_PRE_WORKLOGS não opera cronômetro alheio', async () => {
      db.preAppointment.findUnique.mockResolvedValue(timer('someone-else'));
      give(admin, 'CREATE_EDIT_WORKLOGS');
      await byMode(service.pausePreAppointment('ticket', 'timer', admin), /outro usuário/, 'ok');
      await byMode(service.stopPreAppointment('ticket', 'timer', { ending: '2026-10-17T13:00:00Z' }, admin), /outro usuário/, 'ok');
    });

    it('VIEW_CONTRACT_FINANCIALS libera a tarifa de excesso ao AGENT (com ver valores) e o ADMIN sem a chave não a vê', async () => {
      give(agent, 'CREATE_EDIT_WORKLOGS', 'VIEW_CONTRACT_FINANCIALS');
      give(admin, 'CREATE_EDIT_WORKLOGS');
      const rate = async (u: CurrentUserPayload) => (await service.eligibleContracts('ticket', dto.startTime, dto.endTime, u))[0].excessHourlyRateCents;
      expect(await rate(agent)).toBe(permissionOnly ? 9900 : null);
      expect(await rate(admin)).toBe(permissionOnly ? null : 9900);
    });

    it('o modo desligado não consulta permissão onde o perfil basta (como hoje)', async () => {
      if (permissionOnly) return;
      await service.create('ticket', dto, admin);
      await service.findByTicket('ticket', agent);
      expect(hasPermission).not.toHaveBeenCalled();
    });
  });
});
