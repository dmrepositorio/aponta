import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';
import { SCOPE_KEYS, ScopeResolver } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e1 do tracker #523 (#549): escopo de dados de mesas, credenciais, contratos e agenda.
 * Flag `rbac-permission-only` desligada: o `where` e o do TenantHelper (por perfil), sem consultar
 * permissoes. Ligada: vem do ScopeResolver com as permissoes do usuario, sem olhar `User.role`; a
 * precedencia e a do resolver (o escopo mais amplo vence). Chamados entram no 2e2 (#584).
 */
export type TicketReadScope = 'unrestricted' | 'own' | 'none';

@Injectable()
export class ScopeAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Chamados (2e2, #584): `where` de findAll/findOne, agenda ligada a chamado, relatorios e apontamentos. */
  async ticketWhere(user: CurrentUserPayload): Promise<Prisma.TicketWhereInput> {
    if (!this.flags.isRbacPermissionOnly()) return TenantHelper.getTicketWhere(user);
    return ScopeResolver.getTicketWhere(user, await this.permissions.getEffectivePermissions(user.id));
  }

  /**
   * Quanto do chamado alheio o usuario le e comenta (comments.assertTicketVisibleTo), que hoje so barra
   * o CLIENT. Desligada: por perfil (CLIENT = 'own', o resto 'unrestricted'). Ligada: qualquer chave ampla
   * (todos, organizacao, mesas) = 'unrestricted'; so VIEW_OWN_TICKETS = 'own'; nenhuma = 'none' (fail-closed).
   * Mantem de proposito a CARACTERIZACAO da Fase 0 (CLIENT_MASTER de outra organizacao e AGENT sem vinculo
   * leem e comentam hoje): estreitar isso e decisao do dono, nao deste lote.
   */
  async ticketReadScope(user: CurrentUserPayload): Promise<TicketReadScope> {
    if (!this.flags.isRbacPermissionOnly()) return user.role === Role.CLIENT ? 'own' : 'unrestricted';
    const held = await this.permissions.getEffectivePermissions(user.id);
    const broad = [SCOPE_KEYS.TICKETS_ALL, SCOPE_KEYS.TICKETS_ORGANIZATION, SCOPE_KEYS.TICKETS_DESKS];
    if (broad.some((key) => held.has(key))) return 'unrestricted';
    return held.has(SCOPE_KEYS.TICKETS_OWN) ? 'own' : 'none';
  }

  /** Flag rbac-permission-only ligada: a autorizacao do chamado vem das permissoes. */
  isPermissionOnly(): boolean {
    return this.flags.isRbacPermissionOnly();
  }

  async serviceDeskWhere(user: CurrentUserPayload): Promise<Prisma.ServiceDeskWhereInput> {
    if (!this.flags.isRbacPermissionOnly()) return TenantHelper.getServiceDeskWhere(user);
    return ScopeResolver.getServiceDeskWhere(user, await this.permissions.getEffectivePermissions(user.id));
  }

  async credentialWhere(user: CurrentUserPayload): Promise<Prisma.CredentialWhereInput> {
    if (!this.flags.isRbacPermissionOnly()) return TenantHelper.getCredentialWhere(user);
    return ScopeResolver.getCredentialWhere(user, await this.permissions.getEffectivePermissions(user.id));
  }

  async contractWhere(user: CurrentUserPayload): Promise<Prisma.ContractWhereInput> {
    if (!this.flags.isRbacPermissionOnly()) return TenantHelper.getContractWhere(user);
    return ScopeResolver.getContractWhere(user, await this.permissions.getEffectivePermissions(user.id));
  }

  async appointmentWhere(user: CurrentUserPayload): Promise<Prisma.AppointmentWhereInput> {
    if (!this.flags.isRbacPermissionOnly()) return TenantHelper.getAppointmentWhere(user);
    return ScopeResolver.getAppointmentWhere(user, await this.permissions.getEffectivePermissions(user.id));
  }
}
