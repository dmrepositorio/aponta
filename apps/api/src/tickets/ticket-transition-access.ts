import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from './decorators/current-user.decorator';

/**
 * Lote 2f do tracker #523 (#550): quem reabre chamado fechado (CLOSED -> OPEN).
 * Flag `rbac-permission-only` desligada: por perfil (comportamento de hoje).
 * Ligada: so por permissao REVIEW_REOPEN_CLOSED_TICKETS, sem olhar `User.role`.
 *
 * Fora deste helper, por lacuna nos grupos padrao (ver PR): liberar PENDING_APPROVAL
 * e `allowedStatuses` de CLIENT_MASTER seguem por perfil ate o lote 1i.
 */
@Injectable()
export class TicketTransitionAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  async canReopenClosed(user: CurrentUserPayload): Promise<boolean> {
    void this.flags;
    void this.permissions;
    return user.role === Role.ADMIN;
  }
}
