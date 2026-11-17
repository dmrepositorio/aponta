import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailService } from './mail.service';
import { ImapService } from './imap.service';
import { TicketEventsListener } from './listeners/ticket-events.listener';

@Module({
  imports: [PrismaModule],
  providers: [MailService, ImapService, TicketEventsListener],
  exports: [MailService],
})
export class MailModule {}
