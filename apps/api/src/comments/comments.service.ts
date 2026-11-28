import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Comment, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { assertListedAgentMayMutate } from '../service-desks/desk-policy';
import { DeskAccess } from '../service-desks/desk-access';
import { MaskAccess } from './mask-access';

/** Autor do comentário: SOMENTE id, nome e papel (nunca e-mail, telefone etc.). */
export interface CommentAuthorView {
  id: string;
  /** Nulo quando o leitor não pode ver o nome da equipe e o autor é da equipe (nome oculto). */
  name: string | null;
  role: Role;
}

const CLIENT_ROLES: Role[] = [Role.CLIENT, Role.CLIENT_MASTER];

function toCommentAuthorView(
  author: { id: string; name: string; role: Role } | null | undefined,
  hideTeamNames: boolean,
): CommentAuthorView | null {
  if (!author) return null;
  const hideName = hideTeamNames && !CLIENT_ROLES.includes(author.role);
  return {
    id: author.id,
    name: hideName ? null : author.name,
    role: author.role,
  };
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly maskAccess: MaskAccess,
    @Optional() _deskAccess?: DeskAccess,
  ) {}

  withTransaction(database: Prisma.TransactionClient, afterCommit: Array<() => void>) {
    const events = { emit: (name: string, payload: unknown) => {
      afterCommit.push(() => { this.eventEmitter.emit(name, payload); });
      return true;
    } } as EventEmitter2;
    return new CommentsService(database as PrismaService, events, this.maskAccess);
  }

  /**
   * Creates a comment on a ticket. `isInternal` is only honored for callers
   * who may post internal notes (MaskAccess); for everyone else it is forced
   * to `false` server-side no matter what the request body contained, so a
   * client can never publish a comment other clients can't see, nor probe the
   * internal-note channel.
   */
  async create(
    ticketId: string,
    dto: CreateCommentDto,
    currentUser: CurrentUserPayload,
  ): Promise<Comment> {
    const ticketForAuth = await this.assertTicketVisibleTo(ticketId, currentUser);

    const isInternal =
      (dto.isInternal ?? false) &&
      (await this.maskAccess.canPostInternalNotes(currentUser));

    if (isInternal && ticketForAuth.serviceDesk) {
      assertListedAgentMayMutate({
        desk: ticketForAuth.serviceDesk,
        user: currentUser,
      });
    }

    const comment = await this.prisma.comment.create({
      data: {
        content: dto.content,
        isInternal,
        ticketId,
        authorId: currentUser.id,
      },
      include: {
        author: { select: { email: true } },
      }
    });

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: { select: { email: true } },
        agent: { select: { email: true } },
      },
    });

    if (ticket) {
      this.eventEmitter.emit('ticket.commented', {
        ticket,
        comment,
        authorEmail: comment.author?.email,
        requesterEmail: ticket.requester?.email,
        agentEmail: ticket.agent?.email,
      });
    }

    return comment;
  }

  /**
   * Lists a ticket's comments in chronological order. Internal comments are
   * filtered out at the database query level for readers who may not view
   * them (never fetched-then-filtered in memory), so such a reader can never
   * receive an internal note through this endpoint.
   */
  async findByTicket(
    ticketId: string,
    currentUser: CurrentUserPayload,
  ): Promise<Array<Comment & { author: CommentAuthorView | null }>> {
    await this.assertTicketVisibleTo(ticketId, currentUser);

    const [canViewInternal, canViewNames] = await Promise.all([
      this.maskAccess.canViewInternalNotes(currentUser),
      this.maskAccess.canViewTeamMemberNames(currentUser),
    ]);
    const where: Prisma.CommentWhereInput = { ticketId };
    if (!canViewInternal) {
      where.isInternal = false;
    }

    const comments = await this.prisma.comment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    return comments.map((comment) => ({
      ...comment,
      author: toCommentAuthorView(comment.author, !canViewNames),
    }));
  }

  /**
   * Loads the ticket and enforces CLIENT ownership, reusing the exact
   * pattern from TicketsService.findOne: a CLIENT interacting with a ticket
   * they do not request gets NotFoundException (NOT ForbiddenException) so
   * the existence of other users' tickets is never leaked.
   *
   * Escopo, fora do lote 2c (#547): continua por perfil (só CLIENT é barrado).
   * As chaves de escopo (ScopeResolver) estreitariam CLIENT_MASTER (organização)
   * e AGENT/AGENT_MASTER (mesas), o que muda o comportamento de hoje; a troca é
   * do lote 2e junto com tickets.findOne.
   */
  private async assertTicketVisibleTo(
    ticketId: string,
    currentUser: CurrentUserPayload,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        serviceDesk: {
          select: {
            listedGroupsOnly: true,
            agents: { select: { id: true } },
            agentGroups: { select: { members: { select: { id: true } } } },
          },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${ticketId} not found`);
    }
    if (
      currentUser.role === Role.CLIENT &&
      ticket.requesterId !== currentUser.id
    ) {
      // Deliberately NotFoundException (not Forbidden): do not leak the
      // existence of other users' tickets to a CLIENT.
      throw new NotFoundException(`Ticket with ID ${ticketId} not found`);
    }
    return ticket;
  }
}
