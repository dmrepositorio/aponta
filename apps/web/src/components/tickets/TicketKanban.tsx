import { CSSProperties, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
  DragStart,
  DroppableProvidedProps,
} from '@hello-pangea/dnd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '../../lib/api';
import type { Ticket, TicketStatus, TicketsPage } from '../../hooks/useTickets';
import type { DeskStage } from '../MesaStagesEditor';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';
import { statusLabels, priorityLabels } from './TicketCard';
import { TicketKanbanCard, type TicketKanbanCardVisibleFields } from './TicketKanbanCard';
import { useAuthStore } from '../../stores/authStore';
import { EzAlert, EzAvatar, EzSelect, EzSpinner, EzTag } from '../ds';
import { cn } from '../ds/utils';
import { useUserScreenConfig } from '../../hooks/useUserScreenConfig';

const statusColumns: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'ESCALATED',
  'PENDING_CUSTOMER',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'PENDING_SANKHYA',
  'RESOLVED',
  'CLOSED',
];

/**
 * Responsive board (DMTE-458): the board scrolls horizontally with snap on
 * phones/tablets (columns ~80vw / 260px) and, from `lg`, columns share the
 * available width (flex-1, min 220px) so the board only scrolls when there are
 * more columns than fit. DMTE-527: o encaixe é `proximity` (não prende a
 * rolagem) e, a partir de `lg`, o `scroll-padding` à direita reserva o espaço
 * das faixas recolhidas, que ficam fixas na borda (ver `CollapsedColumn`).
 */
const KANBAN_BOARD_CLASS =
  'flex items-start gap-3 overflow-x-auto pb-4 snap-x snap-proximity lg:gap-4 lg:scroll-pr-[var(--strips-width)]';

/** Colunas que abrem recolhidas quando o usuário ainda não escolheu (DMTE-527 AC-07). */
const FINAL_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

/** Faixa recolhida (48 px) mais o `gap-4` do quadro: cada faixa fixa fica uma posição à esquerda da seguinte, onde estaria no fim do quadro. */
const STRIP_STEP_PX = 64;
const stripRight = (collapsedIds: string[], id: string) =>
  (collapsedIds.length - 1 - collapsedIds.indexOf(id)) * STRIP_STEP_PX;
/** Alvo de 32 px (WCAG 2.5.8) com margem negativa para o cabeçalho da coluna manter a altura. */
const collapseButtonClass =
  '-my-1.5 -ml-1.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-gray-400 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const boardStyle = (collapsedIds: string[]) =>
  ({ '--strips-width': `${collapsedIds.length * STRIP_STEP_PX}px` }) as CSSProperties;
const KANBAN_COLUMN_CLASS =
  'flex w-[80vw] max-w-[320px] shrink-0 snap-start sm:w-[260px] lg:w-auto lg:min-w-[220px] lg:max-w-none lg:flex-1';

/** "Ordenar" fields (D6b) — only fields that exist in the Aponta ticket model. */
const SORT_FIELDS: { id: string; label: string }[] = [
  { id: 'title', label: 'Título' },
  { id: 'protocol', label: 'Número' },
  { id: 'agent', label: 'Responsável' },
  { id: 'priority', label: 'Prioridade' },
  { id: 'resolveDeadline', label: 'Vencimento de solução' },
  { id: 'responseDeadline', label: 'Vencimento de atendimento' },
  { id: 'createdAt', label: 'Data de criação' },
  { id: 'status', label: 'Status' },
  { id: 'updatedAt', label: 'Data de atualização' },
];

/**
 * D6c "Exibir campos": card fields the Configurações popover can toggle.
 * Título/Número are fixed (D6c/D7) and have no entry here. Defaults mirror
 * the TiFlux benchmark (§2.4): Responsável/Cumprimento SLA on, Cliente off.
 * "Tempo no estágio" from the benchmark is NOT included — it would need a
 * new per-ticket aggregation over `TicketAudit` STAGE_CHANGED entries (no
 * such field exists on Ticket today), which is a backend decision beyond
 * this correction round's scope.
 */
const KANBAN_FIELDS: { id: keyof TicketKanbanCardVisibleFields; label: string; defaultVisible: boolean }[] = [
  { id: 'agent', label: 'Responsável', defaultVisible: true },
  { id: 'client', label: 'Cliente', defaultVisible: false },
  { id: 'sla', label: 'Cumprimento SLA', defaultVisible: true },
  { id: 'createdAt', label: 'Data de criação', defaultVisible: false },
  { id: 'updatedAt', label: 'Data de última atualização', defaultVisible: false },
];

const DEFAULT_KANBAN_FIELD_VISIBILITY = KANBAN_FIELDS.reduce<Record<string, boolean>>(
  (acc, field) => {
    acc[field.id] = field.defaultVisible;
    return acc;
  },
  {},
);

const PRIORITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const STATUS_RANK: Record<string, number> = Object.fromEntries(
  statusColumns.map((status, index) => [status, index]),
);

function sortValue(ticket: Ticket, field: string): string | number {
  switch (field) {
    case 'title':
      return ticket.title.toLowerCase();
    case 'protocol':
      return ticket.protocol.toLowerCase();
    case 'agent':
      return (ticket.agent?.name ?? '').toLowerCase();
    case 'priority':
      return PRIORITY_RANK[ticket.priority] ?? 0;
    case 'status':
      return STATUS_RANK[ticket.status] ?? 0;
    case 'resolveDeadline':
      return ticket.resolveDeadline ? new Date(ticket.resolveDeadline).getTime() : 0;
    case 'responseDeadline':
      return ticket.responseDeadline ? new Date(ticket.responseDeadline).getTime() : 0;
    case 'createdAt':
      return new Date(ticket.createdAt).getTime();
    case 'updatedAt':
      return new Date(ticket.updatedAt).getTime();
    default:
      return 0;
  }
}

/** Reorders cards within a column (D6b) — purely cosmetic, never re-fetches. */
function applySort(list: Ticket[], field: string | null, dir: 'asc' | 'desc'): Ticket[] {
  if (!field) return list;
  const sorted = [...list].sort((a, b) => {
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

/**
 * Synthetic column id for tickets with no recognized current stage on the
 * selected mesa — either `ticket.stageId` is null, or it points at a stage
 * that doesn't belong to this mesa's current stage list (e.g. deleted
 * stage). Not a real `TicketStage.id`. The backend has no "unset stage"
 * operation, so this column never accepts a drop — but its cards ARE
 * draggable OUT to the mesa's initial stage(s), since the backend allows
 * that exact move for a stageless ticket (see `getAllowedStageIds`).
 */
const NO_STAGE_COLUMN_ID = '__NO_STAGE__';

interface ServiceDesk {
  id: string;
  name: string;
}

interface TicketKanbanProps {
  tickets: Ticket[];
  isLoading: boolean;
  isError: boolean;
  /**
   * Mesa (service desk) inicial, usada apenas para semear a seleção do
   * seletor de Mesa dedicado do Kanban (ex. ao chegar de um link do
   * Dashboard com `?serviceDeskId=...`). Depois da primeira renderização, a
   * escolha de mesa vive inteiramente dentro do Kanban — como no TiFlux,
   * onde o seletor "Mesa: <nome>" do quadro é independente de qualquer
   * filtro da tela de Lista — e não é mais sincronizada com o filtro
   * "Departamento" de `TicketFilters`.
   */
  initialServiceDeskId?: string;
}

/**
 * Estágios para os quais é permitido mover `ticket`, espelhando a regra que
 * `TicketsService.changeStage` aplica no backend: um ticket com estágio
 * reconhecido só pode se mover para um estágio presente em
 * `transitionToIds` do seu estágio atual (dados de `TicketStageTransition`,
 * os mesmos retornados por `GET /service-desks/:id/stages`); um ticket SEM
 * estágio reconhecido só pode ir para um estágio `isInitial` (mesma regra
 * do backend para `existing.stageId` nulo).
 */
function getAllowedStageIds(ticket: Ticket, stages: DeskStage[]): Set<string> {
  const currentStage = ticket.stageId
    ? stages.find((stage) => stage.id === ticket.stageId)
    : undefined;
  if (currentStage) return new Set(currentStage.transitionToIds);
  // No recognized current stage: only the mesa's initial stage(s) are valid targets.
  return new Set(
    stages.filter((stage) => stage.isInitial).map((stage) => stage.id),
  );
}

/** The column id a ticket belongs to in stage mode: its own stage id when
 * recognized on this mesa, or the `NO_STAGE_COLUMN_ID` bucket otherwise. */
function stageColumnIdFor(ticket: Ticket, stages: DeskStage[]): string {
  const recognized =
    Boolean(ticket.stageId) &&
    stages.some((stage) => stage.id === ticket.stageId);
  return recognized ? (ticket.stageId as string) : NO_STAGE_COLUMN_ID;
}

/** Extracts a user-facing message from a failed stage-change call,
 * preferring the backend's own validation message (e.g. "Transição de
 * estágio não permitida") when present. */
function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string } | undefined)
      ?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Não foi possível mover o chamado. Tente novamente.';
}

/** TiFlux parity: a collapsed column shrinks to a thin strip (no ticket
 * list), with its label rotated vertically and a chevron to re-expand. It
 * still renders the Droppable's ref/props (required by @hello-pangea/dnd
 * even while `isDropDisabled`) but never accepts a drop while collapsed.
 * DMTE-527: a faixa inteira é o botão de expandir (alvo de 48 px de largura) e,
 * a partir de `lg`, fica fixa na borda direita do quadro (`right` em px vem de
 * `--strip-right`, para as faixas não se sobreporem). */
function CollapsedColumn({
  label,
  count,
  right,
  onExpand,
  droppableRef,
  droppableProps,
  placeholder,
}: {
  label: string;
  count: number;
  right: number;
  onExpand: () => void;
  droppableRef: (element: HTMLElement | null) => void;
  droppableProps: DroppableProvidedProps;
  placeholder: ReactNode;
}) {
  return (
    <div
      ref={droppableRef}
      {...droppableProps}
      style={{ '--strip-right': `${right}px` } as CSSProperties}
      className="group relative flex min-h-[500px] w-12 shrink-0 flex-col items-center gap-2 self-stretch rounded-lg border border-gray-200 bg-gray-80 p-2 lg:sticky lg:right-[var(--strip-right)]"
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expandir coluna ${label}`}
        title="Expandir coluna"
        data-testid="expand-column"
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      />
      <ChevronRight className="pointer-events-none h-3.5 w-3.5 text-gray-400 group-hover:text-gray-700" aria-hidden="true" />
      <EzTag label={String(count)} variant="gray" className="pointer-events-none !px-1.5 !py-0.5" />
      <span className="pointer-events-none [writing-mode:vertical-rl] rotate-180 text-xs font-semibold text-gray-900 py-1 whitespace-nowrap">
        {label}
      </span>
      {placeholder}
    </div>
  );
}

/** TiFlux parity: a quick-add link at the bottom of each (expanded) Kanban
 * column — same destination as the Grid toolbar's "+" action. */
function NewTicketButton() {
  return (
    <Link
      to="/tickets/new"
      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-[12px] font-medium text-gray-600 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      Abrir novo ticket
    </Link>
  );
}

/** Gatilho + painel da toolbar (Ordenar, Configurações). Fecha como o
 * `EzSelect` do seletor de Mesa: Esc (devolve o foco ao botão) e `mousedown`
 * fora. Quem controla `open` mantém um menu aberto por vez. */
function ToolbarMenu({
  label,
  icon,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEscapeLayer(() => {
    onOpenChange(false);
    triggerRef.current?.focus();
  }, open);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-2 rounded-control border border-gray-200 bg-white px-3 text-[14px] max-sm:h-11 sm:h-[var(--control-height-toolbar)] font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-90 focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-600"
      >
        {icon}
        {label}
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-control border border-gray-200 bg-white p-2 shadow-popover"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function TicketKanban({
  tickets,
  isLoading,
  isError,
  initialServiceDeskId,
}: TicketKanbanProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isClient = user?.role === 'CLIENT';

  // Dedicated Mesa selector (TiFlux parity): lives entirely inside the
  // Kanban, independent of the "Departamento" filter used by Lista/Grade.
  // Seeded once from `initialServiceDeskId`; further changes come only from
  // the dropdown below, not from the parent re-rendering with a new prop.
  const [selectedDeskId, setSelectedDeskId] = useState<string>(
    initialServiceDeskId ?? '',
  );
  const stageMode = Boolean(selectedDeskId);

  // D6c "Configurações": Agrupar por (Estágio padrão, Status, Responsável,
  // Prioridade), persisted per user. "Estágio" only applies while a Mesa is
  // selected — falls back to "Status" otherwise (same as the pre-D6c
  // behavior), so switching Mesa off never leaves the board stuck on an
  // ungroupable dimension.
  const {
    config: kanbanConfig,
    isLoading: isConfigLoading,
    setGroupBy,
    setColumnVisibility,
    setColumnCollapsed,
  } = useUserScreenConfig('tickets-kanban', {
    groupBy: 'stage',
    grid: { columnVisibility: DEFAULT_KANBAN_FIELD_VISIBILITY, density: 'compact' },
  });
  const groupBy = kanbanConfig.groupBy || 'stage';
  const effectiveGroupBy = groupBy === 'stage' && !stageMode ? 'status' : groupBy;
  const visibleCardFields: TicketKanbanCardVisibleFields = kanbanConfig.grid.columnVisibility;

  // D6a: fila de avatares dos agentes presentes no board inteiro (não só os
  // visíveis após outros filtros), clique alterna filtro por agente (multi).
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const presentAgents = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    tickets.forEach((t) => {
      if (t.agent) byId.set(t.agent.id, t.agent);
    });
    return Array.from(byId.values());
  }, [tickets]);
  const toggleAgentFilter = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };
  const visibleTickets = useMemo(
    () =>
      selectedAgentIds.size === 0
        ? tickets
        : tickets.filter((t) => t.agentId && selectedAgentIds.has(t.agentId)),
    [tickets, selectedAgentIds],
  );

  // D6b "Ordenar": reorders cards within each column; purely client-side,
  // not persisted (session-local).
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [openMenu, setOpenMenu] = useState<'sort' | 'config' | null>(null);
  const setSortMenuOpen = (open: boolean) => setOpenMenu(open ? 'sort' : null);
  const setConfigMenuOpen = (open: boolean) => setOpenMenu(open ? 'config' : null);
  const handleSortFieldClick = (field: string) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const { data: serviceDesks = [] } = useQuery({
    queryKey: ['service-desks'],
    queryFn: async () => {
      const { data } = await api.get<ServiceDesk[]>('/service-desks');
      return data;
    },
  });

  const [dropError, setDropError] = useState<string | null>(null);
  // Set of column ids the currently-dragged card may be dropped on
  // (including its own origin column, so same-column reordering/no-op stays
  // enabled). `null` while nothing is being dragged.
  const [draggingAllowedColumnIds, setDraggingAllowedColumnIds] =
    useState<Set<string> | null>(null);
  // O encaixe `proximity` devolve cada passo da rolagem automática do arrastar ao ponto de
  // encaixe e o quadro não anda até a borda (medido em Chromium, DMTE-527 AC-09): sem encaixe enquanto arrasta.
  const [isDragging, setIsDragging] = useState(false);
  const draggableBoardClass = cn(KANBAN_BOARD_CLASS, isDragging && 'snap-none');

  // TiFlux parity: columns (status or stage) can be individually collapsed
  // to a thin strip, independent of which mesa/mode is active. Keyed by
  // column id, so the map is naturally shared across both render modes.
  // DMTE-527: guarda só a escolha do usuário (no servidor, mapa `collapsed`); coluna sem
  // entrada usa o padrão (Resolvido, Fechado e estágios finais recolhidos) e id de coluna que
  // não existe mais nunca entra na conta, porque só as colunas desenhadas são consultadas.
  const isColumnCollapsed = (columnId: string, byDefault: boolean) =>
    kanbanConfig.collapsed[columnId] ?? byDefault;
  const toggleColumnCollapsed = (columnId: string, collapsed: boolean) =>
    setColumnCollapsed(columnId, !collapsed);

  const {
    data: stages = [],
    isLoading: isStagesLoading,
    isError: isStagesError,
  } = useQuery({
    queryKey: ['service-desk-stages', selectedDeskId],
    queryFn: async () => {
      const { data } = await api.get<DeskStage[]>(
        `/service-desks/${selectedDeskId}/stages`,
      );
      return data;
    },
    enabled: stageMode,
  });

  const { mutate: mutateStatus } = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: TicketStatus;
    }) => {
      const { data } = await api.patch<Ticket>(`/tickets/${id}/status`, {
        status,
      });
      return data;
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      const previousQueries = queryClient.getQueriesData<TicketsPage>({
        queryKey: ['tickets'],
      });
      queryClient.setQueriesData<TicketsPage>(
        { queryKey: ['tickets'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((t) => (t.id === id ? { ...t, status } : t)),
          };
        },
      );
      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      context?.previousQueries?.forEach(([key, value]) => {
        queryClient.setQueryData(key, value);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const { mutate: mutateStage } = useMutation({
    mutationFn: async ({ id, stageId }: { id: string; stageId: string }) => {
      const { data } = await api.patch<Ticket>(`/tickets/${id}/stage`, {
        stageId,
      });
      return data;
    },
    onMutate: async ({ id, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      const previousQueries = queryClient.getQueriesData<TicketsPage>({
        queryKey: ['tickets'],
      });
      queryClient.setQueriesData<TicketsPage>(
        { queryKey: ['tickets'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((t) => (t.id === id ? { ...t, stageId } : t)),
          };
        },
      );
      return { previousQueries };
    },
    onError: (err, _vars, context) => {
      context?.previousQueries?.forEach(([key, value]) => {
        queryClient.setQueryData(key, value);
      });
      setDropError(extractErrorMessage(err));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const onDragStart = (start: DragStart) => {
    setIsDragging(true);
    if (!stageMode) return;
    const ticket = tickets.find((t) => t.id === start.draggableId);
    if (!ticket) return;
    const allowed = getAllowedStageIds(ticket, stages);
    allowed.add(start.source.droppableId);
    setDraggingAllowedColumnIds(allowed);
  };

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    setIsDragging(false);
    setDraggingAllowedColumnIds(null);

    if (!destination) return;
    if (destination.droppableId === source.droppableId) return; // Same column: no-op

    if (!stageMode) {
      mutateStatus({
        id: draggableId,
        status: destination.droppableId as TicketStatus,
      });
      return;
    }

    if (destination.droppableId === NO_STAGE_COLUMN_ID) return; // No backend operation to unset a stage

    const ticket = tickets.find((t) => t.id === draggableId);
    if (!ticket) return;

    const allowed = getAllowedStageIds(ticket, stages);
    if (!allowed.has(destination.droppableId)) {
      setDropError('Transição de estágio não permitida para este chamado.');
      return;
    }
    setDropError(null);
    mutateStage({ id: draggableId, stageId: destination.droppableId });
  };

  // TiFlux parity: a dedicated "Mesa" dropdown above the columns, always
  // visible regardless of loading/error/fallback state, so switching mesas
  // never requires leaving the Kanban.

  // Seletor em contorno (DMTE-527 AC-04): fundo branco, borda brand-500, texto e seta
  // brand-700, hover claro e o anel de foco do próprio EzSelect. O EzSelect não expõe
  // className do controle interno, então as variantes descendentes pintam a caixa (o div
  // que contém o combobox), o texto e a seta só neste seletor; a altura segue a barra.
  const mesaSelector = (
    <div
      className={cn(
        'w-full sm:w-auto sm:max-w-xs',
        '[&_div:has(>[role=combobox])]:max-sm:h-11 [&_div:has(>[role=combobox])]:sm:h-[var(--control-height-toolbar)]',
        '[&_div:has(>[role=combobox])]:border-brand-500 [&_div:has(>[role=combobox])]:hover:border-brand-700 [&_div:has(>[role=combobox])]:hover:bg-brand-50',
        '[&_[role=combobox]]:text-brand-700 [&_[role=combobox]_svg]:text-brand-700',
      )}
    >
      <label htmlFor="kanban-mesa-select" className="sr-only">
        Mesa
      </label>
      <EzSelect
        id="kanban-mesa-select"
        aria-label="Mesa"
        data-testid="kanban-mesa-select"
        value={selectedDeskId}
        onChange={(e) => setSelectedDeskId(e.target.value)}
      >
        <option value="">Mesa: Todas</option>
        {serviceDesks.map((desk) => (
          <option key={desk.id} value={desk.id}>
            Mesa: {desk.name}
          </option>
        ))}
      </EzSelect>
    </div>
  );

  // D6a: fila de avatares (clique alterna filtro por agente, multi).
  const agentAvatarRow = presentAgents.length > 0 && (
    <div className="flex flex-wrap items-center -space-x-1.5" role="group" aria-label="Filtrar por responsável">
      {presentAgents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          aria-label={`Filtrar por ${agent.name}`}
          aria-pressed={selectedAgentIds.has(agent.id)}
          onClick={() => toggleAgentFilter(agent.id)}
          className={cn(
            'rounded-full ring-2 ring-white transition-transform hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-brand-600',
            selectedAgentIds.has(agent.id) && 'ring-brand-500',
          )}
        >
          <EzAvatar name={agent.name} size={28} />
        </button>
      ))}
    </div>
  );

  // D6b "Ordenar": popover with one button per sortable field + Limpar.
  const sortMenu = (
    <ToolbarMenu
      label="Ordenar"
      icon={<ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />}
      open={openMenu === 'sort'}
      onOpenChange={setSortMenuOpen}
    >
      <p className="px-1 pb-1 text-[12px] font-semibold text-gray-500">
        Ordenar os cards por
      </p>
      {SORT_FIELDS.map((field) => (
        <button
          key={field.id}
          type="button"
          onClick={() => handleSortFieldClick(field.id)}
          className="flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-80"
        >
          {field.label}
          {sortField === field.id && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setSortField(null)}
        className="mt-1 w-full rounded-[6px] px-2 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-80 hover:text-brand-700"
      >
        Limpar ordenação
      </button>
    </ToolbarMenu>
  );

  // D6c "Configurações": Agrupar por + Exibir campos (quais campos opcionais
  // o card mostra — Título/Número são fixos, ver KANBAN_FIELDS acima).
  const configMenu = (
    <ToolbarMenu
      label="Configurações"
      icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
      open={openMenu === 'config'}
      onOpenChange={setConfigMenuOpen}
    >
      <label htmlFor="kanban-group-by" className="px-1 text-[12px] font-semibold text-gray-500">
        Agrupar por
      </label>
      <EzSelect
        id="kanban-group-by"
        aria-label="Agrupar por"
        variant="compact"
        className="mt-1"
        value={groupBy}
        onChange={(e) => setGroupBy(e.target.value)}
      >
        <option value="stage">Estágio</option>
        <option value="status">Status</option>
        <option value="agent">Responsável</option>
        <option value="priority">Prioridade</option>
      </EzSelect>

      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="px-1 text-[12px] font-semibold text-gray-500">Exibir campos</p>
        {KANBAN_FIELDS.map((field) => (
          <label key={field.id} className="flex items-center gap-2 px-1 py-1 text-[13px]">
            <input
              type="checkbox"
              checked={kanbanConfig.grid.columnVisibility[field.id] !== false}
              onChange={(e) =>
                setColumnVisibility((prev) => ({ ...prev, [field.id]: e.target.checked }))
              }
            />
            {field.label}
          </label>
        ))}
      </div>
    </ToolbarMenu>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      {mesaSelector}
      {agentAvatarRow}
      <div className="flex items-center gap-3">
        {sortMenu}
        {configMenu}
      </div>
    </div>
  );

  // O recolhimento e o "Agrupar por" mudariam o quadro já desenhado: espera a leitura da preferência.
  if (isLoading || (isConfigLoading && !isError)) {
    return (
      <div className="space-y-3">
        {mesaSelector}
        <div data-testid="kanban-board" className={KANBAN_BOARD_CLASS}>
          {statusColumns.map((col) => (
            <div
              key={col}
              className={`${KANBAN_COLUMN_CLASS} space-y-4 rounded-lg border border-gray-100 bg-gray-80 p-4`}
            >
              <h3 className="text-sm font-semibold text-gray-600">
                {statusLabels[col]}
              </h3>
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white">
                <EzSpinner
                  label={col === 'OPEN' ? 'Carregando...' : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-3">
        {mesaSelector}
        <EzAlert variant="error">Falha ao carregar os chamados.</EzAlert>
      </div>
    );
  }

  if (stageMode && isStagesLoading) {
    return (
      <div className="space-y-3">
        {mesaSelector}
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white">
          <EzSpinner label="Carregando estágios da mesa…" />
        </div>
      </div>
    );
  }

  if (stageMode && isStagesError) {
    return (
      <div className="space-y-3">
        {mesaSelector}
        <EzAlert variant="error">
          Falha ao carregar os estágios desta mesa.
        </EzAlert>
      </div>
    );
  }

  if (effectiveGroupBy === 'stage') {
    const orderedStages = [...stages].sort((a, b) => a.position - b.position);
    const hasInitialStage = stages.some((stage) => stage.isInitial);
    const stageColumns = orderedStages.map((stage) => ({
      id: stage.id,
      label: stage.name,
      collapsedByDefault: stage.isFinal,
      tickets: applySort(visibleTickets.filter((t) => t.stageId === stage.id), sortField, sortDir),
    }));
    stageColumns.push({
      id: NO_STAGE_COLUMN_ID,
      label: 'Sem estágio',
      collapsedByDefault: false,
      tickets: applySort(
        visibleTickets.filter(
          (t) => stageColumnIdFor(t, stages) === NO_STAGE_COLUMN_ID,
        ),
        sortField,
        sortDir,
      ),
    });
    const collapsedIds = stageColumns
      .filter((col) => isColumnCollapsed(col.id, col.collapsedByDefault))
      .map((col) => col.id);

    return (
      <div className="space-y-3">
        {toolbar}
        {dropError && (
          <EzAlert variant="error" onClose={() => setDropError(null)}>
            {dropError}
          </EzAlert>
        )}
        {stages.length === 0 && (
          <EzAlert variant="info">
            Esta mesa ainda não possui estágios configurados.
          </EzAlert>
        )}
        <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div data-testid="kanban-board" className={draggableBoardClass} style={boardStyle(collapsedIds)}>
            {stageColumns.map((col) => {
              const isCollapsed = collapsedIds.includes(col.id);
              const isUnreachableWhileDragging =
                draggingAllowedColumnIds !== null &&
                !draggingAllowedColumnIds.has(col.id);
              const dropDisabled =
                isClient ||
                col.id === NO_STAGE_COLUMN_ID ||
                isUnreachableWhileDragging ||
                isCollapsed;

              return (
                <Droppable
                  key={col.id}
                  droppableId={col.id}
                  isDropDisabled={dropDisabled}
                >
                  {(provided, snapshot) =>
                    isCollapsed ? (
                      <CollapsedColumn
                        label={col.label}
                        count={col.tickets.length}
                        right={stripRight(collapsedIds, col.id)}
                        onExpand={() => toggleColumnCollapsed(col.id, true)}
                        droppableRef={provided.innerRef}
                        droppableProps={provided.droppableProps}
                        placeholder={provided.placeholder}
                      />
                    ) : (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        data-testid="kanban-column"
                        className={cn(
                          KANBAN_COLUMN_CLASS,
                          'flex-col gap-3 rounded-lg border p-4 min-h-[500px] transition-colors',
                          snapshot.isDraggingOver && !dropDisabled
                            ? 'border-brand-500 bg-brand-100/30 ring-1 ring-brand-200'
                            : 'border-gray-200 bg-gray-80',
                          isUnreachableWhileDragging && 'opacity-50',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => toggleColumnCollapsed(col.id, false)}
                            className={collapseButtonClass}
                            title="Recolher coluna"
                            aria-label={`Recolher coluna ${col.label}`}
                            data-testid={`collapse-column-${col.id}`}
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <h3 className="flex-1 text-sm font-semibold text-gray-900">
                            {col.label}
                          </h3>
                          <EzTag
                            label={String(col.tickets.length)}
                            variant="gray"
                            className="!px-2 !py-0.5"
                          />
                        </div>

                        <div className="flex flex-1 flex-col gap-3">
                          {col.tickets.map((ticket, index) => {
                            // Unstaged tickets ("Sem estágio") ARE draggable when the mesa has an
                            // initial stage: the backend allows moving a stageless ticket there
                            // (TicketsService.changeStage), so getAllowedStageIds mirrors that.
                            const isDraggable =
                              col.id !== NO_STAGE_COLUMN_ID || hasInitialStage;
                            return (
                              <Draggable
                                key={ticket.id}
                                draggableId={ticket.id}
                                index={index}
                                isDragDisabled={isClient || !isDraggable}
                              >
                                {(dragProvided, dragSnapshot) => (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    {...dragProvided.dragHandleProps}
                                    className={`${dragSnapshot.isDragging ? 'opacity-70 rotate-2 scale-105' : ''} transition-transform`}
                                    style={dragProvided.draggableProps.style}
                                  >
                                    <TicketKanbanCard ticket={ticket} visibleFields={visibleCardFields} />
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                        {!isClient && <NewTicketButton />}
                      </div>
                    )
                  }
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      </div>
    );
  }

  if (effectiveGroupBy === 'status') {
  // Groups by the generic `status` enum (visão "todas as mesas", ou Status
  // escolhido explicitamente em Configurações mesmo com uma Mesa ativa).
  const grouped = statusColumns.reduce(
    (acc, col) => {
      acc[col] = applySort(visibleTickets.filter((t) => t.status === col), sortField, sortDir);
      return acc;
    },
    {} as Record<TicketStatus, Ticket[]>,
  );

  const collapsedIds = statusColumns.filter((col) =>
    isColumnCollapsed(col, FINAL_STATUSES.includes(col)),
  );

  return (
    <div className="space-y-3">
      {toolbar}
      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div data-testid="kanban-board" className={draggableBoardClass} style={boardStyle(collapsedIds)}>
          {statusColumns.map((col) => {
            const isCollapsed = collapsedIds.includes(col);
            return (
              <Droppable
                key={col}
                droppableId={col}
                isDropDisabled={isClient || isCollapsed} // Clientes não podem mudar status arrastando (geralmente nem vêem o Kanban, mas só pra garantir)
              >
                {(provided, snapshot) =>
                  isCollapsed ? (
                    <CollapsedColumn
                      label={statusLabels[col]}
                      count={grouped[col].length}
                      right={stripRight(collapsedIds, col)}
                      onExpand={() => toggleColumnCollapsed(col, true)}
                      droppableRef={provided.innerRef}
                      droppableProps={provided.droppableProps}
                      placeholder={provided.placeholder}
                    />
                  ) : (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      data-testid="kanban-column"
                      className={`${KANBAN_COLUMN_CLASS} flex-col gap-3 rounded-lg border p-4 min-h-[500px] transition-colors ${
                        snapshot.isDraggingOver
                          ? 'border-brand-500 bg-brand-100/30 ring-1 ring-brand-200'
                          : 'border-gray-200 bg-gray-80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => toggleColumnCollapsed(col, false)}
                          className={collapseButtonClass}
                          title="Recolher coluna"
                          aria-label={`Recolher coluna ${statusLabels[col]}`}
                          data-testid={`collapse-column-${col}`}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <h3 className="flex-1 text-sm font-semibold text-gray-900">
                          {statusLabels[col]}
                        </h3>
                        <EzTag
                          label={String(grouped[col].length)}
                          variant="gray"
                          className="!px-2 !py-0.5"
                        />
                      </div>

                      <div className="flex flex-1 flex-col gap-3">
                        {grouped[col].map((ticket, index) => (
                          <Draggable
                            key={ticket.id}
                            draggableId={ticket.id}
                            index={index}
                            // Disable drag for clients or closed tickets if needed
                            isDragDisabled={
                              isClient || ticket.status === 'CLOSED'
                            }
                          >
                            {(provided, dragSnapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`${dragSnapshot.isDragging ? 'opacity-70 rotate-2 scale-105' : ''} transition-transform`}
                                style={provided.draggableProps.style}
                              >
                                <TicketKanbanCard ticket={ticket} visibleFields={visibleCardFields} groupBy="status" />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                      {!isClient && <NewTicketButton />}
                    </div>
                  )
                }
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
  }

  // D6c: Agrupar por Responsável ou Prioridade — visão somente leitura
  // (nenhuma dessas dimensões tem uma operação de arrastar-para-mudar no
  // backend atual, diferente de Estágio/Status).
  const dynamicColumns =
    effectiveGroupBy === 'agent'
      ? (() => {
          const byAgent = new Map<string, { label: string; tickets: Ticket[] }>();
          visibleTickets.forEach((t) => {
            const key = t.agent?.id ?? '__unassigned__';
            const label = t.agent?.name ?? 'Não atribuído';
            const bucket = byAgent.get(key) ?? { label, tickets: [] };
            bucket.tickets.push(t);
            byAgent.set(key, bucket);
          });
          return Array.from(byAgent.entries()).map(([id, { label, tickets: colTickets }]) => ({
            id,
            label,
            tickets: applySort(colTickets, sortField, sortDir),
          }));
        })()
      : (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => ({
          id: priority,
          label: priorityLabels[priority],
          tickets: applySort(
            visibleTickets.filter((t) => t.priority === priority),
            sortField,
            sortDir,
          ),
        }));

  return (
    <div className="space-y-3">
      {toolbar}
      <div data-testid="kanban-board" className={KANBAN_BOARD_CLASS}>
        {dynamicColumns.map((col) => (
          <div
            key={col.id}
            data-testid="kanban-column"
            className={`${KANBAN_COLUMN_CLASS} flex-col gap-3 rounded-lg border border-gray-200 bg-gray-80 p-4 min-h-[500px]`}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex-1 text-sm font-semibold text-gray-900">{col.label}</h3>
              <EzTag label={String(col.tickets.length)} variant="gray" className="!px-2 !py-0.5" />
            </div>
            <div className="flex flex-1 flex-col gap-3">
              {col.tickets.map((ticket) => (
                <TicketKanbanCard key={ticket.id} ticket={ticket} visibleFields={visibleCardFields} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
