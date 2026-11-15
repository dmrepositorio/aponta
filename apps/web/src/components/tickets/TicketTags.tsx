import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import type { TicketPriority, TicketStatus } from '../../hooks/useTickets';
import { EzTag } from '../ds';
import { priorityLabels, statusLabels } from './TicketCard';

/**
 * Tags de status e de prioridade (SPEC DMTE-525). São dois eixos com forma própria:
 * status = pílula neutra com um ponto por família; prioridade = glifo de 1 a 4 barras,
 * com cor forte só em Alta e Crítica. Vermelho fica para crítico e escalado.
 */

/** Pares [texto, fundo] de token por tag; o teste confere contraste AA (4.5:1). O fundo da pílula neutra é o do cartão (branco). */
export const ticketTagTokenPairs: Record<string, [string, string]> = {
  status: ['gray-700', 'gray-70'],
  'status:ESCALATED': ['red-800', 'gray-70'],
  'priority:LOW': ['gray-700', 'gray-70'],
  'priority:HIGH': ['yellow-800', 'yellow-100'],
  'priority:CRITICAL': ['red-800', 'red-100'],
  authorizationCounter: ['yellow-800', 'yellow-100'],
};

/** Tokens dos glifos (ponto, anel, check e barras); o teste confere 3:1 contra o branco. */
export const ticketGlyphTokens = ['petroleum-500', 'brand-600', 'yellow-800', 'red-600', 'green-600', 'gray-400'];

const dot = (color: string) => (
  <span data-glyph="dot" aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />
);

const statusGlyph: Record<TicketStatus, ReactElement> = {
  OPEN: <span data-glyph="ring" aria-hidden="true" className="h-2 w-2 rounded-full border-2 border-petroleum-500" />,
  IN_PROGRESS: dot('bg-brand-600'),
  PENDING_CUSTOMER: dot('bg-yellow-800'),
  ON_HOLD: dot('bg-yellow-800'),
  PENDING_SANKHYA: dot('bg-yellow-800'),
  PENDING_APPROVAL: dot('bg-yellow-800'),
  ESCALATED: dot('bg-red-600'),
  RESOLVED: <Check data-glyph="check" aria-hidden="true" className="h-3 w-3 text-green-600" strokeWidth={3} />,
  CLOSED: dot('bg-gray-400'),
};

export function TicketStatusTag({ status }: { status: TicketStatus }) {
  return (
    <EzTag
      data-ticket-tag="status"
      label={statusLabels[status] ?? status}
      variant="outline"
      className={status === 'ESCALATED' ? 'text-red-800 border-red-300' : 'border-gray-200'}
      leftIcon={statusGlyph[status]}
    />
  );
}

const barLevel: Record<TicketPriority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const barColor: Record<TicketPriority, string> = {
  LOW: 'bg-gray-400',
  MEDIUM: 'bg-gray-400',
  HIGH: 'bg-yellow-800',
  CRITICAL: 'bg-red-600',
};
const barHeights = ['h-1', 'h-1.5', 'h-2', 'h-2.5'];

/** Barras ascendentes; fora da tag (cartão do Kanban) leva o nome acessível "Prioridade <nome>". */
export function TicketPriorityGlyph({
  priority,
  decorative = false,
}: {
  priority: TicketPriority;
  decorative?: boolean;
}) {
  return (
    <span
      data-glyph={`bars-${barLevel[priority]}`}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': `Prioridade ${priorityLabels[priority] ?? priority}`, title: `Prioridade ${priorityLabels[priority] ?? priority}` })}
      className="inline-flex items-end gap-px"
    >
      {barHeights.map((height, index) => (
        <span
          key={height}
          className={`w-[3px] rounded-[1px] ${height} ${index < barLevel[priority] ? barColor[priority] : 'bg-gray-200'}`}
        />
      ))}
    </span>
  );
}

const priorityVariant: Record<TicketPriority, 'outline' | 'yellow' | 'red'> = {
  LOW: 'outline',
  MEDIUM: 'outline',
  HIGH: 'yellow',
  CRITICAL: 'red',
};

export function TicketPriorityTag({ priority }: { priority: TicketPriority }) {
  return (
    <EzTag
      data-ticket-tag="priority"
      label={priorityLabels[priority] ?? priority}
      variant={priorityVariant[priority]}
      className={priorityVariant[priority] === 'outline' ? 'border-gray-200' : undefined}
      leftIcon={<TicketPriorityGlyph priority={priority} decorative />}
    />
  );
}
