import { Module } from '@nestjs/common';
import { ServiceDesksService } from './service-desks.service';
import { ServiceDesksController } from './service-desks.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HolidaysImportService } from './holidays-import.service';
import { TicketStagesService } from './ticket-stages.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { DeskAccess } from './desk-access';
import { ScopeAccess } from '../core/security/scope-access';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [ServiceDesksController],
  providers: [ServiceDesksService, HolidaysImportService, TicketStagesService, DeskAccess, ScopeAccess],
  exports: [ServiceDesksService, TicketStagesService, DeskAccess],
})
export class ServiceDesksModule {}
