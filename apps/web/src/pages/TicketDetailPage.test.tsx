import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { TicketDetailPage } from './TicketDetailPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const ticket: {
  id: string;
  protocol: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  requesterId: string;
  agentId: string;
  serviceDeskId: string;
  responseDeadline: string;
  resolveDeadline: string;
  createdAt: string;
  updatedAt: string;
  serviceDesk?: {
    ticketSections: { key: string; enabled: boolean; sortOrder: number }[];
  };
} = {
  id: 't-1',
  protocol: 'AP-000001',
  title: 'Printer not working',
  description: 'The floor 2 printer is jammed.',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  requesterId: 'u-1',
  agentId: 'agent-1',
  serviceDeskId: 'sd-1',
  responseDeadline: '2026-09-30T14:00:00.000Z',
  resolveDeadline: '2026-10-02T17:30:00.000Z',
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
};

// Mutable so the POST mock can append and the next GET (after React Query
// invalidation) returns the new comment.
const comments = [
  {
    id: 'c-1',
    content: 'The printer has been restarted.',
    isInternal: false,
    ticketId: 't-1',
    authorId: 'agent-1',
    createdAt: '2026-09-28T11:00:00.000Z',
  },
  {
    id: 'c-2',
    content: 'Ordered a replacement fuser unit.',
    isInternal: true,
    ticketId: 't-1',
    authorId: 'agent-1',
    createdAt: '2026-09-28T12:00:00.000Z',
  },
];

const preAppointments: Array<{
  id: string;
  beginning: string;
  ending: string | null;
  initTime: string;
  endTime: string | null;
  ticketId: string;
  authorId: string;
  createdAt: string;
  author: { id: string; name: string; email: string };
}> = [];

const mockAgents = [
  { id: 'agent-1', name: 'Agent Smith', email: 'agent1@ex.com', role: 'AGENT' },
  { id: 'agent-2', name: 'Agent Jones', email: 'agent2@ex.com', role: 'AGENT' },
  { id: 'admin-1', name: 'Admin Boss', email: 'admin@ex.com', role: 'ADMIN' },
];

let canDeleteTickets = false;

function mockApi() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-1', isAdmin: false, permissions: [], canDeleteTickets } });
    if (url.endsWith('/worklog-contracts')) return Promise.resolve({ data: [{ id: 'contract-1' }] });
    if (url === '/tickets/t-1') {
      return Promise.resolve({ data: ticket });
    }
    if (url === '/tickets/t-1/comments') {
      return Promise.resolve({ data: [...comments] });
    }
    if (url === '/users/agents') {
      return Promise.resolve({ data: mockAgents });
    }
    if (url === '/tickets/t-1/audits') {
      return Promise.resolve({ data: [] });
    }
    if (url === '/tickets/t-1/worklogs') {
      return Promise.resolve({ data: [] });
    }
    if (url === '/tickets/t-1/pre-appointments') {
      return Promise.resolve({ data: [...preAppointments] });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  vi.mocked(api.patch).mockImplementation((url: string, body: unknown) => {
    if (url === '/tickets/t-1/status') {
      ticket.status = (body as { status: string }).status;
      return Promise.resolve({ data: ticket });
    }
    if (url === '/tickets/t-1/assign') {
      const { agentId } = body as { agentId: string };
      ticket.agentId = agentId;
      return Promise.resolve({ data: ticket });
    }
    const preMatch = url.match(/^\/tickets\/t-1\/pre-appointments\/(.+)$/);
    if (preMatch) {
      const input = body as { ending?: string; endTime?: string };
      const idx = preAppointments.findIndex((row) => row.id === preMatch[1]);
      if (idx >= 0) {
        preAppointments[idx] = {
          ...preAppointments[idx],
          ending: input.ending || new Date().toISOString(),
          endTime: input.endTime || '00:00',
        };
        return Promise.resolve({ data: preAppointments[idx] });
      }
    }
    return Promise.reject(new Error(`Unexpected PATCH ${url}`));
  });
  vi.mocked(api.post).mockImplementation((url: string, body: unknown) => {
    if (url === '/tickets/t-1/pre-appointments') {
      const input = body as { beginning?: string; initTime?: string };
      const beginning = input.beginning || new Date().toISOString();
      const created = {
        id: `pre-${preAppointments.length + 1}`,
        beginning,
        ending: null,
        initTime: input.initTime || '00:00',
        endTime: null,
        ticketId: 't-1',
        authorId: 'u-1',
        createdAt: beginning,
        author: { id: 'u-1', name: 'Agent Smith', email: 'agent1@ex.com' },
      };
      preAppointments.unshift(created);
      return Promise.resolve({ data: created });
    }
    const { content, isInternal } = body as {
      content: string;
      isInternal?: boolean;
    };
    if (url === '/tickets/t-1/comments') {
      const created = {
        id: `c-${comments.length + 1}`,
        content,
        isInternal: isInternal ?? false,
        ticketId: 't-1',
        authorId: 'u-1',
        createdAt: '2026-09-29T09:00:00.000Z',
      };
      comments.push(created);
      return Promise.resolve({ data: created });
    }
    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
}

function setRole(role: 'CLIENT' | 'AGENT' | 'ADMIN') {
  useAuthStore.setState({
    token: 'fake.jwt.token',
    user: { sub: 'u-1', email: 'user@example.com', role },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tickets/t-1']}>
        <Routes>
          <Route path="/" element={<p>Dashboard</p>} />
          <Route path="/tickets" element={<p>Lista de tickets</p>} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TicketDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canDeleteTickets = false;
    comments.length = 2;
    preAppointments.length = 0;
    mockApi();
    setRole('CLIENT');
  });

  it('should render ticket details with status, priority and SLA deadlines', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Printer not working' }),
    ).toBeInTheDocument();
    expect(screen.getByText('AP-000001')).toBeInTheDocument();
    expect(
      screen.getByText('The floor 2 printer is jammed.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Em Andamento')).toBeInTheDocument();
    expect(screen.getByText('Alta')).toBeInTheDocument();
    expect(screen.getByText(/prazo de resposta/i)).toBeInTheDocument();
    expect(screen.getByText('2026-09-30 14:00 UTC')).toBeInTheDocument();
    expect(screen.getByText(/prazo de resolução/i)).toBeInTheDocument();
    expect(screen.getByText('2026-10-02 17:30 UTC')).toBeInTheDocument();
  });

  it('AC-3: Esc volta para a tela inicial', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Printer not working' });
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('sets the browser tab title to "#<protocolo> - <título>" (TiFlux parity) and restores it on unmount', async () => {
    document.title = 'Aponta';
    const { unmount } = renderPage();

    await screen.findByRole('heading', { name: 'Printer not working' });
    expect(document.title).toBe('#AP-000001 - Printer not working');

    unmount();
    expect(document.title).toBe('Aponta');
  });

  it('shows SLA status badges when the backend reports responseSlaStatus/resolveSlaStatus', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/tickets/t-1') {
        return Promise.resolve({
          data: {
            ...ticket,
            responseSlaStatus: 'AT_RISK',
            resolveSlaStatus: 'BREACHED',
          },
        });
      }
      if (url === '/tickets/t-1/comments') {
        return Promise.resolve({ data: comments });
      }
      if (url === '/users/agents') {
        return Promise.resolve({ data: mockAgents });
      }
      return Promise.resolve({ data: [] });
    });

    renderPage();

    expect(await screen.findByText(/em risco/i)).toBeInTheDocument();
    expect(screen.getAllByText(/vencido/i).length).toBeGreaterThan(0);
  });

  it('AC-04: ticket em pausa (PENDING_SANKHYA) mostra selo "Dentro do prazo" e "Pausado · Aguardando Sankhya", sem "Vencido há"', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/tickets/t-1') {
        return Promise.resolve({
          data: {
            ...ticket,
            status: 'PENDING_SANKHYA',
            resolveSlaStatus: 'ON_TRACK',
            slaPausedAt: '2026-10-01T10:00:00.000Z',
            slaAccumulatedPauseTime: 60,
          },
        });
      }
      if (url === '/tickets/t-1/comments') {
        return Promise.resolve({ data: comments });
      }
      if (url === '/users/agents') {
        return Promise.resolve({ data: mockAgents });
      }
      return Promise.resolve({ data: [] });
    });

    renderPage();

    expect(await screen.findByText(/dentro do prazo/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Pausado · Aguardando Sankhya/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/vencido há/i)).not.toBeInTheDocument();
  });

  it('should render the comment timeline with an internal-note indicator only on internal comments', async () => {
    setRole('AGENT');
    renderPage();

    const publicContent = await screen.findByText(
      'The printer has been restarted.',
    );
    const publicItem = publicContent.closest('li');
    expect(publicItem).not.toBeNull();
    expect(
      within(publicItem as HTMLElement).queryByText(/nota interna/i),
    ).not.toBeInTheDocument();

    const internalContent = screen.getByText(
      'Ordered a replacement fuser unit.',
    );
    const internalItem = internalContent.closest('li');
    expect(internalItem).not.toBeNull();
    expect(
      within(internalItem as HTMLElement).getByText(/nota interna/i),
    ).toBeInTheDocument();
  });

  it('should show the comment form and post a new comment', async () => {
    setRole('AGENT');
    const user = userEvent.setup();
    renderPage();

    const textarea = await screen.findByLabelText(/adicionar um comentário/i);
    await user.type(textarea, 'Follow-up question');
    await user.click(screen.getByRole('button', { name: /publicar comentário/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/tickets/t-1/comments', {
        content: 'Follow-up question',
        isInternal: false,
      });
    });
    expect(await screen.findByText('Follow-up question')).toBeInTheDocument();
  });

  it('should show the isInternal checkbox for agents', async () => {
    setRole('AGENT');
    renderPage();

    await screen.findByText('Printer not working');
    expect(
      screen.getByRole('checkbox', { name: /nota interna/i }),
    ).toBeInTheDocument();
  });

  it('should show the isInternal checkbox for admins', async () => {
    setRole('ADMIN');
    renderPage();

    await screen.findByText('Printer not working');
    expect(
      screen.getByRole('checkbox', { name: /nota interna/i }),
    ).toBeInTheDocument();
  });

  it('should hide the isInternal checkbox for clients', async () => {
    setRole('CLIENT');
    renderPage();

    await screen.findByText('Printer not working');
    expect(
      screen.queryByRole('checkbox', { name: /nota interna/i }),
    ).not.toBeInTheDocument();
  });

  it('should show the worklogs section for agents and admins', async () => {
    setRole('AGENT');
    renderPage();

    await screen.findByText('Printer not working');
    expect(screen.getByTestId('ticket-worklogs-section')).toBeInTheDocument();
  });

  it('should hide the worklogs section for clients', async () => {
    setRole('CLIENT');
    renderPage();

    await screen.findByText('Printer not working');
    expect(screen.queryByTestId('ticket-worklogs-section')).not.toBeInTheDocument();
  });

  it('starts a TiFlux-style pré-apontamento from the header play on any tab', async () => {
    setRole('AGENT');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Printer not working');
    expect(screen.getByTestId('ticket-header-play-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tab-panel-geral')).not.toHaveClass('hidden');

    await user.click(screen.getByTestId('ticket-header-play-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ticket-header-stop-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ticket-header-timer-display')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /apontamentos/i }));

    expect(screen.getByTestId('tab-panel-apontamentos')).not.toHaveClass('hidden');
    expect(screen.getByTestId('worklog-pre-appointments')).toBeInTheDocument();
    expect(screen.getByTestId('worklog-pre-end')).toHaveTextContent('--');

    await user.click(screen.getByTestId('ticket-header-stop-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('ticket-header-play-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('worklog-pre-end')).not.toHaveTextContent('--');
  });

  describe('Agent assignment', () => {
    it('hides the assignment dropdown from clients', async () => {
      setRole('CLIENT');
      renderPage();
      await screen.findByText('Printer not working');
      expect(screen.queryByLabelText(/atribuído a:/i, { selector: 'select' })).not.toBeInTheDocument();
    });

    it('shows the assignment dropdown to agents and allows assigning a ticket', async () => {
      setRole('AGENT');
      const user = userEvent.setup();
      renderPage();
      
      const select = await screen.findByLabelText(/atribuído a:/i, { selector: 'select' });
      expect(select).toBeInTheDocument();
      
      // Need to wait for the agents query to render options
      await screen.findByRole('option', { name: 'Agent Jones', hidden: true });
      
      // Select the new agent (Agent Jones)
      await user.selectOptions(select, 'agent-2');
      
      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/tickets/t-1/assign', { agentId: 'agent-2' });
      });
    });
  });

  describe('Aguardando Sankhya (DMTE-490)', () => {
    const STATUS_OPTIONS = [
      'Aberto',
      'Em Andamento',
      'Aguardando Cliente',
      'Aguardando Terceiros',
      'Aguardando Sankhya',
      'Aguardando Aprovação',
      'Escalonado',
      'Resolvido',
      'Fechado',
    ];

    afterEach(() => {
      ticket.status = 'IN_PROGRESS';
    });

    it('AC-05: the agent status select lists Aguardando Sankhya right after Aguardando Terceiros and moves the ticket there', async () => {
      setRole('AGENT');
      const user = userEvent.setup();
      renderPage();

      const select = await screen.findByLabelText(/^status$/i, { selector: 'select' });
      const labels = within(select).getAllByRole('option', { hidden: true }).map((o) => o.textContent);
      expect(labels).toEqual(STATUS_OPTIONS);

      await user.selectOptions(select, 'PENDING_SANKHYA');

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/tickets/t-1/status', { status: 'PENDING_SANKHYA' });
      });
    });

    it('AC-07: a client sees the status as text, without a status select', async () => {
      ticket.status = 'PENDING_SANKHYA';
      setRole('CLIENT');
      renderPage();

      expect(await screen.findByText('Aguardando Sankhya')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^status$/i, { selector: 'select' })).not.toBeInTheDocument();
    });
  });

  describe('Status change errors', () => {
    it('shows an error message (not a silent revert) when the backend rejects an invalid status transition', async () => {
      setRole('AGENT');
      vi.mocked(api.patch).mockImplementation((url: string) => {
        if (url === '/tickets/t-1/status') {
          return Promise.reject({
            isAxiosError: true,
            response: {
              status: 400,
              data: { message: 'Cannot transition ticket from IN_PROGRESS to CLOSED' },
            },
          });
        }
        return Promise.reject(new Error(`Unexpected PATCH ${url}`));
      });
      const user = userEvent.setup();
      renderPage();

      const select = await screen.findByLabelText(/^status$/i, { selector: 'select' });
      await user.selectOptions(select, 'CLOSED');

      await waitFor(() => {
        expect(
          screen.getByText(/não foi possível alterar o status/i),
        ).toBeInTheDocument();
      });
      // The select must reflect the real (unchanged) status from the server,
      // not silently keep whatever the user picked.
      expect(select).toHaveValue('IN_PROGRESS');
    });
  });

  describe('Audit history ("Histórico")', () => {
    const audits = [
      {
        id: 'a-1',
        action: 'STATUS_CHANGED',
        prevVal: 'OPEN',
        newVal: 'IN_PROGRESS',
        createdAt: '2026-09-28T10:30:00.000Z',
        user: { name: 'Agente Smith' },
      },
      {
        id: 'a-2',
        action: 'ASSIGNED',
        prevVal: null,
        newVal: 'agent-1',
        createdAt: '2026-09-28T10:00:00.000Z',
        user: { name: 'Agente Smith' },
      },
    ];

    function mockApiWithAudits() {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/tickets/t-1') {
          return Promise.resolve({ data: ticket });
        }
        if (url === '/tickets/t-1/comments') {
          return Promise.resolve({ data: [...comments] });
        }
        if (url === '/users/agents') {
          return Promise.resolve({ data: mockAgents });
        }
        if (url === '/tickets/t-1/audits') {
          return Promise.resolve({ data: audits });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
    }

    it('hides the "Histórico" section from clients', async () => {
      setRole('CLIENT');
      mockApiWithAudits();
      renderPage();

      await screen.findByText('Printer not working');
      expect(
        screen.queryByRole('heading', { name: /histórico/i }),
      ).not.toBeInTheDocument();
    });

    it('shows the "Histórico" section with the audit trail to agents', async () => {
      setRole('AGENT');
      mockApiWithAudits();
      renderPage();

      await screen.findByRole('heading', { name: /histórico/i });
      expect(
        await screen.findByText(/aberto.*em andamento/i),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText((text) => text.includes('Agente Smith')).length,
      ).toBeGreaterThan(0);
    });

    it('shows an empty-state message when there is no audit history yet', async () => {
      setRole('AGENT');
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/tickets/t-1') {
          return Promise.resolve({ data: ticket });
        }
        if (url === '/tickets/t-1/comments') {
          return Promise.resolve({ data: [] });
        }
        if (url === '/users/agents') {
          return Promise.resolve({ data: mockAgents });
        }
        if (url === '/tickets/t-1/audits') {
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
      renderPage();

      await screen.findByRole('heading', { name: /histórico/i });
      expect(
        screen.getByText(/nenhuma alteração registrada/i),
      ).toBeInTheDocument();
    });

    it('refetches the audit trail after an assignment succeeds', async () => {
      setRole('AGENT');
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/tickets/t-1') return Promise.resolve({ data: ticket });
        if (url === '/tickets/t-1/comments')
          return Promise.resolve({ data: [] });
        if (url === '/users/agents')
          return Promise.resolve({ data: mockAgents });
        if (url === '/tickets/t-1/audits') return Promise.resolve({ data: [] });
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
      const user = userEvent.setup();
      renderPage();

      await screen.findByRole('heading', { name: /histórico/i });
      await screen.findByText(/nenhuma alteração registrada/i);

      // After the assignment succeeds, the audits endpoint resolves with a
      // new entry — the UI must refetch (not just show a stale empty state).
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/tickets/t-1') return Promise.resolve({ data: ticket });
        if (url === '/tickets/t-1/comments')
          return Promise.resolve({ data: [] });
        if (url === '/users/agents')
          return Promise.resolve({ data: mockAgents });
        if (url === '/tickets/t-1/audits') {
          return Promise.resolve({
            data: [
              {
                id: 'audit-1',
                action: 'ASSIGNED',
                prevVal: null,
                newVal: 'agent-2',
                createdAt: '2026-10-01T19:42:00.000Z',
                user: { name: 'Agente Smith', email: 'agent@aponta.com' },
              },
            ],
          });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
      vi.mocked(api.patch).mockResolvedValue({ data: { id: 't-1' } });

      const select = await screen.findByLabelText(/atribuído a:/i, { selector: 'select' });
      await screen.findByRole('option', { name: 'Agent Jones', hidden: true });
      await user.selectOptions(select, 'agent-2');

      await waitFor(() => {
        expect(
          screen.queryByText(/nenhuma alteração registrada/i),
        ).not.toBeInTheDocument();
      });
      expect(
        screen.getAllByText((text) => text.includes('Agente Smith')).length,
      ).toBeGreaterThan(0);
    });
  });

  describe('Tab navigation', () => {
    it('switches between tabs and shows respective tab panels for agents', async () => {
      setRole('AGENT');
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Printer not working');

      expect(screen.getByTestId('tab-panel-geral')).not.toHaveClass('hidden');

      const apontamentosTab = screen.getByRole('tab', { name: /apontamentos/i });
      await user.click(apontamentosTab);

      expect(screen.getByTestId('tab-panel-apontamentos')).not.toHaveClass('hidden');
      expect(screen.getByTestId('tab-panel-geral')).toHaveClass('hidden');

      const comunicacaoTab = screen.getByRole('tab', { name: /comunicação/i });
      await user.click(comunicacaoTab);

      expect(screen.getByTestId('tab-panel-comunicacao')).not.toHaveClass('hidden');
      expect(screen.getByTestId('tab-panel-apontamentos')).toHaveClass('hidden');
    });

    it('Apontamentos tab activates tab-panel-apontamentos when clicked', async () => {
      setRole('AGENT');
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Printer not working');

      const apontamentosTab = screen.getByRole('tab', { name: /apontamentos/i });
      await user.click(apontamentosTab);

      expect(screen.getByTestId('tab-panel-apontamentos')).not.toHaveClass('hidden');
      expect(screen.getByTestId('tab-panel-geral')).toHaveClass('hidden');
    });

    it('hides ticket sections disabled on the mesa', async () => {
      setRole('AGENT');
      ticket.serviceDesk = {
        ticketSections: [
          { key: 'GENERAL_INFO', enabled: true, sortOrder: 0 },
          { key: 'WORKLOGS', enabled: false, sortOrder: 1 },
          { key: 'COMMUNICATION', enabled: true, sortOrder: 2 },
        ],
      };
      renderPage();

      await screen.findByText('Printer not working');
      expect(screen.queryByRole('tab', { name: /apontamentos/i })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /comunicação/i })).toBeInTheDocument();
      delete ticket.serviceDesk;
    });

    it('hides non-client tabs from clients', async () => {
      setRole('CLIENT');
      renderPage();

      await screen.findByText('Printer not working');

      expect(screen.getByRole('tab', { name: /informações gerais/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /comunicação/i })).toBeInTheDocument();

      expect(screen.queryByRole('tab', { name: /apontamentos/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /categoria/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /compromissos/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /github/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-quick-worklog-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ticket-header-play-btn')).not.toBeInTheDocument();
    });
  });

  describe('Back button', () => {
    it('shows a "Voltar" link that navigates back to the ticket list', async () => {
      setRole('AGENT');
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Printer not working');

      const backLink = screen.getByRole('link', { name: /voltar/i });
      expect(backLink).toBeInTheDocument();

      await user.click(backLink);

      expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    });
  });
  describe('excluir ticket (DMTE-560 T1)', () => {
    async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
      await screen.findByRole('heading', { name: 'Printer not working' });
      await user.click(await screen.findByRole('button', { name: 'Excluir ticket' }));
      return screen.findByRole('dialog');
    }

    it('AC-07: "Excluir ticket" só aparece quando o servidor diz que o usuário pode (canDeleteTickets)', async () => {
      setRole('ADMIN');
      renderPage();

      await screen.findByRole('heading', { name: 'Printer not working' });
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
      expect(screen.queryByRole('button', { name: 'Excluir ticket' })).not.toBeInTheDocument();
    });

    it('AC-07: abre o diálogo do DS com o protocolo e não exclui antes de Confirmar; Cancelar fecha sem excluir', async () => {
      canDeleteTickets = true;
      setRole('AGENT');
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDeleteDialog(user);

      expect(within(dialog).getByText(/AP-000001/)).toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('AC-07: Confirmar chama DELETE /tickets/:id uma vez, desabilita Confirmar durante o envio e, no sucesso, volta à lista de Tickets', async () => {
      canDeleteTickets = true;
      setRole('AGENT');
      let finish: (value: unknown) => void = () => undefined;
      vi.mocked(api.delete).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDeleteDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirmar' })).toBeDisabled());
      expect(api.delete).toHaveBeenCalledTimes(1);
      expect(api.delete).toHaveBeenCalledWith('/tickets/t-1');
      finish({ data: { id: 't-1' } });
      expect(await screen.findByText('Lista de tickets')).toBeInTheDocument();
    });

    it('AC-07: a recusa da API aparece no diálogo, que continua aberto', async () => {
      canDeleteTickets = true;
      setRole('AGENT');
      vi.mocked(api.delete).mockRejectedValue({
        response: { data: { message: 'Não é possível excluir o ticket AP-000001: tem 2 apontamentos.' } },
      });
      const user = userEvent.setup();
      renderPage();

      const dialog = await openDeleteDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await within(dialog).findByText(/tem 2 apontamentos/i)).toBeInTheDocument();
      expect(screen.queryByText('Lista de tickets')).not.toBeInTheDocument();
    });
  });
});

describe('TicketDetailPage: descrição como conteúdo rico (DMTE-558)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canDeleteTickets = false;
    comments.length = 2;
    preAppointments.length = 0;
    mockApi();
    setRole('CLIENT');
  });

  async function renderWithDescription(description: string) {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/tickets/t-1'
        ? Promise.resolve({ data: { ...ticket, description } })
        : base(url),
    );
    const view = renderPage();
    await screen.findByRole('heading', { name: 'Printer not working' });
    return view;
  }

  it('AC-01: descrição <p>…</p> aparece como texto, sem tag literal', async () => {
    await renderWithDescription('<p>Erro no emissão da TOP 1100 </p>');

    expect(screen.getByText('Erro no emissão da TOP 1100')).toBeInTheDocument();
    expect(screen.queryByText(/<\/?p>/)).not.toBeInTheDocument();
  });

  it('AC-02: parágrafos, negrito, itálico, lista e quebra viram elementos', async () => {
    const { container } = await renderWithDescription(
      '<p>Primeiro <strong>negrito</strong> e <em>itálico</em></p>' +
        '<p>Segundo<br>quebra</p>' +
        '<ul><li>item um</li><li>item dois</li></ul>',
    );

    expect(screen.getByText('negrito').tagName).toBe('STRONG');
    expect(screen.getByText('itálico').tagName).toBe('EM');
    const item = screen.getByText('item um');
    expect(item.tagName).toBe('LI');
    expect(item.parentElement?.tagName).toBe('UL');
    expect(screen.getByText('item dois').tagName).toBe('LI');
    expect(screen.getByText(/Segundo/).querySelector('br')).not.toBeNull();
    expect(container.textContent).not.toMatch(/<\/?(p|strong|em|ul|li|br)\b/);
  });

  it('AC-03 (caracterização, regressão): texto puro com \n mantém as duas linhas em contêiner whitespace-pre-wrap', async () => {
    await renderWithDescription('linha 1\nlinha 2');

    const block = screen.getByText('linha 1\nlinha 2', {
      normalizer: (text) => text,
    });
    expect(block.closest('.whitespace-pre-wrap')).not.toBeNull();
  });

  it('AC-04: conteúdo inseguro não vira script, handler, javascript: nem texto', async () => {
    const { container } = await renderWithDescription(
      '<p>Ok</p><script>alert(1)</script>' +
        '<img src="javascript:alert(1)" alt="x">' +
        '<img src="/uploads/a.png" onerror="alert(1)" alt="ok">' +
        '<a href="javascript:alert(1)">link</a>',
    );

    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/<\/?(p|script|img|a)\b/);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(screen.queryByAltText('x')).not.toBeInTheDocument();
    for (const el of Array.from(container.querySelectorAll('*'))) {
      const handlers = el
        .getAttributeNames()
        .filter((name) => name.toLowerCase().startsWith('on'));
      expect(handlers).toEqual([]);
    }
    const link = screen.getByText('link');
    expect(link.closest('a')).toBeNull();
    expect(link).not.toHaveAttribute('href');
    expect(screen.getByAltText('ok')).toBeInTheDocument();
  });

  it('AC-05: imagem relativa e https aparecem dentro de link para a mesma URL, sem estourar a largura', async () => {
    await renderWithDescription(
      '<p><img src="/uploads/a.png" alt="captura"></p>' +
        '<p><img src="https://example.com/b.png" alt="externa"></p>',
    );

    for (const [alt, src] of [
      ['captura', '/uploads/a.png'],
      ['externa', 'https://example.com/b.png'],
    ]) {
      const img = screen.getByAltText(alt);
      expect(img).toHaveAttribute('src', src);
      expect(img).toHaveClass('max-w-full');
      expect(img.closest('a')).toHaveAttribute('href', src);
    }
  });

  it('AC-06: markdown legado de imagem mostra texto e imagem, sem a sintaxe ![', async () => {
    const { container } = await renderWithDescription(
      'Evidência anexada\n![evidencia.png](https://cdn.example.com/tela.png)',
    );

    expect(screen.getByText('Evidência anexada')).toBeInTheDocument();
    expect(screen.getByAltText('evidencia.png')).toHaveAttribute(
      'src',
      'https://cdn.example.com/tela.png',
    );
    expect(container.textContent).not.toContain('![');
  });

  it('AC-07 (caracterização, regressão): o bloco da descrição mantém text-sm text-gray-900 e o cabeçalho não muda', async () => {
    await renderWithDescription('Descrição simples do chamado.');

    const wrapper = screen
      .getByText('Descrição simples do chamado.')
      .closest('.text-sm.text-gray-900');
    expect(wrapper).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Printer not working' })).toBeInTheDocument();
    expect(screen.getByText('AP-000001')).toBeInTheDocument();
    expect(screen.getByText(/prazo de resposta/i)).toBeInTheDocument();
  });
});
