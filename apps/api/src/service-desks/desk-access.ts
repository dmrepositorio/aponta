import { Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { DeskActor, deskActorFromRole } from './desk-policy';

/**
 * Lote 2d do tracker #523 (#548): resolve, em um unico lugar, o ator da politica de mesas.
 * RED: stub neutro, ainda decide so por perfil.
 */
@Injectable()
export class DeskAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  async resolve(user: CurrentUserPayload): Promise<DeskActor> {
    void this.flags;
    void this.permissions;
    return deskActorFromRole(user);
  }
}
