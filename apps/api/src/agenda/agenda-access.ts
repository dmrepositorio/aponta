import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lotes 2a5 e 2a5b do tracker #523 (#545, #575): decide, em um unico lugar, quem gere a agenda
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

  /**
   * Quem enxerga a agenda so pela organizacao nao escolhe outra nem agenda fora dela. Hoje so
   * CLIENT_MASTER. Por permissao segue a precedencia do ScopeResolver: o escopo mais amplo
   * vence, entao so tem a organizacao quem a tem e nao tem VIEW_ALL_APPOINTMENTS (o ADMIN
   * recebe todas as chaves do catalogo, inclusive a da organizacao).
   */
  async isOrganizationScoped(user: CurrentUserPayload): Promise<boolean> {
    if (!this.flags.isRbacPermissionOnly()) return user.role === Role.CLIENT_MASTER;
    if (await this.permissions.hasPermission(user.id, 'VIEW_ALL_APPOINTMENTS')) return false;
    return this.permissions.hasPermission(user.id, 'VIEW_ORGANIZATION_APPOINTMENTS');
  }

  /** Ler a agenda de outro usuario (query.userId). Hoje ADMIN e AGENT_MASTER. */
  canViewOtherUsers(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(
      user,
      'VIEW_OTHER_USERS_APPOINTMENTS',
      () => user.role === Role.ADMIN || user.role === Role.AGENT_MASTER,
    );
  }

  /**
   * Consultar ausencia interna (type=ABSENCE). Hoje so o CLIENT_MASTER e vedado; o CLIENT nao
   * tem a chave no grupo padrao, mas o escopo base ja nega tudo a ele (sem efeito observavel).
   */
  canViewInternalAbsences(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'VIEW_INTERNAL_ABSENCES', () => user.role !== Role.CLIENT_MASTER);
  }

  private async decide(user: CurrentUserPayload, key: string, byRole: () => boolean): Promise<boolean> {
    if (!this.flags.isRbacPermissionOnly()) return byRole();
    return this.permissions.hasPermission(user.id, key);
  }
}
