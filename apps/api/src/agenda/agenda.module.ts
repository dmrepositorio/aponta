import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgendaService } from './agenda.service';
import { AgendaController } from './agenda.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { AgendaAccess } from './agenda-access';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [AgendaController],
  providers: [AgendaService, AgendaAccess],
  exports: [AgendaService],
})
export class AgendaModule {}
