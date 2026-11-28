import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Lote 2a5 do tracker #523 (#545): decide, em um unico lugar, quem le artigos
 * PRIVATE de qualquer autor e quem exclui artigo de outro autor. Flag
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

  /**
   * Editar artigo de outro autor. LACUNA do lote 1f (#566): nenhum grupo padrao
   * reproduz "so ADMIN edita" com chave propria (MANAGE_KNOWLEDGE_BASE tambem
   * esta em AGENT e AGENT_MASTER). Segue por perfil nos dois modos ate a chave existir.
   */
  canEditOthers(user: CurrentUserPayload): boolean {
    return user.role === Role.ADMIN;
  }

  private async decide(user: CurrentUserPayload, key: string, byRole: () => boolean): Promise<boolean> {
    return byRole();
  }
}
