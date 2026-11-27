import { useState, useMemo, useEffect, useRef } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Appointment, AppointmentType, useAppointments } from '../hooks/useAppointments';
import { AppointmentModal } from '../components/schedule/AppointmentModal';
import { CompromissoDetailModal } from '../components/schedule/CompromissoDetailModal';
import {
  EzActionsButton,
  EzAlert,
  EzButton,
  EzCheck,
  EzEmptyCard,
  EzPageLayout,
  EzSelect,
  EzSpinner,
} from '../components/ds';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  User as UserIcon,
  Building,
} from 'lucide-react';

function formatDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TYPE_LABELS: Record<AppointmentType, string> = {
  AGENDA: 'Agenda',
  VACATION: 'Férias',
  ABSENCE: 'Ausência',
};

const GRID_START_HOUR = 0;
const TODAY_SCROLL_MARGIN_HOURS = 2;
const HOURS = Array.from({ length: 24 }, (_, i) => i + GRID_START_HOUR); // 00 to 23

// Pontos de atendente na barra lateral: tokens do DS (o nome vem sempre ao lado, a cor não é o único canal).
const ATTENDANT_COLORS = [
  'var(--color-brand-600)',
  'var(--color-petroleum-500)',
  'var(--color-green-700)',
  'var(--color-yellow-800)',
  'var(--color-red-600)',
  'var(--color-petroleum-300)',
  'var(--color-brand-800)',
  'var(--color-gray-400)',
];

// Cor por tipo (token do DS). Texto branco sobre estes fundos tem contraste >= 4,5:1:
// petroleum-500 ~8,6:1, green-700 ~8,0:1, yellow-800 ~5,0:1.
const TYPE_BG: Record<AppointmentType, string> = {
  AGENDA: 'bg-petroleum-500',
  VACATION: 'bg-green-700',
  ABSENCE: 'bg-yellow-800',
};

interface PositionedAppointment {
  appointment: Appointment;
  top: number;
  height: number;
  colIndex: number;
  totalCols: number;
}

export function SchedulePage() {
  const user = useAuthStore((state) => state.user);

  // Selected date anchor (defaults to current date)
  const [currentDate, setCurrentDate] = useState(() => new Date());
  // Abaixo de lg a grade semanal não cabe: abre em Dia e os filtros viram painel recolhível.
  const isNarrow = useMediaQuery('(max-width: 1023px)');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'mes' | 'semana' | 'dia' | 'lista'>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches
      ? 'dia'
      : 'semana',
  );

  // Filter types toggles (TiFlux "Filtrar" panel)
  const [showAgenda, setShowAgenda] = useState(true);
  const [showFerias, setShowFerias] = useState(true);
  const [showAusencias, setShowAusencias] = useState(true);

  // Filtro de atendente do ADMIN (vai para a API; a autorização segue no backend)
  const [filterUserId, setFilterUserId] = useState<string>('');

  // Atendentes checkboxes (selected attendant IDs)
  const [selectedAttendantIds, setSelectedAttendantIds] = useState<Set<string>>(new Set());
  const [selectAllAttendants, setSelectAllAttendants] = useState(true);

  const gridBodyRef = useRef<HTMLDivElement>(null);

  // Roving tabindex das células de hora (Semana/Dia): só uma célula entra na ordem de Tab
  // (evita 168 paradas na Semana); as setas movem o foco dentro do grid.
  const [activeSlot, setActiveSlot] = useState<{ dateStr: string; hour: number } | null>(null);
  const slotRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState<string | null>(null);
  const [modalInitialType, setModalInitialType] = useState<AppointmentType>('AGENDA');

  // Compute week start (Sunday = DOM) and end (Saturday = SÁB) of currentDate's week
  const { weekDays, weekStartISO, weekEndISO } = useMemo(() => {
    const d = new Date(currentDate);
    const dayOfWeek = d.getDay(); // 0 is Sunday, 1 is Monday...
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - dayOfWeek);
    sunday.setHours(0, 0, 0, 0);

    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    saturday.setHours(23, 59, 59, 999);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(sunday);
      dayDate.setDate(sunday.getDate() + i);
      days.push(dayDate);
    }

    return { weekDays: days, weekStartISO: sunday.toISOString(), weekEndISO: saturday.toISOString() };
  }, [currentDate]);

  // Month grid: 6 weeks (42 days) padded so the calendar always starts on
  // a Sunday and ends on a Saturday, covering the full visible range.
  const { monthWeeks, monthGridStartISO, monthGridEndISO, monthLabel } = useMemo(() => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const firstWeekday = d.getDay();
    const gridStart = new Date(d);
    gridStart.setDate(d.getDate() - firstWeekday);
    gridStart.setHours(0, 0, 0, 0);

    const allDays: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const dayDate = new Date(gridStart);
      dayDate.setDate(gridStart.getDate() + i);
      allDays.push(dayDate);
    }

    const weeks: Date[][] = [];
    for (let i = 0; i < allDays.length; i += 7) {
      weeks.push(allDays.slice(i, i + 7));
    }

    const gridEnd = new Date(allDays[allDays.length - 1]);
    gridEnd.setHours(23, 59, 59, 999);

    return {
      monthWeeks: weeks,
      monthGridStartISO: gridStart.toISOString(),
      monthGridEndISO: gridEnd.toISOString(),
      monthLabel: currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    };
  }, [currentDate]);

  // Days actually rendered by the time-grid (Semana shows the week, Dia shows just one column)
  const visibleDays = useMemo(() => {
    if (viewMode === 'dia') {
      const d = new Date(currentDate);
      d.setHours(0, 0, 0, 0);
      return [d];
    }
    return weekDays;
  }, [viewMode, currentDate, weekDays]);

  const visibleRange = useMemo(() => {
    if (viewMode === 'dia') {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(currentDate);
      end.setHours(23, 59, 59, 999);
      return { startISO: start.toISOString(), endISO: end.toISOString() };
    }
    if (viewMode === 'mes') {
      return { startISO: monthGridStartISO, endISO: monthGridEndISO };
    }
    // 'semana' and 'lista' both work off the current week's range
    return { startISO: weekStartISO, endISO: weekEndISO };
  }, [viewMode, currentDate, weekStartISO, weekEndISO, monthGridStartISO, monthGridEndISO]);

  const headerPeriodTitle = useMemo(() => {
    if (viewMode === 'dia') {
      const label = currentDate.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    if (viewMode === 'mes') {
      return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    }
    const sunday = weekDays[0];
    const saturday = weekDays[6];
    const monthName = saturday.toLocaleDateString('pt-BR', { month: 'long' });
    return `${sunday.getDate()} – ${saturday.getDate()} de ${monthName} de ${saturday.getFullYear()}`;
  }, [viewMode, currentDate, weekDays, monthLabel]);

  // Query appointments for the currently visible range (day/week/month)
  const queryFilters = useMemo(() => {
    return {
      startTime: visibleRange.startISO,
      endTime: visibleRange.endISO,
      userId: filterUserId || undefined,
    };
  }, [visibleRange, filterUserId]);

  const {
    appointments,
    isLoading,
    isError,
    refetch,
    createMutation,
    updateMutation,
    removeMutation,
  } = useAppointments(queryFilters);

  // A grade só existe depois da carga e em Semana/Dia: ao (re)aparecer, rola para o horário comercial em vez da meia-noite.
  useEffect(() => {
    if (gridBodyRef.current) {
      gridBodyRef.current.scrollTop = Math.max((6 - GRID_START_HOUR) * 56, 0);
    }
  }, [isLoading, isError, viewMode]);

  // Extract unique attendants from appointments & logged user
  const attendantsList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; email: string }>();
    if (user?.sub) {
      map.set(user.sub, {
        id: user.sub,
        name: user.email?.split('@')[0] || 'Usuário Atual',
        email: user.email || '',
      });
    }
    for (const app of appointments) {
      if (app.user?.id) {
        map.set(app.user.id, {
          id: app.user.id,
          name: app.user.name,
          email: app.user.email,
        });
      }
    }
    return Array.from(map.values());
  }, [appointments, user]);

  // Lista de atendentes para o filtro do ADMIN: GET /users/agents (autorização no backend).
  const { data: agentOptions } = useQuery({
    queryKey: ['agents', 'schedule-filter'],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>('/users/agents')).data,
    enabled: user?.role === 'ADMIN',
  });
  const agentSelectOptions = Array.isArray(agentOptions) ? agentOptions : [];

  // Color map for attendants
  const attendantColorMap = useMemo(() => {
    const map = new Map<string, string>();
    attendantsList.forEach((att, idx) => {
      map.set(att.id, ATTENDANT_COLORS[idx % ATTENDANT_COLORS.length]);
    });
    return map;
  }, [attendantsList]);

  // Filter appointments by panel selections
  const filteredAppointments = useMemo(() => {
    return appointments.filter((app) => {
      // Type filter
      if (app.type === 'AGENDA' && !showAgenda) return false;
      if (app.type === 'VACATION' && !showFerias) return false;
      if (app.type === 'ABSENCE' && !showAusencias) return false;

      // Attendant filter
      if (!selectAllAttendants && app.userId && !selectedAttendantIds.has(app.userId)) {
        return false;
      }
      return true;
    });
  }, [appointments, showAgenda, showFerias, showAusencias, selectAllAttendants, selectedAttendantIds]);

  // Layout algorithm: Calculate vertical position and horizontal overlap per day
  const appointmentsByDay = useMemo(() => {
    const map: Record<string, PositionedAppointment[]> = {};

    visibleDays.forEach((day) => {
      const dateStr = formatDateKey(day);
      map[dateStr] = [];
    });

    const dayGrouped: Record<string, Appointment[]> = {};
    filteredAppointments.forEach((app) => {
      const dayKey = formatDateKey(new Date(app.startTime));
      if (!dayGrouped[dayKey]) dayGrouped[dayKey] = [];
      dayGrouped[dayKey].push(app);
    });

    Object.keys(dayGrouped).forEach((dayKey) => {
      const apps = dayGrouped[dayKey].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      // Compute overlapping clusters
      const clusters: Appointment[][] = [];
      apps.forEach((app) => {
        const appStart = new Date(app.startTime).getTime();
        let placed = false;
        for (const cluster of clusters) {
          const clusterEnd = Math.max(...cluster.map((c) => new Date(c.endTime).getTime()));
          if (appStart < clusterEnd) {
            cluster.push(app);
            placed = true;
            break;
          }
        }
        if (!placed) {
          clusters.push([app]);
        }
      });

      const positioned: PositionedAppointment[] = [];
      clusters.forEach((cluster) => {
        const totalCols = cluster.length;
        cluster.forEach((app, colIndex) => {
          const s = new Date(app.startTime);
          const e = new Date(app.endTime);

          const startHour = s.getHours() + s.getMinutes() / 60;
          const endHour = e.getHours() + e.getMinutes() / 60;

          const top = Math.max((startHour - GRID_START_HOUR) * 56, 0);
          const duration = Math.max(endHour - startHour, 0.5);
          const height = Math.max(duration * 56 - 4, 32);

          positioned.push({
            appointment: app,
            top,
            height,
            colIndex,
            totalCols,
          });
        });
      });

      map[dayKey] = positioned;
    });

    return map;
  }, [filteredAppointments, visibleDays]);

  // Navigation handlers: step size follows the active view (day/week/month)
  const handlePrevWeek = () => {
    const next = new Date(currentDate);
    if (viewMode === 'dia') next.setDate(currentDate.getDate() - 1);
    else if (viewMode === 'mes') next.setMonth(currentDate.getMonth() - 1);
    else next.setDate(currentDate.getDate() - 7);
    setCurrentDate(next);
  };

  const handleNextWeek = () => {
    const next = new Date(currentDate);
    if (viewMode === 'dia') next.setDate(currentDate.getDate() + 1);
    else if (viewMode === 'mes') next.setMonth(currentDate.getMonth() + 1);
    else next.setDate(currentDate.getDate() + 7);
    setCurrentDate(next);
  };

  const navLabels =
    viewMode === 'dia'
      ? { prev: 'Dia anterior', next: 'Próximo dia' }
      : viewMode === 'mes'
        ? { prev: 'Mês anterior', next: 'Próximo mês' }
        : { prev: 'Semana anterior', next: 'Próxima semana' };

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    // Rola até a hora atual com uma folga de TODAY_SCROLL_MARGIN_HOURS para ver o que vem antes.
    if (gridBodyRef.current) {
      const hour = today.getHours() + today.getMinutes() / 60;
      gridBodyRef.current.scrollTop = Math.max((hour - TODAY_SCROLL_MARGIN_HOURS - GRID_START_HOUR) * 56, 0);
    }
  };

  // Célula de hora que concentra o Tab: a última focada, se ainda visível; senão 08:00 do 1º dia.
  const visibleDateKeys = visibleDays.map(formatDateKey);
  const tabStopSlot =
    activeSlot && visibleDateKeys.includes(activeSlot.dateStr)
      ? activeSlot
      : { dateStr: visibleDateKeys[0], hour: 8 };

  const handleSlotKeyDown = (e: React.KeyboardEvent, dateStr: string, hour: number) => {
    const dayIdx = visibleDateKeys.indexOf(dateStr);
    let nextDay = dayIdx;
    let nextHour = hour;
    switch (e.key) {
      case 'ArrowUp': nextHour = hour - 1; break;
      case 'ArrowDown': nextHour = hour + 1; break;
      case 'ArrowLeft': nextDay = dayIdx - 1; break;
      case 'ArrowRight': nextDay = dayIdx + 1; break;
      case 'Home': nextHour = HOURS[0]; break;
      case 'End': nextHour = HOURS[HOURS.length - 1]; break;
      default: return;
    }
    e.preventDefault();
    const target = slotRefs.current.get(`${visibleDateKeys[nextDay]}|${nextHour}`);
    if (target) target.focus();
  };

  // Open creation modal
  const handleOpenCreate =(dateStr?: string, hour?: number, type: AppointmentType = 'AGENDA') => {
    setSelectedAppointment(null);
    setModalInitialDate(dateStr || null);
    setModalInitialType(type);
    setIsCreateModalOpen(true);
  };

  // Open detail modal (TiFlux card popover)
  const handleOpenDetail = (app: Appointment) => {
    setSelectedAppointment(app);
    setIsDetailModalOpen(true);
  };

  // Switch from detail modal to edit modal
  const handleEditFromDetail = (app: Appointment) => {
    setSelectedAppointment(app);
    setIsDetailModalOpen(false);
    setIsCreateModalOpen(true);
  };

  const canCreate = user?.role !== 'CLIENT';
  const isAdmin = user?.role === 'ADMIN';

  // Current time line calculation
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const currentTimeTop = (currentHour - GRID_START_HOUR) * 56;
  const todayDateStr = formatDateKey(now);

  const allTypesChecked = showAgenda && showFerias && showAusencias;
  const someTypesChecked = showAgenda || showFerias || showAusencias;

  const toggleAllAttendants = () => {
    if (selectAllAttendants) {
      setSelectedAttendantIds(new Set());
      setSelectAllAttendants(false);
    } else {
      setSelectedAttendantIds(new Set(attendantsList.map((a) => a.id)));
      setSelectAllAttendants(true);
    }
  };

  const toggleAttendant = (id: string) => {
    if (selectAllAttendants) {
      const updated = new Set(attendantsList.map((a) => a.id));
      updated.delete(id);
      setSelectedAttendantIds(updated);
      setSelectAllAttendants(false);
    } else {
      const updated = new Set(selectedAttendantIds);
      if (updated.has(id)) {
        updated.delete(id);
      } else {
        updated.add(id);
      }
      setSelectedAttendantIds(updated);
      setSelectAllAttendants(updated.size === attendantsList.length && attendantsList.length > 0);
    }
  };

  return (
    <EzPageLayout
      header={
        <div className="flex flex-col gap-3 w-full">
          {/* Top Bar: Title & Ações Button */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Agenda</h1>
            </div>

            <div className="flex items-center gap-2">
              {canCreate && (
                <EzButton
                  variant="primary"
                  size="small"
                  leftIcon={Plus}
                  onClick={() => handleOpenCreate()}
                  label="Novo Agendamento"
                />
              )}

              {canCreate && (
                <EzActionsButton
                  label="Ações"
                  className="h-8 px-3 text-xs rounded-lg"
                  actions={[
                    {
                      label: 'Novas Férias',
                      icon: <Clock className="w-3.5 h-3.5" aria-hidden="true" />,
                      onClick: () => handleOpenCreate(undefined, undefined, 'VACATION'),
                    },
                    {
                      label: 'Nova Ausência',
                      icon: <UserIcon className="w-3.5 h-3.5" aria-hidden="true" />,
                      onClick: () => handleOpenCreate(undefined, undefined, 'ABSENCE'),
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </div>
      }
    >
      <div className="flex flex-col lg:flex-row gap-4 items-start w-full py-2">
        {isNarrow && (
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="schedule-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className="px-3 h-11 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 ez-focus"
          >
            Filtros
          </button>
        )}
        {/* ============================================================== */}
        {/* LEFT SIDEBAR: TiFlux Filter Panels */}
        {/* ============================================================== */}
        {(!isNarrow || filtersOpen) && (
        <aside id="schedule-filters" className="w-full lg:w-[230px] shrink-0 space-y-3.5">
          {/* Card 2: Filtrar */}
          <div className="bg-white border border-gray-200 rounded-[10px] p-3 shadow-2xs space-y-2.5">
            <div className="pb-2 border-b border-gray-100">
              <EzCheck
                label="Filtrar"
                labelClassName="text-xs font-bold text-gray-800"
                checked={allTypesChecked}
                indeterminate={someTypesChecked && !allTypesChecked}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setShowAgenda(checked);
                  setShowFerias(checked);
                  setShowAusencias(checked);
                }}
              />
            </div>

            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700">
                <input
                  type="checkbox"
                  checked={showAgenda}
                  onChange={(e) => setShowAgenda(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-petroleum-500"
                />
                <span className="w-2 h-2 rounded-full bg-petroleum-500 inline-block" />
                <span>Agenda</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700">
                <input
                  type="checkbox"
                  checked={showFerias}
                  onChange={(e) => setShowFerias(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-green-700"
                />
                <span className="w-2 h-2 rounded-full bg-green-700 inline-block" />
                <span>Férias</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700">
                <input
                  type="checkbox"
                  checked={showAusencias}
                  onChange={(e) => setShowAusencias(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-yellow-800"
                />
                <span className="w-2 h-2 rounded-full bg-yellow-800 inline-block" />
                <span>Ausências</span>
              </label>
            </div>
          </div>

          {/* Card 3: Atendentes */}
          <div className="bg-white border border-gray-200 rounded-[10px] p-3 shadow-2xs space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <EzCheck
                label="Atendentes"
                labelClassName="text-xs font-bold text-gray-800"
                checked={selectAllAttendants}
                indeterminate={!selectAllAttendants && selectedAttendantIds.size > 0}
                onChange={toggleAllAttendants}
              />
            </div>

            {/* Filtro por atendente (só ADMIN): a API restringe a consulta ao atendente escolhido */}
            {isAdmin && (
              <div className="pt-1">
                <EzSelect
                  variant="compact"
                  label="Atendente"
                  value={filterUserId}
                  onChange={(e) => setFilterUserId(e.target.value)}
                >
                  <option value="">Todos</option>
                  {agentSelectOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </EzSelect>
              </div>
            )}

            <div className="space-y-1.5 pt-1 max-h-[260px] overflow-y-auto text-xs">
              {attendantsList.length === 0 ? (
                <div className="text-[11px] text-gray-400 italic py-1">Nenhum atendente</div>
              ) : (
                attendantsList.map((att) => {
                  const isChecked = selectAllAttendants || selectedAttendantIds.has(att.id);
                  const color = attendantColorMap.get(att.id) || 'var(--color-brand-600)';

                  return (
                    <div
                      key={att.id}
                      className="flex items-center justify-between py-1 px-0.5 hover:bg-gray-50 rounded"
                    >
                      <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700 truncate flex-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleAttendant(att.id)}
                          className="w-3.5 h-3.5 rounded accent-brand-600"
                        />
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate text-xs font-medium">{att.name}</span>
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
        )}

        {/* ============================================================== */}
        {/* MAIN CALENDAR AREA: TiFlux Weekly Time-Grid */}
        {/* ============================================================== */}
        <main className="w-full lg:w-auto flex-1 min-w-0 bg-white border border-gray-200 rounded-[12px] shadow-2xs overflow-hidden flex flex-col">
          {/* Calendar Navigation Toolbar */}
          <div className="flex flex-wrap items-center justify-between p-3.5 border-b border-gray-200 gap-3">
            {/* Left navigation: < > Hoje */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors"
                aria-label={navLabels.prev}
                title={navLabels.prev}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextWeek}
                className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors"
                aria-label={navLabels.next}
                title={navLabels.next}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-3 h-11 sm:h-8 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors ml-1"
              >
                Hoje
              </button>
            </div>

            {/* Center: Date Range Title (e.g. 11 – 17 de outubro de 2026) */}
            <div className="text-sm font-semibold text-gray-800">
              {headerPeriodTitle}
            </div>

            {/* Right: View switcher (Mês | Semana | Dia | Lista) */}
            <div role="group" aria-label="Vista da agenda" className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium text-gray-600">
              <button
                type="button"
                onClick={() => setViewMode('mes')}
                aria-pressed={viewMode === 'mes'}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'mes' ? 'bg-white shadow-2xs text-brand-700 font-semibold' : 'hover:text-gray-900'
                }`}
              >
                Mês
              </button>
              <button
                type="button"
                onClick={() => setViewMode('semana')}
                aria-pressed={viewMode === 'semana'}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'semana'
                    ? 'bg-white border border-brand-600 text-brand-700 font-semibold shadow-2xs'
                    : 'hover:text-gray-900'
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setViewMode('dia')}
                aria-pressed={viewMode === 'dia'}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'dia' ? 'bg-white shadow-2xs text-brand-700 font-semibold' : 'hover:text-gray-900'
                }`}
              >
                Dia
              </button>
              <button
                type="button"
                onClick={() => setViewMode('lista')}
                aria-pressed={viewMode === 'lista'}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'lista' ? 'bg-white shadow-2xs text-brand-700 font-semibold' : 'hover:text-gray-900'
                }`}
              >
                Lista
              </button>
            </div>
          </div>

          {/* Time-Grid Content */}
          {isLoading ? (
            <div className="flex items-center justify-center h-96">
              <EzSpinner size={32} label="Carregando agenda" />
            </div>
          ) : isError ? (
            <div className="p-4">
              <EzAlert
                variant="error"
                title="Não foi possível carregar a agenda"
                action={
                  <EzButton
                    variant="secondary"
                    size="small"
                    label="Tentar novamente"
                    onClick={() => void refetch()}
                  />
                }
              >
                A consulta de compromissos falhou. Tente novamente em instantes.
              </EzAlert>
            </div>
          ) : viewMode === 'mes' ? (
            <MonthView
              monthWeeks={monthWeeks}
              currentDate={currentDate}
              todayDateStr={todayDateStr}
              appointments={filteredAppointments}
              onSelectDay={(day) => {
                setCurrentDate(day);
                setViewMode('dia');
              }}
              onSelectAppointment={handleOpenDetail}
            />
          ) : viewMode === 'lista' ? (
            <ListView
              appointments={filteredAppointments}
              onSelectAppointment={handleOpenDetail}
              onCreate={canCreate ? () => handleOpenCreate() : undefined}
            />
          ) : (
            <div className="overflow-x-auto flex-1 flex flex-col">
              <div
                ref={gridBodyRef}
                className={`${viewMode === 'dia' ? '' : 'min-w-[800px] '}flex flex-col flex-1 overflow-y-auto max-h-[640px]`}
              >
                {/* Day Header Row: Time gutter header + day columns (sticky so it scrolls in lockstep with the body, keeping columns aligned) */}
                <div
                  className="sticky top-0 z-20 grid border-b border-gray-200 bg-gray-50/70 text-center font-medium text-xs"
                  style={{ gridTemplateColumns: `56px repeat(${visibleDays.length}, 1fr)` }}
                >
                  {/* Empty top-left time cell */}
                  <div className="border-r border-gray-200 h-10" />

                  {/* Day columns: DOM, SEG, TER, QUA, QUI, SEX, SÁB (or a single day in "Dia") */}
                  {visibleDays.map((day) => {
                    const dateStr = formatDateKey(day);
                    const isToday = dateStr === todayDateStr;
                    const dayName = day.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase();
                    const dayNum = String(day.getDate()).padStart(2, '0');
                    const monthNum = String(day.getMonth() + 1).padStart(2, '0');

                    return (
                      <div
                        key={dateStr}
                        className={`h-10 flex items-center justify-center gap-1 border-r border-gray-200 last:border-r-0 ${
                          isToday ? 'bg-brand-50 text-brand-800 font-bold' : 'text-gray-700'
                        }`}
                      >
                        <span className="uppercase text-[11px] font-bold">{dayName}.</span>
                        <span className="text-[11px]">{dayNum}/{monthNum}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Grid Body: Time slots + Event columns */}
                <div
                  className="grid relative"
                  style={{ gridTemplateColumns: `56px repeat(${visibleDays.length}, 1fr)` }}
                >
                  {/* Left Time Gutter Column */}
                  <div className="border-r border-gray-200 text-right pr-2 py-1 select-none text-[11px] text-gray-500 font-medium">
                    {HOURS.map((hour) => {
                      const isCurrentHour =
                        now.getHours() === hour && visibleDays.some((d) => formatDateKey(d) === todayDateStr);

                      return (
                        <div
                          key={hour}
                          className="h-[56px] border-b border-gray-100/60 relative flex items-start justify-end pt-1"
                        >
                          {isCurrentHour && (
                            <span className="text-petroleum-600 font-bold mr-1 text-[10px]" aria-hidden="true">▶</span>
                          )}
                          <span className={isCurrentHour ? 'text-petroleum-700 font-bold' : ''}>
                            {String(hour).padStart(2, '0')}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Day Event Columns */}
                  {visibleDays.map((day) => {
                    const dateStr = formatDateKey(day);
                    const isToday = dateStr === todayDateStr;
                    const dayPositionedApps = appointmentsByDay[dateStr] || [];

                    return (
                      <div
                        key={dateStr}
                        className={`border-r border-gray-200 last:border-r-0 relative ${
                          isToday ? 'bg-brand-50/60' : 'bg-white'
                        }`}
                      >
                        {/* Hour slots background rows */}
                        {HOURS.map((hour) => {
                          const hourLabel = `${String(hour).padStart(2, '0')}:00`;
                          if (!canCreate) {
                            return <div key={hour} className="h-[56px] border-b border-gray-100" />;
                          }
                          const isTabStop = tabStopSlot.dateStr === dateStr && tabStopSlot.hour === hour;
                          const slotKey = `${dateStr}|${hour}`;
                          return (
                            <button
                              key={hour}
                              type="button"
                              ref={(el) => {
                                if (el) slotRefs.current.set(slotKey, el);
                                else slotRefs.current.delete(slotKey);
                              }}
                              tabIndex={isTabStop ? 0 : -1}
                              onFocus={() => setActiveSlot({ dateStr, hour })}
                              onKeyDown={(e) => handleSlotKeyDown(e, dateStr, hour)}
                              onClick={() => handleOpenCreate(dateStr, hour)}
                              className="block w-full h-[56px] border-b border-gray-100 hover:bg-brand-50/40 cursor-pointer transition-colors ez-focus-inset"
                              aria-label={`Adicionar compromisso às ${hourLabel}, ${day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                              title={`Adicionar compromisso às ${hourLabel}`}
                            />
                          );
                        })}

                        {/* Red Current Time Line */}
                        {isToday && currentTimeTop >= 0 && currentTimeTop <= HOURS.length * 56 && (
                          <div
                            className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                            style={{ top: `${currentTimeTop}px` }}
                          >
                            <span className="w-2 h-2 rounded-full bg-petroleum-500 -ml-1 shrink-0" />
                            <div className="flex-1 border-t-2 border-petroleum-500" />
                          </div>
                        )}

                        {/* Positioned Appointment Cards */}
                        {dayPositionedApps.map(({ appointment: app, top, height, colIndex, totalCols }) => {
                          const leftPct = (colIndex / totalCols) * 100;
                          const widthPct = 100 / totalCols;

                          const startHM = new Date(app.startTime).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                          const endHM = new Date(app.endTime).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          });

                          return (
                            <div
                              key={app.id}
                              role="button"
                              tabIndex={0}
                              aria-label={`${app.ticket?.protocol ? `#${app.ticket.protocol} - ` : ''}${app.title}, ${startHM} às ${endHM}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDetail(app);
                              }}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleOpenDetail(app);
                                }
                              }}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                left: `${leftPct}%`,
                                width: `calc(${widthPct}% - 4px)`,
                              }}
                              className={`absolute mx-0.5 rounded-[6px] p-2 text-white ${TYPE_BG[app.type]} shadow-xs cursor-pointer hover:brightness-105 transition-all overflow-hidden flex flex-col z-10 ez-focus`}
                            >
                              {/* Time Pill Badge & Type */}
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-block bg-black/25 text-white text-xs font-semibold px-1.5 py-0.5 rounded leading-none">
                                  {startHM} - {endHM}
                                </span>
                                <span className="text-xs text-white font-medium">
                                  {TYPE_LABELS[app.type]}
                                </span>
                              </div>

                              {/* Title in bold uppercase */}
                              <div className="text-white font-bold text-xs leading-tight line-clamp-2 mt-1 uppercase">
                                {app.ticket?.protocol ? `#${app.ticket.protocol} - ${app.title}` : app.title}
                              </div>

                              {/* Attendant & Organization metadata */}
                              {app.user && (
                                <div className="flex items-center gap-1 text-xs text-white truncate mt-1">
                                  <UserIcon className="w-2.5 h-2.5 shrink-0" />
                                  <span className="truncate">{app.user.name}</span>
                                </div>
                              )}
                              {app.organization && (
                                <div className="flex items-center gap-1 text-xs text-white truncate">
                                  <Building className="w-2.5 h-2.5 shrink-0" />
                                  <span className="truncate">{app.organization.name}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Compromisso Detail Modal (TiFlux screenshot 2 parity) */}
      <CompromissoDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        appointment={selectedAppointment}
        canEdit={canCreate}
        onEdit={handleEditFromDetail}
        onDelete={async (id) => {
          await removeMutation.mutateAsync(id);
        }}
      />

      {/* Appointment Create/Edit Modal */}
      <AppointmentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        appointment={selectedAppointment}
        initialDate={modalInitialDate}
        initialType={modalInitialType}
        canEdit={canCreate}
        onSave={async (data) => {
          if ('id' in data) {
            await updateMutation.mutateAsync(data);
          } else {
            await createMutation.mutateAsync(data);
          }
        }}
        onDelete={async (id) => {
          await removeMutation.mutateAsync(id);
        }}
      />
    </EzPageLayout>
  );
}


interface MonthViewProps {
  monthWeeks: Date[][];
  currentDate: Date;
  todayDateStr: string;
  appointments: Appointment[];
  onSelectDay: (day: Date) => void;
  onSelectAppointment: (appointment: Appointment) => void;
}

function MonthView({ monthWeeks, currentDate, todayDateStr, appointments, onSelectDay, onSelectAppointment }: MonthViewProps) {
  const byDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    appointments.forEach((app) => {
      const key = formatDateKey(new Date(app.startTime));
      if (!map[key]) map[key] = [];
      map[key].push(app);
    });
    Object.values(map).forEach((list) =>
      list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    );
    return map;
  }, [appointments]);

  const currentMonth = currentDate.getMonth();
  const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="grid grid-cols-7 border-b border-gray-200 text-center text-[11px] font-bold text-gray-500 uppercase">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2">{label}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthWeeks.flat().map((day) => {
          const dateStr = formatDateKey(day);
          const isToday = dateStr === todayDateStr;
          const isCurrentMonth = day.getMonth() === currentMonth;
          const dayApps = byDay[dateStr] || [];
          const visible = dayApps.slice(0, 3);
          const overflow = dayApps.length - visible.length;

          return (
            <div
              key={dateStr}
              role="group"
              aria-label={`${day.toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}, ${dayApps.length === 1 ? '1 compromisso' : `${dayApps.length} compromissos`}`}
              onClick={() => onSelectDay(day)}
              className={`min-h-[96px] border-r border-b border-gray-100 p-1.5 cursor-pointer hover:bg-gray-50 transition-colors last:border-r-0 ${
                isCurrentMonth ? 'bg-white' : 'bg-gray-50/50'
              }`}
            >
              {/* O botão do número é o ponto de teclado da célula (evita button dentro de button);
                  o clique do mouse continua valendo na célula inteira. */}
              <button
                type="button"
                aria-label={`Abrir dia ${day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectDay(day);
                }}
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ez-focus ${
                  isToday ? 'bg-brand-600 text-white' : isCurrentMonth ? 'text-gray-800' : 'text-gray-400'
                }`}
              >
                {day.getDate()}
              </button>
              <div className="mt-1 space-y-0.5">
                {visible.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAppointment(app);
                    }}
                    className={`w-full truncate text-left text-xs px-1 py-0.5 min-h-6 rounded text-white ${TYPE_BG[app.type]}`}
                    
                    title={app.title}
                  >
                    {app.title}
                  </button>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay(day);
                    }}
                    className="block w-full text-left text-xs text-gray-600 hover:text-gray-900 px-1 min-h-6 rounded ez-focus"
                  >
                    +{overflow} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ListViewProps {
  appointments: Appointment[];
  onSelectAppointment: (appointment: Appointment) => void;
  /** Só para quem pode criar (canCreate); sem ele o estado vazio não oferece o botão. */
  onCreate?: () => void;
}

function ListView({ appointments, onSelectAppointment, onCreate }: ListViewProps) {
  const sorted = useMemo(
    () => [...appointments].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [appointments]
  );

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EzEmptyCard
          title="Nenhum compromisso no período selecionado."
          action={onCreate ? <EzButton size="small" label="Novo agendamento" onClick={onCreate} /> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
      {sorted.map((app) => {
        const start = new Date(app.startTime);
        const end = new Date(app.endTime);
        return (
          <button
            key={app.id}
            type="button"
            onClick={() => onSelectAppointment(app)}
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
          >
            <div className={`w-1.5 h-10 rounded-full shrink-0 ${TYPE_BG[app.type]}`} />
            <div className="min-w-[150px] text-xs text-gray-600">
              <div className="font-semibold text-gray-800">
                {start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </div>
              <div>
                {start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} –{' '}
                {end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {app.ticket?.protocol ? `#${app.ticket.protocol} - ${app.title}` : app.title}
              </p>
              {app.user && <p className="text-xs text-gray-500 truncate">{app.user.name}</p>}
            </div>
            <span className="text-[10px] font-semibold uppercase text-gray-400 shrink-0">{TYPE_LABELS[app.type]}</span>
          </button>
        );
      })}
    </div>
  );
}

export default SchedulePage;
