import type { SlaStatus } from '../../hooks/useTickets';

const STATUS_CONFIG: Record<
  SlaStatus,
  { text: string; className: string }
> = {
  ON_TRACK: {
    text: 'Dentro do prazo',
    className: 'bg-green-100 text-green-800',
  },
  AT_RISK: {
    text: 'Em risco',
    className: 'bg-yellow-100 text-yellow-800',
  },
  BREACHED: {
    text: 'Vencido',
    className: 'bg-red-100 text-red-800',
  },
};

const PAUSED_CONFIG = {
  text: 'Pausado',
  className: 'bg-gray-100 text-gray-700',
};

/**
 * Small pill badge showing the SLA status (response or resolve) for a
 * ticket, driven by `responseSlaStatus`/`resolveSlaStatus` computed on the
 * backend (see `apps/api/src/scheduling/sla-status.ts`). Renders nothing
 * when there is no deadline/status to show (legacy tickets, or SLA not
 * applicable), so callers can render it unconditionally.
 */
export function SlaBadge({
  status,
  label,
  paused = false,
}: {
  status: SlaStatus | null | undefined;
  label: string;
  /** Relógio do SLA parado (slaPausedAt definido e chamado não terminal): o selo fica neutro. */
  paused?: boolean;
}) {
  if (!status) {
    return null;
  }

  const { text, className } = paused ? PAUSED_CONFIG : STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <span className="font-semibold">{label}:</span> {text}
    </span>
  );
}

export default SlaBadge;
