import { Injectable, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { BillingFilterDto } from './dto/billing-filter.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { TenantHelper } from '../core/security/tenant.helper';
import { Role, TicketStatus } from '@prisma/client';
import { SLA_PAUSE_STATUSES } from '../service-desks/desk-policy';
import { WorkloadReportItemDto, BillingReportItemDto, DashboardSummaryDto, ResponseTimeComparisonDto } from './dto/report.dto';
import { getSlaStatus } from '../scheduling/sla-status';
import { PermissionsService } from '../permissions/permissions.service';
import { getClosedMonthRanges } from './closed-month-range';
import { compareResponseTimes } from './response-time-comparison';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ScopeAccess } from '../core/security/scope-access';

const CLOSED_STATUSES: TicketStatus[] = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

// SPEC DMTE-575: variação até 5% na mediana conta como "estável"; períodos
// com menos de 10 amostras ficam marcados como amostra pequena no relatório.
const RESPONSE_TIME_STABLE_THRESHOLD = 0.05;
const RESPONSE_TIME_SMALL_SAMPLE_THRESHOLD = 10;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly flags: FeatureFlagsService,
    @Optional() private readonly scope?: ScopeAccess,
  ) {}

  async getWorkload(user: CurrentUserPayload, targetAgentId?: string): Promise<WorkloadReportItemDto[]> {
    const filterAgentId = (await this.isOwnWorkloadOnly(user)) ? user.id : targetAgentId;

    const baseWhere = TenantHelper.getTicketWhere(user);
    if (baseWhere.id === '00000000-0000-0000-0000-000000000000') {
      throw new ForbiddenException('Acesso negado aos relatórios');
    }

    const worklogs = await this.prisma.worklog.findMany({
      where: {
        voidedAt: null,
        ticket: baseWhere,
        ...(filterAgentId ? { authorId: filterAgentId } : {})
      },
      include: { author: { select: { id: true, name: true } } }
    });

    const grouped = new Map<string, { name: string; minutes: number }>();
    for (const log of worklogs) {
      const g = grouped.get(log.authorId) || { name: log.author.name, minutes: 0 };
      g.minutes += log.minutes;
      grouped.set(log.authorId, g);
    }

    return Array.from(grouped.entries()).map(([agentId, data]) => ({
      agentId,
      agentName: data.name,
      totalMinutes: data.minutes,
    })).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }

  /**
   * Quem fica restrito ao próprio relatório de carga. Desligada a flag, só o perfil AGENT.
   * Ligada, quem vê relatórios de atendentes mas não tem VIEW_USERS_IN_AGENT_REPORTS
   * (grupo "Atendente"); quem nem vê relatórios de atendentes não é restrito, como hoje.
   * Pergunta aberta ao dono: preservar que o gerente de atendimento não é restrito (#544).
   */
  private async isOwnWorkloadOnly(user: CurrentUserPayload): Promise<boolean> {
    if (!this.flags.isRbacPermissionOnly()) return user.role === Role.AGENT;
    const granted = await this.permissions.getEffectivePermissions(user.id);
    return granted.has('VIEW_AGENT_REPORTS') && !granted.has('VIEW_USERS_IN_AGENT_REPORTS');
  }

  /**
   * Autoriza o faturamento e diz se as linhas ficam restritas à organização do usuário.
   * Desligada a flag: ADMIN ou CLIENT_MASTER com organização; só o CLIENT_MASTER é restrito.
   * Ligada: exige o extrato de consumo; sem VIEW_ADMIN_REPORTS o relatório é da organização
   * do usuário e, sem organização, é negado (falha fechada).
   */
  private async resolveBillingScope(user: CurrentUserPayload): Promise<boolean> {
    const denied = () => new ForbiddenException('Restrito a visualização de faturamento');
    if (!this.flags.isRbacPermissionOnly()) {
      if (!([Role.ADMIN, Role.CLIENT_MASTER] as Role[]).includes(user.role) ||
        (user.role === Role.CLIENT_MASTER && !user.organizationId)) {
        throw denied();
      }
      return user.role === Role.CLIENT_MASTER;
    }
    const granted = await this.permissions.getEffectivePermissions(user.id);
    if (!granted.has('VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT')) throw denied();
    const organizationScoped = !granted.has('VIEW_ADMIN_REPORTS');
    if (organizationScoped && !user.organizationId) throw denied();
    return organizationScoped;
  }

  /** Lista de agentes do dashboard: por perfil (flag desligada) ou por quem lança apontamento (ligada). */
  private agentsListWhere() {
    if (!this.flags.isRbacPermissionOnly()) return { role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] } };
    const group = { permissionGroup: { permissions: { has: 'CREATE_EDIT_WORKLOGS' } } };
    return { OR: [{ permissionGroupLinks: { some: group } }, { technicalGroup: { permissionGroupLinks: { some: group } } }] };
  }

  async getBilling(user: CurrentUserPayload, filters: BillingFilterDto = {}): Promise<BillingReportItemDto[]> {
    const organizationScoped = await this.resolveBillingScope(user);
    if (!(await this.permissions.canViewTicketValues(user.id))) {
      throw new ForbiddenException('Valores de tickets exigem a permissão VIEW_TICKET_VALUES');
    }

    const baseWhere = TenantHelper.getTicketWhere(user);
    if (baseWhere.id === '00000000-0000-0000-0000-000000000000') {
      throw new ForbiddenException('Restrição organizacional');
    }

    const from = filters.startDate ? Date.parse(filters.startDate) : -Infinity;
    const to = filters.endDate ? Date.parse(filters.endDate) : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) {
      throw new BadRequestException('Período de ciclos inválido');
    }
    const worklogs = await this.prisma.worklog.findMany({
      where: { ticket: baseWhere, voidedAt: null, ...(filters.contractId ? { contractId: filters.contractId } : {}) },
      include: { ticket: { include: { requester: { include: { organization: true } } } } }
    });

    const grouped = new Map<string, BillingReportItemDto>();
    for (const log of worklogs) {
      const org = log.ticket.requester.organization;
      const snapshot = log.valuationSnapshot as {
        organizationId?: string | null; organizationName?: string | null;
        segments?: Array<{ cycleStart: string; cycleEnd: string; minutes: number; coveredMinutes: number; excessMinutes: number; amountCents: number | null }>;
      } | null;
      const hasHistoricalOrganization = snapshot != null && Object.prototype.hasOwnProperty.call(snapshot, 'organizationId');
      const orgId = (hasHistoricalOrganization ? snapshot.organizationId : org?.id) || 'SEM_EMPRESA';
      // Historical ownership must never leak after a requester moves organization.
      if (organizationScoped && orgId !== user.organizationId) continue;
      const orgName = (hasHistoricalOrganization ? snapshot.organizationName : org?.name) || 'Cliente Sem Organização Vinculada';
      const hasPeriod = Boolean(filters.startDate || filters.endDate);
      // A cycle is selected by its start, preserving the recorded amount in full.
      // Logs without segments use their execution start instead (legacy/manual/guarantee).
      const allSegments = Array.isArray(snapshot?.segments) ? snapshot.segments : [];
      const segments = allSegments.filter((segment) => {
        const start = Date.parse(segment.cycleStart);
        return !hasPeriod || (start >= from && start < to);
      });
      if (hasPeriod && (allSegments.length ? segments.length === 0 :
        !(new Date(log.startTime).getTime() >= from && new Date(log.startTime).getTime() < to))) continue;
      const minutes = allSegments.length ? segments.reduce((sum, segment) => sum + segment.minutes, 0) : log.minutes;
      const g = grouped.get(orgId) || {
        organizationId: orgId, organizationName: orgName, billableMinutes: 0,
        nonBillableMinutes: 0, coveredMinutes: 0, excessMinutes: 0,
        totalValueCents: 0, unknownValuationCount: 0,
      };
      if (log.billable) g.billableMinutes += minutes;
      else g.nonBillableMinutes += minutes;
      g.coveredMinutes += segments.reduce((sum, segment) => sum + segment.coveredMinutes, 0);
      g.excessMinutes += segments.reduce((sum, segment) => sum + segment.excessMinutes, 0);
      if (allSegments.length) {
        g.totalValueCents += segments.reduce((sum, segment) => sum + (segment.amountCents ?? 0), 0);
        if (segments.some((segment) => segment.amountCents == null)) g.unknownValuationCount++;
      } else if (log.valueCents != null) {
        g.totalValueCents += log.valueCents;
      } else if (log.value != null) {
        // Preserve a legacy recorded amount; this converts representation only.
        g.totalValueCents += Math.round(log.value * 100);
      } else {
        g.unknownValuationCount++;
      }
      grouped.set(orgId, g);
    }

    return Array.from(grouped.values()).sort((a, b) => b.billableMinutes - a.billableMinutes);
  }

  async getResponseTimeComparison(
    user: CurrentUserPayload,
    referenceDate: Date = new Date(),
  ): Promise<ResponseTimeComparisonDto> {
    const baseWhere = TenantHelper.getTicketWhere(user);
    if (baseWhere.id === '00000000-0000-0000-0000-000000000000') {
      throw new ForbiddenException('Acesso negado aos relatórios');
    }

    const { current, previous } = getClosedMonthRanges(referenceDate);

    const [resolutionTickets, firstResponseTickets] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { ...baseWhere, closedAt: { gte: previous.start, lt: current.end } },
        select: { createdAt: true, closedAt: true },
      }),
      this.prisma.ticket.findMany({
        where: { ...baseWhere, createdAt: { gte: previous.start, lt: current.end } },
        select: {
          createdAt: true,
          requesterId: true,
          comments: {
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true, authorId: true, isInternal: true },
          },
        },
      }),
    ]);

    const inRange = (date: Date, range: { start: Date; end: Date }) =>
      date >= range.start && date < range.end;
    const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60000;

    const resolutionCurrentMinutes: number[] = [];
    const resolutionPreviousMinutes: number[] = [];
    for (const ticket of resolutionTickets) {
      if (!ticket.closedAt) continue;
      const minutes = minutesBetween(ticket.createdAt, ticket.closedAt);
      if (inRange(ticket.closedAt, current)) resolutionCurrentMinutes.push(minutes);
      else if (inRange(ticket.closedAt, previous)) resolutionPreviousMinutes.push(minutes);
    }

    const firstResponseCurrentMinutes: number[] = [];
    const firstResponsePreviousMinutes: number[] = [];
    for (const ticket of firstResponseTickets) {
      const firstResponse = ticket.comments.find(
        (comment) => !comment.isInternal && comment.authorId !== ticket.requesterId,
      );
      if (!firstResponse) continue;
      const minutes = minutesBetween(ticket.createdAt, firstResponse.createdAt);
      if (inRange(ticket.createdAt, current)) firstResponseCurrentMinutes.push(minutes);
      else if (inRange(ticket.createdAt, previous)) firstResponsePreviousMinutes.push(minutes);
    }

    return {
      periodCurrent: { start: current.start.toISOString(), end: current.end.toISOString() },
      periodPrevious: { start: previous.start.toISOString(), end: previous.end.toISOString() },
      resolution: compareResponseTimes(
        resolutionCurrentMinutes,
        resolutionPreviousMinutes,
        RESPONSE_TIME_STABLE_THRESHOLD,
        RESPONSE_TIME_SMALL_SAMPLE_THRESHOLD,
      ),
      firstResponse: compareResponseTimes(
        firstResponseCurrentMinutes,
        firstResponsePreviousMinutes,
        RESPONSE_TIME_STABLE_THRESHOLD,
        RESPONSE_TIME_SMALL_SAMPLE_THRESHOLD,
      ),
      source: ['Ticket.createdAt', 'Ticket.closedAt', 'Comment.createdAt'],
      elapsedTimeNote: 'Tempo corrido, sem desconto de pausa de SLA.',
      extractedAt: new Date().toISOString(),
    };
  }

  async getSummary(user: CurrentUserPayload): Promise<DashboardSummaryDto> {
    const baseWhere = TenantHelper.getTicketWhere(user);
    if (baseWhere.id === '00000000-0000-0000-0000-000000000000') {
      throw new ForbiddenException('Acesso negado ao dashboard');
    }

    const tickets = await this.prisma.ticket.findMany({
      where: baseWhere,
      select: {
        id: true,
        protocol: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        responseDeadline: true,
        resolveDeadline: true,
        slaAccumulatedPauseTime: true,
        slaPausedAt: true,
        agentId: true,
        agent: { select: { id: true, name: true } },
        serviceDeskId: true,
        serviceDesk: { select: { id: true, name: true } },
        requester: {
          select: {
            id: true,
            name: true,
            organization: { select: { id: true, name: true } },
          },
        },
        csatScore: true,
        comments: {
          select: { id: true, authorId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const now = new Date();
    const byStatus: Record<string, number> = {};
    let openCount = 0;
    let closedCount = 0;
    let slaBreachedCount = 0;
    let resolutionMinutesSum = 0;
    let resolutionCount = 0;

    const ticketSummary = {
      total: tickets.length,
      mine: 0,
      unattended: 0,
      inProgress: 0,
      paused: 0,
      overdue: 0,
    };

    const responseDeadlines = { total: 0, today: 0, tomorrow: 0, later: 0 };
    const solutionDeadlines = { total: 0, today: 0, tomorrow: 0, later: 0 };
    const unansweredTickets = { total: 0, mine: 0 };

    let csatGeneralSum = 0;
    let csatGeneralCount = 0;
    let csatGeneralSatisfied = 0;

    let csatMineSum = 0;
    let csatMineCount = 0;
    let csatMineSatisfied = 0;

    const assigneeCounts = new Map<string, number>();
    const serviceDeskCounts = new Map<string, number>();
    const orgCounts = new Map<string, number>();
    const resourceCounts = new Map<string, number>();

    const nowStartOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDayMs = 86400000;
    const tomorrowStart = nowStartOfDay + oneDayMs;
    const afterTomorrowStart = nowStartOfDay + 2 * oneDayMs;
    // Calendar week (Sunday-start) containing "now", used to bucket real
    // Appointment rows below — kept simple and consistent rather than
    // trying to infer a locale-specific first-day-of-week.
    const weekStart = nowStartOfDay - now.getDay() * oneDayMs;
    const weekEnd = weekStart + 7 * oneDayMs;

    const classifyDeadline = (deadline: Date | null | undefined) => {
      if (!deadline) return null;
      const t = new Date(deadline).getTime();
      if (t < tomorrowStart) return 'today';
      if (t < afterTomorrowStart) return 'tomorrow';
      return 'later';
    };

    for (const ticket of tickets) {
      const isClosed = CLOSED_STATUSES.includes(ticket.status);
      const isMine = ticket.agentId === user.id;

      if (isMine) {
        ticketSummary.mine += 1;
      }

      if (ticket.csatScore !== null && ticket.csatScore !== undefined) {
        csatGeneralSum += ticket.csatScore;
        csatGeneralCount += 1;
        if (ticket.csatScore >= 4) csatGeneralSatisfied += 1;

        if (isMine) {
          csatMineSum += ticket.csatScore;
          csatMineCount += 1;
          if (ticket.csatScore >= 4) csatMineSatisfied += 1;
        }
      }

      if (isClosed) {
        closedCount += 1;
        if (ticket.updatedAt && ticket.createdAt) {
          resolutionMinutesSum +=
            (new Date(ticket.updatedAt).getTime() - new Date(ticket.createdAt).getTime()) / 60000;
          resolutionCount += 1;
        }
      } else {
        openCount += 1;
        byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1;

        if (!ticket.agentId) {
          ticketSummary.unattended += 1;
        }

        if (ticket.status === TicketStatus.IN_PROGRESS) {
          ticketSummary.inProgress += 1;
        }

        if (SLA_PAUSE_STATUSES.includes(ticket.status)) {
          ticketSummary.paused += 1;
        }

        // SLA Check
        if (ticket.createdAt) {
          const responseStatus = getSlaStatus(
            ticket.createdAt,
            ticket.responseDeadline,
            now,
            ticket.slaAccumulatedPauseTime ?? 0,
            ticket.slaPausedAt,
          );
          const resolveStatus = getSlaStatus(
            ticket.createdAt,
            ticket.resolveDeadline,
            now,
            ticket.slaAccumulatedPauseTime ?? 0,
            ticket.slaPausedAt,
          );
          if (responseStatus === 'BREACHED' || resolveStatus === 'BREACHED') {
            slaBreachedCount += 1;
            ticketSummary.overdue += 1;
          }
        }

        // Deadlines breakdown
        if (ticket.responseDeadline) {
          responseDeadlines.total += 1;
          const bucket = classifyDeadline(ticket.responseDeadline);
          if (bucket === 'today') responseDeadlines.today += 1;
          else if (bucket === 'tomorrow') responseDeadlines.tomorrow += 1;
          else if (bucket === 'later') responseDeadlines.later += 1;
        }

        if (ticket.resolveDeadline) {
          solutionDeadlines.total += 1;
          const bucket = classifyDeadline(ticket.resolveDeadline);
          if (bucket === 'today') solutionDeadlines.today += 1;
          else if (bucket === 'tomorrow') solutionDeadlines.tomorrow += 1;
          else if (bucket === 'later') solutionDeadlines.later += 1;
        }

        // Unanswered: either OPEN or no comments
        const hasComments = ticket.comments && ticket.comments.length > 0;
        if (ticket.status === TicketStatus.OPEN || !hasComments) {
          unansweredTickets.total += 1;
          if (isMine) unansweredTickets.mine += 1;
        }

        // In-progress breakdown grouping
        const assigneeName = ticket.agent?.name || 'Não atribuído';
        assigneeCounts.set(assigneeName, (assigneeCounts.get(assigneeName) || 0) + 1);

        const deskName = ticket.serviceDesk?.name || 'Geral';
        serviceDeskCounts.set(deskName, (serviceDeskCounts.get(deskName) || 0) + 1);

        const clientName = ticket.requester?.organization?.name || 'Sem Organização';
        orgCounts.set(clientName, (orgCounts.get(clientName) || 0) + 1);

        const priorityLabel = ticket.priority || 'MEDIUM';
        resourceCounts.set(priorityLabel, (resourceCounts.get(priorityLabel) || 0) + 1);
      }
    }

    // Tickets created/closed per day, trailing 30 days (reuses the tickets already
    // loaded above — no extra query). There is no CANCELLED TicketStatus in the
    // schema today, so that series is always 0 until one is introduced; it stays
    // in the shape so the frontend can render it the moment it exists.
    const dateKey = (d: Date) => {
      const local = new Date(d);
      return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    };
    const trendDays = 30;
    const trendMap = new Map<string, { created: number; closed: number; cancelled: number }>();
    for (let i = trendDays - 1; i >= 0; i -= 1) {
      const d = new Date(nowStartOfDay - i * oneDayMs);
      trendMap.set(dateKey(d), { created: 0, closed: 0, cancelled: 0 });
    }
    for (const ticket of tickets) {
      if (ticket.createdAt) {
        const entry = trendMap.get(dateKey(new Date(ticket.createdAt)));
        if (entry) entry.created += 1;
      }
      if (CLOSED_STATUSES.includes(ticket.status) && ticket.updatedAt) {
        const entry = trendMap.get(dateKey(new Date(ticket.updatedAt)));
        if (entry) entry.closed += 1;
      }
    }
    const ticketsTrend30d = Array.from(trendMap.entries()).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    // Monthly hours for the user
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

    let userWorklogs: any[] = [];
    if (this.prisma.worklog?.findMany) {
      try {
        userWorklogs = await this.prisma.worklog.findMany({
          where: {
            authorId: user.id,
            voidedAt: null,
            createdAt: { gte: startOfMonth, lte: endOfMonth },
          },
        });
      } catch {
        userWorklogs = [];
      }
    }

    const worklogsByDay = new Map<number, number>();
    for (const wl of userWorklogs) {
      if (wl.createdAt) {
        const d = new Date(wl.createdAt).getDate();
        worklogsByDay.set(d, (worklogsByDay.get(d) || 0) + (wl.minutes || 0));
      }
    }

    const dailyHours = [];
    let loggedMinutesTotal = 0;
    let targetHoursTotal = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const targetHours = isWeekend ? 0 : 8;
      targetHoursTotal += targetHours;

      const mins = worklogsByDay.get(d) || 0;
      loggedMinutesTotal += mins;
      const loggedHours = Math.round((mins / 60) * 10) / 10;
      const remainingHours = Math.max(0, Math.round((targetHours - loggedHours) * 10) / 10);

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dailyHours.push({
        day: d,
        date: dateStr,
        targetHours,
        loggedHours,
        remainingHours,
      });
    }

    const loggedHoursTotal = Math.round((loggedMinutesTotal / 60) * 10) / 10;
    const remainingHoursTotal = Math.max(0, targetHoursTotal - loggedHoursTotal);

    // Operational Desks & Agents
    let serviceDesksList: any[] = [];
    if (this.prisma.serviceDesk?.findMany) {
      try {
        serviceDesksList = await this.prisma.serviceDesk.findMany({
          select: { id: true, name: true },
          take: 10,
        });
      } catch {
        serviceDesksList = [];
      }
    }

    let agentsList: any[] = [];
    if (this.prisma.user?.findMany) {
      try {
        agentsList = await this.prisma.user.findMany({
          where: this.agentsListWhere(),
          select: { id: true, name: true, agentGroups: { select: { name: true } } },
          take: 10,
        });
      } catch {
        agentsList = [];
      }
    }

    // Recent notifications from recent tickets
    const recentNotifications = [...tickets]
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 5)
      .map((t) => ({
        id: t.id || t.protocol || Math.random().toString(),
        protocol: t.protocol || 'CH-000',
        title: t.title || 'Chamado',
        message: `Status: ${t.status || 'OPEN'}`,
        createdAt: (t.updatedAt || now).toISOString(),
        userName: t.agent?.name || t.requester?.name || 'Sistema',
      }));

    // The chat/messaging module has no real backend yet (see issue thread),
    // so department/agent NAMES come from real data when available, but
    // every interaction metric is honestly 0/null rather than invented —
    // no more fabricated fallback rows when there are no desks/agents.
    const chatsByDepartment = serviceDesksList.map((d) => ({
      department: d.name,
      total: 0,
      inProgress: 0,
      waitingQueue: 0,
      waitingResponse: 0,
      avgWait: null,
      avgService: null,
    }));

    const chatsByAgent = agentsList.map((a) => ({
      name: a.name,
      status: null,
      inProgress: 0,
      group: a.agentGroups?.[0]?.name || 'Equipe de Atendimento',
    }));

    // Compromissos (Agenda module) ARE real and already shipped — source
    // myAppointments/allAppointments from the Appointment table instead of
    // the hardcoded constants this replaces. "my" is always scoped to the
    // current user; "all" reuses the same role-based visibility AgendaService
    // applies (TenantHelper.getAppointmentWhere).
    const appointmentWhere = this.scope ? await this.scope.appointmentWhere(user) : TenantHelper.getAppointmentWhere(user);
    let myAppointmentRows: { startTime: Date }[] = [];
    let allAppointmentRows: { startTime: Date }[] = [];
    if (this.prisma.appointment?.findMany) {
      try {
        const [mine, all] = await Promise.all([
          this.prisma.appointment.findMany({
            where: { userId: user.id },
            select: { startTime: true },
          }),
          this.prisma.appointment.findMany({
            where: appointmentWhere,
            select: { startTime: true },
          }),
        ]);
        myAppointmentRows = mine;
        allAppointmentRows = all;
      } catch {
        myAppointmentRows = [];
        allAppointmentRows = [];
      }
    }

    const summarizeAppointments = (rows: { startTime: Date }[]) => {
      let today = 0;
      let week = 0;
      let month = 0;
      for (const row of rows) {
        const t = new Date(row.startTime).getTime();
        if (t >= nowStartOfDay && t < tomorrowStart) today += 1;
        if (t >= weekStart && t < weekEnd) week += 1;
        if (t >= startOfMonth.getTime() && t <= endOfMonth.getTime()) month += 1;
      }
      return { total: rows.length, today, week, month };
    };

    return {
      openCount,
      closedCount,
      slaBreachedCount,
      avgResolutionMinutes:
        resolutionCount > 0
          ? Math.round(resolutionMinutesSum / resolutionCount)
          : null,
      byStatus,
      ticketSummary,
      responseDeadlines,
      solutionDeadlines,
      unansweredTickets,
      csatGeneral30d: {
        avg: csatGeneralCount > 0 ? Math.round((csatGeneralSum / csatGeneralCount) * 10) / 10 : null,
        count: csatGeneralCount,
        satisfactionRate: csatGeneralCount > 0 ? Math.round((csatGeneralSatisfied / csatGeneralCount) * 100) : null,
      },
      csatMine30d: {
        avg: csatMineCount > 0 ? Math.round((csatMineSum / csatMineCount) * 10) / 10 : null,
        count: csatMineCount,
        satisfactionRate: csatMineCount > 0 ? Math.round((csatMineSatisfied / csatMineCount) * 100) : null,
      },
      recentNotifications,
      inProgressBreakdown: {
        byAssignee: Array.from(assigneeCounts.entries()).map(([name, count]) => ({ name, count })),
        byServiceDesk: Array.from(serviceDeskCounts.entries()).map(([name, count]) => ({ name, count })),
        byOrganization: Array.from(orgCounts.entries()).map(([name, count]) => ({ name, count })),
        byResource: Array.from(resourceCounts.entries()).map(([name, count]) => ({ name, count })),
      },
      monthlyHours: {
        targetHoursTotal,
        loggedHoursTotal,
        remainingHoursTotal,
        days: dailyHours,
      },
      myChats: {
        inProgress: 0,
        waitingResponse: 0,
        avgWaitMinutes: null,
        avgServiceMinutes: null,
      },
      allChats: {
        inProgress: 0,
        waitingResponse: 0,
        avgWaitMinutes: null,
        avgServiceMinutes: null,
      },
      chatsByDepartment,
      chatsByAgent,
      ticketsTrend30d,
      myAppointments: summarizeAppointments(myAppointmentRows),
      allAppointments: summarizeAppointments(allAppointmentRows),
    };
  }
}
