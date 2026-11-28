import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2a3 do tracker #523 (#543): decide, em um unico lugar, quem gere
 * contratos, quem gere custos individuais e quem ve os valores financeiros.
 * Flag `rbac-permission-only` desligada: decisao por perfil (comportamento de
 * hoje). Ligada: so por permissao, sem olhar `User.role`.
 */
@Injectable()
export class ContractAccess {
  constructor(
    protected readonly flags: FeatureFlagsService,
    protected readonly permissions: PermissionsService,
  ) {}

  canManageContracts(user: CurrentUserPayload): Promise<boolean> {
    return Promise.resolve(user.role === Role.ADMIN);
  }

  canManageBilling(user: CurrentUserPayload): Promise<boolean> {
    return Promise.resolve(user.role === Role.ADMIN);
  }

  canViewFinancials(user: CurrentUserPayload): Promise<boolean> {
    return Promise.resolve(user.role !== Role.AGENT && user.role !== Role.AGENT_MASTER);
  }
}
