import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommentsController } from './comments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { MailInboundListener } from './listeners/mail-inbound.listener';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { MaskAccess } from './mask-access';

@Module({
  imports: [PrismaModule, UsersModule, PermissionsModule, FeatureFlagsModule, EventEmitterModule.forRoot()],
  controllers: [CommentsController],
  providers: [CommentsService, MailInboundListener, MaskAccess],
  exports: [CommentsService, MaskAccess],
})
export class CommentsModule {}
