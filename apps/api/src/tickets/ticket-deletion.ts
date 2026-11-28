import { Role } from '@prisma/client';

/** DMTE-560: motivos pelos quais um ticket não pode ser excluído; usado pela exclusão do ticket e pela consulta do cliente. */
export type TicketDeletionReason = 'CLIENT_REQUESTER' | 'HAS_WORKLOGS' | 'HAS_VOIDED_WORKLOGS' | 'HAS_SUB_TICKETS';

export interface TicketDeletionFacts {
  requester: { organizationId: string | null };
  worklogs: { authorId: string; voidedAt: Date | null }[];
  preAppointments: { authorId: string }[];
  _count: { subTickets: number };
}

export function ticketDeletionReasons(ticket: TicketDeletionFacts): TicketDeletionReason[] {
  const reasons: TicketDeletionReason[] = [];
  if (ticket.requester.organizationId) reasons.push('CLIENT_REQUESTER');
  if (activeWorklogCount(ticket) > 0) reasons.push('HAS_WORKLOGS');
  // Apontamento faturado removido só é anulado (fica no banco para auditoria): não há como "removê-lo" de vez.
  if (ticket.worklogs.some((worklog) => worklog.voidedAt)) reasons.push('HAS_VOIDED_WORKLOGS');
  if (ticket._count.subTickets > 0) reasons.push('HAS_SUB_TICKETS');
  return reasons;
}

/** Apontamentos e pré-apontamentos que ainda existem (o apontamento anulado não entra). */
export const activeWorklogCount = (ticket: Pick<TicketDeletionFacts, 'worklogs' | 'preAppointments'>) =>
  ticket.worklogs.filter((worklog) => !worklog.voidedAt).length + ticket.preAppointments.length;

/** Quem remove apontamento e pré-apontamento: um ADMIN ou o autor (regra do WorklogsService). */
export function canRemoveWorklogs(
  ticket: Pick<TicketDeletionFacts, 'worklogs' | 'preAppointments'>,
  user: { id: string; role?: Role },
  _mayRemoveAnyWorklog?: boolean,
): boolean {
  if (user.role === Role.ADMIN) return true;
  return [...ticket.worklogs.filter((worklog) => !worklog.voidedAt), ...ticket.preAppointments].every((row) => row.authorId === user.id);
}

/** Sem saída para o usuário: ticket do cliente, apontamento anulado ou apontamento que ele não pode remover. */
export const hasNoWayOut = (reasons: TicketDeletionReason[], mayRemoveWorklogs: boolean) =>
  reasons.includes('CLIENT_REQUESTER') || reasons.includes('HAS_VOIDED_WORKLOGS') || (reasons.includes('HAS_WORKLOGS') && !mayRemoveWorklogs);
