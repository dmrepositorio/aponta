/** DMTE-560: motivos pelos quais um ticket não pode ser excluído; usado pela exclusão do ticket e pela consulta do cliente. */
export type TicketDeletionReason = 'CLIENT_REQUESTER' | 'HAS_WORKLOGS' | 'HAS_SUB_TICKETS';

export interface TicketDeletionFacts {
  requester: { organizationId: string | null };
  _count: { worklogs: number; preAppointments: number; subTickets: number };
}

export function ticketDeletionReasons(_ticket: TicketDeletionFacts): TicketDeletionReason[] {
  return [];
}
