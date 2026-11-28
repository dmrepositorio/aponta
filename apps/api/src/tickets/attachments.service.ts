import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from './decorators/current-user.decorator';
import { AttachmentAccess } from './attachment-access';

interface CreateAttachmentInput {
  ticketId: string;
  uploaderId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileUrl: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AttachmentAccess,
  ) {}

  create(input: CreateAttachmentInput) {
    return this.prisma.ticketAttachment.create({ data: input });
  }

  findAllByTicket(ticketId: string) {
    return this.prisma.ticketAttachment.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { id: true, name: true, email: true } } },
    });
  }

  async remove(attachmentId: string, user: CurrentUserPayload) {
    const attachment = await this.prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado');
    }
    const isOwner = attachment.uploaderId === user.id;
    const isPrivileged = !isOwner && (await this.access.canRemoveAny(user));
    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException(
        'Você não tem permissão para remover este anexo',
      );
    }

    await this.prisma.ticketAttachment.delete({ where: { id: attachmentId } });

    try {
      await unlink(join(process.cwd(), 'uploads', attachment.filename));
    } catch {
      // file might already be gone from disk; ignore
    }

    return { success: true };
  }
}
