import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Briefcase,
  Calendar,
  Clock,
  Headset,
  Hourglass,
  Inbox,
  MessageSquare,
  MessageSquareDot,
  Monitor,
  PauseCircle,
  Star,
  Ticket,
  Timer,
  UserCheck,
  UserCircle2,
  Users,
} from 'lucide-react';
import { useDashboardSummary } from '../hooks/useReports';
import { useAuthStore } from '../stores/authStore';
import {
  EzSpinner,
  EzTabs,
  EzActionsButton,
  EzLineChart,
  EzAlert,
  EzButton,
  EzProgressBar,
  ezTabId,
  ezTabPanelId,
} from '../components/ds';
import { cn } from '../components/ds/utils';
import { statusLabels } from '../components/tickets/TicketCard';

/**
 * Pie slices use only DS tokens with no semantic role (red and yellow carry
 * "critical"/"attention" elsewhere on this screen). `text` is the number and
 * letter color that reaches 4.5:1 on that slice; "Outros" is always the last one.
 */
const PIE_COLORS = [
  { bg: 'bg-brand-600', fill: 'fill-brand-600', text: 'text-white', textFill: 'fill-white' },
  { bg: 'bg-petroleum-500', fill: 'fill-petroleum-500', text: 'text-white', textFill: 'fill-white' },
  { bg: 'bg-green-500', fill: 'fill-green-500', text: 'text-gray-900', textFill: 'fill-gray-900' },
  { bg: 'bg-brand-300', fill: 'fill-brand-300', text: 'text-gray-900', textFill: 'fill-gray-900' },
  { bg: 'bg-petroleum-300', fill: 'fill-petroleum-300', text: 'text-gray-900', textFill: 'fill-gray-900' },
  { bg: 'bg-petroleum-700', fill: 'fill-petroleum-700', text: 'text-white', textFill: 'fill-white' },
];
const OTHERS_COLOR = { bg: 'bg-gray-300', fill: 'fill-gray-300', text: 'text-gray-900', textFill: 'fill-gray-900' };
const MAX_PIE_SLICES = 6;

const AGENT_STATUS: Record<string, { label: string; dot: string }> = {
  online: { label: 'Online', dot: 'bg-green-500' },
  busy: { label: 'Ocupado', dot: 'bg-yellow-600' },
  away: { label: 'Ausente', dot: 'bg-gray-400' },
  offline: { label: 'Offline', dot: 'bg-gray-500' },
};

function formatHoursAsClock(hours: number) {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

type DashboardTab = 'tickets' | 'chats' | 'recurso' | 'horas';
/** Distinct id prefixes: the page has two tab rows, and their ids must not collide. */
const MAIN_TABS_PREFIX = 'dashboard';
const PIE_TABS_PREFIX = 'dashboard-pie';
type PieGrouping = 'byAssignee' | 'byServiceDesk' | 'byOrganization' | 'byResource';

/**
 * Plain, flat TiFlux-style card: white background, thin gray border, a bold
 * gray title, and an optional sub-tab row that supplies its own bottom rule.
 * No icon badges, subtitles or accent bars — the real product is far flatter
 * than a typical "modern SaaS" card.
 */
interface TiFluxCardProps {
  title: string;
  tabs?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function TiFluxCard({ title, tabs, children, className, bodyClassName }: TiFluxCardProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200', className)} data-testid={`card-${slugify(title)}`}>
      <div className={cn('px-5 pt-4', !tabs && 'pb-3 border-b border-gray-100')}>
        <h2 className="text-[15px] font-bold text-gray-700">{title}</h2>
      </div>
      {tabs && <div className="px-5">{tabs}</div>}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </div>
  );
}

/**
 * Label-over-icon+number groups. Only an item with `to` is a link (hover, pointer
 * and the DS focus ring); the rest are read-only and look it.
 */
interface KpiItem {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  colorClass: string;
  /** When set, the whole item becomes a link to the matching filtered ticket list. */
  to?: string;
  /** Bigger number, and the full row on a phone. */
  emphasis?: boolean;
}

const KPI_LAYOUT = {
  wrap: 'flex flex-wrap gap-x-10 gap-y-5',
  strip: 'grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4',
  quad: 'grid flex-1 grid-cols-4 gap-x-3',
};

function KpiRow({ items, layout = 'wrap' }: { items: KpiItem[]; layout?: keyof typeof KPI_LAYOUT }) {
  return (
    <div className={KPI_LAYOUT[layout]}>
      {items.map((item) => {
        const body = (
          <>
            <span className="text-[13px] text-gray-600 font-medium">{item.label}</span>
            <span
              className={cn(
                'flex items-center gap-1.5 font-bold leading-none tabular-nums',
                item.emphasis ? 'text-[28px]' : 'text-[19px]',
                item.colorClass,
              )}
            >
              {item.icon}
              {item.value}
            </span>
          </>
        );
        const span = item.emphasis && 'col-span-2 md:col-span-1';

        if (item.to) {
          return (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                'flex min-h-11 flex-col gap-1.5 rounded-md -m-1 p-1 transition-colors cursor-pointer hover:bg-gray-80 lg:min-h-0 ez-focus',
                span,
              )}
            >
              {body}
            </Link>
          );
        }

        return (
          <div key={item.label} className={cn('flex flex-col gap-1.5', span)}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

const ICON = 'w-[18px] h-[18px]';

/** One prazo row (Atendimento or Solução): name above the four cells on a phone, beside them from sm. */
function DeadlineRow({ name, data }: { name: string; data?: { total: number; today: number; tomorrow: number; later: number } }) {
  return (
    <div role="group" aria-label={name} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
      <h3 className="text-[13px] font-bold text-gray-700 sm:w-24 sm:shrink-0">{name}</h3>
      <KpiRow
        layout="quad"
        items={[
          { label: 'Todos', value: data?.total ?? 0, icon: <Timer className={ICON} />, colorClass: 'text-gray-500' },
          { label: 'Hoje', value: data?.today ?? 0, icon: <AlertTriangle className={ICON} />, colorClass: 'text-yellow-800' },
          { label: 'Amanhã', value: data?.tomorrow ?? 0, colorClass: 'text-gray-500' },
          { label: 'Depois', value: data?.later ?? 0, colorClass: 'text-gray-500' },
        ]}
      />
    </div>
  );
}

/** TiFlux's empty-state treatment: a faint envelope/inbox icon and "Não há dados". */
function EmptyState({ label = 'Não há dados' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Inbox className="w-9 h-9 mb-2 text-gray-400" strokeWidth={1.25} />
      <p className="text-[13px] text-gray-500 font-medium">{label}</p>
    </div>
  );
}

function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th scope="col" className={cn('py-3 px-4 font-bold text-gray-600', numeric && 'text-right')}>
      {children}
    </th>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function formatPercent(fraction: number) {
  const percent = Math.round(fraction * 100);
  return percent < 1 ? '<1%' : `${percent}%`;
}

/** The biggest MAX_PIE_SLICES entries, with the rest summed into "Outros". */
function groupSlices(data: { name: string; count: number }[]) {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, MAX_PIE_SLICES).map((item, index) => ({ ...item, color: PIE_COLORS[index] }));
  const rest = sorted.slice(MAX_PIE_SLICES);
  if (rest.length === 0) return top;
  return [...top, { name: 'Outros', count: rest.reduce((sum, item) => sum + item.count, 0), color: OTHERS_COLOR }];
}

/** A real (non-donut) pie chart with a full avatar-style legend: count and percent written out, never clipped. */
function TicketsPieChart({ data }: { data: { name: string; count: number }[] }) {
  const total = data.reduce((acc, d) => acc + d.count, 0);

  if (data.length === 0) {
    return <EmptyState label="Nenhum ticket em andamento encontrado." />;
  }

  let cumulativeAngle = 0;
  const slices = groupSlices(data).map((item) => {
    const percent = total > 0 ? item.count / total : 0;
    const startAngle = cumulativeAngle;
    cumulativeAngle += percent * 360;
    return { ...item, startAngle, endAngle: cumulativeAngle, percent };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-8">
      {/* Scales with the card instead of a fixed 208px box: full width while
          stacked on mobile, up to ~45% of the row (capped so it doesn't
          dwarf the legend) once there's room beside it. */}
      <div className="w-full sm:w-2/5 sm:max-w-sm aspect-square shrink-0">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          role="img"
          aria-label={`Tickets em andamento por categoria: ${slices.map((s) => `${s.name} ${s.count} (${formatPercent(s.percent)})`).join(', ')}`}
        >
          {slices.length === 1 ? (
            <circle cx="50" cy="50" r="46" className={slices[0].color.fill} />
          ) : (
            slices.map((s) => (
              <path key={s.name} d={pieSlicePath(50, 50, 46, s.startAngle, s.endAngle)} className={cn(s.color.fill, 'stroke-white')} strokeWidth="0.75" />
            ))
          )}
          {slices.map((s) => {
            if (s.percent < 0.04) return null;
            const pos = polarToCartesian(50, 50, 28, (s.startAngle + s.endAngle) / 2);
            return (
              <text
                key={`label-${s.name}`}
                x={pos.x}
                y={pos.y}
                fontSize="7"
                fontWeight="700"
                className={s.color.textFill}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {s.count}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-col divide-y divide-gray-100 w-full sm:flex-1">
        {slices.map((s, index) => (
          <div key={s.name} className="flex items-center gap-3 py-2.5">
            {/* Position, not the initial: two names with the same letter stay apart. */}
            <span className={cn('w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold tabular-nums shrink-0', s.color.bg, s.color.text)}>
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-gray-900 break-words">{s.name}</p>
              <p className="text-[12px] text-gray-500 tabular-nums">{`Tickets ${s.count} · ${formatPercent(s.percent)}`}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** "há 2 horas"; empty when the timestamp is missing or invalid. */
function formatRelativeTime(iso?: string) {
  const time = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(time)) return '';
  const minutes = Math.round((time - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return RELATIVE_TIME.format(Math.min(minutes, 0), 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE_TIME.format(hours, 'hour');
  return RELATIVE_TIME.format(Math.round(hours / 24), 'day');
}

function NotificationsList({ items }: { items?: { id: string; protocol: string; title: string; createdAt?: string }[] }) {
  if (!items || items.length === 0) return <EmptyState />;
  return (
    <div role="region" aria-label="Últimas notificações" tabIndex={0} className="max-h-48 overflow-y-auto ez-focus rounded-md">
      <ul className="space-y-1">
        {items.map((notif) => {
          const when = formatRelativeTime(notif.createdAt);
          return (
            <li key={notif.id}>
              <Link to={`/tickets/${notif.id}`} className="flex items-start gap-2.5 rounded-md py-1.5 text-[13px] transition-colors hover:bg-gray-80 ez-focus">
                <Bell aria-hidden="true" className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-mono text-brand-700 font-bold mr-1.5 text-[12px]">{notif.protocol}</span>
                  <span className="text-gray-700">{notif.title}</span>
                  {when && <span className="block text-[12px] text-gray-500">{when}</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RatingCard({ title, rating, className }: { title: string; rating?: { avg: number | null; count: number; satisfactionRate: number | null }; className?: string }) {
  return (
    <TiFluxCard title={title} className={className}>
      {!rating || rating.count === 0 ? (
        <EmptyState />
      ) : (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            {rating.avg == null ? (
              <>
                <span aria-hidden="true" className="text-[30px] font-black text-gray-900 leading-none">—</span>
                <span className="sr-only">Sem nota</span>
              </>
            ) : (
              <span className="text-[30px] font-black text-gray-900 leading-none">{rating.avg.toFixed(1)}</span>
            )}
            <span className="text-yellow-700 text-sm">
              <Star aria-hidden="true" className="w-4 h-4 inline fill-yellow-600" />
            </span>
          </div>
          <p className="text-[12px] text-gray-500">
            {rating.count} avaliações · {rating.satisfactionRate ?? 0}% satisfeitos
          </p>
        </div>
      )}
    </TiFluxCard>
  );
}

export function DashboardPage() {
  const { data, isLoading, isError, isFetching, refetch } = useDashboardSummary();
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<string | number>('tickets');
  const [pieGrouping, setPieGrouping] = useState<PieGrouping>('byAssignee');

  const greetingName = useMemo(() => {
    // The token only carries `name` when the backend issues it; otherwise the e-mail prefix.
    if (user?.name) return user.name;
    const raw = user?.email ? user.email.split('@')[0] : 'Usuário';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user?.name, user?.email]);

  const panelProps = (tab: DashboardTab) => ({
    role: 'tabpanel' as const,
    id: ezTabPanelId(MAIN_TABS_PREFIX, tab),
    'aria-labelledby': ezTabId(MAIN_TABS_PREFIX, tab),
  });

  const tabsConfig = useMemo(
    () => [
      { id: 'tickets', label: 'Tickets' },
      { id: 'chats', label: 'Chats' },
      { id: 'recurso', label: 'Recurso' },
      { id: 'horas', label: 'Horas' },
    ],
    [],
  );

  const pieData = useMemo(() => {
    if (!data?.inProgressBreakdown) return [];
    return (data.inProgressBreakdown[pieGrouping] || []).filter((i) => i.count > 0);
  }, [data?.inProgressBreakdown, pieGrouping]);

  const monthlyDays = useMemo(() => data?.monthlyHours?.days || [], [data?.monthlyHours?.days]);
  const hoursTargetTotal = data?.monthlyHours?.targetHoursTotal ?? 0;
  const hoursLoggedTotal = data?.monthlyHours?.loggedHoursTotal ?? 0;
  const hoursRemainingTotal = data?.monthlyHours?.remainingHoursTotal ?? Math.max(0, hoursTargetTotal - hoursLoggedTotal);

  const todayKey = toDateKey(new Date());
  const yesterdayKey = toDateKey(new Date(Date.now() - 86400000));
  const todayHours = monthlyDays.find((d) => d.date === todayKey)?.loggedHours ?? 0;
  const yesterdayHours = monthlyDays.find((d) => d.date === yesterdayKey)?.loggedHours ?? 0;

  const weekDays = useMemo(() => monthlyDays.filter((d) => d.date <= todayKey).slice(-7), [monthlyDays, todayKey]);

  const trend30d = data?.ticketsTrend30d || [];
  const byStatusTotal = Object.values(data?.byStatus ?? {}).reduce((sum, count) => sum + count, 0);

  return (
    <div className="space-y-5">
      {/* Header: mascot icon + greeting, Modo TV, Ações — a plain row, not a bordered banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Headset className="w-5 h-5 text-gray-700" />
          <div>
            <h1 className="text-[18px] font-bold leading-tight text-gray-700">Painel</h1>
            <p className="text-[13px] text-gray-600">Bom te ver de volta, {greetingName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex h-[var(--control-height-md)] min-h-11 items-center gap-1.5 rounded-lg border border-dashed border-gray-200 px-3 text-[13px] font-medium text-gray-500 cursor-not-allowed lg:min-h-0"
          >
            <Monitor className="w-4 h-4" />
            Modo TV
            <span className="text-[12px] font-normal">· Em breve</span>
          </button>
          <EzActionsButton
            label="Ações"
            align="right"
            className="bg-brand-600 text-white border-brand-600 hover:bg-brand-700 h-[var(--control-height-md)] min-h-11 rounded-lg lg:min-h-0"
            actions={[{ label: 'Novo Ticket', onClick: () => navigate('/tickets/new') }]}
          />
        </div>
      </div>

      {/* Plain-text tab row, brand underline on the active tab */}
      {!isError && (
        <EzTabs
          tabs={tabsConfig}
          activeTab={activeTab}
          onChange={(tabId) => setActiveTab(tabId as DashboardTab)}
          variant="line"
          idPrefix={MAIN_TABS_PREFIX}
        />
      )}

      {isLoading && (
        <div className="flex justify-center p-12 bg-white rounded-xl border border-gray-200">
          <EzSpinner label="Carregando métricas..." />
        </div>
      )}

      {isError && (
        <EzAlert
          variant="error"
          title="Falha ao carregar as métricas do dashboard"
          action={<EzButton variant="secondary" size="small" label="Tentar novamente" loading={isFetching} onClick={() => void refetch()} />}
        >
          As métricas não carregaram. Verifique a conexão e tente novamente.
        </EzAlert>
      )}

      {data && !isError && (
        <>
          {/* TAB: TICKETS */}
          {/*
            Top strip first (what needs action now), then two independent
            columns on lg (masonry-style: a short card is never stretched to
            match a tall one next to it). Below lg the columns dissolve
            (`contents`) and `order-*` sets the reading order: Prazos, CSAT,
            Tickets em andamento, 30 dias, Notificações.
          */}
          {activeTab === 'tickets' && (
            <div className="flex flex-col gap-5" {...panelProps('tickets')}>
              <TiFluxCard title="Resumo de tickets">
                <KpiRow
                  layout="strip"
                  items={[
                    {
                      label: 'Vencidos',
                      value: data.ticketSummary?.overdue ?? data.slaBreachedCount,
                      icon: <AlertTriangle className="w-6 h-6" />,
                      colorClass: 'text-red-600',
                      to: '/tickets?overdue=true',
                      emphasis: true,
                    },
                    {
                      label: 'Não atendidos',
                      value: data.ticketSummary?.unattended ?? 0,
                      icon: <MessageSquareDot className={ICON} />,
                      colorClass: 'text-yellow-800',
                      to: '/tickets?unassigned=true',
                    },
                    {
                      label: 'Sem resposta',
                      value: data.unansweredTickets?.total ?? 0,
                      icon: <MessageSquare className={ICON} />,
                      colorClass: 'text-gray-500',
                    },
                    {
                      label: 'Meus sem resposta',
                      value: data.unansweredTickets?.mine ?? 0,
                      icon: <UserCircle2 className={ICON} />,
                      colorClass: 'text-gray-500',
                    },
                    {
                      label: 'Meus',
                      value: data.ticketSummary?.mine ?? 0,
                      icon: <UserCheck className={ICON} />,
                      colorClass: 'text-brand-600',
                      to: '/tickets?mine=true',
                    },
                    {
                      label: 'Todos',
                      value: data.ticketSummary?.total ?? data.openCount + data.closedCount,
                      icon: <Ticket className={ICON} />,
                      colorClass: 'text-brand-600',
                      to: '/tickets',
                    },
                    {
                      label: 'Em andamento',
                      value: data.ticketSummary?.inProgress ?? data.byStatus?.IN_PROGRESS ?? 0,
                      icon: <Activity className={ICON} />,
                      colorClass: 'text-green-600',
                      to: '/tickets?status=IN_PROGRESS',
                    },
                    {
                      label: 'Pausados',
                      value: data.ticketSummary?.paused ?? 0,
                      icon: <PauseCircle className={ICON} />,
                      colorClass: 'text-gray-500',
                      to: '/tickets?paused=true',
                    },
                  ]}
                />
              </TiFluxCard>

              <div className="contents lg:flex lg:flex-row lg:gap-5">
                <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-5">
                  <TiFluxCard title="Prazos" className="order-1 lg:order-none">
                    <div className="flex flex-col gap-5">
                      <DeadlineRow name="Atendimento" data={data.responseDeadlines} />
                      <DeadlineRow name="Solução" data={data.solutionDeadlines} />
                    </div>
                  </TiFluxCard>

                  <div className="order-2 flex flex-col gap-5 sm:flex-row lg:order-none">
                    <RatingCard title="Avaliação geral de tickets (30 dias)" rating={data.csatGeneral30d} className="sm:flex-1 min-w-0" />
                    <RatingCard title="Avaliação dos meus tickets (30 dias)" rating={data.csatMine30d} className="sm:flex-1 min-w-0" />
                  </div>

                  <TiFluxCard title="Últimas notificações" className="order-5 lg:order-none">
                    <NotificationsList items={data.recentNotifications} />
                  </TiFluxCard>
                </div>

                <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-5">
                  <TiFluxCard
                    title="Tickets em andamento"
                    className="order-3 lg:order-none"
                    tabs={
                      <EzTabs
                        tabs={[
                          { id: 'byAssignee', label: 'Por responsável' },
                          { id: 'byServiceDesk', label: 'Por mesa' },
                          { id: 'byOrganization', label: 'Por cliente' },
                          { id: 'byResource', label: 'Por tipo de recurso' },
                        ]}
                        activeTab={pieGrouping}
                        onChange={(val) => setPieGrouping(val as PieGrouping)}
                        variant="line"
                        idPrefix={PIE_TABS_PREFIX}
                      />
                    }
                  >
                    <div
                      role="tabpanel"
                      id={ezTabPanelId(PIE_TABS_PREFIX, pieGrouping)}
                      aria-labelledby={ezTabId(PIE_TABS_PREFIX, pieGrouping)}
                    >
                      <TicketsPieChart data={pieData} />
                    </div>
                  </TiFluxCard>

                  <TiFluxCard title="Tickets nos últimos 30 dias" className="order-4 lg:order-none">
                    {trend30d.length === 0 ? (
                      <EmptyState />
                    ) : (
                      <EzLineChart
                        ariaLabel="Tickets criados, fechados e cancelados nos últimos 30 dias"
                        series={[
                          { name: 'Tickets criados', color: 'brand-600', values: trend30d.map((d) => d.created) },
                          { name: 'Tickets fechados', color: 'green-600', values: trend30d.map((d) => d.closed) },
                          { name: 'Tickets cancelados', color: 'gray-500', values: trend30d.map((d) => d.cancelled) },
                        ]}
                        xLabels={trend30d.map((d) => formatDateLabel(d.date))}
                        partialLast={trend30d[trend30d.length - 1].date === todayKey}
                      />
                    )}
                  </TiFluxCard>
                </div>
              </div>

              <TiFluxCard title="Chamados abertos por status" className="order-6">
                {Object.keys(data.byStatus).length === 0 ? (
                  <EmptyState label="Nenhum chamado aberto no momento." />
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {Object.entries(data.byStatus).map(([status, count]) => (
                      <li key={status}>
                        <Link
                          to={`/tickets?status=${status}`}
                          className="flex items-center justify-between gap-3 rounded-md py-2.5 text-sm transition-colors hover:bg-gray-80 ez-focus"
                        >
                          <span className="text-gray-700 font-medium">{(statusLabels as Record<string, string>)[status] ?? status}</span>
                          <span className="font-bold text-gray-900 tabular-nums">
                            {count}
                            <span className="ml-2 font-normal text-gray-600">{formatPercent(count / byStatusTotal)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TiFluxCard>
            </div>
          )}

          {/* TAB: CHATS */}
          {activeTab === 'chats' && (
            <div className="space-y-5" {...panelProps('chats')}>
              <div className="flex flex-col md:flex-row gap-5">
                <TiFluxCard title="Meus chats" className="md:flex-1 min-w-0">
                  <KpiRow
                    items={[
                      {
                        label: 'Em atendimento',
                        value: data.myChats?.inProgress ?? 0,
                        icon: <MessageSquare className={ICON} />,
                        colorClass: 'text-brand-600',
                      },
                      {
                        label: 'Aguardando resposta',
                        value: data.myChats?.waitingResponse ?? 0,
                        icon: <MessageSquareDot className={ICON} />,
                        colorClass: 'text-yellow-800',
                      },
                      {
                        label: 'Média de espera',
                        value: data.myChats?.avgWaitMinutes != null ? `${data.myChats.avgWaitMinutes}m` : '—',
                        icon: <Hourglass className={ICON} />,
                        colorClass: 'text-gray-500',
                      },
                      {
                        label: 'Média de atendimento',
                        value: data.myChats?.avgServiceMinutes != null ? `${data.myChats.avgServiceMinutes}m` : '—',
                        icon: <Clock className={ICON} />,
                        colorClass: 'text-green-600',
                      },
                    ]}
                  />
                </TiFluxCard>

                <TiFluxCard title="Todos os chats" className="md:flex-1 min-w-0">
                  <KpiRow
                    items={[
                      {
                        label: 'Todos',
                        value: data.allChats?.inProgress !== undefined ? (data.allChats.inProgress + (data.allChats.waitingResponse ?? 0)) : data.openCount,
                        icon: <Users className={ICON} />,
                        colorClass: 'text-brand-600',
                      },
                      {
                        label: 'Em atendimento',
                        value: data.allChats?.inProgress ?? data.openCount,
                        icon: <MessageSquare className={ICON} />,
                        colorClass: 'text-brand-600',
                      },
                      {
                        label: 'Aguardando resposta',
                        value: data.allChats?.waitingResponse ?? 0,
                        icon: <MessageSquareDot className={ICON} />,
                        colorClass: 'text-yellow-800',
                      },
                      {
                        label: 'Média de espera',
                        value: data.allChats?.avgWaitMinutes != null ? `${data.allChats.avgWaitMinutes}m` : '—',
                        icon: <Hourglass className={ICON} />,
                        colorClass: 'text-gray-500',
                      },
                      {
                        label: 'Média de atendimento',
                        value: data.allChats?.avgServiceMinutes != null ? `${data.allChats.avgServiceMinutes}m` : '—',
                        icon: <Clock className={ICON} />,
                        colorClass: 'text-green-600',
                      },
                    ]}
                  />
                </TiFluxCard>
              </div>

              <TiFluxCard title="Chats por departamentos" bodyClassName="p-0">
                {!data.chatsByDepartment || data.chatsByDepartment.length === 0 ? (
                  <EmptyState />
                ) : (
                  <div className="overflow-x-auto">
                    <table aria-label="Chats por departamentos" className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="bg-gray-80 border-y border-gray-100 text-gray-600">
                          <Th>Departamento</Th>
                          <Th numeric>Todos</Th>
                          <Th numeric>Em atendimento</Th>
                          <Th numeric>Fila de espera</Th>
                          <Th numeric>Aguardando resposta</Th>
                          <Th numeric>Média de espera</Th>
                          <Th numeric>Média de atendimento</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.chatsByDepartment.map((dept) => (
                          <tr key={dept.department} className="hover:bg-gray-80 transition-colors">
                            <td className="py-3 px-4 font-semibold text-gray-900">{dept.department}</td>
                            <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{dept.total}</td>
                            <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{dept.inProgress}</td>
                            <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{dept.waitingQueue}</td>
                            <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{dept.waitingResponse}</td>
                            <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{dept.avgWait ?? '—'}</td>
                            <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{dept.avgService ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TiFluxCard>

              <TiFluxCard title="Chats por atendentes" bodyClassName="p-0">
                {!data.chatsByAgent || data.chatsByAgent.length === 0 ? (
                  <EmptyState />
                ) : (
                  <div className="overflow-x-auto">
                    <table aria-label="Chats por atendentes" className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="bg-gray-80 border-y border-gray-100 text-gray-600">
                          <Th>Atendente</Th>
                          <Th>Status</Th>
                          <Th numeric>Em andamento</Th>
                          <Th>Grupo de atendente</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.chatsByAgent.map((ag) => {
                          const status = ag.status ? AGENT_STATUS[ag.status] : undefined;
                          return (
                            <tr key={ag.name} className="hover:bg-gray-80 transition-colors">
                              <td className="py-3 px-4 font-semibold text-gray-900">{ag.name}</td>
                              <td className="py-3 px-4">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={cn('w-2 h-2 rounded-full', status?.dot ?? 'bg-gray-400')} />
                                  <span className="text-gray-700">{status?.label ?? ag.status ?? '—'}</span>
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{ag.inProgress}</td>
                              <td className="py-3 px-4 text-gray-700">{ag.group}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </TiFluxCard>
            </div>
          )}

          {/* TAB: RECURSO */}
          {/* Two independent columns, same reasoning as the Tickets tab:
              each "Meus"/"Todos" pair hugs its own rating card below it
              instead of both columns being stretched to a shared row
              height. */}
          {activeTab === 'recurso' && (
            <div className="flex flex-col md:flex-row gap-5" {...panelProps('recurso')}>
              <div className="flex flex-col gap-5 md:flex-1 min-w-0">
                <TiFluxCard title="Meus compromissos">
                  <KpiRow
                    items={[
                      { label: 'Todos', value: data.myAppointments?.total ?? 0, icon: <Calendar className={ICON} />, colorClass: 'text-brand-600' },
                      { label: 'Hoje', value: data.myAppointments?.today ?? 0, icon: <Calendar className={ICON} />, colorClass: 'text-yellow-800' },
                      { label: 'Semana', value: data.myAppointments?.week ?? 0, icon: <Calendar className={ICON} />, colorClass: 'text-gray-500' },
                      { label: 'Mês', value: data.myAppointments?.month ?? 0, icon: <Calendar className={ICON} />, colorClass: 'text-gray-500' },
                    ]}
                  />
                </TiFluxCard>

                <RatingCard title="Avaliação geral de tickets (30 dias)" rating={data.csatGeneral30d} />
              </div>

              <div className="flex flex-col gap-5 md:flex-1 min-w-0">
                <TiFluxCard title="Todos os compromissos">
                  <KpiRow
                    items={[
                      { label: 'Todos', value: data.allAppointments?.total ?? 0, icon: <Briefcase className={ICON} />, colorClass: 'text-brand-600' },
                      { label: 'Hoje', value: data.allAppointments?.today ?? 0, icon: <Briefcase className={ICON} />, colorClass: 'text-yellow-800' },
                      { label: 'Semana', value: data.allAppointments?.week ?? 0, icon: <Briefcase className={ICON} />, colorClass: 'text-gray-500' },
                      { label: 'Mês', value: data.allAppointments?.month ?? 0, icon: <Briefcase className={ICON} />, colorClass: 'text-gray-500' },
                    ]}
                  />
                </TiFluxCard>

                <RatingCard title="Avaliação dos meus tickets (30 dias)" rating={data.csatMine30d} />
              </div>
            </div>
          )}

          {/* TAB: HORAS — only the hours; the 30-day ticket chart and the notifications live in Tickets. */}
          {activeTab === 'horas' && (
            <div className="max-w-4xl" {...panelProps('horas')}>
              <TiFluxCard title="Minhas horas apontadas">
                <div className="mb-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                  <div className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium text-gray-500">Ontem</span>
                    <strong className="flex items-center gap-1.5 text-[19px] font-bold tabular-nums text-brand-600">
                      <UserCheck className={ICON} />
                      {formatHoursAsClock(yesterdayHours)}
                    </strong>
                  </div>
                  <div className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium text-gray-500">Hoje</span>
                    <strong className="flex items-center gap-1.5 text-[19px] font-bold tabular-nums text-yellow-800">
                      <Clock className={ICON} />
                      {formatHoursAsClock(todayHours)}
                    </strong>
                  </div>
                  <div className="flex items-baseline gap-1.5 text-[13px] text-gray-500">
                    <span>Apontadas</span>
                    <strong className="text-gray-700 tabular-nums">{formatHoursAsClock(hoursLoggedTotal)}</strong>
                  </div>
                  <div className="flex items-baseline gap-1.5 text-[13px] text-gray-500">
                    <span>Faltantes</span>
                    <strong className="text-gray-700 tabular-nums">{formatHoursAsClock(hoursRemainingTotal)}</strong>
                  </div>
                  <div className="flex items-baseline gap-1.5 text-[13px] text-gray-500">
                    <span>Meta</span>
                    <strong className="text-gray-700 tabular-nums">{formatHoursAsClock(hoursTargetTotal)}</strong>
                  </div>
                </div>

                {hoursTargetTotal > 0 && (
                  <EzProgressBar
                    className="mb-5"
                    value={(hoursLoggedTotal / hoursTargetTotal) * 100}
                    showLabel
                    aria-label="Horas apontadas no mês em relação à meta"
                    aria-valuetext={`${formatHoursAsClock(hoursLoggedTotal)} de ${formatHoursAsClock(hoursTargetTotal)}`}
                  />
                )}

                {weekDays.length === 0 ? (
                  <EmptyState />
                ) : (
                  <EzLineChart
                    ariaLabel="Horas apontadas por dia"
                    series={[{ name: 'Horas apontadas', color: 'brand-600', values: weekDays.map((d) => d.loggedHours) }]}
                    xLabels={weekDays.map((d) => formatDateLabel(d.date))}
                    formatValue={formatHoursAsClock}
                    partialLast={weekDays[weekDays.length - 1].date === todayKey}
                  />
                )}
              </TiFluxCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DashboardPage;
