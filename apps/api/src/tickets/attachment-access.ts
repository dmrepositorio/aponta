import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from './decorators/current-user.decorator';

/**
 * Lote 2a1 do tracker #523 (#541): quem remove anexo de ticket de outra pessoa.
 * Flag `rbac-permission-only` desligada: por perfil (comportamento de hoje).
 * Ligada: so por permissao REMOVE_TICKET_ATTACHMENTS, sem olhar `User.role`.
 */
@Injectable()
export class AttachmentAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  async canRemoveAny(user: CurrentUserPayload): Promise<boolean> {
    if (!this.flags.isRbacPermissionOnly()) return ([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT] as Role[]).includes(user.role);
    return this.permissions.hasPermission(user.id, 'REMOVE_TICKET_ATTACHMENTS');
  }
}
