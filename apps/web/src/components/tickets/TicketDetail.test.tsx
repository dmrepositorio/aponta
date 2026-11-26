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

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TicketDetail ticket={ticket} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
    expect(await screen.findByText(/30\/09\/2026 11:00/)).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });

  it('GH-446 DET-02: os prazos de resposta e resolução usam o mesmo formato e fuso', async () => {
    renderDetail();

    expect(await screen.findByText('30/09/2026 11:00', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('02/10/2026 14:30', { selector: 'dd' })).toBeInTheDocument();
  });
});
