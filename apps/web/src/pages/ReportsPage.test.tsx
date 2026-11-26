import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { ReportsPage } from './ReportsPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const workload = [
  { agentId: 'a1', agentName: 'Alice', totalMinutes: 125 },
  { agentId: 'a2', agentName: 'Bob', totalMinutes: 60 },
];

const billing = [
  {
    organizationId: 'org-1',
    organizationName: 'Empresa A',
    billableMinutes: 120,
    nonBillableMinutes: 30,
    coveredMinutes: 60, excessMinutes: 60, totalValueCents: 12000, unknownValuationCount: 1,
  },
];

let canViewTicketValues = true;
let meResolved = false;

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-1', isAdmin: false, permissions: [], canViewTicketValues } }).then((response) => { meResolved = true; return response; });
    if (url === '/reports/workload') return Promise.resolve({ data: workload });
    if (url === '/reports/billing') return Promise.resolve({ data: billing });
    if (url === '/contracts') return Promise.resolve({ data: [{ id: 'c1', name: 'Suporte' }] });
    if (url === '/reports/commercial' || url === '/contracts/cost-rates' || url === '/users/agents') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(entry = '/reports') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/reports" element={<><ReportsPage /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function loginAs(role: 'ADMIN' | 'AGENT' | 'CLIENT_MASTER') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'user@aponta.com', role },
  });
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canViewTicketValues = true;
    meResolved = false;
    mockApiGet();
    useAuthStore.setState({ token: null, user: null });
  });

  it('shows the workload tab by default with hours formatted as Xh Ym', async () => {
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    expect(screen.getByText('2h 5m')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('1h 0m')).toBeInTheDocument();
  });

  it('shows the Faturamento tab for ADMIN and switches content on click', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });
    expect(api.get).toHaveBeenCalledWith('/reports/billing', { params: { contractId: undefined, startDate: undefined, endDate: undefined } });
    expect(screen.getByText('1h 0m / 1h 0m')).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
  });

  it('shows the Faturamento tab for CLIENT_MASTER too', async () => {
    loginAs('CLIENT_MASTER');
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /faturamento base/i })).toBeInTheDocument();
    });
  });

  it('hides the Faturamento tab entirely for AGENT', async () => {
    loginAs('AGENT');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    expect(screen.queryByRole('tab', { name: /faturamento base/i })).not.toBeInTheDocument();
    // AGENT must never trigger the billing request at all
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/reports/billing')).toBe(false);
  });

  it('DMTE-479 AC-03: hides Faturamento and Resultado gerencial for an ADMIN without canViewTicketValues', async () => {
    canViewTicketValues = false;
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    await waitFor(() => expect(meResolved).toBe(true));
    await act(async () => undefined);

    expect(screen.queryByRole('tab', { name: /faturamento base/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /resultado gerencial/i })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/reports/billing')).toBe(false);
  });

  it('DMTE-479 AC-03: hides Faturamento for a CLIENT_MASTER without canViewTicketValues', async () => {
    canViewTicketValues = false;
    loginAs('CLIENT_MASTER');
    renderPage();

    await waitFor(() => expect(meResolved).toBe(true));
    await act(async () => undefined);

    expect(screen.queryByRole('tab', { name: /faturamento base/i })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/reports/billing')).toBe(false);
  });

  it('DMTE-479 AC-03: shows Resultado gerencial for an ADMIN with canViewTicketValues', async () => {
    loginAs('ADMIN');
    renderPage();

    expect(await screen.findByRole('tab', { name: /resultado gerencial/i })).toBeInTheDocument();
  });

  it('DMTE-479 AC-03: Resultado gerencial aberto some e para de consultar quando a permissão é revogada', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    const { queryClient } = renderPage();

    await user.click(await screen.findByRole('tab', { name: /resultado gerencial/i }));
    await screen.findByText('Custo por técnico e vigência');

    canViewTicketValues = false;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me', 'permissions'] });
    });
    await waitFor(() => expect(screen.queryByRole('tab', { name: /resultado gerencial/i })).not.toBeInTheDocument());

    expect(screen.queryByText('Custo por técnico e vigência')).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no workload data', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/reports/workload') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/nenhum apontamento registrado/i)).toBeInTheDocument();
    });
  });
});

function rejectBilling(status: number) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-1', isAdmin: false, permissions: [], canViewTicketValues } });
    if (url === '/reports/workload') return Promise.resolve({ data: workload });
    if (url === '/contracts') return Promise.resolve({ data: [{ id: 'c1', name: 'Suporte' }] });
    if (url === '/reports/billing') {
      return Promise.reject(new AxiosError('falhou', 'ERR_BAD_RESPONSE', undefined, undefined, { status, data: {} } as AxiosResponse));
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

const billingCalls = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === '/reports/billing');
const billingParams = (call: unknown[]) => (call[1] as { params: { contractId?: string; startDate?: string; endDate?: string } }).params;

describe('ReportsPage F3-17 (#454)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canViewTicketValues = true;
    mockApiGet();
    useAuthStore.setState({ token: null, user: null });
  });

  describe('REP-02: falha de faturamento', () => {
    it('mostra EzAlert de falha temporária com Tentar de novo no status 500, sem culpar o período', async () => {
      rejectBilling(500);
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/falha temporária/i);
      expect(alert).not.toHaveTextContent(/verifique o período/i);
      const before = billingCalls().length;
      await user.click(within(alert).getByRole('button', { name: /tentar de novo/i }));
      await waitFor(() => expect(billingCalls().length).toBeGreaterThan(before));
    });

    it('aponta o período no status 400', async () => {
      rejectBilling(400);
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/verifique o período/i);
      expect(within(alert).queryByRole('button', { name: /tentar de novo/i })).not.toBeInTheDocument();
    });

    it('diz que falta permissão no status 403', async () => {
      rejectBilling(403);
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/não tem permissão/i);
      expect(alert).not.toHaveTextContent(/verifique o período/i);
    });
  });

  describe('REP-03: filtros de ciclo', () => {
    async function openBilling() {
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));
      await screen.findByText('Empresa A');
      return user;
    }

    it('início maior que fim mostra erro no campo e não consulta com datas', async () => {
      await openBilling();
      fireEvent.change(screen.getByLabelText('Ciclos desde'), { target: { value: '2026-05' } });
      fireEvent.change(screen.getByLabelText(/Ciclos até/), { target: { value: '2026-03' } });

      expect(await screen.findByText(/não pode ser anterior ao início/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Ciclos até/)).toHaveAttribute('aria-invalid', 'true');
      await act(async () => undefined);
      // Só início (2026-05) é intervalo válido e consulta; início e fim juntos, invertidos, não.
      expect(billingCalls().some((call) => billingParams(call).startDate && billingParams(call).endDate)).toBe(false);
    });

    it('Limpar período esvazia início e fim', async () => {
      const user = await openBilling();
      fireEvent.change(screen.getByLabelText('Ciclos desde'), { target: { value: '2026-01' } });
      fireEvent.change(screen.getByLabelText(/Ciclos até/), { target: { value: '2026-03' } });

      await user.click(screen.getByRole('button', { name: /limpar período/i }));

      expect(screen.getByLabelText('Ciclos desde')).toHaveValue('');
      expect(screen.getByLabelText(/Ciclos até/)).toHaveValue('');
    });

    it('o rótulo do fim explica em português que o mês escolhido não entra', async () => {
      await openBilling();
      expect(screen.getByLabelText(/Ciclos até/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/exclusivo/i)).not.toBeInTheDocument();
      expect(screen.getByText(/mês escolhido não é incluído/i)).toBeInTheDocument();
    });
  });

  describe('REP-04: tabelas', () => {
    it('Carga: cabeçalhos com scope col, números tabulares, ordenação e total', async () => {
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Alice');

      const table = screen.getByRole('table', { name: /carga de trabalho por usuário/i });
      const headers = within(table).getAllByRole('columnheader');
      expect(headers.length).toBe(2);
      headers.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
      expect(screen.getByText('2h 5m')).toHaveClass('tabular-nums');

      const rowTexts = () => within(table).getAllByRole('row').map((row) => row.textContent ?? '').filter((text) => /Alice|Bob/.test(text));
      await user.click(within(table).getByRole('button', { name: /tempo apontado/i }));
      expect(within(table).getByRole('columnheader', { name: /tempo apontado/i })).toHaveAttribute('aria-sort', 'ascending');
      expect(rowTexts()[0]).toContain('Bob');
      await user.click(within(table).getByRole('button', { name: /tempo apontado/i }));
      expect(within(table).getByRole('columnheader', { name: /tempo apontado/i })).toHaveAttribute('aria-sort', 'descending');
      expect(rowTexts()[0]).toContain('Alice');

      expect(within(table).getByRole('row', { name: /total/i })).toHaveTextContent('3h 5m');
    });

    it('Faturamento: scope col, ordenação por coluna e linha de total', async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-1', isAdmin: false, permissions: [], canViewTicketValues } });
        if (url === '/reports/workload') return Promise.resolve({ data: workload });
        if (url === '/contracts') return Promise.resolve({ data: [] });
        if (url === '/reports/billing') {
          return Promise.resolve({ data: [
            { ...billing[0], organizationId: 'org-1', organizationName: 'Empresa A', billableMinutes: 120, totalValueCents: 12000 },
            { ...billing[0], organizationId: 'org-2', organizationName: 'Empresa B', billableMinutes: 30, totalValueCents: 3000, nonBillableMinutes: 0, coveredMinutes: 0, excessMinutes: 30 },
          ] });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));
      const table = await screen.findByRole('table', { name: /faturamento base por contrato/i });

      within(table).getAllByRole('columnheader').forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
      await user.click(within(table).getByRole('button', { name: /horas faturáveis/i }));
      const orgs = within(table).getAllByRole('row').map((row) => row.textContent ?? '').filter((text) => /Empresa/.test(text));
      expect(orgs[0]).toContain('Empresa B');
      expect(within(table).getByRole('row', { name: /total/i })).toHaveTextContent(/150,00/);
    });
  });

  describe('REP-05: cor não é o único canal', () => {
    it('cabeçalhos de horas não dependem de text-green-600 e as colunas de valor têm descrição acessível', async () => {
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));
      await screen.findByText('Empresa A');

      expect(screen.getByRole('columnheader', { name: /horas faturáveis/i })).not.toHaveClass('text-green-600');
      expect(screen.getByRole('columnheader', { name: /sem valorização/i })).toHaveAccessibleDescription(/apontamentos sem valor/i);
      expect(screen.getByRole('columnheader', { name: /valor conhecido/i })).toHaveAccessibleDescription(/soma dos valores/i);
      expect(screen.getAllByText('2h 0m')[0]).not.toHaveClass('text-green-600');
    });
  });

  describe('REP-06: layout e abas', () => {
    it('usa o cabeçalho de página do DS e liga aba e tabpanel', async () => {
      loginAs('ADMIN');
      renderPage();
      await screen.findByText('Alice');

      const heading = screen.getByRole('heading', { level: 1, name: 'Relatórios' });
      expect(heading).not.toHaveClass('text-3xl');
      const panel = screen.getByRole('tabpanel');
      const tab = screen.getByRole('tab', { name: /carga de trabalho/i });
      expect(tab.id).not.toBe('');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(tab).toHaveAttribute('aria-controls', panel.id);
    });
  });

  describe('REP-07: aba e filtros na URL', () => {
    it('?aba=BILLING abre Faturamento para ADMIN', async () => {
      loginAs('ADMIN');
      renderPage('/reports?aba=BILLING');

      expect(await screen.findByText('Empresa A')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /faturamento base/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('?aba=BILLING cai em Carga de Trabalho para AGENT', async () => {
      loginAs('AGENT');
      renderPage('/reports?aba=BILLING');

      expect(await screen.findByText('Alice')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /carga de trabalho/i })).toHaveAttribute('aria-selected', 'true');
      expect(billingCalls()).toHaveLength(0);
    });

    it('trocar de aba atualiza a query string', async () => {
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /faturamento base/i }));

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('aba=BILLING'));
    });

    it('os filtros de faturamento vêm da URL e voltam para ela', async () => {
      loginAs('ADMIN');
      renderPage('/reports?aba=BILLING&contrato=c1&de=2026-01&ate=2026-03');

      await screen.findByText('Empresa A');
      expect(screen.getByLabelText('Ciclos desde')).toHaveValue('2026-01');
      expect(screen.getByLabelText(/Ciclos até/)).toHaveValue('2026-03');
      expect(billingCalls().some((call) => billingParams(call).contractId === 'c1')).toBe(true);

      fireEvent.change(screen.getByLabelText('Ciclos desde'), { target: { value: '2026-02' } });
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('de=2026-02'));
    });
  });
});
