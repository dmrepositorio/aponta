import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import type { Ticket } from '../../hooks/useTickets';
import { EzButton, EzEmptyCard, EzSelect, EzSlaChip, EzSpinner, EzTag } from '../ds';
import { priorityLabels, statusLabels } from './TicketCard';
import { TicketPriorityTag, TicketStatusTag } from './TicketTags';
import { effectiveDeadline } from './TicketKanbanCard';
import { useUserScreenConfig } from '../../hooks/useUserScreenConfig';
import { useOpenInTab } from '../../contexts/TabsContext';
import { useAuthStore } from '../../stores/authStore';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatDateTime } from '../../lib/formatDateTime';

/** Abaixo de 640 px (breakpoint `sm`) a Lista troca a tabela de colunas por cartões. */
const NARROW_QUERY = '(max-width: 639px)';

const sourceLabels: Record<string, string> = {
  WEB: 'Web',
  EMAIL: 'E-mail',
  WHATSAPP: 'WhatsApp',
};

interface ColumnDef {
  id: string;
  label: string;
  /** Whitelisted backend `sortBy` field (D8) — omit for columns with no server-side sort support. */
  sortField?: string;
  render: (ticket: Ticket) => ReactNode;
  defaultVisible: boolean;
  /** The API only sends this data to staff (ADMIN/AGENT_MASTER/AGENT), so any other role never gets the column. */
  staffOnly?: boolean;
}

const ticketPath = (ticket: Ticket) => `/tickets/${ticket.id}`;
const ticketTabTitle = (ticket: Ticket) => `#${ticket.protocol} - ${ticket.title}`;

/** Same click contract as the Kanban card: modifiers and middle click stay with the browser (new tab). */
function TicketNumberLink({ ticket }: { ticket: Ticket }) {
  const openInTab = useOpenInTab();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openInTab(ticketPath(ticket), ticketTabTitle(ticket));
  };
  return (
    <Link
      to={ticketPath(ticket)}
      onClick={handleClick}
      className="whitespace-nowrap rounded-control font-mono text-[12px] text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {ticket.protocol}
    </Link>
  );
}

/** Selos de prazo da linha (mesmos do Kanban) e "Pausado" quando o relógio do SLA está parado. */
function TicketSlaCell({ ticket }: { ticket: Ticket }) {
  const now = new Date();
  const hasChips = Boolean(ticket.responseSlaStatus || ticket.resolveSlaStatus);
  if (!hasChips && !ticket.slaPausedAt) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <EzSlaChip
        kind="response"
        status={ticket.responseSlaStatus}
        deadline={effectiveDeadline(ticket.responseDeadline, ticket, now)}
        now={now}
      />
      <EzSlaChip
        kind="resolve"
        status={ticket.resolveSlaStatus}
        deadline={effectiveDeadline(ticket.resolveDeadline, ticket, now)}
        now={now}
      />
      {ticket.slaPausedAt && <EzTag label="Pausado" variant="gray" className="whitespace-nowrap" />}
    </div>
  );
}

function renderDateTime(value: string | null | undefined): ReactNode {
  if (!value) return <span className="text-gray-400">—</span>;
  return <span>{formatDateTime(value)}</span>;
}

const COLUMNS: ColumnDef[] = [
  {
    id: 'number',
    label: 'Número',
    sortField: 'protocol',
    defaultVisible: true,
    render: (t) => <TicketNumberLink ticket={t} />,
  },
  {
    id: 'title',
    label: 'Título',
    sortField: 'title',
    defaultVisible: true,
    render: (t) => <span className="block min-w-[14rem] font-medium text-gray-900">{t.title}</span>,
  },
  {
    id: 'client',
    label: 'Cliente',
    defaultVisible: true,
    render: (t) => <span>{t.requester?.organization?.name ?? '—'}</span>,
  },
  {
    id: 'origin',
    label: 'Origem',
    defaultVisible: true,
    render: (t) => <span>{sourceLabels[t.source ?? 'WEB'] ?? '—'}</span>,
  },
  {
    id: 'priority',
    label: 'Prioridade',
    sortField: 'priority',
    defaultVisible: true,
    render: (t) => <TicketPriorityTag priority={t.priority} />,
  },
  {
    id: 'status',
    label: 'Status',
    sortField: 'status',
    defaultVisible: true,
    render: (t) => <TicketStatusTag status={t.status} />,
  },
  {
    id: 'stage',
    label: 'Estágio',
    defaultVisible: true,
    render: (t) => <span>{t.stage?.name ?? '—'}</span>,
  },
  {
    id: 'sla',
    label: 'SLA',
    defaultVisible: true,
    render: (t) => <TicketSlaCell ticket={t} />,
  },
  {
    id: 'serviceDesk',
    label: 'Mesa de serviço',
    defaultVisible: false,
    render: (t) => <span>{t.serviceDesk?.displayName ?? t.serviceDesk?.name ?? '—'}</span>,
  },
  {
    id: 'resourceGroup',
    label: 'Grupo de recursos',
    defaultVisible: false,
    render: (t) => <span>{t.resourceGroup || '—'}</span>,
  },
  {
    id: 'agent',
    label: 'Responsável',
    sortField: 'agentId',
    defaultVisible: false,
    render: (t) => <span>{t.agent?.name ?? 'Não atribuído'}</span>,
  },
  {
    id: 'requester',
    label: 'Solicitante',
    defaultVisible: false,
    render: (t) => <span>{t.requester?.name ?? '—'}</span>,
  },
  {
    id: 'requesterEmail',
    label: 'E-mail do solicitante',
    defaultVisible: false,
    render: (t) => <span>{t.requester?.email || '—'}</span>,
  },
  {
    id: 'requesterPhone',
    label: 'Telefone do solicitante',
    defaultVisible: false,
    staffOnly: true,
    render: (t) => <span>{t.requester?.phone || '—'}</span>,
  },
  {
    id: 'requesterExtension',
    label: 'Ramal do solicitante',
    defaultVisible: false,
    staffOnly: true,
    render: (t) => <span>{t.requester?.extension || '—'}</span>,
  },
  {
    id: 'createdAt',
    label: 'Criado em',
    sortField: 'createdAt',
    defaultVisible: false,
    render: (t) => renderDateTime(t.createdAt),
  },
  {
    id: 'updatedAt',
    label: 'Atualizado em',
    sortField: 'updatedAt',
    defaultVisible: false,
    render: (t) => renderDateTime(t.updatedAt),
  },
  {
    id: 'responseDeadline',
    label: 'Vencimento de atendimento',
    sortField: 'responseDeadline',
    defaultVisible: false,
    render: (t) => renderDateTime(t.responseDeadline),
  },
  {
    id: 'resolveDeadline',
    label: 'Vencimento de solução',
    sortField: 'resolveDeadline',
    defaultVisible: false,
    render: (t) => renderDateTime(t.resolveDeadline),
  },
];

const DEFAULT_COLUMN_VISIBILITY = COLUMNS.reduce<Record<string, boolean>>((acc, col) => {
  acc[col.id] = col.defaultVisible;
  return acc;
}, {});

interface GroupOption {
  id: string;
  label: string;
  keyOf: (ticket: Ticket) => string;
}

const GROUP_OPTIONS: GroupOption[] = [
  { id: 'none', label: 'Nenhum', keyOf: () => '' },
  { id: 'organization', label: 'Cliente', keyOf: (t) => t.requester?.organization?.name ?? 'Sem cliente' },
  { id: 'stage', label: 'Estágio', keyOf: (t) => t.stage?.name ?? 'Sem estágio' },
  { id: 'status', label: 'Status', keyOf: (t) => statusLabels[t.status] },
  { id: 'priority', label: 'Prioridade', keyOf: (t) => priorityLabels[t.priority] },
  { id: 'agent', label: 'Responsável', keyOf: (t) => t.agent?.name ?? 'Não atribuído' },
  { id: 'serviceDesk', label: 'Mesa de serviço', keyOf: (t) => t.serviceDesk?.displayName ?? t.serviceDesk?.name ?? 'Sem mesa' },
  { id: 'requester', label: 'Solicitante', keyOf: (t) => t.requester?.name ?? 'Sem solicitante' },
];

interface TicketListProps {
  tickets: Ticket[];
  isLoading: boolean;
  /** Used only to render the R1 grouping-caveat note (grouping only sees the current page). */
  totalPages?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (sortBy: string, sortDir: 'asc' | 'desc') => void;
  /** Há filtro ativo na tela: o vazio vira "nenhum resultado" com "Redefinir filtros", em vez de "nenhum chamado ainda". */
  hasFilters?: boolean;
  onResetFilters?: () => void;
}

export function TicketList({
  tickets,
  isLoading,
  totalPages,
  sortBy: initialSortBy,
  sortDir: initialSortDir,
  onSortChange,
  hasFilters = false,
  onResetFilters,
}: TicketListProps) {
  const openInTab = useOpenInTab();
  const role = useAuthStore((state) => state.user?.role);
  const isStaff = role === 'ADMIN' || role === 'AGENT_MASTER' || role === 'AGENT';
  const columns = isStaff ? COLUMNS : COLUMNS.filter((col) => !col.staffOnly);
  const { config, isLoading: isConfigLoading, setGroupBy, setColumnVisibility } = useUserScreenConfig('tickets-list', {
    groupBy: 'none',
    grid: { columnVisibility: DEFAULT_COLUMN_VISIBILITY, density: 'compact' },
  });
  // Os grupos nascem expandidos: guarda só os que o usuário recolheu.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const columnButtonRef = useRef<HTMLButtonElement>(null);
  const isNarrow = useMediaQuery(NARROW_QUERY);

  useEscapeLayer(
    () => {
      setIsColumnMenuOpen(false);
      columnButtonRef.current?.focus();
    },
    isColumnMenuOpen && !isNarrow,
  );

  useEffect(() => {
    if (!isColumnMenuOpen) return undefined;
    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      if (columnMenuRef.current?.contains(event.target as Node)) return;
      setIsColumnMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isColumnMenuOpen]);
  const [sort, setSort] = useState<{ field?: string; dir: 'asc' | 'desc' }>({
    field: initialSortBy,
    dir: initialSortDir ?? 'asc',
  });

  const handleSortClick = (field: string) => {
    const nextDir: 'asc' | 'desc' = sort.field === field && sort.dir === 'asc' ? 'desc' : 'asc';
    setSort({ field, dir: nextDir });
    onSortChange?.(field, nextDir);
  };

  const sortableColumns = columns.filter((col) => col.sortField);
  const handleSortFieldChange = (field: string) => {
    if (!field) return;
    setSort((prev) => ({ field, dir: prev.dir }));
    onSortChange?.(field, sort.dir);
  };
  const handleSortDirChange = (dir: 'asc' | 'desc') => {
    if (!sort.field) return;
    setSort({ field: sort.field, dir });
    onSortChange?.(sort.field, dir);
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // O "Agrupar por" mudaria a lista já desenhada: espera a leitura da preferência.
  if (isLoading || isConfigLoading) {
    return (
      <div className="flex justify-center py-8">
        <EzSpinner label="Carregando chamados…" />
      </div>
    );
  }

  const visibleColumns = columns.filter((col) => config.grid.columnVisibility[col.id] !== false);
  const groupOption = GROUP_OPTIONS.find((g) => g.id === config.groupBy) ?? GROUP_OPTIONS[0];
  const isGrouped = groupOption.id !== 'none';

  const groups = isGrouped
    ? tickets.reduce<Map<string, Ticket[]>>((acc, ticket) => {
        const key = groupOption.keyOf(ticket);
        const bucket = acc.get(key) ?? [];
        bucket.push(ticket);
        acc.set(key, bucket);
        return acc;
      }, new Map())
    : null;

  // Mesmo contrato de abrir o ticket para a linha da tabela e para o cartão.
  const openProps = (ticket: Ticket) => ({
    tabIndex: 0,
    'aria-keyshortcuts': 'Enter',
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Só o próprio item: Enter no link do número já abre pelo link.
      if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
      event.preventDefault();
      openInTab(ticketPath(ticket), ticketTabTitle(ticket));
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      // The number link and any button handle their own click.
      if ((event.target as HTMLElement).closest('a, button')) return;
      openInTab(ticketPath(ticket), ticketTabTitle(ticket));
    },
  });

  const renderRow = (ticket: Ticket) => (
    <tr
      key={ticket.id}
      {...openProps(ticket)}
      className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-grid-row-hover focus-within:bg-grid-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
    >
      {visibleColumns.map((col) => (
        <td key={col.id} className="px-3 py-2 text-[13px] text-gray-700">
          {col.render(ticket)}
        </td>
      ))}
    </tr>
  );

  // Cartão (< 640 px): número, status, título e SLA. Os dados vêm do mesmo modelo da linha.
  const renderCard = (ticket: Ticket) => (
    <li
      key={ticket.id}
      {...openProps(ticket)}
      className="cursor-pointer space-y-2 rounded-control border border-gray-200 bg-white p-3 hover:bg-grid-row-hover focus-within:bg-grid-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
    >
      <div className="flex items-center justify-between gap-2">
        <TicketNumberLink ticket={ticket} />
        <TicketStatusTag status={ticket.status} />
      </div>
      <p className="break-words text-[14px] font-medium text-gray-900">{ticket.title}</p>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-600">
        <span>SLA</span>
        <TicketSlaCell ticket={ticket} />
      </div>
    </li>
  );

  const allExpanded = groups ? Array.from(groups.keys()).every((key) => !collapsedGroups.has(key)) : true;
  const toggleAllGroups = () =>
    setCollapsedGroups(allExpanded && groups ? new Set(groups.keys()) : new Set());

  const renderGroupHeader = (groupKey: string, count: number, isExpanded: boolean) => (
    <button
      type="button"
      aria-expanded={isExpanded}
      onClick={() => toggleGroup(groupKey)}
      className="flex w-full cursor-pointer items-center gap-2 rounded-control text-left text-[13px] font-semibold text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {isExpanded ? (
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" />
      ) : (
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" />
      )}
      <span>
        {groupKey} ({count})
      </span>
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ticket-list-group-by" className="text-[13px] font-medium text-gray-700">
          Agrupar por
        </label>
        <EzSelect
          id="ticket-list-group-by"
          aria-label="Agrupar por"
          variant="compact"
          className="w-auto"
          value={config.groupBy || 'none'}
          onChange={(e) => {
            // Ao escolher o agrupamento, todos os grupos começam expandidos.
            setCollapsedGroups(new Set());
            setGroupBy(e.target.value);
          }}
        >
          {GROUP_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </EzSelect>

        {isGrouped && tickets.length > 0 && (
          <button
            type="button"
            onClick={toggleAllGroups}
            className="max-sm:h-11 sm:h-[var(--control-height-compact)] rounded-control border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-90"
          >
            {allExpanded ? 'Recolher tudo' : 'Expandir tudo'}
          </button>
        )}

        {/* Nos cartões as colunas não existem: o menu de colunas não teria efeito. */}
        {!isNarrow && (
        <div ref={columnMenuRef} className="relative">
          <button
            ref={columnButtonRef}
            type="button"
            aria-haspopup="true"
            aria-expanded={isColumnMenuOpen}
            onClick={() => setIsColumnMenuOpen((prev) => !prev)}
            className="max-sm:h-11 sm:h-[var(--control-height-compact)] rounded-control border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-90"
          >
            Exibir colunas
          </button>
          {isColumnMenuOpen && (
            <div
              role="group"
              aria-label="Colunas visíveis"
              className="absolute z-10 mt-1 w-56 rounded-control border border-gray-200 bg-white p-2 shadow-popover"
            >
              {columns.map((col) => (
                <label key={col.id} className="flex items-center gap-2 px-1 py-1 text-[13px]">
                  <input
                    type="checkbox"
                    checked={config.grid.columnVisibility[col.id] !== false}
                    onChange={(e) =>
                      setColumnVisibility((prev) => ({ ...prev, [col.id]: e.target.checked }))
                    }
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Sem cabeçalho de coluna nos cartões, a ordenação vem destes dois campos. */}
        {isNarrow && tickets.length > 0 && (
          <>
            <EzSelect
              aria-label="Ordenar por"
              variant="compact"
              className="w-auto"
              value={sort.field ?? ''}
              onChange={(e) => handleSortFieldChange(e.target.value)}
            >
              <option value="" disabled>
                Ordenar por
              </option>
              {sortableColumns.map((col) => (
                <option key={col.id} value={col.sortField}>
                  {col.label}
                </option>
              ))}
            </EzSelect>
            <EzSelect
              aria-label="Direção da ordenação"
              variant="compact"
              className="w-auto"
              value={sort.dir}
              disabled={!sort.field}
              onChange={(e) => handleSortDirChange(e.target.value as 'asc' | 'desc')}
            >
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </EzSelect>
          </>
        )}

        {isGrouped && tickets.length > 0 && totalPages && totalPages > 1 && (
          <span className="text-[12px] text-gray-500">
            Agrupando os {tickets.length} chamados desta página.
          </span>
        )}
      </div>

      {tickets.length === 0 ? (
        hasFilters ? (
          <EzEmptyCard
            title="Nenhum chamado encontrado"
            description="Nenhum chamado corresponde aos filtros ativos."
            action={
              onResetFilters && (
                <EzButton variant="secondary" size="small" label="Redefinir filtros" onClick={onResetFilters} />
              )
            }
          />
        ) : (
          <EzEmptyCard
            title="Nenhum chamado ainda"
            description="Quando um chamado for aberto, ele aparece aqui."
            action={
              <EzButton
                variant="primary"
                size="small"
                label="Abrir chamado"
                onClick={() => openInTab('/tickets/new', 'Novo ticket')}
              />
            }
          />
        )
      ) : isNarrow ? (
        <div className="space-y-2">
          {isGrouped ? (
            Array.from(groups ?? []).map(([groupKey, groupTickets]) => {
              const isExpanded = !collapsedGroups.has(groupKey);
              return (
                <div key={groupKey} className="space-y-2">
                  <div className="rounded-control bg-gray-80 px-3 py-2">
                    {renderGroupHeader(groupKey, groupTickets.length, isExpanded)}
                  </div>
                  {isExpanded && (
                    <ul aria-label={groupKey} className="space-y-2">
                      {groupTickets.map(renderCard)}
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <ul aria-label="Chamados" className="space-y-2">
              {tickets.map(renderCard)}
            </ul>
          )}
        </div>
      ) : (
        <div
          role="region"
          aria-label="Tabela de chamados"
          tabIndex={0}
          className="overflow-x-auto rounded-control border border-gray-200 bg-white outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-80">
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    aria-sort={
                      col.sortField && col.sortField === sort.field
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    className="px-3 py-2 text-[12px] font-semibold text-gray-600"
                  >
                    {col.sortField ? (
                      <button
                        type="button"
                        onClick={() => handleSortClick(col.sortField as string)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-control outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {col.label}
                        {col.sortField === sort.field &&
                          (sort.dir === 'asc' ? (
                            <ArrowUp aria-hidden="true" className="h-3 w-3" />
                          ) : (
                            <ArrowDown aria-hidden="true" className="h-3 w-3" />
                          ))}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isGrouped
                ? Array.from(groups ?? []).map(([groupKey, groupTickets]) => {
                    const isExpanded = !collapsedGroups.has(groupKey);
                    return (
                      <Fragment key={groupKey}>
                        <tr className="bg-gray-80">
                          <td colSpan={visibleColumns.length} className="px-3 py-2">
                            {renderGroupHeader(groupKey, groupTickets.length, isExpanded)}
                          </td>
                        </tr>
                        {isExpanded && groupTickets.map(renderRow)}
                      </Fragment>
                    );
                  })
                : tickets.map(renderRow)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TicketList;
