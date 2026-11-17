import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { CnpjLookupService } from './cnpj-lookup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, CnpjLookupService],
})
export class OrganizationsModule {}
