import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { TicketAdvancedSearchPage } from './TicketAdvancedSearchPage';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}));

const serviceDesks = [{ id: 'sd-1', name: 'Suporte N1' }];
const organizations = [
  { id: 'org-1', name: 'Acme' },
  { id: 'org-2', name: 'Beta Ltda' },
];
const agents = [
  { id: 'agent-1', name: 'Agente Silva' },
  { id: 'agent-2', name: 'Agente Souza' },
];
const stages = [{ id: 'stage-1', name: 'Triagem', position: 0, isInitial: true, transitionToIds: [] }];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/service-desks') return Promise.resolve({ data: serviceDesks });
    if (url === '/organizations') return Promise.resolve({ data: organizations });
    if (url === '/users/agents') return Promise.resolve({ data: agents });
    if (url === '/service-desks/sd-1/stages') return Promise.resolve({ data: stages });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname + location.search}</div>;
}

function renderPage(initialEntry = '/tickets/search') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/tickets/search" element={<TicketAdvancedSearchPage />} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TicketAdvancedSearchPage (D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: 'tok', user: { sub: 'u1', email: 'agent@x.com', role: 'AGENT', organizationId: null } });
    mockApiGet();
  });

  it('DMTE-499 AC-01: a página não tem teto de largura, como a tela de novo ticket', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Busca avançada' }).closest('[class*="max-w-"]')).toBeNull();
  });

  it('ADV-07: sem mesa o Estágio explica por que está desabilitado, e a ajuda some ao escolher a mesa', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByLabelText(/estágio/i, { selector: 'select' })).toBeDisabled();
    expect(screen.getByText('Selecione uma mesa de serviço primeiro')).toBeInTheDocument();

    await screen.findByRole('option', { name: 'Suporte N1', hidden: true }, { timeout: 5000 });
    await user.selectOptions(screen.getByLabelText(/mesa de serviço/i, { selector: 'select' }), 'sd-1');

    await waitFor(() => expect(screen.queryByText('Selecione uma mesa de serviço primeiro')).not.toBeInTheDocument(), {
      timeout: 5000,
    });
  });

  it('ADV-09: "Voltar para Tickets" no topo leva à lista', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('link', { name: 'Voltar para Tickets' }));

    expect(await screen.findByTestId('location-probe', undefined, { timeout: 5000 })).toHaveTextContent(/^\/$/);
  });

  it('renders every D4 field for AGENT/ADMIN', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Busca avançada' })).toBeInTheDocument();
    expect(screen.getByLabelText(/número/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/título/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^status$/i, { selector: 'select' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^cliente$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/solicitante/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^atendente$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/mesa de serviço/i, { selector: 'select' })).toBeInTheDocument();
    expect(screen.getByLabelText(/estágio/i, { selector: 'select' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^prioridade$/i, { selector: 'select' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
  });

  it('hides Cliente, Solicitante and Atendente for CLIENT (RBAC §2.5)', () => {
    useAuthStore.setState({ token: 'tok', user: { sub: 'u2', email: 'client@x.com', role: 'CLIENT', organizationId: null } });
    renderPage();

    expect(screen.queryByRole('textbox', { name: /^cliente$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/solicitante/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^atendente$/i })).not.toBeInTheDocument();
  });

  it('RODADA 2: hides Atendente (but keeps Solicitante) for CLIENT_MASTER, since GET /users/agents returns 403 for this role', () => {
    useAuthStore.setState({
      token: 'tok',
      user: { sub: 'u3', email: 'master@x.com', role: 'CLIENT_MASTER', organizationId: 'org-1' },
    });
    renderPage();

    expect(screen.queryByRole('textbox', { name: /^cliente$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/solicitante/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^atendente$/i })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/users/agents');
  });

  it('RODADA 2: "Status" has Abertos/Fechados shortcuts that map to notClosed/closedOnly, not a literal status (D4)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText(/^status$/i, { selector: 'select' }), 'Abertos');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.textContent).toContain('notClosed=true');
      expect(probe.textContent).not.toContain('status=');
    });
  });

  it('RODADA 2: "Fechados" shortcut maps to closedOnly', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText(/^status$/i, { selector: 'select' }), 'Fechados');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.textContent).toContain('closedOnly=true');
      expect(probe.textContent).not.toContain('status=');
    });
  });

  it('AC-12: the "Filtros adicionais" checkboxes map to mine/unassigned/paused/overdue and "Limpar" unchecks them', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Filtros adicionais'));
    for (const name of ['Meus', 'Não atendidos', 'Pausados', 'Vencidos']) {
      await user.click(screen.getByRole('checkbox', { name }));
      expect(screen.getByRole('checkbox', { name })).toBeChecked();
    }

    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    for (const name of ['Meus', 'Não atendidos', 'Pausados', 'Vencidos']) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    }

    await user.click(screen.getByRole('checkbox', { name: 'Meus' }));
    await user.click(screen.getByRole('checkbox', { name: 'Vencidos' }));
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      const url = screen.getByTestId('location-probe').textContent ?? '';
      expect(url).toContain('mine=true');
      expect(url).toContain('overdue=true');
      expect(url).not.toContain('paused=true');
    });
  });

  it('AC-12: "Filtros adicionais" is a button that expands and collapses the extra filters (aria-expanded)', async () => {
    const user = userEvent.setup();
    renderPage();

    const toggle = screen.queryByRole('button', { name: 'Filtros adicionais' });
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: 'Meus' })).not.toBeInTheDocument();

    await user.click(toggle as HTMLElement);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('checkbox', { name: 'Meus' })).toBeInTheDocument();

    await user.click(toggle as HTMLElement);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: 'Meus' })).not.toBeInTheDocument();
  });

  it('keeps Estágio disabled until a Mesa is chosen', async () => {
    renderPage();

    expect(screen.getByLabelText(/estágio/i, { selector: 'select' })).toBeDisabled();

    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Suporte N1', hidden: true });
    await user.selectOptions(screen.getByLabelText(/mesa de serviço/i, { selector: 'select' }), 'sd-1');

    await waitFor(() => expect(screen.getByLabelText(/estágio/i, { selector: 'select' })).not.toBeDisabled());
  });

  it('"Buscar" navigates to "/" with the chosen filters in the query string', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/número/i), '0007');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe).toHaveTextContent('/');
      expect(probe.textContent).toContain('number=0007');
    });
  });

  it('"Limpar" resets every field back to empty', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberInput = screen.getByLabelText(/número/i);
    await user.type(numberInput, '0007');
    expect(numberInput).toHaveValue('0007');

    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(numberInput).toHaveValue('');
  });

  describe('F3-15 ADV-01: submit vazio', () => {
    it('com todos os campos vazios, Buscar avisa "Preencha ao menos um filtro" e não navega', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Buscar' }));

      expect(screen.queryByText('Preencha ao menos um filtro')).toBeInTheDocument();
      expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();
    });

    it('o aviso some assim que um filtro é preenchido e a busca segue', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(screen.queryByText('Preencha ao menos um filtro')).toBeInTheDocument();

      await user.type(screen.getByLabelText(/número/i), '0007');
      expect(screen.queryByText('Preencha ao menos um filtro')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toContain('number=0007'));
    });
  });

  describe('F3-15 ADV-02: Cliente e Atendente com busca digitável', () => {
    it('digitar parte do nome em Cliente filtra as opções e escolher uma envia organizationId', async () => {
      const user = userEvent.setup();
      renderPage();

      expect(screen.queryByRole('textbox', { name: /^cliente$/i })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('textbox', { name: /^cliente$/i })).toBeEnabled());
      await user.type(screen.getByRole('textbox', { name: /^cliente$/i }), 'bet');
      expect(await screen.findByText('Beta Ltda')).toBeInTheDocument();
      expect(screen.queryByText('Acme')).not.toBeInTheDocument();

      await user.click(screen.getByText('Beta Ltda'));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toContain('organizationId=org-2'));
    });

    it('digitar parte do nome em Atendente filtra as opções e escolher uma envia agentId', async () => {
      const user = userEvent.setup();
      renderPage();

      expect(screen.queryByRole('textbox', { name: /^atendente$/i })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('textbox', { name: /^atendente$/i })).toBeEnabled());
      await user.type(screen.getByRole('textbox', { name: /^atendente$/i }), 'sou');
      expect(await screen.findByText('Agente Souza')).toBeInTheDocument();
      expect(screen.queryByText('Agente Silva')).not.toBeInTheDocument();

      await user.click(screen.getByText('Agente Souza'));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toContain('agentId=agent-2'));
    });
  });

  describe('F3-15 ADV-04: o formulário abre com os filtros ativos da lista', () => {
    it('preenche os campos a partir da query string', async () => {
      renderPage('/tickets/search?status=IN_PROGRESS&priority=HIGH&number=0007&titleContains=vpn&requesterQuery=ana&dateFrom=2026-05-01&dateTo=2026-05-10&dateField=closedAt');

      expect(screen.getByLabelText(/número/i)).toHaveValue('0007');
      expect(screen.getByLabelText(/título/i)).toHaveValue('vpn');
      expect(screen.getByLabelText(/solicitante/i)).toHaveValue('ana');
      expect(screen.getByLabelText(/^status$/i, { selector: 'select' })).toHaveValue('IN_PROGRESS');
      expect(screen.getByLabelText(/^prioridade$/i, { selector: 'select' })).toHaveValue('HIGH');
      expect(screen.getByLabelText('De')).toHaveValue('2026-05-01');
      expect(screen.getByLabelText('Até')).toHaveValue('2026-05-10');
      expect(screen.getByLabelText('Data', { selector: 'select' })).toHaveValue('closedAt');
    });

    it('traduz notClosed/closedOnly para os atalhos de Status', () => {
      renderPage('/tickets/search?notClosed=true');
      expect(screen.getByLabelText(/^status$/i, { selector: 'select' })).toHaveValue('OPEN_SHORTCUT');
    });

    it('marca os "Filtros adicionais" ativos', async () => {
      const user = userEvent.setup();
      renderPage('/tickets/search?mine=true&overdue=true');

      await user.click(screen.getByText('Filtros adicionais'));
      expect(screen.getByRole('checkbox', { name: 'Meus' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Vencidos' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Pausados' })).not.toBeChecked();
    });

    it('seleciona Cliente, Atendente e Mesa vindos da query quando as listas carregam', async () => {
      renderPage('/tickets/search?organizationId=org-2&agentId=agent-2&serviceDeskId=sd-1&stageId=stage-1');

      await waitFor(() => expect(screen.getByRole('textbox', { name: /^cliente$/i })).toHaveValue('Beta Ltda'));
      await waitFor(() => expect(screen.getByRole('textbox', { name: /^atendente$/i })).toHaveValue('Agente Souza'));
      await waitFor(() => expect(screen.getByLabelText(/mesa de serviço/i, { selector: 'select' })).toHaveValue('sd-1'));
      await waitFor(() => expect(screen.getByLabelText(/estágio/i, { selector: 'select' })).toHaveValue('stage-1'));
    });

    it('Buscar sem alterar nada reenvia os mesmos filtros', async () => {
      const user = userEvent.setup();
      renderPage('/tickets/search?priority=HIGH&number=0007');

      await user.click(screen.getByRole('button', { name: 'Buscar' }));

      await waitFor(() => {
        const url = screen.getByTestId('location-probe').textContent ?? '';
        expect(url).toContain('priority=HIGH');
        expect(url).toContain('number=0007');
      });
    });

    it('Limpar zera o formulário que veio preenchido', async () => {
      const user = userEvent.setup();
      renderPage('/tickets/search?priority=HIGH&number=0007');
      expect(screen.getByLabelText(/número/i)).toHaveValue('0007');

      await user.click(screen.getByRole('button', { name: 'Limpar' }));

      expect(screen.getByLabelText(/número/i)).toHaveValue('');
      expect(screen.getByLabelText(/^prioridade$/i, { selector: 'select' })).toHaveValue('');
    });
  });

  describe('F3-15 ADV-05: intervalo de datas', () => {
    it('Até anterior a De mostra erro inline e bloqueia a busca', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByLabelText('De'), '2026-05-10');
      await user.type(screen.getByLabelText('Até'), '2026-05-01');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));

      expect(screen.queryByText('A data final não pode ser anterior à data inicial')).toBeInTheDocument();
      expect(screen.getByLabelText('Até')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();
    });

    it('intervalo válido (Até igual a De) navega normalmente', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByLabelText('De'), '2026-05-10');
      await user.type(screen.getByLabelText('Até'), '2026-05-10');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));

      await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toContain('dateTo=2026-05-10'));
    });

    it('De e Até empilham em telas estreitas e ficam lado a lado a partir de sm', () => {
      renderPage();

      const group = screen.getByLabelText('De').closest('div.gap-2');
      expect(group).toHaveClass('flex-col');
      expect(group).toHaveClass('sm:flex-row');
    });
  });

  describe('F3-15 ADV-08: carregando e erro das consultas', () => {
    function failOn(failingUrl: string) {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === failingUrl) return Promise.reject(new Error('boom'));
        if (url === '/service-desks') return Promise.resolve({ data: serviceDesks });
        if (url === '/organizations') return Promise.resolve({ data: organizations });
        if (url === '/users/agents') return Promise.resolve({ data: agents });
        if (url === '/service-desks/sd-1/stages') return Promise.resolve({ data: stages });
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
    }

    it('falha em /organizations mostra erro no campo Cliente', async () => {
      failOn('/organizations');
      renderPage();

      expect(await screen.findByText('Não foi possível carregar os clientes')).toBeInTheDocument();
    });

    it('falha em /users/agents mostra erro no campo Atendente', async () => {
      failOn('/users/agents');
      renderPage();

      expect(await screen.findByText('Não foi possível carregar os atendentes')).toBeInTheDocument();
    });

    it('falha em /service-desks mostra erro no campo Mesa de serviço', async () => {
      failOn('/service-desks');
      renderPage();

      expect(await screen.findByText('Não foi possível carregar as mesas')).toBeInTheDocument();
    });

    it('falha nos estágios da mesa mostra erro no campo Estágio', async () => {
      failOn('/service-desks/sd-1/stages');
      const user = userEvent.setup();
      renderPage();

      await screen.findByRole('option', { name: 'Suporte N1', hidden: true });
      await user.selectOptions(screen.getByLabelText(/mesa de serviço/i, { selector: 'select' }), 'sd-1');

      expect(await screen.findByText('Não foi possível carregar os estágios')).toBeInTheDocument();
    });

    it('enquanto as consultas carregam, os campos mostram "Carregando…"', () => {
      vi.mocked(api.get).mockImplementation(() => new Promise(() => undefined));
      renderPage();

      expect(screen.queryByPlaceholderText('Carregando clientes…')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Carregando atendentes…')).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Carregando mesas…', hidden: true })).toBeInTheDocument();
    });

    it('CLIENT não consulta organizações nem atendentes', () => {
      useAuthStore.setState({ token: 'tok', user: { sub: 'u2', email: 'client@x.com', role: 'CLIENT', organizationId: null } });
      renderPage();

      expect(api.get).not.toHaveBeenCalledWith('/organizations');
      expect(api.get).not.toHaveBeenCalledWith('/users/agents');
    });
  });
});
