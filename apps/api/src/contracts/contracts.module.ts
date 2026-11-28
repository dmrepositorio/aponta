import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CostRatesController } from './cost-rates.controller';
import { CostRatesService } from './cost-rates.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ContractAccess } from './contract-access';
import { ScopeAccess } from '../core/security/scope-access';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [CostRatesController, ContractsController],
  providers: [ContractsService, CostRatesService, ContractAccess, ScopeAccess],
})
export class ContractsModule {}
