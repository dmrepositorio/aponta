import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { UserAccess } from '../users/user-access';
import { assertAdminPermissions, assertAdminUpdate, isAdminGroup } from './admin-group-guard';
import { DEFAULT_GROUP_KEY } from './default-permission-groups';
import { CreatePermissionGroupDto } from './dto/create-permission-group.dto';
import { UpdatePermissionGroupDto } from './dto/update-permission-group.dto';
import { UpdatePermissionGroupPermissionsDto } from './dto/update-permission-group-permissions.dto';

const INCLUDE_MEMBERS = {
  userMembers: { include: { user: true } },
  technicalGroupLinks: { include: { technicalGroup: true } },
} as const;

@Injectable()
export class PermissionGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    // Opcional: specs que montam o service sem a guarda do ultimo administrador (lote 2h).
    @Optional() private readonly access?: UserAccess,
  ) {}

  findAll() {
    return this.prisma.permissionGroup.findMany({
      orderBy: { name: 'asc' },
      include: INCLUDE_MEMBERS,
    });
  }

  async findOne(id: string) {
    const group = await this.prisma.permissionGroup.findUnique({
      where: { id },
      include: INCLUDE_MEMBERS,
    });

    if (!group) {
      throw new NotFoundException(`Permission group with ID ${id} not found`);
    }

    return group;
  }

  create(dto: CreatePermissionGroupDto) {
    return this.prisma.permissionGroup.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions ?? [],
      },
    });
  }

  async update(id: string, dto: UpdatePermissionGroupDto) {
    const group = await this.findOne(id);
    if (isAdminGroup(group)) assertAdminUpdate(dto);
    // So nome e descricao: o corpo nunca grava `defaultKey` nem `permissions` por aqui (lote 2i).
    return this.prisma.permissionGroup.update({ where: { id }, data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.description !== undefined && { description: dto.description }) } });
  }

  async updatePermissions(id: string, dto: UpdatePermissionGroupPermissionsDto) {
    const group = await this.findOne(id);
    if (isAdminGroup(group)) assertAdminPermissions(dto.permissions);
    return this.prisma.permissionGroup.update({
      where: { id },
      data: { permissions: dto.permissions },
    });
  }

  async remove(id: string) {
    const group = await this.findOne(id);
    this.access?.assertGroupDeletable(group);
    return this.prisma.permissionGroup.delete({ where: { id } });
  }

  async addUser(id: string, userId: string) {
    await this.findOne(id);
    return this.prisma.permissionGroupUser.upsert({
      where: { permissionGroupId_userId: { permissionGroupId: id, userId } },
      update: {},
      create: { permissionGroupId: id, userId },
    });
  }

  async removeUser(id: string, userId: string) {
    const group = await this.findOne(id);
    if (group.defaultKey === DEFAULT_GROUP_KEY[Role.ADMIN]) await this.access?.assertAdminRemains(this.prisma, [userId], { group: true, role: false });
    return this.prisma.permissionGroupUser.delete({
      where: { permissionGroupId_userId: { permissionGroupId: id, userId } },
    });
  }

  async addTechnicalGroup(id: string, technicalGroupId: string) {
    await this.findOne(id);
    return this.prisma.permissionGroupTechnicalGroup.upsert({
      where: {
        permissionGroupId_technicalGroupId: { permissionGroupId: id, technicalGroupId },
      },
      update: {},
      create: { permissionGroupId: id, technicalGroupId },
    });
  }

  async removeTechnicalGroup(id: string, technicalGroupId: string) {
    await this.findOne(id);
    return this.prisma.permissionGroupTechnicalGroup.delete({
      where: {
        permissionGroupId_technicalGroupId: { permissionGroupId: id, technicalGroupId },
      },
    });
  }
}
