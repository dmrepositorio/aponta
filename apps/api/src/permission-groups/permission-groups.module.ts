import { Module } from '@nestjs/common';
import { PermissionGroupsService } from './permission-groups.service';
import { PermissionGroupsController } from './permission-groups.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { UserAccess } from '../users/user-access';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [PermissionGroupsController],
  providers: [PermissionGroupsService, UserAccess],
})
export class PermissionGroupsModule {}
