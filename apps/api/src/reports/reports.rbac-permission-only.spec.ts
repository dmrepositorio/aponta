import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { CommercialReportsService } from './commercial-reports.service';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a4 do tracker #523 (#544): relatórios decididos por permissão atrás da flag
 * `rbac-permission-only`. Desligada = comportamento de hoje (perfil); ligada = permissão.
 * Com os grupos padrão os dois modos dão o mesmo resultado para todos os perfis.
 *
 * Pergunta aberta ao dono (AGENT_MASTER no relatório de carga): preservado o comportamento
 * atual, só o grupo "Atendente" fica restrito ao próprio relatório. A restrição vem da
 * ausência de VIEW_USERS_IN_AGENT_REPORTS em quem tem VIEW_AGENT_REPORTS.
 */
const ORG = 'org-own';

type Actor = { id: string; role: Role; organizationId?: string };
const actors: Record<string, Actor> = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: ORG },
  clientMasterNoOrg: { id: 'u-client-master-2', role: Role.CLIENT_MASTER },
  client: { id: 'u-client', role: Role.CLIENT },
};

/** Permissões efetivas de cada perfil = as do grupo padrão (o que a migração entrega hoje). */
const defaultsOf = (role: Role) => new Set(DEFAULT_PERMISSION_GROUPS[role].permissions);

function build(flagOn: boolean, granted: (user: Actor) => Set<string>) {
  const prisma: any = {
    worklog: { findMany: jest.fn().mockResolvedValue([]) },
    ticket: { findMany: jest.fn().mockResolvedValue([]) },
    serviceDesk: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    appointment: { findMany: jest.fn().mockResolvedValue([]) },
    contract: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const byId = new Map<string, Actor>(Object.values(actors).map((a) => [a.id, a]));
  const effective = (id: string) => granted(byId.get(id) ?? ({ id, role: Role.CLIENT } as Actor));
  const canViewTicketValues = jest.fn(async (id: string) => effective(id).has('VIEW_TICKET_VALUES'));
  const permissions: any = {
    canViewTicketValues,
    getEffectivePermissions: jest.fn(async (id: string) => effective(id)),
    hasPermission: jest.fn(async (id: string, ...keys: string[]) => keys.some((k) => effective(id).has(k))),
  };
  const flags: any = { isRbacPermissionOnly: () => flagOn };
  return {
    prisma,
    permissions,
    canViewTicketValues,
    reports: new ReportsService(prisma, permissions, flags),
    commercial: new CommercialReportsService(prisma, permissions, flags),
  };
}

/** Grupos padrão + VIEW_TICKET_VALUES (chave só de grupo explícito) para quem lê valores. */
const withValues = (user: Actor) => new Set([...defaultsOf(user.role), 'VIEW_TICKET_VALUES']);
const only = (...keys: string[]) => () => new Set(keys);

const billingRow = (organizationId: string, minutes: number) => ({
  billable: true,
  minutes,
  startTime: new Date('2026-01-10T10:00:00Z'),
  valuationSnapshot: { organizationId, organizationName: organizationId },
  ticket: { requester: { organization: { id: ORG, name: 'Atual' } } },
});

describe.each([[false], [true]])('relatórios por perfil/permissão, flag rbac-permission-only=%s (grupos padrão)', (flagOn) => {
  describe('getWorkload (reports.service.ts:30)', () => {
    it('AGENT: restrito ao próprio relatório mesmo pedindo outro agente', async () => {
      const { reports, prisma } = build(flagOn, withValues);
      await reports.getWorkload(actors.agent, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-agent');
    });

    it('AGENT sem alvo: filtra pelo próprio id', async () => {
      const { reports, prisma } = build(flagOn, withValues);
      await reports.getWorkload(actors.agent);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-agent');
    });

    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['ADMIN', actors.admin],
    ])('%s: não é restrito, usa o alvo pedido', async (_l, user) => {
      const { reports, prisma } = build(flagOn, withValues);
      await reports.getWorkload(user, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-outro');
    });

    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['ADMIN', actors.admin],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s sem alvo: não filtra por autor', async (_l, user) => {
      const { reports, prisma } = build(flagOn, withValues);
      await reports.getWorkload(user);
      expect(prisma.worklog.findMany.mock.calls[0][0].where).not.toHaveProperty('authorId');
    });

    it('CLIENT_MASTER: alvo pedido é respeitado como hoje (tem VIEW_WORKLOG_INFO, não VIEW_AGENT_REPORTS)', async () => {
      const { reports, prisma } = build(flagOn, withValues);
      await reports.getWorkload(actors.clientMaster, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-outro');
    });
  });

  describe('getBilling (reports.service.ts:63 e :96)', () => {
    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
      ['CLIENT', actors.client],
      ['CLIENT_MASTER sem organização', actors.clientMasterNoOrg],
    ])('%s: 403 antes de checar valores ou ler apontamentos', async (_l, user) => {
      const { reports, prisma, canViewTicketValues } = build(flagOn, withValues);
      await expect(reports.getBilling(user)).rejects.toThrow(ForbiddenException);
      expect(canViewTicketValues).not.toHaveBeenCalled();
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['ADMIN', actors.admin],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s sem VIEW_TICKET_VALUES: 403 antes de ler apontamentos', async (_l, user) => {
      const { reports, prisma } = build(flagOn, (u) => defaultsOf(u.role));
      await expect(reports.getBilling(user)).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it('ADMIN com valores: lê sem filtro de tenant', async () => {
      const { reports, prisma } = build(flagOn, withValues);
      await reports.getBilling(actors.admin);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
    });

    it('CLIENT_MASTER: descarta linha de organização histórica alheia; ADMIN vê as duas', async () => {
      const rows = [billingRow(ORG, 30), billingRow('org-antiga', 90)];
      const cm = build(flagOn, withValues);
      cm.prisma.worklog.findMany.mockResolvedValue(rows);
      expect((await cm.reports.getBilling(actors.clientMaster)).map((r) => r.organizationId)).toEqual([ORG]);
      const ad = build(flagOn, withValues);
      ad.prisma.worklog.findMany.mockResolvedValue(rows);
      expect((await ad.reports.getBilling(actors.admin)).map((r) => r.organizationId).sort()).toEqual(['org-antiga', ORG]);
    });
  });

  describe('getCommercial (commercial-reports.service.ts:29)', () => {
    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s: 403 sem consultar valores nem contratos', async (_l, user) => {
      const { commercial, prisma, canViewTicketValues } = build(flagOn, withValues);
      await expect(commercial.getCommercial(user)).rejects.toThrow(ForbiddenException);
      expect(canViewTicketValues).not.toHaveBeenCalled();
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('ADMIN com valores: lê contratos; sem VIEW_TICKET_VALUES: 403', async () => {
      const ok = build(flagOn, withValues);
      await ok.commercial.getCommercial(actors.admin, { month: '2026-09' });
      expect(ok.prisma.contract.findMany).toHaveBeenCalledTimes(1);
      const no = build(flagOn, (u) => defaultsOf(u.role));
      await expect(no.commercial.getCommercial(actors.admin)).rejects.toThrow(ForbiddenException);
      expect(no.prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('ordem: sem acesso comercial recebe 403, não 400, mesmo com competência inválida', async () => {
      const { commercial } = build(flagOn, withValues);
      await expect(commercial.getCommercial(actors.agent, { month: 'foo' })).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe('flag desligada: permissão não decide, o perfil continua decidindo', () => {
  it('AGENT com VIEW_USERS_IN_AGENT_REPORTS segue restrito ao próprio relatório', async () => {
    const { reports, prisma } = build(false, only('VIEW_AGENT_REPORTS', 'VIEW_USERS_IN_AGENT_REPORTS'));
    await reports.getWorkload(actors.agent, 'u-outro');
    expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-agent');
  });

  it('ADMIN sem nenhuma chave de relatório segue lendo o comercial (só VIEW_TICKET_VALUES)', async () => {
    const { commercial, prisma } = build(false, only('VIEW_TICKET_VALUES'));
    await commercial.getCommercial(actors.admin, { month: '2026-09' });
    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
  });

  it('AGENT_MASTER com VIEW_COMMERCIAL_RESULT segue negado', async () => {
    const { commercial, prisma } = build(false, only('VIEW_COMMERCIAL_RESULT', 'VIEW_TICKET_VALUES'));
    await expect(commercial.getCommercial(actors.agentMaster)).rejects.toThrow(ForbiddenException);
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });

  it('AGENT com a chave de extrato segue negado em getBilling', async () => {
    const { reports } = build(false, only('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_ADMIN_REPORTS', 'VIEW_TICKET_VALUES'));
    await expect(reports.getBilling(actors.agent)).rejects.toThrow(ForbiddenException);
  });

  it('getSummary lista agentes pelo perfil', async () => {
    const { reports, prisma } = build(false, withValues);
    await reports.getSummary(actors.admin);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] } });
  });
});

describe('flag ligada: a permissão decide, o perfil não', () => {
  describe('getWorkload', () => {
    it('AGENT com VIEW_AGENT_REPORTS e VIEW_USERS_IN_AGENT_REPORTS escolhe o agente alvo', async () => {
      const { reports, prisma } = build(true, only('VIEW_AGENT_REPORTS', 'VIEW_USERS_IN_AGENT_REPORTS'));
      await reports.getWorkload(actors.agent, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-outro');
    });

    it('AGENT_MASTER só com VIEW_AGENT_REPORTS fica restrito ao próprio relatório', async () => {
      const { reports, prisma } = build(true, only('VIEW_AGENT_REPORTS'));
      await reports.getWorkload(actors.agentMaster, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-agent-master');
    });

    it('ADMIN só com VIEW_AGENT_REPORTS também fica restrito (sem bypass por perfil)', async () => {
      const { reports, prisma } = build(true, only('VIEW_AGENT_REPORTS'));
      await reports.getWorkload(actors.admin);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-admin');
    });

    it('sem VIEW_AGENT_REPORTS (portal do cliente) o filtro de autor não é imposto, como hoje', async () => {
      const { reports, prisma } = build(true, only('VIEW_WORKLOG_INFO'));
      await reports.getWorkload(actors.clientMaster, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-outro');
    });

    it('papel fora do mapa continua 403 antes de ler apontamentos (TenantHelper)', async () => {
      const { reports, prisma } = build(true, only('VIEW_AGENT_REPORTS', 'VIEW_USERS_IN_AGENT_REPORTS'));
      await expect(reports.getWorkload({ id: 'x', role: 'UNKNOWN' as Role })).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getBilling', () => {
    it('ADMIN sem a chave de extrato de consumo é negado (sem bypass por perfil)', async () => {
      const { reports, prisma } = build(true, only('VIEW_TICKET_VALUES', 'VIEW_ADMIN_REPORTS'));
      await expect(reports.getBilling(actors.admin)).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it('AGENT com extrato, relatórios administrativos e valores é atendido', async () => {
      const { reports, prisma } = build(true, only('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_ADMIN_REPORTS', 'VIEW_TICKET_VALUES'));
      await reports.getBilling(actors.agent);
      expect(prisma.worklog.findMany).toHaveBeenCalledTimes(1);
    });

    it('sem VIEW_ADMIN_REPORTS e sem organização: 403, mesmo com extrato e valores', async () => {
      const { reports, prisma } = build(true, only('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_TICKET_VALUES'));
      await expect(reports.getBilling(actors.admin)).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it('sem VIEW_ADMIN_REPORTS e com organização: descarta organização histórica alheia (ADMIN inclusive)', async () => {
      const { reports, prisma } = build(true, only('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_TICKET_VALUES'));
      prisma.worklog.findMany.mockResolvedValue([billingRow(ORG, 30), billingRow('org-antiga', 90)]);
      const res = await reports.getBilling({ id: 'u-admin', role: Role.ADMIN, organizationId: ORG });
      expect(res.map((r) => r.organizationId)).toEqual([ORG]);
    });

    it('com VIEW_ADMIN_REPORTS, CLIENT_MASTER vê todas as organizações do relatório', async () => {
      const { reports, prisma } = build(true, only('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_ADMIN_REPORTS', 'VIEW_TICKET_VALUES'));
      prisma.worklog.findMany.mockResolvedValue([billingRow(ORG, 30), billingRow('org-antiga', 90)]);
      const res = await reports.getBilling(actors.clientMaster);
      expect(res.map((r) => r.organizationId).sort()).toEqual(['org-antiga', ORG]);
    });

    it('com extrato e VIEW_ADMIN_REPORTS mas sem VIEW_TICKET_VALUES: 403', async () => {
      const { reports, prisma } = build(true, only('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_ADMIN_REPORTS'));
      await expect(reports.getBilling(actors.admin)).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getCommercial', () => {
    it('AGENT_MASTER com VIEW_COMMERCIAL_RESULT e VIEW_TICKET_VALUES recebe o relatório', async () => {
      const { commercial, prisma } = build(true, only('VIEW_COMMERCIAL_RESULT', 'VIEW_TICKET_VALUES'));
      await commercial.getCommercial(actors.agentMaster, { month: '2026-09' });
      expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
    });

    it('ADMIN sem VIEW_COMMERCIAL_RESULT é negado antes de consultar valores', async () => {
      const { commercial, prisma, canViewTicketValues } = build(true, only('VIEW_TICKET_VALUES'));
      await expect(commercial.getCommercial(actors.admin)).rejects.toThrow(ForbiddenException);
      expect(canViewTicketValues).not.toHaveBeenCalled();
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('com VIEW_COMMERCIAL_RESULT mas sem VIEW_TICKET_VALUES: 403 antes de ler contratos', async () => {
      const { commercial, prisma } = build(true, only('VIEW_COMMERCIAL_RESULT'));
      await expect(commercial.getCommercial(actors.admin)).rejects.toThrow(ForbiddenException);
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getSummary (reports.service.ts:510)', () => {
    it('lista de agentes do dashboard vem de quem tem CREATE_EDIT_WORKLOGS (grupo direto ou técnico), não do perfil', async () => {
      const { reports, prisma } = build(true, withValues);
      await reports.getSummary(actors.admin);
      const group = { permissionGroup: { permissions: { has: 'CREATE_EDIT_WORKLOGS' } } };
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ permissionGroupLinks: { some: group } }, { technicalGroup: { permissionGroupLinks: { some: group } } }],
      });
    });
  });
});
