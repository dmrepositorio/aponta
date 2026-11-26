import { X } from 'lucide-react';
import type { TicketFiltersInput } from '../../hooks/useTickets';
import type { TicketFilterNames } from '../../hooks/useTicketFilterNames';
import { EzButton, EzTag } from '../ds';
import { priorityLabels, statusLabels } from './TicketCard';

/** Chave que `onRemove` devolve; `period` cobre dateFrom, dateTo e dateField juntos. */
export type ActiveFilterKey =
  | 'status'
  | 'priority'
  | 'search'
  | 'number'
  | 'titleContains'
  | 'requesterQuery'
  | 'serviceDeskId'
  | 'organizationId'
  | 'agentId'
  | 'stageId'
  | 'period'
  | 'mine'
  | 'unassigned'
  | 'paused'
  | 'overdue'
  | 'notClosed'
  | 'closedOnly';

interface TicketActiveFiltersProps {
  filters: TicketFiltersInput;
  onReset: () => void;
  /** Remove um filtro só. */
  onRemove: (key: ActiveFilterKey) => void;
  /** Nomes dos filtros por id; sem o nome a tag mostra o rótulo genérico do campo. */
  names?: TicketFilterNames;
}

interface ActiveFilter {
  key: ActiveFilterKey;
  label: string;
}

/** Filtros ativos com o rótulo de cada tag. Os que guardam só um id mostram o nome quando ele já foi resolvido. */
function describeFilters(filters: TicketFiltersInput, names: TicketFilterNames): ActiveFilter[] {
  const withName = (base: string, name: string | undefined) => (name ? `${base}: ${name}` : base);
  const entries: Array<[ActiveFilterKey, unknown, string]> = [
    ['status', filters.status, `Status: ${filters.status ? statusLabels[filters.status] : ''}`],
    ['priority', filters.priority, `Prioridade: ${filters.priority ? priorityLabels[filters.priority] : ''}`],
    ['search', filters.search, `Busca: ${filters.search}`],
    ['number', filters.number, `Número: ${filters.number}`],
    ['titleContains', filters.titleContains, `Título: ${filters.titleContains}`],
    ['requesterQuery', filters.requesterQuery, `Solicitante: ${filters.requesterQuery}`],
    ['serviceDeskId', filters.serviceDeskId, withName('Mesa de serviço', names.serviceDeskId)],
    ['organizationId', filters.organizationId, withName('Cliente', names.organizationId)],
    ['agentId', filters.agentId, withName('Atendente', names.agentId)],
    ['stageId', filters.stageId, withName('Estágio', names.stageId)],
    ['period', filters.dateFrom || filters.dateTo, 'Período'],
    ['mine', filters.mine, 'Meus'],
    ['unassigned', filters.unassigned, 'Não atendidos'],
    ['paused', filters.paused, 'Pausados'],
    ['overdue', filters.overdue, 'Vencidos'],
    ['notClosed', filters.notClosed, 'Abertos'],
    ['closedOnly', filters.closedOnly, 'Fechados'],
  ];
  return entries.filter(([, active]) => Boolean(active)).map(([key, , label]) => ({ key, label }));
}

/**
 * Filtros ativos da Lista (vindos da URL ou da Busca avançada): cada um é uma tag que se remove
 * sozinha, mais a ação de redefinir todos. Página, ordenação e o filtro por avatar do Kanban não
 * contam. Sem filtros, não renderiza nada.
 */
export function TicketActiveFilters({ filters, onReset, onRemove, names = {} }: TicketActiveFiltersProps) {
  const active = describeFilters(filters, names);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Filtros ativos" className="flex flex-wrap items-center gap-2">
        {active.map(({ key, label }) => (
          <EzTag
            key={key}
            label={label}
            variant="gray"
            aria-label={`Remover filtro ${label}`}
            rightIcon={<X aria-hidden="true" className="h-3 w-3" />}
            onClick={() => onRemove(key)}
          />
        ))}
      </div>
      <EzButton variant="tertiary" size="small" label="Redefinir filtros" onClick={onReset} />
    </div>
  );
}

export default TicketActiveFilters;
