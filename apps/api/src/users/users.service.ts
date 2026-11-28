import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { assertPasswordPolicy } from '../auth/password-policy';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { normalizeEmail } from './dto/transforms';
import type { User } from '@prisma/client';
import {
  findOrCreateDefaultGroup,
} from '../permission-groups/default-permission-groups';
import { TenantHelper } from '../core/security/tenant.helper';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { escapeLikePattern } from '../common/escape-like-pattern';

const SALT_ROUNDS = 10;
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';
const FOREIGN_KEY_VIOLATION = 'P2003';
const EMAIL_IN_USE = 'E-mail já cadastrado';
const USER_NOT_FOUND = 'Usuário não encontrado';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** `pending` = convite pendente (senha nula); a senha nunca sai da API. */
export type SafeUser = Omit<User, 'password'> & { pending: boolean };

interface GroupSummary {
  id: string;
  name: string;
}

export type UserWithGroups = SafeUser & {
  technicalGroup: GroupSummary | null;
  permissionGroups: GroupSummary[];
  /** Só se o segundo fator está ativo; o segredo e os códigos nunca saem da API (DMTE-551). */
  twoFactorEnabled: boolean;
};

type UserWithGroupRelations = User & {
  technicalGroup?: GroupSummary | null;
  permissionGroupLinks?: { permissionGroup: GroupSummary }[];
  twoFactor?: { enabled: boolean } | null;
};

export interface PaginatedUsers {
  data: UserWithGroups[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

// Tiflux-parity (DMTE-84, Tarefa 3): a tela de Usuários mostra as colunas
// "Grupos de permissões" e "Grupos de atendentes" — este include resolve
// ambas num único round-trip ao Postgres.
const USER_GROUPS_INCLUDE = {
  organization: true,
  twoFactor: { select: { enabled: true } },
  technicalGroup: { select: { id: true, name: true } },
  permissionGroupLinks: {
    include: { permissionGroup: { select: { id: true, name: true } } },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // E-mail é único sem diferença de caixa (DMTE-550): toda escrita o guarda em minúsculas, então a chave única
  // acha quase sempre. A varredura insensível só roda quando ela não acha (dado legado de caixa mista).
  async findByEmail(email: string): Promise<User | null> {
    const normalized = normalizeEmail(email);
    return (
      (await this.prisma.user.findUnique({ where: { email: normalized } })) ??
      this.prisma.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } })
    );
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    assertPasswordPolicy(dto.password, dto);
    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
          ...(dto.role ? { role: dto.role } : {}),
        },
      });
    } catch (error) {
      // Two concurrent registrations can both pass the findByEmail check
      // above (TOCTOU race). Translate the resulting unique-constraint
      // violation from the database into the same clean 409 the pre-check
      // produces, instead of letting a raw Prisma error surface as a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }

    await this.linkToDefaultPermissionGroup(user);

    return this.toSafeUser(user);
  }

  // DMTE-133: sem isto, PermissionsService.getEffectivePermissions não
  // encontra nenhum PermissionGroup vinculado a um usuário recém-criado e
  // ele nasce sem nenhuma permissão (ADMIN tem bypass no PermissionsGuard,
  // os demais papéis não) — reusa o mesmo mapeamento Role -> grupo padrão
  // que o seed usa para os 2 usuários fixos (find-or-create pela `defaultKey`,
  // #533: o nome do grupo pode ser renomeado sem quebrar o vínculo).
  private async linkToDefaultPermissionGroup(user: User): Promise<void> {
    const groupId = await this.defaultGroupId(this.prisma, user.role);
    await this.prisma.permissionGroupUser.create({
      data: { permissionGroupId: groupId, userId: user.id },
    });
  }

  private defaultGroupId(db: Pick<PrismaService, 'permissionGroup'>, role: Role): Promise<string> {
    return findOrCreateDefaultGroup(db, role);
  }

  /**
   * Cadastro pelo administrador (DMTE-550): sem senha, o usuário nasce com convite pendente.
   * Vincula o grupo de permissões padrão do tipo mais os escolhidos; tudo numa transação.
   */
  async createByAdmin(dto: AdminCreateUserDto): Promise<UserWithGroups> {
    if (await this.findByEmail(dto.email)) {
      throw new ConflictException(EMAIL_IN_USE);
    }
    const extraGroupIds = dto.permissionGroupIds ?? [];
    await this.assertPermissionGroupsExist(extraGroupIds);

    const id = await this.writeUnique(() =>
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            password: null,
            ...(dto.role ? { role: dto.role } : {}),
            phone: dto.phone ?? null,
            extension: dto.extension ?? null,
            organizationId: dto.organizationId ?? null,
            technicalGroupId: dto.technicalGroupId ?? null,
          },
        });
        const groupIds = new Set([await this.defaultGroupId(tx, user.role), ...extraGroupIds]);
        await tx.permissionGroupUser.createMany({
          data: [...groupIds].map((permissionGroupId) => ({ permissionGroupId, userId: user.id })),
        });
        return user.id;
      }),
    );
    return this.findOne(id);
  }

  // Corrida entre dois cadastros com o mesmo e-mail e chave estrangeira inexistente viram erro de cliente, não 500.
  private async writeUnique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === UNIQUE_CONSTRAINT_VIOLATION) throw new ConflictException(EMAIL_IN_USE);
        if (error.code === FOREIGN_KEY_VIOLATION) throw new BadRequestException('Cliente ou grupo de atendentes inexistente');
        if (error.code === RECORD_NOT_FOUND) throw new NotFoundException(USER_NOT_FOUND);
      }
      throw error;
    }
  }

  private async assertPermissionGroupsExist(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = await this.prisma.permissionGroup.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw new BadRequestException('Grupo de permissões inexistente');
  }

  toSafeUser(user: User): SafeUser {
    const rest = { ...user, pending: user.password == null } as Partial<User> & { pending: boolean };
    delete rest.password;
    return rest as SafeUser;
  }

  private toUserWithGroups(user: UserWithGroupRelations): UserWithGroups {
    const safe = this.toSafeUser(user) as SafeUser & {
      permissionGroupLinks?: unknown;
      twoFactor?: unknown;
    };
    delete safe.permissionGroupLinks;
    delete safe.twoFactor;

    return {
      ...safe,
      technicalGroup: user.technicalGroup ?? null,
      permissionGroups: (user.permissionGroupLinks ?? []).map(
        (link) => link.permissionGroup,
      ),
      twoFactorEnabled: user.twoFactor?.enabled === true,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<SafeUser> {
    const user = await this.findById(userId);
    if (!user || !user.password) {
      // Same error as a wrong password: never reveal whether the user
      // exists to a caller who only has a (possibly stale) JWT.
      throw new UnauthorizedException('Current password is incorrect');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    assertPasswordPolicy(newPassword, user);
    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // A versão sobe: os outros tokens deixam de valer; quem trocou recebe um novo (AuthController).
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword, passwordVersion: { increment: 1 } },
    });
    return this.toSafeUser(updated);
  }

  async updateProfile(
    userId: string,
    data: { name: string; email: string },
  ): Promise<SafeUser> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { name: data.name, email: data.email },
      });
      return this.toSafeUser(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  // Tiflux-parity (DMTE-84, Tarefa 3): mantém retrocompatibilidade com os
  // chamadores existentes (TicketForm.tsx, OrganizationsPage.tsx) que fazem
  // GET /users sem nenhum query param e esperam um array simples — só muda
  // para o envelope paginado `{ data, meta }` (mesmo formato já usado pelo
  // Vault) quando o chamador passa página/busca/filtro explicitamente.
  async findAll(query: UserQueryDto): Promise<UserWithGroups[] | PaginatedUsers> {
    const hasPaginationParams = Boolean(
      query.page ||
        query.pageSize ||
        query.q ||
        query.technicalGroupId ||
        query.permissionGroupId ||
        query.roles ||
        query.status,
    );

    const where: Prisma.UserWhereInput = {};
    if (query.q) {
      where.OR = [
        { name: { contains: escapeLikePattern(query.q), mode: 'insensitive' } },
        { email: { contains: escapeLikePattern(query.q), mode: 'insensitive' } },
      ];
    }
    if (query.technicalGroupId) {
      where.technicalGroupId = query.technicalGroupId;
    }
    if (query.permissionGroupId) {
      where.permissionGroupLinks = {
        some: { permissionGroupId: query.permissionGroupId },
      };
    }
    if (query.roles?.length) {
      where.role = { in: query.roles };
    }
    // Convite pendente é derivado (senha nula, ainda ativo); sem coluna de status.
    if (query.status === 'ACTIVE') Object.assign(where, { active: true, password: { not: null } });
    if (query.status === 'INACTIVE') where.active = false;
    if (query.status === 'PENDING') Object.assign(where, { active: true, password: null });

    if (!hasPaginationParams) {
      const users = await this.prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        include: USER_GROUPS_INCLUDE,
      });
      return users.map((user) => this.toUserWithGroups(user));
    }

    const page = Math.max(parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(
        parseInt(query.pageSize ?? String(DEFAULT_PAGE_SIZE), 10) ||
          DEFAULT_PAGE_SIZE,
        1,
      ),
      MAX_PAGE_SIZE,
    );

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        include: USER_GROUPS_INCLUDE,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: users.map((user) => this.toUserWithGroups(user)),
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async findOne(id: string): Promise<UserWithGroups> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: USER_GROUPS_INCLUDE,
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
    return this.toUserWithGroups(user);
  }

  /**
   * Edição pelo administrador (DMTE-550). Trocar o tipo não mexe nos grupos de permissões; só
   * `permissionGroupIds` os substitui. `canChangeRole` vem da permissão CHANGE_USER_ROLE.
   */
  async update(id: string, dto: UpdateUserDto, canChangeRole: boolean): Promise<UserWithGroups> {
    const current = await this.findById(id);
    if (!current) throw new NotFoundException(USER_NOT_FOUND);
    if (dto.role !== undefined && dto.role !== current.role && !canChangeRole) {
      throw new ForbiddenException('Sem permissão para alterar o tipo do usuário');
    }
    if (dto.email !== undefined) {
      const other = await this.findByEmail(dto.email);
      if (other && other.id !== id) throw new ConflictException(EMAIL_IN_USE);
    }
    await this.assertPermissionGroupsExist(dto.permissionGroupIds ?? []);

    const { permissionGroupIds, ...rest } = dto;
    // Só o que veio no corpo muda: campo ausente não pode virar `undefined` na gravação.
    const fields = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    await this.writeUnique(() =>
      this.prisma.user.update({
        where: { id },
        data: {
          ...fields,
          ...(permissionGroupIds
            ? {
                permissionGroupLinks: {
                  deleteMany: {},
                  create: [...new Set(permissionGroupIds)].map((permissionGroupId) => ({ permissionGroupId })),
                },
              }
            : {}),
        },
      }),
    );
    return this.findOne(id);
  }

  async setActive(id: string, active: boolean, actorId: string): Promise<SafeUser> {
    const [user] = await this.setActiveMany([id], active, actorId);
    return user;
  }

  /**
   * Ativar/inativar vale na hora e em lote, tudo ou nada (DMTE-550). Inativar: ninguém inativa a si
   * mesmo nem deixa o sistema sem ADMIN ativo (a regra olha o conjunto inteiro).
   * shortcut: sem isolamento serializável; duas inativações simultâneas de admins distintos podem
   * passar juntas. Subir o isolamento se o volume de administradores crescer.
   */
  async setActiveMany(ids: string[], active: boolean, actorId: string): Promise<SafeUser[]> {
    const unique = [...new Set(ids)];
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.user.findMany({ where: { id: { in: unique } } });
      if (found.length !== unique.length) throw new NotFoundException(USER_NOT_FOUND);
      if (!active) {
        if (unique.includes(actorId)) {
          throw new ConflictException('Você não pode inativar a si mesmo.');
        }
        if (found.some((u) => u.role === Role.ADMIN && u.active)) {
          const remaining = await tx.user.count({ where: { role: Role.ADMIN, active: true, id: { notIn: unique } } });
          if (remaining === 0) throw new ConflictException('Não é possível inativar o último administrador ativo.');
        }
      }
      await tx.user.updateMany({ where: { id: { in: unique } }, data: { active } });
      const updated = await tx.user.findMany({ where: { id: { in: unique } }, orderBy: { name: 'asc' } });
      return updated.map((user) => this.toSafeUser(user));
    });
  }

  /**
   * "Atendente" picker for the ticket Busca avançada / assignment UI
   * (SPEC DMTE-137 D8/T4). ADMIN sees every agent with no desk scoping;
   * AGENT/AGENT_MASTER only see agents of the service desks they can
   * themselves access, reusing the exact same scope
   * `TenantHelper.getServiceDeskWhere` applies to ticket/desk visibility.
   */
  async findAgents(currentUser: CurrentUserPayload): Promise<SafeUser[]> {
    const roleFilter: Prisma.UserWhereInput = {
      role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] },
      // Inativo e convite pendente não são atribuíveis (DMTE-550); o nome em ticket antigo segue legível.
      active: true,
      password: { not: null },
    };

    if (currentUser.role === Role.ADMIN) {
      const users = await this.prisma.user.findMany({
        where: roleFilter,
        orderBy: { name: 'asc' },
      });
      return users.map((user) => this.toSafeUser(user));
    }

    const desks = await this.prisma.serviceDesk.findMany({
      where: TenantHelper.getServiceDeskWhere(currentUser),
      select: {
        agents: { select: { id: true } },
        agentGroups: { select: { members: { select: { id: true } } } },
      },
    });
    const agentIds = new Set<string>();
    for (const desk of desks) {
      desk.agents.forEach((agent) => agentIds.add(agent.id));
      desk.agentGroups.forEach((group) =>
        group.members.forEach((member) => agentIds.add(member.id)),
      );
    }

    const users = await this.prisma.user.findMany({
      where: { ...roleFilter, id: { in: Array.from(agentIds) } },
      orderBy: { name: 'asc' },
    });
    return users.map((user) => this.toSafeUser(user));
  }
}
