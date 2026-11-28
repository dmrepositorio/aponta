import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lotes 2a5 e 2a5b do tracker #523 (#545, #575): decide, em um unico lugar, quem le artigos
 * PRIVATE de qualquer autor e quem edita ou exclui artigo de outro autor. Flag
 * `rbac-permission-only` desligada: decisao por perfil (comportamento de hoje).
 * Ligada: so por permissao, sem olhar `User.role`.
 */
@Injectable()
export class ArticleAccess {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Sem filtro de visibilidade (le PUBLIC e PRIVATE). Anonimo nunca. Hoje so ADMIN. */
  canViewAll(user: CurrentUserPayload | undefined): Promise<boolean> {
    if (!user) return Promise.resolve(false);
    return this.decide(user, 'VIEW_ALL_KNOWLEDGE_ARTICLES', () => user.role === Role.ADMIN);
  }

  /** Excluir artigo de outro autor. Hoje so ADMIN (pergunta aberta ao dono: preservado). */
  canDeleteOthers(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'DELETE_KNOWLEDGE_ARTICLES', () => user.role === Role.ADMIN);
  }

  /** Editar artigo de outro autor. Hoje so ADMIN (chave propria desde o lote 1g, #571). */
  canEditOthers(user: CurrentUserPayload): Promise<boolean> {
    return this.decide(user, 'EDIT_ALL_KNOWLEDGE_ARTICLES', () => user.role === Role.ADMIN);
  }

  private async decide(user: CurrentUserPayload, key: string, byRole: () => boolean): Promise<boolean> {
    if (!this.flags.isRbacPermissionOnly()) return byRole();
    return this.permissions.hasPermission(user.id, key);
  }
}
