import type { TicketPriority, TicketStatus } from '../../hooks/useTickets';
import { EzTag } from '../ds';
import { priorityLabels, statusLabels } from './TicketCard';

// Stub neutro (RED da DMTE-525): sem o comportamento novo.
export const ticketTagTokenPairs: Record<string, [string, string]> = {};
export const ticketGlyphTokens: string[] = [];

export function TicketStatusTag({ status }: { status: TicketStatus }) {
  return <EzTag label={statusLabels[status] ?? status} />;
}

export function TicketPriorityTag({ priority }: { priority: TicketPriority }) {
  return <EzTag label={priorityLabels[priority] ?? priority} />;
}

export function TicketPriorityGlyph(_props: { priority: TicketPriority; decorative?: boolean }) {
  return null;
}
