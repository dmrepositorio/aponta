import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';
import { ScopeResolver } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e1 do tracker #523 (#549): escopo de dados de mesas, credenciais, contratos e agenda.
 * Flag `rbac-permission-only` desligada: o `where` e o do TenantHelper (por perfil), sem consultar
 * permissoes. Ligada: vem do ScopeResolver com as permissoes do usuario, sem olhar `User.role`; a
 * precedencia e a do resolver (o escopo mais amplo vence). Chamados (`getTicketWhere`) ficam no 2e2.
 */
@Injectable()
export class ScopeAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

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
