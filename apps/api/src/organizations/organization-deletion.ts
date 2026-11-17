import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TicketDeletionReason, ticketDeletionReasons } from '../tickets/ticket-deletion';

/** DMTE-560: regras de bloqueio da exclusão de cliente; a consulta e a exclusão usam este módulo, para nunca divergirem. */

const SAMPLE = 5;

export type DeletionBlockerCode = 'TICKETS' | 'SERVICE_DESKS' | 'CONTRACTS' | 'USERS' | 'VAULT' | 'APPOINTMENTS';

export interface DeletionBlocker {
  code: DeletionBlockerCode;
  message: string;
  count: number;
  items: { id: string; label: string; reasons?: string[] }[];
  resolvable: boolean;
  howToResolve: string | null;
}

export interface OrganizationDeletionCheck {
  id: string;
  name: string;
  canDelete: boolean;
  blockers: DeletionBlocker[];
  cascade: { addresses: number; contacts: number; agentGroups: number; technicalGroups: number; sharedArticles: number; deskEvents: number };
}

const ticketReasonText: Record<TicketDeletionReason, string> = {
  CLIENT_REQUESTER: 'aberto pelo cliente',
  HAS_WORKLOGS: 'tem apontamento',
  HAS_SUB_TICKETS: 'tem sub-tickets',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const named = (list: { id: string; name: string | null }[], fallback: string) =>
  list.map((row) => ({ id: row.id, label: row.name ?? fallback }));

export async function checkOrganizationDeletion(
  db: Prisma.TransactionClient,
  id: string,
  canDeleteTickets: boolean,
): Promise<OrganizationDeletionCheck> {
  const sample = { take: SAMPLE };
  const organization = await db.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          addresses: true, contacts: true, agentGroups: true, technicalGroupLinks: true, articlesSharedWith: true, deskEvents: true,
          serviceDesks: true, contracts: true, users: true, credentials: true, credentialFolders: true, appointments: true,
        },
      },
      serviceDesks: { select: { id: true, name: true }, ...sample },
      contracts: { select: { id: true, name: true }, ...sample },
      users: { select: { id: true, name: true }, ...sample },
      credentials: { select: { id: true, name: true }, ...sample },
      credentialFolders: { select: { id: true, name: true }, ...sample },
      appointments: { select: { id: true, title: true }, ...sample },
    },
  });
  if (!organization) throw new NotFoundException(`Organization with ID ${id} not found`);
  const count = organization._count;

  // shortcut: lê todos os tickets do cliente para decidir a saída; trocar por contagens no banco se passar de ~10 mil.
  const tickets = await db.ticket.findMany({
    where: { OR: [{ commercialOrganizationId: id }, { requester: { organizationId: id } }] },
    select: {
      id: true, protocol: true, title: true,
      requester: { select: { organizationId: true } },
      _count: { select: { worklogs: true, preAppointments: true, subTickets: true } },
    },
  });

  const blockers: DeletionBlocker[] = [];
  if (tickets.length > 0) {
    const rows = tickets.map((ticket) => {
      const rules = ticketDeletionReasons(ticket);
      const reasons = rules.map((code) => ticketReasonText[code]);
      if (!canDeleteTickets) reasons.push('sem permissão para excluir tickets');
      return { ticket, rules, reasons };
    });
    const resolvable = rows.every((row) => canDeleteTickets && !row.rules.includes('CLIENT_REQUESTER'));
    blockers.push({
      code: 'TICKETS',
      message: `Há ${plural(tickets.length, 'ticket', 'tickets')} do cliente.`,
      count: tickets.length,
      items: rows.slice(0, SAMPLE).map(({ ticket, reasons }) => ({ id: ticket.id, label: `${ticket.protocol}: ${ticket.title}`, reasons })),
      resolvable,
      howToResolve: resolvable ? 'Exclua os tickets em Tickets (antes, remova os apontamentos e os sub-tickets, se houver) e tente de novo.' : null,
    });
  }
  if (count.serviceDesks > 0) {
    blockers.push({
      code: 'SERVICE_DESKS',
      message: `Há ${plural(count.serviceDesks, 'mesa vinculada', 'mesas vinculadas')} ao cliente.`,
      count: count.serviceDesks,
      items: named(organization.serviceDesks, 'Mesa'),
      resolvable: true,
      howToResolve: 'Desvincule a mesa em Clientes > Relacionamentos.',
    });
  }
  if (count.contracts > 0) {
    blockers.push({
      code: 'CONTRACTS',
      message: `Há ${plural(count.contracts, 'contrato', 'contratos')} do cliente.`,
      count: count.contracts,
      items: named(organization.contracts, 'Contrato sem nome'),
      resolvable: true,
      howToResolve: 'Exclua o contrato em Contratos.',
    });
  }
  if (count.users > 0) {
    blockers.push({
      code: 'USERS',
      message: `Há ${plural(count.users, 'usuário vinculado', 'usuários vinculados')} ao cliente.`,
      count: count.users,
      items: named(organization.users, 'Usuário'),
      resolvable: false,
      howToResolve: null,
    });
  }
  const vault = count.credentials + count.credentialFolders;
  if (vault > 0) {
    blockers.push({
      code: 'VAULT',
      message: `Há ${plural(vault, 'item', 'itens')} no cofre do cliente.`,
      count: vault,
      items: [...named(organization.credentials, 'Credencial'), ...named(organization.credentialFolders, 'Pasta')].slice(0, SAMPLE),
      resolvable: true,
      howToResolve: 'Exclua as credenciais e pastas no Cofre.',
    });
  }
  if (count.appointments > 0) {
    blockers.push({
      code: 'APPOINTMENTS',
      message: `Há ${plural(count.appointments, 'compromisso', 'compromissos')} na agenda ligados ao cliente.`,
      count: count.appointments,
      items: organization.appointments.map((row) => ({ id: row.id, label: row.title })),
      resolvable: true,
      howToResolve: 'Exclua o compromisso na Agenda.',
    });
  }

  return {
    id: organization.id,
    name: organization.name,
    canDelete: blockers.length === 0,
    blockers,
    cascade: {
      addresses: count.addresses,
      contacts: count.contacts,
      agentGroups: count.agentGroups,
      technicalGroups: count.technicalGroupLinks,
      sharedArticles: count.articlesSharedWith,
      deskEvents: count.deskEvents,
    },
  };
}
