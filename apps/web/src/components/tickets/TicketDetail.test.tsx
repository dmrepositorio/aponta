import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import type { Ticket } from '../../hooks/useTickets';
import { useAuthStore } from '../../stores/authStore';
import { TicketDetail } from './TicketDetail';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const ticket = {
  id: 't-1',
  protocol: 'AP-000001',
  title: 'Impressora parada',
  description: 'Descrição simples.',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  requesterId: 'u-1',
  agentId: 'agent-1',
  serviceDeskId: 'sd-1',
  responseDeadline: '2026-09-30T14:00:00.000Z',
  resolveDeadline: '2026-10-02T17:30:00.000Z',
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
} as unknown as Ticket;

const agents = [
  { id: 'agent-1', name: 'Agent Smith' },
  { id: 'agent-2', name: 'Agent Jones' },
];

const audits = [
  {
    id: 'a-1',
    action: 'STATUS_CHANGED',
    prevVal: 'OPEN',
    newVal: 'IN_PROGRESS',
    createdAt: '2026-09-30T14:00:00.000Z',
    user: { name: 'Agent Smith' },
  },
];

function mockGets() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/users/agents') return Promise.resolve({ data: agents });
    if (url === '/tickets/t-1/audits') return Promise.resolve({ data: audits });
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(current: Ticket = ticket) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TicketDetail ticket={current} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const withStatus = (status: string, allowedStatuses?: string[]) =>
  ({ ...ticket, status, allowedStatuses }) as unknown as Ticket;

const statusSelect = () => screen.getByLabelText('Status', { selector: 'select' }) as HTMLSelectElement;
const optionNames = () => Array.from(statusSelect().options).map((option) => option.text);

describe('TicketDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGets();
    useAuthStore.setState({
      token: 'fake.jwt.token',
      user: { sub: 'u-1', email: 'agent@example.com', role: 'AGENT' },
    });
  });

  it('GH-446 DET-08: falha ao atribuir mostra alerta de erro', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Request failed'));
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('option', { name: 'Agent Jones', hidden: true });
    await user.selectOptions(screen.getByLabelText('Atribuído a:', { selector: 'select' }), 'agent-2');

    expect(api.patch).toHaveBeenCalledWith('/tickets/t-1/assign', { agentId: 'agent-2' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível atribuir/i);
  });

  it('GH-446 DET-08: atribuição bem-sucedida avisa "Chamado atribuído a <nome>" e não mostra erro', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: ticket });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('option', { name: 'Agent Jones', hidden: true });
    await user.selectOptions(screen.getByLabelText('Atribuído a:', { selector: 'select' }), 'agent-2');

    expect(await screen.findByText('Chamado atribuído a Agent Jones')).toBeInTheDocument();
    expect(screen.queryByText(/não foi possível atribuir/i)).not.toBeInTheDocument();
  });

  it('GH-446 DET-02: histórico mostra a data em dd/mm/aaaa HH:mm no fuso de Brasília, sem UTC', async () => {
    renderDetail();

    await waitFor(() => expect(screen.getAllByText(/Agent Smith/).length).toBeGreaterThan(0));
    expect(await screen.findByText(/30\/09\/2026 11:00/, { selector: 'li span' })).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });

  it('GH-446 DET-02: os prazos de resposta e resolução usam o mesmo formato e fuso', async () => {
    renderDetail();

    expect(await screen.findByText('30/09/2026 11:00', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('02/10/2026 14:30', { selector: 'dd' })).toBeInTheDocument();
  });

  describe('GH-494 DET-07: seletor de status', () => {
    it('com status OPEN lista só o atual e as transições da API (sem Resolvido)', async () => {
      renderDetail(withStatus('OPEN', ['IN_PROGRESS', 'ESCALATED']));

      await waitFor(() => expect(optionNames()).toEqual(['Aberto', 'Em Andamento', 'Escalonado']), { timeout: 5000 });
      expect(statusSelect().value).toBe('OPEN');
    });

    it('sem allowedStatuses na resposta (API antiga) cai para a lista completa de 9 status', async () => {
      renderDetail(withStatus('OPEN'));

      await waitFor(() => expect(optionNames()).toHaveLength(9), { timeout: 5000 });
      expect(optionNames()).toContain('Resolvido');
      expect(statusSelect().value).toBe('OPEN');
    });

    it('allowedStatuses vazio (ex.: Fechado) deixa só o status atual', async () => {
      renderDetail(withStatus('CLOSED', []));

      await waitFor(() => expect(optionNames()).toEqual(['Fechado']), { timeout: 5000 });
    });

    it('status comum envia o PATCH na hora e avisa com toast, sem diálogo', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: ticket });
      const user = userEvent.setup();
      renderDetail(withStatus('OPEN', ['IN_PROGRESS', 'ESCALATED']));

      await user.selectOptions(statusSelect(), 'IN_PROGRESS');

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/tickets/t-1/status', { status: 'IN_PROGRESS' }), { timeout: 5000 });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText('Status alterado para Em Andamento', undefined, { timeout: 5000 })).toBeInTheDocument();
    });

    it.each([
      ['RESOLVED', 'Resolvido', 'IN_PROGRESS', ['RESOLVED', 'ESCALATED']],
      ['CLOSED', 'Fechado', 'RESOLVED', ['CLOSED', 'IN_PROGRESS']],
    ])('escolher %s pede confirmação e só envia o PATCH ao confirmar', async (target, label, from, allowed) => {
      vi.mocked(api.patch).mockResolvedValue({ data: ticket });
      const user = userEvent.setup();
      renderDetail(withStatus(from, allowed));

      await user.selectOptions(statusSelect(), target);

      const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
      expect(dialog).toHaveTextContent('Confirmar mudança de status');
      expect(dialog).toHaveTextContent(label);
      expect(api.patch).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/tickets/t-1/status', { status: target }), { timeout: 5000 });
      expect(await screen.findByText(`Status alterado para ${label}`, undefined, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('cancelar a confirmação não envia PATCH, não mostra toast e mantém o status atual', async () => {
      const user = userEvent.setup();
      renderDetail(withStatus('IN_PROGRESS', ['RESOLVED']));

      await user.selectOptions(statusSelect(), 'RESOLVED');
      await screen.findByRole('dialog', undefined, { timeout: 5000 });
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
      expect(screen.queryByText(/Status alterado para/)).not.toBeInTheDocument();
      expect(statusSelect().value).toBe('IN_PROGRESS');
    });

    it('falha da API mostra o alerta de erro e nenhum toast de sucesso', async () => {
      vi.mocked(api.patch).mockRejectedValue(new Error('Request failed'));
      const user = userEvent.setup();
      renderDetail(withStatus('OPEN', ['IN_PROGRESS']));

      await user.selectOptions(statusSelect(), 'IN_PROGRESS');

      expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent(/não foi possível alterar o status/i);
      expect(screen.queryByText(/Status alterado para/)).not.toBeInTheDocument();
    });

    it('falha ao confirmar Resolvido fecha o diálogo e mostra o alerta de erro', async () => {
      vi.mocked(api.patch).mockRejectedValue(new Error('Request failed'));
      const user = userEvent.setup();
      renderDetail(withStatus('IN_PROGRESS', ['RESOLVED']));

      await user.selectOptions(statusSelect(), 'RESOLVED');
      await screen.findByRole('dialog', undefined, { timeout: 5000 });
      await user.click(screen.getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent(/não foi possível alterar o status/i);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText(/Status alterado para/)).not.toBeInTheDocument();
    });
  });
});
