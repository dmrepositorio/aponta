import { useQuery } from '@tanstack/react-query';
import { Clock, PauseCircle, ShieldCheck, TicketCheck, User, UserX } from 'lucide-react';
import { api } from '../../lib/api';
import type { TicketFiltersInput } from '../../hooks/useTickets';
import { EzBadge } from '../ds';

/** Perfis que podem liberar um ticket em Aguardando Aprovação (`changeStatus` na API). */
const AUTHORIZER_ROLES = ['ADMIN', 'AGENT_MASTER', 'CLIENT_MASTER'];

type ShortcutPatch = Pick<
  TicketFiltersInput,
  'status' | 'closedOnly' | 'notClosed' | 'unassigned' | 'paused' | 'overdue' | 'mine'
>;

/** Ligar um atalho assume o recorte de status: a API sobrepõe `status`/`closedOnly` a estes filtros, e o botão aceso mentiria. */
const CLEAR_STATUS_FILTERS: ShortcutPatch = {
  status: undefined,
  closedOnly: undefined,
  notClosed: undefined,
  unassigned: undefined,
  paused: undefined,
  overdue: undefined,
  mine: undefined,
};

interface TicketShortcutsProps {
  role?: string;
  status?: TicketFiltersInput['status'];
  closedOnly?: boolean;
  mine?: boolean;
  unassigned?: boolean;
  overdue?: boolean;
  paused?: boolean;
  onSelect: (patch: ShortcutPatch) => void;
}

type BooleanFilter = 'mine' | 'unassigned' | 'overdue' | 'paused';

/** Visões de trabalho sobre filtros que a lista e a Busca avançada já têm; as de atendimento ficam ocultas para CLIENT. */
const filterShortcuts: { label: string; icon: typeof Clock; filter: BooleanFilter; hideForClient?: boolean }[] = [
  { label: 'Meus', icon: User, filter: 'mine', hideForClient: true },
  { label: 'Não atendidos', icon: UserX, filter: 'unassigned', hideForClient: true },
  { label: 'Vencidos', icon: Clock, filter: 'overdue' },
  { label: 'Pausados', icon: PauseCircle, filter: 'paused' },
];

const buttonClass = (active: boolean) =>
  `inline-flex max-sm:h-11 sm:h-[var(--control-height-compact)] min-w-0 items-center gap-2 rounded-control border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
    active
      ? 'border-brand-600 bg-brand-100/50 text-brand-700'
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-90'
  }`;

/**
 * Atalhos da Lista de Tickets (SPEC DMTE-503): cada um liga e desliga um filtro
 * da própria lista (um por vez). O estado vem dos filtros, não de estado próprio,
 * então um link com `closedOnly` ou `status` na URL já abre o atalho ligado.
 */
export function TicketShortcuts({
  role,
  status,
  closedOnly,
  mine,
  unassigned,
  overdue,
  paused,
  onSelect,
}: TicketShortcutsProps) {
  const active = { mine, unassigned, overdue, paused };
  const canAuthorize = AUTHORIZER_ROLES.includes(role ?? '');
  const isClient = role === 'CLIENT';
  const closedActive = Boolean(closedOnly);
  const authorizationActive = status === 'PENDING_APPROVAL';

  const { data: authorizationTotal } = useQuery({
    queryKey: ['tickets', 'authorization-count'],
    queryFn: async () => {
      const { data } = await api.get<{ meta?: { total?: number } }>('/tickets', {
        params: { status: 'PENDING_APPROVAL', limit: 1 },
      });
      return data?.meta?.total ?? 0;
    },
    enabled: canAuthorize,
  });

  return (
    <div role="group" aria-label="Atalhos da lista" className="flex flex-wrap items-center gap-2">
      {canAuthorize && (
        <button
          type="button"
          aria-pressed={authorizationActive}
          className={buttonClass(authorizationActive)}
          onClick={() =>
            onSelect(
              authorizationActive
                ? { status: undefined }
                : { ...CLEAR_STATUS_FILTERS, status: 'PENDING_APPROVAL' },
            )
          }
        >
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Autorizações
          <span aria-live="polite">
            {authorizationTotal ? (
              <EzBadge size="small" colorClass="bg-yellow-100 text-yellow-800" className="tabular-nums">
                {authorizationTotal}
              </EzBadge>
            ) : null}
          </span>
        </button>
      )}
      {filterShortcuts
        .filter(({ hideForClient }) => !(hideForClient && isClient))
        .map(({ label, icon, filter }) => (
          <FilterShortcut
            key={filter}
            label={label}
            icon={icon}
            filter={filter}
            active={Boolean(active[filter])}
            onSelect={onSelect}
          />
        ))}
      <button
        type="button"
        aria-pressed={closedActive}
        className={buttonClass(closedActive)}
        onClick={() =>
          onSelect(closedActive ? { closedOnly: undefined } : { ...CLEAR_STATUS_FILTERS, closedOnly: true })
        }
      >
        <TicketCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        Tickets fechados
      </button>
    </div>
  );
}

/** Atalho de um filtro booleano já existente (mine, unassigned, overdue, paused): liga com o recorte limpo e desliga no segundo clique. */
function FilterShortcut({
  label,
  icon: Icon,
  filter,
  active,
  onSelect,
}: {
  label: string;
  icon: typeof Clock;
  filter: BooleanFilter;
  active: boolean;
  onSelect: (patch: ShortcutPatch) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={buttonClass(active)}
      onClick={() => onSelect(active ? { [filter]: undefined } : { ...CLEAR_STATUS_FILTERS, [filter]: true })}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}

export default TicketShortcuts;
