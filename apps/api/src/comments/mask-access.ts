import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2c do tracker #523 (#547): decide, em um unico lugar, quem posta e le
 * nota interna, quem ve o nome da equipe nos comentarios e quem recebe
 * telefone e ramal do solicitante. Flag `rbac-permission-only` desligada:
 * decisao por perfil (comportamento de hoje). Ligada: so por permissao, sem
 * olhar `User.role`.
 */
@Injectable()
export class MaskAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  canPostInternalNotes(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'POST_INTERNAL_NOTES', () => user.role !== Role.CLIENT);
  }

  /** Ler nota interna usa a chave que ja abre o controller de comentarios (ver e adicionar comunicacao interna). */
  canViewInternalNotes(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'VIEW_ADD_INTERNAL_COMMUNICATION', () => user.role !== Role.CLIENT);
  }

  canViewTeamMemberNames(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'VIEW_TEAM_MEMBER_NAMES', () => user.role !== Role.CLIENT);
  }

  canViewRequesterContact(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(
      user,
      'VIEW_REQUESTER_CONTACT_INFO',
      () => user.role === Role.ADMIN || user.role === Role.AGENT_MASTER || user.role === Role.AGENT,
    );
  }

  private async decide(user: CurrentUserPayload, key: string, byRole: () => boolean): Promise<boolean> {
    if (!this.flags.isRbacPermissionOnly()) return byRole();
    return this.permissions.hasPermission(user.id, key);
  }
}
