import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TicketsController } from './tickets.controller';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';
import { PublicCsatController } from './public-csat.controller';
import { PublicCsatService } from './public-csat.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { AttachmentAccess } from './attachment-access';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule, EventEmitterModule.forRoot()],
  controllers: [
    TicketsController,
    CsatController,
    PublicCsatController,
    AttachmentsController,
  ],
  providers: [TicketsService, CsatService, PublicCsatService, AttachmentsService, AttachmentAccess],
  exports: [TicketsService],
})
export class TicketsModule {}
