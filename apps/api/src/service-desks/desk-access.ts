import { Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { SCOPE_KEYS } from '../core/security/scope-resolver';
import { DeskActor, DeskScope, deskActorFromRole } from './desk-policy';

const USE_INTERNAL_KEY = 'USE_INTERNAL_SERVICE_DESKS';

/**
 * Lote 2d do tracker #523 (#548): resolve, em um unico lugar, o ator da politica de mesas.
 * Flag `rbac-permission-only` desligada: decide pelo perfil (comportamento de hoje, sem consultar
 * permissoes). Ligada: so por permissao, sem olhar `User.role`; o escopo segue a precedencia do
 * ScopeResolver (todas > em que atua > da organizacao > nenhum).
 */
@Injectable()
export class DeskAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  async resolve(user: CurrentUserPayload): Promise<DeskActor> {
    if (!this.flags.isRbacPermissionOnly()) return deskActorFromRole(user);
    const held = await this.permissions.getEffectivePermissions(user.id);
    const scope: DeskScope = held.has(SCOPE_KEYS.SERVICE_DESKS_ALL)
      ? 'ALL'
      : held.has(SCOPE_KEYS.SERVICE_DESKS_ASSIGNED)
        ? 'ASSIGNED'
        : held.has(SCOPE_KEYS.SERVICE_DESKS_ORGANIZATION)
          ? 'ORGANIZATION'
          : 'NONE';
    return { canUseInternalDesks: held.has(USE_INTERNAL_KEY), scope };
  }
}
