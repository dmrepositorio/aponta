import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { DashboardPage } from './DashboardPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The "Resumo de tickets" KPIs are now <Link>s to /tickets, so a
          router context is required even though these tests never navigate. */}
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/tickets/new" element={<p>Tela de novo ticket</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function card(testId: string) {
  return within(screen.getByTestId(testId));
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while the summary is being fetched', () => {
    vi.mocked(api.get).mockImplementation(
      () =>
        new Promise(() => {
          // never resolves
        }),
    );
    renderDashboard();

    expect(screen.getByText(/carregando métricas/i)).toBeInTheDocument();
  });

  it('renders the greeting (TiFlux "Bom te ver de volta" copy) and the four plain-text tabs', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
      },
    });
    renderDashboard();

    expect(await screen.findByText(/bom te ver de volta/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recurso' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Horas' })).toBeInTheDocument();
  });

  it('AC-12: shows "Modo TV" as a disabled button with "Em breve" written on screen', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { openCount: 0, closedCount: 0, slaBreachedCount: 0, avgResolutionMinutes: null, byStatus: {} },
    });
    renderDashboard();

    await screen.findByText(/bom te ver de volta/i);
    const modoTv = screen.getByRole('button', { name: /modo tv/i });
    expect(modoTv).toBeDisabled();
    expect(modoTv).toHaveAttribute('aria-disabled', 'true');
    expect(modoTv).toHaveTextContent('Em breve');
  });

  it('AC-12: "Ações > Novo Ticket" navigates inside the app without reloading the page', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { openCount: 0, closedCount: 0, slaBreachedCount: 0, avgResolutionMinutes: null, byStatus: {} },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText(/bom te ver de volta/i);
    await user.click(screen.getByRole('button', { name: /ações/i }));
    await user.click(screen.getByRole('menuitem', { name: /novo ticket/i }));

    expect(await screen.findByText('Tela de novo ticket')).toBeInTheDocument();
  });

  it('renders the Resumo de tickets KPI row from ticketSummary', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 5,
        closedCount: 12,
        slaBreachedCount: 2,
        avgResolutionMinutes: 125,
        byStatus: { OPEN: 3, IN_PROGRESS: 2 },
        ticketSummary: { total: 74, mine: 4, unattended: 11, inProgress: 73, paused: 9, overdue: 72 },
      },
    });
    renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    const resumoCard = card('card-resumo-de-tickets');
    expect(resumoCard.getByText('74')).toBeInTheDocument();
    expect(resumoCard.getByText('4')).toBeInTheDocument();
    expect(resumoCard.getByText('11')).toBeInTheDocument();
    expect(resumoCard.getByText('73')).toBeInTheDocument();
    expect(resumoCard.getByText('9')).toBeInTheDocument();
    expect(resumoCard.getByText('72')).toBeInTheDocument();
  });

  it('renders each "Resumo de tickets" KPI as a link to the matching filtered ticket list', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 5,
        closedCount: 12,
        slaBreachedCount: 2,
        avgResolutionMinutes: 125,
        byStatus: { OPEN: 3, IN_PROGRESS: 2 },
        ticketSummary: { total: 74, mine: 4, unattended: 11, inProgress: 73, paused: 9, overdue: 72 },
      },
    });
    renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    const scoped = card('card-resumo-de-tickets');

    expect(scoped.getByRole('link', { name: /todos/i })).toHaveAttribute('href', '/tickets');
    expect(scoped.getByRole('link', { name: /meus/i })).toHaveAttribute('href', '/tickets?mine=true');
    expect(scoped.getByRole('link', { name: /não atendidos/i })).toHaveAttribute('href', '/tickets?unassigned=true');
    expect(scoped.getByRole('link', { name: /em andamento/i })).toHaveAttribute('href', '/tickets?status=IN_PROGRESS');
    expect(scoped.getByRole('link', { name: /pausados/i })).toHaveAttribute('href', '/tickets?paused=true');
    expect(scoped.getByRole('link', { name: /vencidos/i })).toHaveAttribute('href', '/tickets?overdue=true');
  });

  it('renders the open-tickets-by-status breakdown', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 3,
        closedCount: 0,
        slaBreachedCount: 0,
        avgResolutionMinutes: null,
        byStatus: { OPEN: 2, ESCALATED: 1 },
      },
    });
    renderDashboard();

    expect(await screen.findByText('Aberto')).toBeInTheDocument();
    expect(screen.getByText('Escalonado')).toBeInTheDocument();
  });

  it('DMTE-490 AC-05: labels the PENDING_SANKHYA slice of the open-tickets breakdown as Aguardando Sankhya', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 0,
        slaBreachedCount: 0,
        avgResolutionMinutes: null,
        byStatus: { OPEN: 1, PENDING_SANKHYA: 1 },
      },
    });
    renderDashboard();

    expect(await screen.findByText('Aguardando Sankhya')).toBeInTheDocument();
  });

  it('shows an empty message when there are no open tickets', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 0,
        closedCount: 4,
        slaBreachedCount: 0,
        avgResolutionMinutes: 30,
        byStatus: {},
      },
    });
    renderDashboard();

    expect(
      await screen.findByText(/nenhum chamado aberto/i),
    ).toBeInTheDocument();
  });

  it('shows an error message when the summary request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network Error'));
    renderDashboard();

    expect(
      await screen.findByText(/falha ao carregar as métricas/i),
    ).toBeInTheDocument();
  });

  it('renders a real pie chart (not a donut) for Tickets em andamento and switches grouping via plain tabs', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
        inProgressBreakdown: {
          byAssignee: [{ name: 'Joana', count: 5 }, { name: 'Pedro', count: 3 }],
          byServiceDesk: [{ name: 'Mesa Central', count: 8 }],
          byOrganization: [],
          byResource: [],
        },
      },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderDashboard();

    const pieCard = within(await screen.findByTestId('card-tickets-em-andamento'));
    expect(pieCard.getByText('Joana')).toBeInTheDocument();
    expect(pieCard.getByText('Tickets 5 · 63%')).toBeInTheDocument();
    // No donut hole: the chart is built from <path> wedges (or a single <circle> for one slice), never a ring.
    expect(pieCard.getByRole('img', { name: /tickets em andamento/i })).toBeInTheDocument();

    await user.click(pieCard.getByRole('tab', { name: 'Por mesa' }));
    expect(pieCard.getByText('Mesa Central')).toBeInTheDocument();
  });

  it('scales the pie chart to the card width instead of a fixed small box', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
        inProgressBreakdown: {
          byAssignee: [{ name: 'Joana', count: 5 }],
          byServiceDesk: [],
          byOrganization: [],
          byResource: [],
        },
      },
    });
    renderDashboard();

    const pieCard = within(await screen.findByTestId('card-tickets-em-andamento'));
    const svg = pieCard.getByRole('img', { name: /tickets em andamento/i });
    // No longer pinned to a fixed 208px (w-52 h-52) box — it fills whatever
    // its (responsive) wrapper gives it.
    expect(svg.getAttribute('class') ?? '').not.toContain('w-52');
    expect(svg.getAttribute('class') ?? '').toContain('w-full');
  });

  it('draws "Minhas horas apontadas" with the DS line chart, named for screen readers', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 0,
        closedCount: 0,
        slaBreachedCount: 0,
        avgResolutionMinutes: null,
        byStatus: {},
        monthlyHours: {
          targetHoursTotal: 40,
          loggedHoursTotal: 10,
          remainingHoursTotal: 30,
          days: [{ day: 1, date: '2026-10-01', targetHours: 8, loggedHours: 2, remainingHours: 6 }],
        },
      },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('tab', { name: 'Horas' }));
    const horasCard = within(screen.getByTestId('card-minhas-horas-apontadas'));
    expect(horasCard.getByRole('group', { name: /horas apontadas por dia/i })).toBeInTheDocument();
    expect(horasCard.getByRole('slider', { name: /horas apontadas por dia/i })).toBeInTheDocument();
    expect(horasCard.queryAllByRole('button')).toHaveLength(0);
  });

  it('switches to Chats tab and renders chat KPI rows, departments and agents tables', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
        myChats: { inProgress: 1, waitingResponse: 0, avgWaitMinutes: 3, avgServiceMinutes: 18 },
        allChats: { inProgress: 2, waitingResponse: 1, avgWaitMinutes: 5, avgServiceMinutes: 20 },
        chatsByDepartment: [
          {
            department: 'Suporte Técnico',
            total: 5,
            inProgress: 3,
            waitingQueue: 1,
            waitingResponse: 1,
            avgWait: '4m',
            avgService: '18m',
          },
        ],
        chatsByAgent: [
          { name: 'Carlos Atendente', status: 'online', inProgress: 2, group: 'N1' },
        ],
      },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    renderDashboard();

    const chatsTab = await screen.findByRole('tab', { name: 'Chats' });
    await user.click(chatsTab);

    expect(screen.getByText('Meus chats')).toBeInTheDocument();
    expect(screen.getByText('Todos os chats')).toBeInTheDocument();
    expect(screen.getByText('Chats por departamentos')).toBeInTheDocument();
    expect(screen.getByText('Suporte Técnico')).toBeInTheDocument();
    expect(screen.getByText('Chats por atendentes')).toBeInTheDocument();
    expect(screen.getByText('Carlos Atendente')).toBeInTheDocument();
  });

  it('shows a "Não há dados" empty state for chat tables when there is no data, instead of fabricated rows', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 0,
        closedCount: 0,
        slaBreachedCount: 0,
        avgResolutionMinutes: null,
        byStatus: {},
        chatsByDepartment: [],
        chatsByAgent: [],
      },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('tab', { name: 'Chats' }));

    const deptCard = within(screen.getByTestId('card-chats-por-departamentos'));
    expect(deptCard.getByText('Não há dados')).toBeInTheDocument();
    const agentCard = within(screen.getByTestId('card-chats-por-atendentes'));
    expect(agentCard.getByText('Não há dados')).toBeInTheDocument();
    // None of the previously-hardcoded placeholder people should ever appear.
    expect(screen.queryByText('Alfredo Maia')).not.toBeInTheDocument();
    expect(screen.queryByText('Hermes Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Consultor DM')).not.toBeInTheDocument();
  });

  it('switches to Recurso tab and renders compromisso KPI rows (TiFlux shows counts, not an item list)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
        myAppointments: { total: 3, today: 1, week: 2, month: 5, items: [] },
        allAppointments: { total: 320, today: 4, week: 24, month: 147, items: [] },
      },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    renderDashboard();

    const recursoTab = await screen.findByRole('tab', { name: 'Recurso' });
    await user.click(recursoTab);

    const meus = within(screen.getByTestId('card-meus-compromissos'));
    expect(meus.getByText('3')).toBeInTheDocument();
    expect(meus.getByText('1')).toBeInTheDocument();
    expect(meus.getByText('2')).toBeInTheDocument();
    expect(meus.getByText('5')).toBeInTheDocument();

    const todos = within(screen.getByTestId('card-todos-os-compromissos'));
    expect(todos.getByText('320')).toBeInTheDocument();
    expect(todos.getByText('4')).toBeInTheDocument();
    expect(todos.getByText('24')).toBeInTheDocument();
    expect(todos.getByText('147')).toBeInTheDocument();
  });

  it('switches to Horas tab and renders Ontem/Hoje plus the weekly line chart and monthly totals', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
        monthlyHours: {
          targetHoursTotal: 160,
          loggedHoursTotal: 40,
          remainingHoursTotal: 120,
          days: [
            { day: 1, date: '2026-10-01', targetHours: 8, loggedHours: 6, remainingHours: 2 },
            { day: 2, date: '2026-10-02', targetHours: 8, loggedHours: 8, remainingHours: 0 },
          ],
        },
      },
    });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    renderDashboard();

    const horasTab = await screen.findByRole('tab', { name: 'Horas' });
    await user.click(horasTab);

    const horasCard = within(screen.getByTestId('card-minhas-horas-apontadas'));
    expect(horasCard.getByText('Ontem')).toBeInTheDocument();
    expect(horasCard.getByText('Hoje')).toBeInTheDocument();
    // DSH-12: the monthly totals use the same HH:MM clock as Ontem/Hoje.
    expect(horasCard.getByText('40:00')).toBeInTheDocument();
    expect(horasCard.getByText('120:00')).toBeInTheDocument();
    expect(horasCard.getByText('160:00')).toBeInTheDocument();
    expect(horasCard.getByRole('group', { name: /horas apontadas por dia/i })).toBeInTheDocument();
  });

  it('renders the 3-series Tickets nos últimos 30 dias line chart from real backend trend data', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        openCount: 2,
        closedCount: 5,
        slaBreachedCount: 0,
        avgResolutionMinutes: 45,
        byStatus: { OPEN: 2 },
        ticketsTrend30d: [
          { date: '2026-10-10', created: 3, closed: 1, cancelled: 0 },
          { date: '2026-10-11', created: 2, closed: 2, cancelled: 0 },
        ],
      },
    });
    renderDashboard();

    const trendCard = within(await screen.findByTestId('card-tickets-nos-ultimos-30-dias'));
    expect(trendCard.getByText('Tickets criados')).toBeInTheDocument();
    expect(trendCard.getByText('Tickets fechados')).toBeInTheDocument();
    expect(trendCard.getByText('Tickets cancelados')).toBeInTheDocument();
  });

  // ---- DMTE-529 ----

  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  const hex = (token: string) => {
    const match = css.match(new RegExp(`--color-${token}:\\s*#([0-9a-f]{6})`, 'i'));
    if (!match) throw new Error('token not found: ' + token);
    return match[1];
  };
  const luminance = (value: string) =>
    [0, 2, 4]
      .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  function fullSummary() {
    return {
      openCount: 5,
      closedCount: 12,
      slaBreachedCount: 2,
      avgResolutionMinutes: 125,
      byStatus: { OPEN: 3, IN_PROGRESS: 2 },
      ticketSummary: { total: 74, mine: 4, unattended: 11, inProgress: 73, paused: 9, overdue: 72 },
      responseDeadlines: { total: 21, today: 5, tomorrow: 6, later: 10 },
      solutionDeadlines: { total: 31, today: 7, tomorrow: 8, later: 16 },
      unansweredTickets: { total: 13, mine: 3 },
      csatGeneral30d: { avg: 4.5, count: 10, satisfactionRate: 90 },
      csatMine30d: { avg: 4.2, count: 5, satisfactionRate: 80 },
      recentNotifications: [{ id: 'n1', protocol: 'TK-1', title: 'Novo comentário' }],
      inProgressBreakdown: {
        byAssignee: [{ name: 'Joana', count: 5 }],
        byServiceDesk: [],
        byOrganization: [],
        byResource: [],
      },
      monthlyHours: {
        targetHoursTotal: 160,
        loggedHoursTotal: 40,
        remainingHoursTotal: 120,
        days: [{ day: 1, date: '2026-10-01', targetHours: 8, loggedHours: 6, remainingHours: 2 }],
      },
      ticketsTrend30d: [
        { date: '2026-10-10', created: 3, closed: 1, cancelled: 0 },
        { date: '2026-10-11', created: 2, closed: 2, cancelled: 0 },
      ],
      myChats: { inProgress: 1, waitingResponse: 2, avgWaitMinutes: 3, avgServiceMinutes: 18 },
      allChats: { inProgress: 2, waitingResponse: 1, avgWaitMinutes: 5, avgServiceMinutes: 20 },
      chatsByDepartment: [
        { department: 'Suporte', total: 5, inProgress: 3, waitingQueue: 1, waitingResponse: 1, avgWait: '4m', avgService: '18m' },
      ],
      chatsByAgent: [{ name: 'Carlos', status: 'online', inProgress: 2, group: 'N1' }],
      myAppointments: { total: 3, today: 1, week: 2, month: 5, items: [] },
      allAppointments: { total: 30, today: 4, week: 24, month: 147, items: [] },
    };
  }

  async function openTab(name: string) {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name }));
    return user;
  }

  /** The number element of a KPI: the sibling right after its label. */
  function kpiValue(scope: ReturnType<typeof within>, label: string) {
    return scope.getByText(label, { selector: 'span' }).parentElement?.children[1] as HTMLElement;
  }

  const alertIcon = 'svg.lucide-triangle-alert, svg.lucide-alert-triangle';

  it('AC-02: colors every Resumo and prazo KPI by its role and keeps the alert icon only on Vencidos and Hoje', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    const { container } = renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    const resumo = card('card-resumo-de-tickets');
    const expected: Record<string, string> = {
      Vencidos: 'text-red-600',
      'Não atendidos': 'text-yellow-800',
      'Em andamento': 'text-green-600',
      Pausados: 'text-gray-500',
      Todos: 'text-brand-600',
      Meus: 'text-brand-600',
    };
    for (const [label, token] of Object.entries(expected)) {
      expect(kpiValue(resumo, label), label).toHaveClass(token);
    }
    expect(kpiValue(resumo, 'Vencidos').querySelector(alertIcon)).not.toBeNull();

    for (const kind of ['Atendimento', 'Solução']) {
      const group = within(screen.getByRole('group', { name: kind }));
      expect(kpiValue(group, 'Hoje'), `${kind} Hoje`).toHaveClass('text-yellow-800');
      for (const label of ['Todos', 'Amanhã', 'Depois']) {
        expect(kpiValue(group, label), `${kind} ${label}`).toHaveClass('text-gray-500');
      }
      expect(kpiValue(group, 'Hoje').querySelector(alertIcon)).not.toBeNull();
      expect(kpiValue(group, 'Amanhã').querySelector(alertIcon)).toBeNull();
      expect(kpiValue(group, 'Depois').querySelector(alertIcon)).toBeNull();
    }
    // Vencidos + one Hoje per prazo row; nothing else on the tab warns.
    expect(container.querySelectorAll(alertIcon)).toHaveLength(3);
  });

  it('AC-03: every text color class on the four tabs reaches 4.5:1 on the white card', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    const { container } = renderDashboard();
    await screen.findByTestId('card-resumo-de-tickets');

    const used = new Set<string>();
    const collect = () => {
      for (const element of Array.from(container.querySelectorAll('*'))) {
        const hasOwnText = Array.from(element.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim());
        if (!hasOwnText) continue;
        const classes = element.getAttribute('class') ?? '';
        for (const match of classes.matchAll(/\b(?:text|fill)-([a-z]+-\d+)\b/g)) {
          used.add(match[1]);
        }
      }
    };
    collect();
    for (const tab of ['Chats', 'Recurso', 'Horas']) {
      await openTab(tab);
      collect();
    }

    expect(used.size).toBeGreaterThan(3);
    for (const token of used) {
      expect(css.includes(`--color-${token}:`), `${token} is not a DS token`).toBe(true);
      expect(contrast(token, 'gray-70'), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('AC-04: the pie shows at most 6 slices plus Outros, a full legend with number and percent, and no number inside tiny slices', async () => {
    const people = [
      ['Ana', 40], ['Bia', 30], ['Caio', 20], ['Duda', 10], ['Edu', 5], ['Fabi', 3], ['Gabi', 2], ['Hugo', 1], ['Iara', 1],
    ] as const;
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...fullSummary(),
        inProgressBreakdown: {
          byAssignee: people.map(([name, count]) => ({ name, count })),
          byServiceDesk: [],
          byOrganization: [],
          byResource: [],
        },
      },
    });
    renderDashboard();

    const pieCard = within(await screen.findByTestId('card-tickets-em-andamento'));
    // 112 tickets in total: 6 named slices (Ana..Fabi) + Outros (Gabi, Hugo, Iara = 4).
    for (const name of ['Ana', 'Bia', 'Caio', 'Duda', 'Edu', 'Fabi', 'Outros']) {
      expect(pieCard.getByText(name)).toBeInTheDocument();
    }
    for (const name of ['Gabi', 'Hugo', 'Iara']) expect(pieCard.queryByText(name)).not.toBeInTheDocument();
    expect(pieCard.getByText('Tickets 40 · 36%')).toBeInTheDocument();
    expect(pieCard.getByText('Tickets 4 · 4%')).toBeInTheDocument();

    const svg = pieCard.getByRole('img', { name: /tickets em andamento/i });
    expect(svg.querySelectorAll('path')).toHaveLength(7);
    // Under 4% of 112 (Fabi 3, Outros 4) a slice carries no number.
    const texts = Array.from(svg.querySelectorAll('text'));
    expect(texts.map((t) => t.textContent)).toEqual(['40', '30', '20', '10', '5']);

    // The number is readable on its own slice (4.5:1), whatever the slice color.
    const fillToken = (el: Element) =>
      el.getAttribute('class')?.match(/\bfill-((?:brand|gray|green|yellow|red|petroleum)-\d+|white)\b/)?.[1] ?? '';
    const asToken = (name: string) => (name === 'white' ? 'gray-70' : name);
    texts.forEach((text, index) => {
      const slice = fillToken(svg.querySelectorAll('path')[index]);
      expect(slice, `slice ${index}`).not.toBe('');
      expect(contrast(asToken(fillToken(text)), slice), `slice ${index}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('AC-04: the legend is not clipped by a fixed height', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    const pieCard = within(await screen.findByTestId('card-tickets-em-andamento'));
    const row = pieCard.getByText('Joana').closest('div[class*="flex"]') as HTMLElement;
    let node: HTMLElement | null = row;
    while (node && node.dataset.testid !== 'card-tickets-em-andamento') {
      expect(node.className, node.className).not.toMatch(/max-h-|overflow-y-/);
      node = node.parentElement;
    }
  });

  it('AC-08: the top strip leads with Vencidos linked to the overdue list and Sem resposta is read-only', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    const strip = card('card-resumo-de-tickets');
    const first = strip.getAllByRole('link')[0];
    expect(first).toHaveAccessibleName(/vencidos/i);
    expect(first).toHaveAttribute('href', '/tickets?overdue=true');
    expect(kpiValue(strip, 'Vencidos').className).toMatch(/text-\[(2[4-9]|3\d)px\]/);
    expect(kpiValue(strip, 'Sem resposta')).toHaveTextContent('13');
    expect(strip.queryByRole('link', { name: /sem resposta/i })).not.toBeInTheDocument();
  });

  it('AC-08: attendance and solution deadlines share one card with a 2x4 table and the old cards are gone', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await screen.findByTestId('card-prazos');
    const prazos = card('card-prazos');
    const atendimento = within(prazos.getByRole('group', { name: 'Atendimento' }));
    expect(kpiValue(atendimento, 'Todos')).toHaveTextContent('21');
    expect(kpiValue(atendimento, 'Hoje')).toHaveTextContent('5');
    expect(kpiValue(atendimento, 'Amanhã')).toHaveTextContent('6');
    expect(kpiValue(atendimento, 'Depois')).toHaveTextContent('10');
    const solucao = within(prazos.getByRole('group', { name: 'Solução' }));
    expect(kpiValue(solucao, 'Todos')).toHaveTextContent('31');
    expect(kpiValue(solucao, 'Hoje')).toHaveTextContent('7');
    expect(kpiValue(solucao, 'Amanhã')).toHaveTextContent('8');
    expect(kpiValue(solucao, 'Depois')).toHaveTextContent('16');

    expect(screen.queryByTestId('card-vencimento-de-atendimento')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-vencimento-de-solucao')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-tickets-sem-respostas')).not.toBeInTheDocument();
  });

  it('AC-09: no block appears in two tabs (Tickets has the 30-day chart and notifications, Horas only the hours)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    expect(screen.getByTestId('card-tickets-nos-ultimos-30-dias')).toBeInTheDocument();
    expect(screen.getByTestId('card-ultimas-notificacoes')).toBeInTheDocument();
    expect(screen.queryByTestId('card-minhas-horas-apontadas')).not.toBeInTheDocument();

    await openTab('Horas');
    expect(screen.getByTestId('card-minhas-horas-apontadas')).toBeInTheDocument();
    expect(screen.queryByTestId('card-tickets-nos-ultimos-30-dias')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-ultimas-notificacoes')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^card-/)).toHaveLength(1);
  });

  it('AC-10: the monthly totals are 13px, share the baseline of Ontem/Hoje and may wrap', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await openTab('Horas');
    const horas = card('card-minhas-horas-apontadas');
    for (const label of ['Apontadas', 'Faltantes', 'Meta']) {
      const total = horas.getByText(label).parentElement as HTMLElement;
      expect(total, label).toHaveClass('text-[13px]');
      expect(total.parentElement, label).toHaveClass('items-baseline', 'flex-wrap');
    }
    const ontem = horas.getByText('Ontem').parentElement as HTMLElement;
    expect(ontem.parentElement).toHaveClass('items-baseline', 'flex-wrap');
    expect(horas.getByText('40:00')).toBeInTheDocument();
  });

  it('AC-11: read-only KPIs have no link, hover or pointer cursor; linked KPIs share the focus ring of the Ações button', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await screen.findByTestId('card-prazos');
    const readOnly = [
      kpiValue(within(screen.getByRole('group', { name: 'Atendimento' })), 'Hoje'),
      kpiValue(within(screen.getByRole('group', { name: 'Solução' })), 'Depois'),
      kpiValue(card('card-resumo-de-tickets'), 'Sem resposta'),
    ];
    for (const value of readOnly) {
      const item = value.parentElement as HTMLElement;
      expect(item.closest('a')).toBeNull();
      expect(item.className).not.toMatch(/hover:|cursor-pointer/);
    }

    const ring = screen
      .getByRole('button', { name: /ações/i })
      .className.split(/\s+/)
      .filter((c) => c.startsWith('ez-focus'));
    expect(ring.length).toBeGreaterThan(0);
    for (const link of card('card-resumo-de-tickets').getAllByRole('link')) {
      for (const cls of ring) expect(link.className, link.textContent ?? '').toContain(cls);
    }
  });

  it('AC-12: the Chats tables do not show a sort icon they do not honor', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await openTab('Chats');
    expect(screen.getByRole('table', { name: /chats por departamentos/i })).toBeInTheDocument();
    expect(document.querySelector('svg.lucide-arrow-up-down')).toBeNull();
  });

  it('AC-13: shows the agent status in Portuguese in the Chats table', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...fullSummary(),
        chatsByAgent: [
          { name: 'A1', status: 'online', inProgress: 1, group: 'N1' },
          { name: 'A2', status: 'busy', inProgress: 1, group: 'N1' },
          { name: 'A3', status: 'away', inProgress: 1, group: 'N1' },
          { name: 'A4', status: 'offline', inProgress: 1, group: 'N1' },
        ],
      },
    });
    renderDashboard();

    await openTab('Chats');
    const agents = within(screen.getByTestId('card-chats-por-atendentes'));
    for (const label of ['Online', 'Ocupado', 'Ausente', 'Offline']) {
      expect(agents.getByText(label)).toBeInTheDocument();
    }
    expect(agents.queryByText('busy')).not.toBeInTheDocument();
  });

  // ---- F3-16 (#452): DSH-01, 03, 07, 09, 10, 11, 12 ----

  it('DSH-01: a failed summary request shows an alert with the cause and hides the tabs', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network Error'));
    renderDashboard();

    await screen.findByText(/falha ao carregar as métricas/i);
    const alert = screen.queryByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/não carregaram/i);
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('DSH-01: "Tentar novamente" requests the summary again and brings the dashboard back', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ data: fullSummary() });
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText(/falha ao carregar as métricas/i);
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));

    expect(await screen.findByTestId('card-resumo-de-tickets')).toBeInTheDocument();
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('DSH-03: the pie is named with every category, its count and percent, and same-initial rows get distinct markers', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...fullSummary(),
        inProgressBreakdown: {
          byAssignee: [{ name: 'Ana', count: 5 }, { name: 'Alice', count: 3 }, { name: 'Bia', count: 2 }],
          byServiceDesk: [],
          byOrganization: [],
          byResource: [],
        },
      },
    });
    renderDashboard();

    const pieCard = within(await screen.findByTestId('card-tickets-em-andamento'));
    const svg = pieCard.getByRole('img', { name: /tickets em andamento/i });
    const name = svg.getAttribute('aria-label') ?? '';
    expect(name).toContain('Ana 5 (50%)');
    expect(name).toContain('Alice 3 (30%)');
    expect(name).toContain('Bia 2 (20%)');

    const marker = (label: string) => (pieCard.getByText(label).closest('div[class*="flex"]') as HTMLElement).firstElementChild?.textContent;
    const markers = ['Ana', 'Alice', 'Bia'].map(marker);
    expect(new Set(markers).size).toBe(3);
    expect(markers).not.toContain('A');
  });

  it('DSH-07: KPI labels are 13px gray-600 and the "Ausente" dot and the empty icon reach 3:1', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...fullSummary(),
        chatsByDepartment: [],
        chatsByAgent: [{ name: 'A3', status: 'away', inProgress: 1, group: 'N1' }],
      },
    });
    renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    const label = card('card-resumo-de-tickets').getByText('Vencidos', { selector: 'span' });
    expect(label).toHaveClass('text-[13px]', 'text-gray-600');

    await openTab('Chats');
    const dot = within(screen.getByTestId('card-chats-por-atendentes')).getByText('Ausente').previousElementSibling as HTMLElement;
    const dotToken = dot.className.match(/\bbg-(gray-\d+)\b/)?.[1] ?? '';
    expect(dotToken).not.toBe('');
    expect(contrast(dotToken, 'gray-70')).toBeGreaterThanOrEqual(3);

    const icon = within(screen.getByTestId('card-chats-por-departamentos')).getByText('Não há dados').previousElementSibling as Element;
    const iconToken = icon.getAttribute('class')?.match(/\btext-(gray-\d+)\b/)?.[1] ?? '';
    expect(iconToken).not.toBe('');
    expect(contrast(iconToken, 'gray-70')).toBeGreaterThanOrEqual(3);
  });

  it('DSH-09: each tab row owns a tabpanel named by its active tab and the tab points at it', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
    renderDashboard();

    await screen.findByTestId('card-resumo-de-tickets');
    const main = screen.queryByRole('tabpanel', { name: 'Tickets' });
    expect(main).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tickets' })).toHaveAttribute('aria-controls', main?.id);

    const pie = screen.queryByRole('tabpanel', { name: 'Por responsável' });
    expect(pie).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Por responsável' })).toHaveAttribute('aria-controls', pie?.id);
    expect(pie?.id).not.toBe(main?.id);

    await openTab('Chats');
    const chats = screen.queryByRole('tabpanel', { name: 'Chats' });
    expect(chats).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-controls', chats?.id);
  });

  describe('DSH-10 headings and greeting', () => {
    beforeEach(() => {
      useAuthStore.setState({ token: null, user: null });
    });
    afterEach(() => {
      useAuthStore.setState({ token: null, user: null });
    });

    it('the h1 is the page title "Painel", the greeting is a paragraph and card titles are h2', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
      renderDashboard();

      await screen.findByTestId('card-resumo-de-tickets');
      expect(screen.queryByRole('heading', { level: 1, name: 'Painel' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /bom te ver/i })).not.toBeInTheDocument();
      expect(screen.getByText(/bom te ver de volta/i).tagName).toBe('P');
      expect(card('card-prazos').queryByRole('heading', { level: 2, name: 'Prazos' })).toBeInTheDocument();
      expect(card('card-tickets-em-andamento').queryByRole('heading', { level: 2, name: 'Tickets em andamento' })).toBeInTheDocument();
    });

    it('greets by the user name when the token carries one', async () => {
      useAuthStore.setState({ user: { sub: 'u1', email: 'joao.silva@aponta.com', role: 'AGENT', name: 'João da Silva' } });
      vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
      renderDashboard();

      expect(await screen.findByText('Bom te ver de volta, João da Silva')).toBeInTheDocument();
    });

    it('falls back to the e-mail prefix when there is no name', async () => {
      useAuthStore.setState({ user: { sub: 'u1', email: 'joao.silva@aponta.com', role: 'AGENT' } });
      vi.mocked(api.get).mockResolvedValue({ data: fullSummary() });
      renderDashboard();

      expect(await screen.findByText('Bom te ver de volta, Joao.silva')).toBeInTheDocument();
    });
  });

  it('DSH-11: the Recurso rating cards show the big average and the satisfied percent, and never "undefined"', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { ...fullSummary(), csatMine30d: { avg: null, count: 3, satisfactionRate: null } },
    });
    renderDashboard();

    await openTab('Recurso');
    const geral = card('card-avaliacao-geral-de-tickets-30-dias');
    expect(geral.queryByText('4.5')).toBeInTheDocument();
    expect(geral.queryByText(/90% satisfeitos/)).toBeInTheDocument();
    const minhas = card('card-avaliacao-dos-meus-tickets-30-dias');
    expect(minhas.queryByText('—')).toBeInTheDocument();
    expect(minhas.queryByText(/% satisfeitos/)).toBeInTheDocument();
    expect(minhas.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(minhas.queryByText(/de média em/)).not.toBeInTheDocument();
  });

  it('DSH-12: the monthly totals read as HH:MM and a progress bar shows logged versus target', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...fullSummary(),
        monthlyHours: { targetHoursTotal: 160, loggedHoursTotal: 7.5, remainingHoursTotal: 152.5, days: [] },
      },
    });
    renderDashboard();

    await openTab('Horas');
    const horas = card('card-minhas-horas-apontadas');
    expect(horas.getByText('Apontadas').parentElement).toHaveTextContent('07:30');
    expect(horas.getByText('Faltantes').parentElement).toHaveTextContent('152:30');
    expect(horas.getByText('Meta').parentElement).toHaveTextContent('160:00');
    const bar = horas.queryByRole('progressbar');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '5');
    expect(horas.queryByText(/\dH\b/)).not.toBeInTheDocument();
  });
});
