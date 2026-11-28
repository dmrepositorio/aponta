import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { DEFAULT_GROUP_KEY } from '../permission-groups/default-permission-groups';

/**
 * Lote 2g do tracker #523 (#551): decide, em um unico lugar, quem entra na lista de
 * atendentes e qual grupo protege o ultimo administrador. Flag `rbac-permission-only`
 * desligada: por perfil (comportamento de hoje). Ligada: por permissao e por grupo
 * protegido, sem olhar `User.role`, que passa a ser so rotulo.
 */
@Injectable()
export class UserAccess {
  constructor(private readonly flags: FeatureFlagsService) {}

  isPermissionOnly(): boolean {
    return this.flags.isRbacPermissionOnly();
  }

  /**
   * Quem pode ser atribuido: perfis de atendimento (hoje) ou quem lanca apontamento, direto ou
   * pelo grupo de atendentes (mesma regra da lista de agentes de ReportsService, #562).
   */
  agentsWhere(): Prisma.UserWhereInput {
    if (!this.isPermissionOnly()) return { role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] } };
    const group = { permissionGroup: { permissions: { has: 'CREATE_EDIT_WORKLOGS' } } };
    return { OR: [{ permissionGroupLinks: { some: group } }, { technicalGroup: { permissionGroupLinks: { some: group } } }] };
  }

  /**
   * Usuario ativo que pertence ao grupo protegido (o padrao Administrador, achado pela
   * `defaultKey` e nunca pelo nome). `undefined` com a flag desligada: a protecao segue por perfil.
   */
  protectedAdminWhere(): Prisma.UserWhereInput | undefined {
    if (!this.isPermissionOnly()) return undefined;
    return { active: true, permissionGroupLinks: { some: { permissionGroup: { defaultKey: DEFAULT_GROUP_KEY[Role.ADMIN] } } } };
  }

  /** STUB (RED, lote 2h): ainda nao define o administrador da guarda. */
  lastAdminWhere(): Prisma.UserWhereInput {
    return { id: { in: [] } };
  }

  /** STUB (RED, lote 2h): ainda nao barra nada. */
  async assertAdminRemains(_db: Pick<Prisma.TransactionClient, 'user'>, _leavingIds: string[]): Promise<void> {
    void ConflictException;
  }

  /** STUB (RED, lote 2h): ainda nao barra nada. */
  assertGroupDeletable(_group: { defaultKey: string | null }): void {
    void ConflictException;
  }
}
