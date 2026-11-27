import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { SchedulePage } from './SchedulePage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const now = new Date();
const mockAppointments = [
  {
    id: 'app-1',
    title: 'Alinhamento Semanal',
    description: 'Sprint Review',
    startTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString(),
    endTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0, 0).toISOString(),
    type: 'AGENDA',
    userId: 'agent-1',
    user: { id: 'agent-1', name: 'Agente Silva', email: 'silva@aponta.com' },
    organizationId: 'org-1',
    organization: { id: 'org-1', name: 'Acme Corp' },
    ticketId: null,
    ticket: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route path="/schedule" element={<SchedulePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginAs(role: 'ADMIN' | 'AGENT' | 'CLIENT_MASTER' | 'CLIENT') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'user@aponta.com', role },
  });
}

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
  });

  it('renders the header and navigation controls', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(screen.queryByText('Agenda & Alocação')).not.toBeInTheDocument();
    expect(screen.getByText('Hoje')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /novo agendamento/i })).toBeInTheDocument();
  });

  it('renders appointments list on the current week', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
    loginAs('AGENT');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alinhamento Semanal')).toBeInTheDocument();
      expect(screen.getAllByText('Agente Silva').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getAllByText('Agenda').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('opens create modal when clicking "Novo Agendamento"', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    const newBtn = screen.getByRole('button', { name: /novo agendamento/i });
    await user.click(newBtn);

    expect(screen.getAllByText('Novo Agendamento').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText(/ex: reunião com cliente/i)).toBeInTheDocument();
  });

  it('filtra por tipo pelo painel de checkboxes, sem seletor oculto', async () => {
    const user = userEvent.setup();
    const vacation = { ...mockAppointments[0], id: 'app-2', title: 'Férias de Verão', type: 'VACATION' };
    vi.mocked(api.get).mockResolvedValue({ data: [...mockAppointments, vacation] });
    loginAs('ADMIN');
    renderPage();

    expect(await screen.findByText('Férias de Verão')).toBeInTheDocument();
    expect(screen.getByText('Alinhamento Semanal')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Férias' }));

    await waitFor(() => expect(screen.queryByText('Férias de Verão')).not.toBeInTheDocument());
    expect(screen.getByText('Alinhamento Semanal')).toBeInTheDocument();
    expect(screen.queryAllByLabelText('Filtrar por tipo')).toHaveLength(0);
  });

  it('SCH-03: filtro de atendente do ADMIN é um select rotulado, sem campo de UUID', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') {
        return { data: [{ id: 'agent-9', name: 'Maria Souza', email: 'maria@aponta.com' }] };
      }
      return { data: [] };
    });
    loginAs('ADMIN');
    renderPage();

    const combo = await screen.findByRole('combobox', { name: 'Atendente' });
    expect(screen.queryByPlaceholderText(/filtrar id do técnico/i)).not.toBeInTheDocument();

    await user.click(combo);
    await user.click(await screen.findByRole('option', { name: 'Maria Souza' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/appointments',
        expect.objectContaining({ params: expect.objectContaining({ userId: 'agent-9' }) }),
      ),
    );
  });

  it('does not show technician filter for standard AGENT', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    expect(screen.queryByPlaceholderText(/filtrar id do técnico/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Atendente' })).not.toBeInTheDocument();
  });

  it('switches to Dia view and shows a single-day grid', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
    loginAs('AGENT');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Dia' }));

    await waitFor(() => {
      expect(screen.getByText('Alinhamento Semanal')).toBeInTheDocument();
      // Dia view's header title is a single full date (e.g. "Terça-feira, 13 de ...")
      // instead of the week range title ("11 – 17 de outubro de 2026") shown in Semana.
      expect(screen.getByText(/^[A-ZÀ-Ú][a-zà-ú-]+, \d{2} de /)).toBeInTheDocument();
    });
  });

  it('switches to Mês view and shows the month grid with appointment chips', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
    loginAs('AGENT');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Mês' }));

    await waitFor(() => {
      expect(screen.getByText('DOM')).toBeInTheDocument();
      expect(screen.getByText('SÁB')).toBeInTheDocument();
      expect(screen.getByText('Alinhamento Semanal')).toBeInTheDocument();
    });
  });

  it('switches to Lista view and shows a chronological list of appointments', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
    loginAs('AGENT');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Lista' }));

    await waitFor(() => {
      expect(screen.getByText('Alinhamento Semanal')).toBeInTheDocument();
      expect(screen.getAllByText('Agente Silva').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows an empty state in Lista view when there are no appointments', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Lista' }));

    expect(screen.getByText(/nenhum compromisso no período selecionado/i)).toBeInTheDocument();
  });

  it('SCH-15: o estado vazio da Lista oferece Novo agendamento para AGENT e ADMIN e abre o modal de criação', async () => {
    for (const role of ['AGENT', 'ADMIN'] as const) {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs(role);
      const view = renderPage();
      await user.click(screen.getByRole('button', { name: 'Lista' }));
      await screen.findByText(/nenhum compromisso no período selecionado/i, {}, { timeout: 5000 });
      // O botão do cabeçalho mais o do estado vazio (último na ordem do documento).
      const buttons = screen.getAllByRole('button', { name: /novo agendamento/i });
      expect(buttons).toHaveLength(2);
      await user.click(buttons[1]);
      expect(await screen.findByPlaceholderText(/ex: reunião com cliente/i, {}, { timeout: 5000 })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('SCH-15: o estado vazio da Lista não oferece Novo agendamento para CLIENT e usa texto legível', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('CLIENT');
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const text = await screen.findByText(/nenhum compromisso no período selecionado/i, {}, { timeout: 5000 });
    expect(screen.queryAllByRole('button', { name: /novo agendamento/i })).toHaveLength(0);
    expect(text.className).not.toContain('text-gray-400');
  });

  it('navigates to the previous and next week, and back to today', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    await user.click(screen.getByText('Hoje'));

    expect(api.get).toHaveBeenCalled();
  });

  describe('controles inertes (SCH-02)', () => {
    it('não exibe o card Agendas com nome de empresa fixo nem lápis sem ação', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      expect(screen.queryByText('DM Tech')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Agendas')).not.toBeInTheDocument();
      expect(document.querySelector('svg.lucide-pencil')).toBeNull();
    });
  });

  describe('falha e carregamento (SCH-04)', () => {
    it('mostra alerta com Tentar novamente quando a consulta falha e refaz a busca', async () => {
      const user = userEvent.setup();
      let appointmentCalls = 0;
      vi.mocked(api.get).mockImplementation(async (url: string) => {
        if (url === '/appointments') {
          appointmentCalls += 1;
          if (appointmentCalls === 1) throw new Error('500');
        }
        return { data: [] };
      });
      loginAs('AGENT');
      renderPage();

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /adicionar compromisso às/i })).toHaveLength(0);

      await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      expect(appointmentCalls).toBe(2);
    });

    it('rotula o indicador de carregamento como Carregando agenda', () => {
      vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
      loginAs('AGENT');
      renderPage();

      expect(screen.getByRole('status', { name: 'Carregando agenda' })).toBeInTheDocument();
    });
  });

  describe('marcador da hora atual (SCH-13)', () => {
    it('esconde o triângulo dos leitores de tela e não usa vermelho de erro', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      const marker = await screen.findByText('▶');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(document.querySelector('[class*="red-"]')).toBeNull();
    });
  });

  describe('cores por token (SCH-05)', () => {
    it('pinta o cartão pelo tipo com token do DS, sem hex inline', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
      loginAs('AGENT');
      renderPage();

      const card = await screen.findByRole('button', { name: /alinhamento semanal/i });
      expect(card.style.backgroundColor).toBe('');
      expect(card.className).toMatch(/\bbg-petroleum-500\b/);
      expect(document.querySelector('[class*="bg-[#"]')).toBeNull();
    });
  });

  describe('ações e criação (SCH-06)', () => {
    it('Ações é um menu acessível que fecha com Esc e não duplica Nova Agenda', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      const trigger = screen.getByRole('button', { name: /ações/i });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /novas férias/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /nova ausência/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /nova agenda/i })).not.toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('Novo Agendamento não carrega o verde fixo de outra marca', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      expect(screen.getByRole('button', { name: /novo agendamento/i }).className).not.toMatch(/00a884/i);
    });
  });

  describe('navegação e alternador de vista (SCH-07)', () => {
    it('rotula anterior/próximo conforme a vista e marca a vista ativa com aria-pressed', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Dia' }));
      expect(screen.getByRole('button', { name: 'Dia anterior' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Próximo dia' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('group', { name: /vista/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Mês' }));
      expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeInTheDocument();
    });
  });

  describe('perfis e RBAC na UI (SCH-03, SCH-06)', () => {
    it.each(['ADMIN', 'AGENT', 'CLIENT_MASTER'] as const)(
      '%s vê "Novo Agendamento" e o menu "Ações"',
      (role) => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        loginAs(role);
        renderPage();

        expect(screen.getByRole('button', { name: /novo agendamento/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ações/i })).toBeInTheDocument();
      },
    );

    it('CLIENT não vê "Novo Agendamento" nem o menu "Ações"', () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('CLIENT');
      renderPage();

      expect(screen.queryByRole('button', { name: /novo agendamento/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ações/i })).not.toBeInTheDocument();
    });

    it.each(['AGENT', 'CLIENT', 'CLIENT_MASTER'] as const)(
      '%s nunca consulta /users/agents',
      async (role) => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        loginAs(role);
        renderPage();

        await waitFor(() => expect(api.get).toHaveBeenCalledWith('/appointments', expect.anything()));
        expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).not.toContain('/users/agents');
      },
    );

    it('ADMIN consulta /users/agents para o filtro de atendente', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('ADMIN');
      renderPage();

      await waitFor(() =>
        expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).toContain('/users/agents'),
      );
    });
  });

  describe('operação por teclado (SCH-01)', () => {
    async function tabUntilFocused(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
      for (let i = 0; i < 60 && document.activeElement !== el; i += 1) {
        await user.tab();
      }
      expect(el).toHaveFocus();
    }

    it('abre o detalhe pelo teclado no cartão de compromisso da vista Semana', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
      loginAs('AGENT');
      renderPage();

      const card = await screen.findByRole('button', { name: /alinhamento semanal/i });
      await tabUntilFocused(user, card);
      await user.keyboard('{Enter}');

      expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    });

    it('abre o detalhe com Espaço no cartão da vista Dia', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
      loginAs('AGENT');
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Dia' }));
      const card = await screen.findByRole('button', { name: /alinhamento semanal/i });
      await tabUntilFocused(user, card);
      await user.keyboard(' ');

      expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    });

    it('cria compromisso pela célula de hora com Enter', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      const slots = await screen.findAllByRole('button', { name: /adicionar compromisso às/i });
      await tabUntilFocused(user, slots.find((s) => s.tabIndex === 0) as HTMLElement);
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toHaveAccessibleName(/adicionar compromisso às 09:00/i);
      await user.keyboard('{Enter}');

      expect(await screen.findByPlaceholderText(/ex: reunião com cliente/i)).toBeInTheDocument();
    });

    it('mantém um único ponto de Tab entre as células de hora e navega com setas', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      const slots = await screen.findAllByRole('button', { name: /adicionar compromisso às/i });
      expect(slots.length).toBe(7 * 24);
      const tabStops = slots.filter((s) => s.tabIndex === 0);
      expect(tabStops).toHaveLength(1);

      await tabUntilFocused(user, tabStops[0]);
      const before = tabStops[0].getAttribute('aria-label');
      await user.keyboard('{ArrowDown}');

      const after = document.activeElement as HTMLElement;
      expect(after).not.toBe(tabStops[0]);
      expect(after.getAttribute('aria-label')).not.toBe(before);
      expect(after.tabIndex).toBe(0);
      expect(tabStops[0].tabIndex).toBe(-1);
    });

    it('não oferece células de hora operáveis para perfil sem permissão de criar', async () => {
      // aguarda a grade renderizar antes de afirmar a ausência
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('CLIENT');
      renderPage();

      expect(screen.queryAllByRole('button', { name: /adicionar compromisso às/i })).toHaveLength(0);
    });

    it('abre o dia pelo teclado no botão do número do dia da vista Mês', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: mockAppointments });
      loginAs('AGENT');
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Mês' }));
      const todayLabel = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
      const dayButton = await screen.findByRole('button', { name: new RegExp(`abrir dia ${todayLabel}`, 'i') });
      await tabUntilFocused(user, dayButton);
      await user.keyboard('{Enter}');

      expect(
        await screen.findAllByRole('button', { name: /adicionar compromisso às 09:00/i }),
      ).toHaveLength(1);
    });
  });
  describe('vista Mês: dia, excedente e alvos (SCH-10)', () => {
    const sameDay = (title: string, hour: number, n: number) => ({
      ...mockAppointments[0],
      id: `app-${n}`,
      title,
      startTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0).toISOString(),
      endTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 30, 0).toISOString(),
    });
    const fiveToday = [8, 9, 10, 11, 12].map((h, i) => sameDay(`Compromisso ${i + 1}`, h, i + 1));

    it('"+N mais" é botão que abre o dia na vista Dia', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: fiveToday });
      loginAs('AGENT');
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Mês' }));
      await screen.findByText('Compromisso 1', {}, { timeout: 5000 });
      const more = screen.queryByRole('button', { name: /\+2 mais/i });
      expect(more).toBeInTheDocument();
      await user.click(more as HTMLElement);

      await waitFor(
        () => expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true'),
        { timeout: 5000 },
      );
      const full = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
      expect(screen.getByText(new RegExp(`^${full.split(',')[0]}`, 'i'))).toBeInTheDocument();
    });

    it('chips de compromisso têm altura mínima de 24 px', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: fiveToday });
      loginAs('AGENT');
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Mês' }));
      await screen.findByText('Compromisso 1', {}, { timeout: 5000 });
      expect(screen.getByRole('button', { name: 'Compromisso 1' })).toHaveClass('min-h-6');
    });

    it('cada célula do dia tem rótulo com a data completa e a quantidade de compromissos', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: fiveToday });
      loginAs('AGENT');
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Mês' }));
      const full = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      await screen.findByText('Compromisso 1', {}, { timeout: 5000 });
      expect(screen.queryByRole('group', { name: `${full}, 5 compromissos` })).toBeInTheDocument();
    });
  });

  describe('tela estreita (SCH-08)', () => {
    const originalMatchMedia = window.matchMedia;
    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string) => ({
          matches: query.includes('max-width'),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
    });
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    });

    it('abre na vista Dia', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('esconde os filtros por padrão e os revela no botão Filtros', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      const toggle = screen.queryByRole('button', { name: /^filtros$/i }) as HTMLElement;
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('checkbox', { name: /agenda/i })).not.toBeInTheDocument();

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    });
  });

  it('em tela larga abre na vista Semana, com filtros visíveis e sem botão Filtros', () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /^filtros$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });
});

describe('SchedulePage: rolagem, filtros e estados (P3-E)', () => {
  const scrollTopOf = new WeakMap<Element, number>();
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    // jsdom não faz layout: registra o scrollTop atribuído a cada elemento.
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopOf.get(this) ?? 0;
      },
      set(value: number) {
        scrollTopOf.set(this, value);
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (original) Object.defineProperty(Element.prototype, 'scrollTop', original);
  });

  const timeGrid = () => document.querySelector('[class~="overflow-y-auto"][class~="max-h-[640px]"]') as HTMLElement;

  it('SCH-11: a rolagem inicial do grid é 06:00, mesmo quando a agenda carrega depois do primeiro render', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();
    await waitFor(() => expect(timeGrid()).not.toBeNull(), { timeout: 5000 });
    expect(timeGrid().scrollTop).toBe(6 * 56);
  });

  it('SCH-11: ao clicar em Hoje às 15:00 o grid rola até a hora atual menos uma folga, além das 06:00', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 12, 15, 0, 0) });
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();
    await waitFor(() => expect(timeGrid()).not.toBeNull(), { timeout: 5000 });
    const grid = timeGrid();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hoje' }));

    expect(grid.scrollTop).toBeGreaterThan(6 * 56);
    expect(grid.scrollTop).toBeLessThanOrEqual(15 * 56);
  });

  it('SCH-12: "Filtrar" fica indeterminado quando só parte dos tipos está marcada', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('ADMIN');
    renderPage();
    const filtrar = screen.getByLabelText('Filtrar') as HTMLInputElement;
    expect(filtrar.indeterminate).toBe(false);

    await userEvent.setup().click(screen.getByLabelText('Férias'));

    expect(filtrar.indeterminate).toBe(true);
    expect(filtrar.checked).toBe(false);
  });

  it('SCH-12: "Atendentes" fica indeterminado quando só parte dos atendentes está marcada', async () => {
    const other = {
      ...mockAppointments[0],
      id: 'app-9',
      title: 'Reunião da Bia',
      userId: 'agent-2',
      user: { id: 'agent-2', name: 'Bia Souza', email: 'bia@aponta.com' },
    };
    vi.mocked(api.get).mockResolvedValue({ data: [...mockAppointments, other] });
    loginAs('AGENT');
    renderPage();
    const atendentes = screen.getByLabelText('Atendentes') as HTMLInputElement;
    expect(await screen.findByLabelText('Bia Souza', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(atendentes.indeterminate).toBe(false);

    await userEvent.setup().click(screen.getByLabelText('Bia Souza'));

    await waitFor(() => expect(atendentes.indeterminate).toBe(true), { timeout: 5000 });
  });
});
