import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2b do tracker #523 (#546): quem gere o cofre e quem le a trilha de auditoria.
 * Flag `rbac-permission-only` desligada: so o perfil ADMIN (comportamento de hoje).
 * Ligada: as mesmas chaves que o controller ja exige, sem olhar `User.role`.
 * Leitura/revelacao (`assertVaultAccess`) fica fora deste lote.
 */
@Injectable()
export class VaultAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Criar, editar e remover pastas e credenciais. */
  assertCanManage(user: CurrentUserPayload): Promise<void> {
    return this.assert(user, 'MANAGE_PASSWORD_VAULT');
  }

  /** Trilha de auditoria do cofre. */
  assertCanViewAudit(user: CurrentUserPayload): Promise<void> {
    return this.assert(user, 'VIEW_PASSWORD_VAULT_AUDIT');
  }

  // Stub neutro do RED: ainda ignora a flag e decide so por perfil.
  private async assert(user: CurrentUserPayload, _key: string): Promise<void> {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Apenas Administradores podem gerenciar o cofre');
  }
}
