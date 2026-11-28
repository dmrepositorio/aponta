import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e1 do tracker #523 (#549): escopo de dados de mesas, credenciais, contratos e agenda.
 * Esqueleto neutro (RED): ainda decide so pelo perfil, como o TenantHelper.
 */
@Injectable()
export class ScopeAccess {
  constructor(
    _flags: FeatureFlagsService,
    _permissions: PermissionsService,
  ) {}

  async serviceDeskWhere(user: CurrentUserPayload): Promise<Prisma.ServiceDeskWhereInput> {
    return TenantHelper.getServiceDeskWhere(user);
  }

  async credentialWhere(user: CurrentUserPayload): Promise<Prisma.CredentialWhereInput> {
    return TenantHelper.getCredentialWhere(user);
  }

  async contractWhere(user: CurrentUserPayload): Promise<Prisma.ContractWhereInput> {
    return TenantHelper.getContractWhere(user);
  }

  async appointmentWhere(user: CurrentUserPayload): Promise<Prisma.AppointmentWhereInput> {
    return TenantHelper.getAppointmentWhere(user);
  }
}
