import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { VaultAccess } from './vault-access';
import { ScopeAccess } from '../core/security/scope-access';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [VaultController],
  providers: [VaultService, VaultAccess, ScopeAccess],
})
export class VaultModule {}
