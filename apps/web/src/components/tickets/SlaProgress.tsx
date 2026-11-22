import { Ticket } from '../../hooks/useTickets';
import { EzProgressBar } from '../ds';
import { statusLabels } from './TicketCard';

export function SlaProgress({ ticket }: { ticket: Ticket }) {
  if (!ticket.resolveDeadline) return null;

  const createdAt = new Date(ticket.createdAt).getTime();
  const deadline = new Date(ticket.resolveDeadline).getTime();
  const isTerminal = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
  // Pausa = slaPausedAt definido, o mesmo critério de getSlaStatus na API.
  // Durante a pausa o relógio fica congelado no instante em que ela começou.
  const isPaused = !isTerminal && !!ticket.slaPausedAt;
  const now = isPaused
    ? new Date(ticket.slaPausedAt as string).getTime()
    : new Date().getTime();

  const totalPauseMs = (ticket.slaAccumulatedPauseTime || 0) * 60000;
  const effectiveDeadlineMs = deadline + totalPauseMs;

  const totalWindow = effectiveDeadlineMs - createdAt;
  if (totalWindow <= 0) return null;

  const rawElapsed = now - createdAt;
  const activeElapsed = rawElapsed - totalPauseMs;

  let progress = (activeElapsed / (deadline - createdAt)) * 100;
  progress = Math.max(0, Math.min(progress, 100)); // Clamp between 0 and 100

  // Colors based on status (gray-400 is within the DS gray palette;
  // brand-600 matches EzButton's primary brand color; the status reds/
  // yellows/greens are semantic, not DS tokens, so they stay as-is).
  let barColor = 'bg-brand-600';
  if (isTerminal || isPaused) barColor = 'bg-gray-400';
  else if (ticket.resolveSlaStatus === 'BREACHED') barColor = 'bg-red-500';
  else if (ticket.resolveSlaStatus === 'AT_RISK') barColor = 'bg-yellow-500';
  else barColor = 'bg-green-500';

  const timeRemainingMs = effectiveDeadlineMs - now;
  const isBreached = timeRemainingMs < 0 && !isTerminal;
  
  const absRemainingMs = Math.abs(timeRemainingMs);
  const hoursLeft = Math.floor(absRemainingMs / 3600000);
  const minsLeft = Math.floor((absRemainingMs % 3600000) / 60000);
  
  const labelText = isBreached 
    ? `Vencido há ${hoursLeft}h ${minsLeft}m`
    : `Restam ${hoursLeft}h ${minsLeft}m`;
  const pausedText = `Pausado · ${statusLabels[ticket.status]}`;
  const frozenText = isBreached
    ? `vencido há ${hoursLeft}h ${minsLeft}m`
    : `restam ${hoursLeft}h ${minsLeft}m`;

  return (
    <div className="w-full space-y-1 mt-2 mb-4">
      <div className="flex justify-between text-xs text-gray-500 font-medium">
        <span>Progresso do SLA (Resolução)</span>
        {isPaused ? (
          <span className="flex gap-2">
            <span>{pausedText}</span>
            <span className="text-gray-500">{frozenText}</span>
          </span>
        ) : (
          <span className={isBreached ? 'text-red-600 font-bold' : ''}>
            {labelText}
          </span>
        )}
      </div>
      <EzProgressBar
        value={progress}
        colorClass={barColor}
        aria-label="Progresso do SLA (Resolução)"
        aria-valuetext={isPaused ? pausedText : labelText}
      />
    </div>
  );
}
