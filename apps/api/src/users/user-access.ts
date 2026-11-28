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
/** O que o usuario que sai perde: o vinculo ao grupo Administrador e/ou o perfil ADMIN (lote 2h). */
export interface AdminLoss {
  group: boolean;
  role: boolean;
}

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

  private inAdminGroup(): Prisma.UserWhereInput {
    return { permissionGroupLinks: { some: { permissionGroup: { defaultKey: DEFAULT_GROUP_KEY[Role.ADMIN] } } } };
  }

  /**
   * Lote 2h (#578): quem sustenta o sistema na guarda do ultimo administrador. Ligada: ativo no grupo
   * Administrador. Desligada: ativo com perfil ADMIN OU no grupo (uniao), porque hoje o perfil ainda
   * da acesso; cobre tambem o grupo e os caminhos que antes nao tinham guarda.
   */
  lastAdminWhere(): Prisma.UserWhereInput {
    if (this.isPermissionOnly()) return { active: true, ...this.inAdminGroup() };
    return { active: true, OR: [{ role: Role.ADMIN }, this.inAdminGroup()] };
  }

  /**
   * Barra a operacao que deixaria o sistema sem nenhum administrador ativo. `lose` diz o que `leavingIds`
   * perde (grupo e/ou perfil): quem perde so um dos dois segue administrador pelo outro (so no modo
   * desligado; ligado, o perfil e rotulo). Se ninguem em `leavingIds` e administrador, nada a barrar.
   * shortcut: sem isolamento serializavel, como no `setActiveMany`; duas saidas simultaneas podem passar juntas.
   */
  async assertAdminRemains(db: Pick<Prisma.TransactionClient, 'user'>, leavingIds: string[], lose: AdminLoss = { group: true, role: true }): Promise<void> {
    const admin = this.lastAdminWhere();
    if ((await db.user.count({ where: { ...admin, id: { in: leavingIds } } })) === 0) return;
    if ((await db.user.count({ where: { ...admin, id: { notIn: leavingIds } } })) > 0) return;
    const keeps: Prisma.UserWhereInput[] = [];
    if (!lose.group) keeps.push(this.inAdminGroup());
    if (!lose.role && !this.isPermissionOnly()) keeps.push({ role: Role.ADMIN });
    if (keeps.length && (await db.user.count({ where: { active: true, OR: keeps, id: { in: leavingIds } } })) > 0) return;
    throw new ConflictException('Não é possível remover o último administrador ativo.');
  }

  /** O grupo padrao Administrador (achado pela `defaultKey`) nunca e excluido: a exclusao leva todos os membros. */
  assertGroupDeletable(group: { defaultKey: string | null }): void {
    if (group.defaultKey === DEFAULT_GROUP_KEY[Role.ADMIN]) throw new ConflictException('O grupo Administrador não pode ser excluído.');
  }
}
