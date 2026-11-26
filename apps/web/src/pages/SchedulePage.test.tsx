import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    expect(screen.getByText('Agenda & Alocação')).toBeInTheDocument();
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
});
