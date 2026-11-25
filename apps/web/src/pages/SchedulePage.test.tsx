import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('filters appointments when changing type filter', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('ADMIN');
    renderPage();

    const select = screen.getByLabelText(/filtrar por tipo/i, { selector: 'select' });
    await user.selectOptions(select, 'VACATION');

    expect(api.get).toHaveBeenCalledWith(
      '/appointments',
      expect.objectContaining({
        params: expect.objectContaining({ type: 'VACATION' }),
      }),
    );
  });

  it('shows technician input filter only for ADMIN', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('ADMIN');
    renderPage();

    expect(screen.getByPlaceholderText(/filtrar id do técnico/i)).toBeInTheDocument();
  });

  it('does not show technician input filter for standard AGENT', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('AGENT');
    renderPage();

    expect(screen.queryByPlaceholderText(/filtrar id do técnico/i)).not.toBeInTheDocument();
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

    await user.click(screen.getByTitle('Semana anterior'));
    await user.click(screen.getByTitle('Próxima semana'));
    await user.click(screen.getByText('Hoje'));

    expect(api.get).toHaveBeenCalled();
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

      const slots = screen.getAllByRole('button', { name: /adicionar compromisso às 09:00/i });
      const slot = slots.find((s) => s.tabIndex === 0) ?? slots[0];
      await tabUntilFocused(user, slot);
      await user.keyboard('{Enter}');

      expect(await screen.findByPlaceholderText(/ex: reunião com cliente/i)).toBeInTheDocument();
    });

    it('mantém um único ponto de Tab entre as células de hora e navega com setas', async () => {
      const user = userEvent.setup();
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      loginAs('AGENT');
      renderPage();

      const slots = screen.getAllByRole('button', { name: /adicionar compromisso às/i });
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
