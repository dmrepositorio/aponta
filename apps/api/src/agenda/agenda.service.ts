import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AppointmentType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantHelper } from '../core/security/tenant.helper';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
import { PermissionsService } from '../permissions/permissions.service';
import { AgendaAccess } from './agenda-access';
import { ScopeAccess } from '../core/security/scope-access';

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly access: AgendaAccess,
    @Optional() private readonly scope?: ScopeAccess,
  ) {}

  private appointmentWhere(user: CurrentUserPayload) {
    return this.scope ? this.scope.appointmentWhere(user) : TenantHelper.getAppointmentWhere(user);
  }

  async findAll(query: QueryAppointmentDto, user: CurrentUserPayload) {
    const baseWhere = await this.appointmentWhere(user);
    const where: Prisma.AppointmentWhereInput = { ...baseWhere };

    if (query.userId) {
      if (await this.access.canViewOtherUsers(user)) {
        where.userId = query.userId;
      }
    }

    if (query.organizationId) {
      if (!(await this.access.isOrganizationScoped(user))) {
        where.organizationId = query.organizationId;
      }
    }

    if (query.type) {
      if (query.type === AppointmentType.ABSENCE && !(await this.access.canViewInternalAbsences(user))) {
        // Quem nao ve ausencias internas (hoje o CLIENT_MASTER) recebe lista vazia
        return [];
      }
      where.type = query.type;
    }

    if (query.startTime || query.endTime) {
      if (query.startTime && query.endTime) {
        where.startTime = { lte: new Date(query.endTime) };
        where.endTime = { gte: new Date(query.startTime) };
      } else if (query.startTime) {
        where.endTime = { gte: new Date(query.startTime) };
      } else if (query.endTime) {
        where.startTime = { lte: new Date(query.endTime) };
      }
    }

    return this.prisma.appointment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true } },
        ticket: {
          select: {
            id: true,
            protocol: true,
            title: true,
            description: true,
            status: true,
            requester: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string, user: CurrentUserPayload) {
    const baseWhere = await this.appointmentWhere(user);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id,
        ...baseWhere,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true } },
        ticket: {
          select: {
            id: true,
            protocol: true,
            title: true,
            description: true,
            status: true,
            requester: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Compromisso não encontrado');
    }

    return appointment;
  }

  async create(dto: CreateAppointmentDto, user: CurrentUserPayload) {
    if (user.role === Role.CLIENT) {
      throw new ForbiddenException('Clientes não têm permissão para agendar compromissos');
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Datas de início e término inválidas');
    }

    if (end <= start) {
      throw new BadRequestException('A data de término deve ser posterior à data de início');
    }

    let targetUserId = user.id;
    if (dto.userId && (await this.access.canManageSchedules(user))) {
      targetUserId = dto.userId;
    }

    let targetOrgId = dto.organizationId;
    if (await this.access.isOrganizationScoped(user)) {
      targetOrgId = user.organizationId ?? undefined;
    }

    let title = dto.title;
    let description = dto.description;
    if (dto.ticketId) {
      const link = await this.resolveTicketLinkage(dto.ticketId, user);
      title = link.title;
      targetOrgId = link.organizationId ?? targetOrgId;
      description = description ?? link.descriptionSummary;
    }

    await this.assertMayMarkIgnoresRule(dto.ignoresWorklogRule, user);

    return this.prisma.appointment.create({
      data: {
        ignoresWorklogRule: dto.ignoresWorklogRule ?? false,
        title,
        description,
        startTime: start,
        endTime: end,
        type: dto.type ?? AppointmentType.AGENDA,
        userId: targetUserId,
        organizationId: targetOrgId,
        ticketId: dto.ticketId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true } },
        ticket: {
          select: {
            id: true,
            protocol: true,
            title: true,
            description: true,
            status: true,
            requester: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  /**
   * When an appointment is linked to a ticket, its title mirrors the
   * ticket's title and its client organization is derived from the
   * ticket's requester — both are authoritative on the ticket, not
   * independently editable on the appointment (DMTE-18 review feedback).
   */
  private async resolveTicketLinkage(ticketId: string, user: CurrentUserPayload) {
    const ticketWhere = TenantHelper.getTicketWhere(user);
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, ...ticketWhere },
      select: {
        title: true,
        description: true,
        requester: { select: { organizationId: true } },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Chamado vinculado não encontrado');
    }

    const descriptionSummary =
      ticket.description.length > 160
        ? `${ticket.description.slice(0, 160).trim()}…`
        : ticket.description;

    return {
      title: ticket.title,
      organizationId: ticket.requester.organizationId ?? undefined,
      descriptionSummary,
    };
  }

  /** DMTE-462 T2: sem desvio por role; só a permissão do grupo marca, altera ou desmarca o compromisso que ignora a regra. */
  private async assertMayMarkIgnoresRule(marked: boolean | undefined, user: CurrentUserPayload) {
    if (marked && !(await this.permissions.hasPermission(user.id, 'RELEASE_WORKLOG_WITHOUT_SCHEDULE'))) {
      throw new ForbiddenException('Sem permissão para liberar apontamento sem agenda');
    }
  }

  async update(id: string, dto: UpdateAppointmentDto, user: CurrentUserPayload) {
    const existing = await this.findOne(id, user);
    const canManage = await this.access.canManageSchedules(user);

    if (!canManage && existing.userId !== user.id) {
      throw new ForbiddenException('Sem permissão para alterar este compromisso');
    }

    await this.assertMayMarkIgnoresRule(dto.ignoresWorklogRule === true || existing.ignoresWorklogRule, user);

    const start = dto.startTime ? new Date(dto.startTime) : existing.startTime;
    const end = dto.endTime ? new Date(dto.endTime) : existing.endTime;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Datas de início e término inválidas');
    }

    if (end <= start) {
      throw new BadRequestException('A data de término deve ser posterior à data de início');
    }

    let title = dto.title;
    let description = dto.description;
    let organizationId = dto.organizationId;
    if (dto.ticketId) {
      const link = await this.resolveTicketLinkage(dto.ticketId, user);
      title = link.title;
      organizationId = link.organizationId ?? organizationId;
      description = description ?? link.descriptionSummary;
    }

    return this.prisma.appointment.update({
      where: { id },
      data: {
        ignoresWorklogRule: dto.ignoresWorklogRule,
        title,
        description,
        startTime: dto.startTime ? start : undefined,
        endTime: dto.endTime ? end : undefined,
        type: dto.type,
        userId: canManage && dto.userId ? dto.userId : undefined,
        organizationId: organizationId !== undefined ? organizationId : undefined,
        ticketId: dto.ticketId !== undefined ? dto.ticketId : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true } },
        ticket: {
          select: {
            id: true,
            protocol: true,
            title: true,
            description: true,
            status: true,
            requester: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  async remove(id: string, user: CurrentUserPayload) {
    const existing = await this.findOne(id, user);

    if (!(await this.access.canManageSchedules(user)) && existing.userId !== user.id) {
      throw new ForbiddenException('Sem permissão para excluir este compromisso');
    }

    return this.prisma.appointment.delete({
      where: { id },
    });
  }
}
