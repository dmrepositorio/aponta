import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2a5 do tracker #523 (#545): decide, em um unico lugar, quem gere a agenda
 * de outros usuarios e quem fica preso a propria organizacao. Flag
 * `rbac-permission-only` desligada: decisao por perfil (comportamento de hoje).
 * Ligada: so por permissao, sem olhar `User.role`.
 */
@Injectable()
export class AgendaAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Agendar em nome de outro, reatribuir, editar e excluir compromisso alheio. Hoje so ADMIN. */
  canManageSchedules(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'MANAGE_SCHEDULES_ADMIN', () => user.role === Role.ADMIN);
  }

  /** Quem enxerga a agenda so pela organizacao nao escolhe outra nem agenda fora dela. Hoje so CLIENT_MASTER. */
  isOrganizationScoped(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'VIEW_ORGANIZATION_APPOINTMENTS', () => user.role === Role.CLIENT_MASTER);
  }

  private async decide(user: CurrentUserPayload, key: string, byRole: () => boolean): Promise<boolean> {
    return byRole();
  }
}
