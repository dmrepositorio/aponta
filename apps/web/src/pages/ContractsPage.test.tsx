import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { ContractsPage } from './ContractsPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const contracts = [
  {
    id: 'c1',
    organizationId: 'org-1',
    organization: { name: 'Empresa A' },
    type: 'HOURS_LIMIT',
    active: true,
    monthlyValue: 5000,
    hoursLimit: 40,
    adjustmentDate: '2026-01-15T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'c2',
    organizationId: 'org-2',
    organization: { name: 'Empresa B' },
    type: 'COVERAGE',
    active: true,
    createdAt: '2025-02-01T00:00:00.000Z',
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/contracts']}>
        <Routes>
          <Route path="/contracts" element={<ContractsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginAs(role: 'ADMIN' | 'AGENT' | 'CLIENT_MASTER') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'user@aponta.com', role },
  });
}

describe('ContractsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    // The screen-config tests below exercise useUserScreenConfig; keep each test isolated.
    localStorage.clear();
  });

  it('shows a loading state while contracts are being fetched', () => {
    vi.mocked(api.get).mockReturnValue(
      new Promise(() => {
        // Never resolves, keeping the query in its loading state.
      }),
    );
    loginAs('ADMIN');
    renderPage();

    expect(screen.getByText(/carregando contratos/i)).toBeInTheDocument();
  });

  it('shows an error state when the contracts request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network error'));
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/erro ao carregar os contratos/i),
      ).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no contracts', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/nenhum contrato encontrado/i),
      ).toBeInTheDocument();
    });
  });

  it('shows financial columns (valor mensal / reajuste) for ADMIN', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    expect(screen.getByText(/R\$ 5\.000/)).toBeInTheDocument();
    expect(screen.getByText('Pacote: 40h')).toBeInTheDocument();
    expect(screen.getByText('Cobertura')).toBeInTheDocument();
  });

  it('shows financial columns for CLIENT_MASTER as well', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('CLIENT_MASTER');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/R\$ 5\.000/)).toBeInTheDocument();
    });
  });

  it('hides financial columns for AGENT (masked by the backend, but double-check the UI gate too)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('AGENT');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    expect(screen.queryByText(/R\$ 5\.000/)).not.toBeInTheDocument();
    expect(screen.queryByText('Aditivo / Global')).not.toBeInTheDocument();
    expect(screen.queryByText('Reajuste')).not.toBeInTheDocument();
  });

  it('displays inactive contracts and zero money honestly', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ ...contracts[0], active: false, monthlyValue: 0 }],
    });
    loginAs('ADMIN');
    renderPage();
    expect(await screen.findByText('Inativo')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*0,00/)).toBeInTheDocument();
  });

  it('lets admins create with explicit excess rate and minute allowance', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data:
        url === '/organizations' ? [{ id: 'org-1', name: 'Empresa A' }] : [],
    }));
    vi.mocked(api.post).mockResolvedValue({
      data: { ...contracts[0], name: 'Suporte' },
    });
    loginAs('ADMIN');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo contrato' }));
    await screen.findByRole('option', { name: 'Empresa A', hidden: true });
    fireEvent.change(screen.getByLabelText(/Nome do contrato/), {
      target: { value: 'Suporte' },
    });
    fireEvent.change(await screen.findByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org-1' },
    });
    fireEvent.change(screen.getByLabelText('Modalidade', { selector: 'select' }), {
      target: { value: 'MONTHLY_HOURS' },
    });
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), {
      target: { value: '10.5' },
    });
    fireEvent.change(screen.getByLabelText('Hora excedente (R$)'), {
      target: { value: '120.25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/contracts',
        expect.objectContaining({
          name: 'Suporte',
          organizationId: 'org-1',
          includedMinutes: 630,
          excessHourlyRateCents: 12025,
        }),
      ),
    );
  });

  it('prevents non-admin management and hides detail financial data', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('AGENT');
    renderPage();
    expect(await screen.findByText('Empresa A')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Novo contrato' }),
    ).not.toBeInTheDocument();

    vi.mocked(api.get).mockResolvedValue({ data: contracts[0] });
    fireEvent.click(screen.getAllByRole('button', { name: /Ver detalhes/ })[0]);
    expect(await screen.findByText('Mesas cobertas')).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Editar contrato' }),
    ).not.toBeInTheDocument();
  });

  it('opens a contract\'s detail as a full page (no dialog) and returns to the list via the back button', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url === '/contracts/c1' ? contracts[0] : contracts,
    }));
    loginAs('ADMIN');
    renderPage();

    await screen.findByText('Empresa A');
    fireEvent.click(screen.getAllByRole('button', { name: /Ver detalhes/ })[0]);

    expect(await screen.findByText('Mesas cobertas')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Editar contrato' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Voltar'));

    await waitFor(() => {
      expect(screen.queryByText('Mesas cobertas')).not.toBeInTheDocument();
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
      expect(screen.getByText('Empresa B')).toBeInTheDocument();
    });
  });

  it('navigates between contracts using the toolbar Anterior/Próximo buttons', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/contracts/c1') return { data: contracts[0] };
      if (url === '/contracts/c2') return { data: contracts[1] };
      return { data: contracts };
    });
    loginAs('ADMIN');
    renderPage();

    await screen.findByText('Empresa A');
    fireEvent.click(screen.getAllByRole('button', { name: /Ver detalhes/ })[0]);

    await waitFor(() => {
      expect(screen.getByTestId('ez-toolbar-record-count')).toHaveTextContent(
        '1 de 2',
      );
    });
    expect(screen.getByTestId('ez-toolbar-previous-button')).toBeDisabled();
    expect(screen.getByTestId('ez-toolbar-next-button')).toBeEnabled();

    fireEvent.click(screen.getByTestId('ez-toolbar-next-button'));
    await waitFor(() => {
      expect(screen.getByTestId('ez-toolbar-record-count')).toHaveTextContent(
        '2 de 2',
      );
    });
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-next-button')).toBeDisabled();

    fireEvent.click(screen.getByTestId('ez-toolbar-previous-button'));
    await waitFor(() => {
      expect(screen.getByTestId('ez-toolbar-record-count')).toHaveTextContent(
        '1 de 2',
      );
    });
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
  });

  it('shows a dedicated "Novo contrato" button directly on the toolbar for ADMIN, opening the full-page form', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url === '/organizations' ? [] : contracts,
    }));
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    const insertButton = screen.getByRole('button', { name: 'Novo contrato' });
    expect(insertButton).toBeInTheDocument();
    fireEvent.click(insertButton);

    // Full-page form (Sankhya "Modo Formulário") — no modal/dialog anymore.
    expect(await screen.findByLabelText('Nome do contrato')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTitle('Voltar')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Voltar'));
    await waitFor(() => {
      expect(screen.queryByLabelText('Nome do contrato')).not.toBeInTheDocument();
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });
  });

  const namedContracts = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `c${i + 1}`,
      organizationId: `org-${i + 1}`,
      organization: { name: `Empresa ${i + 1}` },
      name: `Contrato ${i + 1}`,
      type: 'COVERAGE',
      active: true,
      createdAt: `2025-0${(i % 9) + 1}-01T00:00:00.000Z`,
    }));

  const openDeleteDialog = async (
    user: ReturnType<typeof userEvent.setup>,
    rowsToSelect: number | 'all',
  ) => {
    const checkboxes = screen.getAllByRole('checkbox');
    if (rowsToSelect === 'all') {
      await user.click(checkboxes[0]);
    } else {
      for (let i = 1; i <= rowsToSelect; i += 1) await user.click(checkboxes[i]);
    }
    await user.click(screen.getByTestId('ez-toolbar-delete-button'));
    return screen.findByRole('dialog');
  };

  it('asks for confirmation in a DS dialog that names the contract before deleting', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: namedContracts(2) });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const confirmSpy = vi.spyOn(window, 'confirm');
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    const dialog = await openDeleteDialog(user, 1);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Contrato 1 · Empresa 1')).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/contracts/c1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    confirmSpy.mockRestore();
  });

  it('lists up to five contract names and counts the rest', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: namedContracts(7) });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    const dialog = await openDeleteDialog(user, 'all');

    expect(within(dialog).getAllByRole('listitem')).toHaveLength(5);
    expect(within(dialog).getByText('e mais 2')).toBeInTheDocument();
  });

  it('cancels the deletion without calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: namedContracts(2) });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    const dialog = await openDeleteDialog(user, 1);
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-delete-button'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('lists each failed contract with its own message and keeps only the failed ones selected', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: namedContracts(3) });
    vi.mocked(api.delete).mockImplementation(async (url: string) => {
      if (url === '/contracts/c1') return { data: {} };
      throw { response: { data: { message: `Falha em ${url.split('/').pop()}` } } };
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    const dialog = await openDeleteDialog(user, 'all');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    const failures = await within(dialog).findAllByRole('listitem');
    expect(failures).toHaveLength(2);
    expect(failures[0]).toHaveTextContent('Contrato 2 · Empresa 2');
    expect(failures[0]).toHaveTextContent('Falha em c2');
    expect(failures[1]).toHaveTextContent('Contrato 3 · Empresa 3');
    expect(failures[1]).toHaveTextContent('Falha em c3');
    expect(within(dialog).queryByText(/Contrato 1 ·/)).not.toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-delete-button')).toHaveAttribute(
      'title',
      'Excluir 2 selecionado(s)',
    );
  });

  it('retries only the contracts that failed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: namedContracts(3) });
    vi.mocked(api.delete).mockImplementation(async (url: string) => {
      if (url === '/contracts/c1') return { data: {} };
      throw { response: { data: { message: 'Contrato com apontamentos não pode ser excluído' } } };
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    const dialog = await openDeleteDialog(user, 'all');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await within(dialog).findAllByRole('listitem');
    expect(api.delete).toHaveBeenCalledTimes(3);

    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    await user.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledTimes(5);
    });
    expect(
      vi.mocked(api.delete).mock.calls.filter(([url]) => url === '/contracts/c1'),
    ).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('disables Confirmar while the deletion is running', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: namedContracts(2) });
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(api.delete).mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    const dialog = await openDeleteDialog(user, 1);
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    });
    expect(api.delete).toHaveBeenCalledTimes(1);

    finish({ data: {} });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('disables the toolbar delete button while a contract form is open', async () => {
    const list = namedContracts(2);
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/contracts/c1' ? list[0] : url === '/contracts/c2' ? list[1] : list,
    }));
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa 1');
    await user.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByTestId('ez-toolbar-delete-button')).toBeEnabled();

    await user.click(screen.getAllByRole('button', { name: /Ver detalhes/ })[0]);
    await waitFor(() => {
      expect(screen.getByTestId('ez-toolbar-record-count')).toHaveTextContent('1 de 2');
    });
    expect(screen.getByTestId('ez-toolbar-delete-button')).toBeDisabled();
  });

  it('does not show the delete button for AGENT, who cannot manage contracts', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('AGENT');
    renderPage();

    await screen.findByText('Empresa A');
    expect(
      screen.queryByRole('button', { name: 'Excluir' }),
    ).not.toBeInTheDocument();
  });

  it('renders the Sankhya standard filter drawer and screen config modal (parity with Clientes)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');

    expect(screen.getByTestId('ez-toolbar-filter-panel-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-screen-config-button')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    expect(within(drawer).getByText('Filtros de Contratos')).toBeInTheDocument();
    expect(
      within(drawer).getByLabelText(/buscar contrato\/empresa/i),
    ).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/^status$/i)).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-screen-config-button'));
    const modal = screen.getByTestId('ez-entity-screen-config-modal');
    expect(
      within(modal).getByText('Personalização da Tela (Usuário)'),
    ).toBeInTheDocument();
    expect(within(modal).getByText('Contrato')).toBeInTheDocument();
  });

  it('filters contracts by name or company on the client side via the filter drawer', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    await user.type(
      within(drawer).getByLabelText(/buscar contrato\/empresa/i),
      'Empresa A',
    );
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.queryByText('Empresa B')).not.toBeInTheDocument();

    // No server-side search should ever be issued: only the initial load.
    expect(api.get).toHaveBeenCalledWith('/contracts', { params: undefined });
    expect(api.get).not.toHaveBeenCalledWith(
      '/contracts',
      expect.objectContaining({ params: { search: expect.anything() } }),
    );

    await user.click(screen.getByTestId('ez-filter-drawer-clear'));
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
  });

  it('filters contracts by status (Ativo/Inativo) via the filter drawer', async () => {
    const statusContracts = [
      { ...contracts[0], active: true },
      { ...contracts[1], active: false },
    ];
    vi.mocked(api.get).mockResolvedValue({ data: statusContracts });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    await user.selectOptions(
      within(drawer).getByLabelText(/^status$/i),
      'INACTIVE',
    );
    expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.selectOptions(within(drawer).getByLabelText(/^status$/i), 'ALL');
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
  });

  it('filters dynamically by modality using the rule builder (Sankhya Filtros parity)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    await user.click(within(drawer).getByTestId('ez-dynamic-filter-add'));

    const rule = within(drawer).getByTestId('ez-dynamic-filter-rule');
    await user.selectOptions(within(rule).getByLabelText('Campo', { selector: 'select' }), 'modality');
    await user.selectOptions(within(rule).getByLabelText('Valor', { selector: 'select' }), 'Cobertura');

    expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-filter-drawer-clear'));
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
  });

  it('saves, applies, and deletes a saved filter from the drawer (Sankhya saved filters parity)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    await user.type(
      within(drawer).getByLabelText(/buscar contrato\/empresa/i),
      'Empresa A',
    );
    await user.click(within(drawer).getByTestId('ez-filter-drawer-save-btn'));
    await user.type(
      within(drawer).getByTestId('ez-filter-drawer-name-input'),
      'Só Empresa A',
    );
    await user.click(within(drawer).getByTestId('ez-filter-drawer-confirm-save'));

    const savedList = await within(drawer).findByTestId(
      'ez-filter-drawer-saved-list',
    );
    expect(within(savedList).getByText('Só Empresa A')).toBeInTheDocument();

    await user.clear(within(drawer).getByLabelText(/buscar contrato\/empresa/i));
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.click(within(savedList).getByText('Só Empresa A'));
    expect(
      within(drawer).getByLabelText(/buscar contrato\/empresa/i),
    ).toHaveValue('Empresa A');
    expect(screen.queryByText('Empresa B')).not.toBeInTheDocument();

    await user.click(
      within(savedList).getByLabelText(/excluir filtro só empresa a/i),
    );
    expect(within(savedList).queryByText('Só Empresa A')).not.toBeInTheDocument();
  });

  it('edits via the update command without turning zero into missing money', async () => {
    const zero = {
      ...contracts[0],
      name: 'Suporte',
      monthlyValue: 0,
      excessHourlyRateCents: 0,
    };
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data:
        url === '/organizations'
          ? [{ id: 'org-1', name: 'Empresa A' }]
          : url === '/contracts/c1'
            ? zero
            : [zero],
    }));
    vi.mocked(api.post).mockResolvedValue({ data: zero });
    loginAs('ADMIN');
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ver detalhes Suporte' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar contrato' }),
    );
    await screen.findByRole('option', { name: 'Empresa A', hidden: true });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Salvar contrato' }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Nome do contrato'), {
      target: { value: 'Suporte atualizado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/contracts/c1/update',
        expect.objectContaining({
          name: 'Suporte atualizado',
          monthlyValue: 0,
          excessHourlyRateCents: 0,
        }),
      ),
    );
  });

  it('validates reversed dates before saving', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data:
        url === '/organizations' ? [{ id: 'org-1', name: 'Empresa A' }] : [],
    }));
    loginAs('ADMIN');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo contrato' }));
    await screen.findByRole('option', { name: 'Empresa A', hidden: true });
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org-1' },
    });
    fireEvent.change(screen.getByLabelText('Início da vigência'), {
      target: { value: '2026-10-15' },
    });
    fireEvent.change(screen.getByLabelText('Fim da vigência'), {
      target: { value: '2026-10-14' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(
      await screen.findByText(
        'O fim da vigência deve ser igual ou posterior ao início.',
      ),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

// Grade de Contratos (SPEC DMTE-536): ação visível, uma linha por célula, estado em tags e um vocabulário só.
describe('ContractsPage grid (DMTE-536)', () => {
  const longName = 'Suporte mensal Sankhya ERP — Matriz e filiais (inclui sobreaviso)';
  const longCompany = 'Cooperativa Agroindustrial do Vale do Sul Ltda';
  const gridContracts = [
    {
      id: 'g1',
      organizationId: 'o1',
      organization: { name: longCompany },
      name: longName,
      type: 'MONTHLY_HOURS',
      active: true,
      approved: true,
      monthlyFeeCents: 850000,
      excessHourlyRateCents: 19000,
      adjustmentDate: '2027-01-15T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'g2',
      organizationId: 'o2',
      organization: { name: 'Mercado Bom Preço' },
      name: 'Horas avulsas',
      type: 'HOURLY',
      active: true,
      approved: false,
      createdAt: '2025-02-01T00:00:00.000Z',
    },
    {
      id: 'g3',
      organizationId: 'o3',
      organization: { name: 'Clínica Sorriso' },
      name: 'Pacote legado',
      type: 'HOURS_LIMIT',
      hoursLimit: 20,
      active: false,
      approved: true,
      createdAt: '2025-03-01T00:00:00.000Z',
    },
  ];

  function mockGrid() {
    vi.mocked(api.get).mockImplementation(async (url) => {
      const detail = gridContracts.find((c) => url === `/contracts/${c.id}`);
      return { data: detail ?? gridContracts };
    });
    loginAs('ADMIN');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    localStorage.clear();
  });

  it('opens the detail from the contract name button and has no Ações column', async () => {
    mockGrid();
    renderPage();

    const open = await screen.findByRole('button', { name: `Ver detalhes ${longName}` });
    expect(open).toHaveTextContent(longName);
    expect(screen.queryByText('Ver detalhes')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Ações/ })).not.toBeInTheDocument();

    fireEvent.click(open);
    expect(await screen.findByText('Mesas cobertas')).toBeInTheDocument();
  });

  it('opens the detail of the row on double click', async () => {
    mockGrid();
    renderPage();

    const row = (await screen.findByRole('button', { name: 'Ver detalhes Horas avulsas' })).closest('tr');
    fireEvent.doubleClick(row as HTMLElement);

    expect(await screen.findByText('Mesas cobertas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horas avulsas' })).toBeInTheDocument();
  });

  it('keeps Contrato and Empresa on one line with the full text in the title, and fixed column widths', async () => {
    mockGrid();
    renderPage();

    const name = await screen.findByRole('button', { name: `Ver detalhes ${longName}` });
    expect(name).toHaveClass('truncate');
    expect(name).toHaveAttribute('title', longName);
    const company = screen.getByText(longCompany);
    expect(company).toHaveClass('truncate');
    expect(company).toHaveAttribute('title', longCompany);

    const headers = screen.getAllByRole('columnheader');
    const width = (label: string) =>
      headers.find((header) => header.textContent?.includes(label))?.style.width;
    expect(width('Contrato')).toBe('180px');
    expect(width('Empresa')).toBe('166px');
    expect(width('Modalidade')).toBe('188px');
    expect(width('Situação')).toBe('300px');
    expect(width('Valor mensal')).toBe('156px');
    const total = headers.reduce((sum, header) => sum + parseInt(header.style.width, 10), 0);
    expect(total).toBeLessThanOrEqual(1076);
  });

  it('shows Ativo/Inativo and the approval state as tags with text and icon in one Situação column', async () => {
    mockGrid();
    renderPage();

    await screen.findByRole('button', { name: `Ver detalhes ${longName}` });
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.some((text) => text?.includes('Situação'))).toBe(true);

    expect(screen.getAllByText('Ativo')).toHaveLength(2);
    expect(screen.getAllByText('Aprovado')).toHaveLength(1);
    expect(screen.getAllByText('Rascunho')).toHaveLength(1);
    expect(screen.getAllByText('Regularização pendente')).toHaveLength(1);
    for (const label of ['Inativo', 'Rascunho', 'Regularização pendente']) {
      expect(screen.getByText(label).closest('[data-ez-tag]')?.querySelector('[data-glyph]')).not.toBeNull();
    }
    expect(screen.queryByText('Pendente')).not.toBeInTheDocument();
  });

  it('uses the same approval words in the detail', async () => {
    mockGrid();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalhes Horas avulsas' }));
    await screen.findByText('Mesas cobertas');
    expect(screen.getByText('Aprovação').parentElement).toHaveTextContent('Rascunho');

    fireEvent.click(screen.getByTitle('Voltar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalhes Pacote legado' }));
    await screen.findByText('Mesas cobertas');
    expect(screen.getByText('Aprovação').parentElement).toHaveTextContent('Regularização pendente');
  });

  it('filters by the same approval words, including Rascunho and Regularização pendente', async () => {
    mockGrid();
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Mercado Bom Preço');
    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    await user.click(within(drawer).getByTestId('ez-dynamic-filter-add'));
    const rule = within(drawer).getByTestId('ez-dynamic-filter-rule');
    await user.selectOptions(within(rule).getByLabelText('Campo', { selector: 'select' }), 'approved');

    const value = within(rule).getByLabelText('Valor', { selector: 'select' });
    const options = within(value).getAllByRole('option', { hidden: true }).map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['Aprovado', 'Rascunho', 'Regularização pendente']));
    expect(options).not.toContain('Pendente');

    await user.selectOptions(value, 'Regularização pendente');
    expect(screen.getByText('Clínica Sorriso')).toBeInTheDocument();
    expect(screen.queryByText('Mercado Bom Preço')).not.toBeInTheDocument();

    await user.selectOptions(value, 'Rascunho');
    expect(screen.getByText('Mercado Bom Preço')).toBeInTheDocument();
    expect(screen.queryByText('Clínica Sorriso')).not.toBeInTheDocument();
  });

  it('starts with Hora excedente and Reajuste hidden but still configurable', async () => {
    mockGrid();
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: `Ver detalhes ${longName}` });
    const headerText = () => screen.getAllByRole('columnheader').map((header) => header.textContent ?? '');
    expect(headerText().some((text) => text.includes('Valor mensal'))).toBe(true);
    expect(headerText().some((text) => text.includes('Hora excedente'))).toBe(false);
    expect(headerText().some((text) => text.includes('Reajuste'))).toBe(false);

    await user.click(screen.getByTestId('ez-toolbar-screen-config-button'));
    expect(screen.getByTestId('ez-screen-config-toggle-situation')).toBeInTheDocument();
    expect(screen.getByTestId('ez-screen-config-toggle-monthlyValue')).toBeChecked();
    expect(screen.getByTestId('ez-screen-config-toggle-excessHourlyRate')).not.toBeChecked();
    expect(screen.getByTestId('ez-screen-config-toggle-adjustmentDate')).not.toBeChecked();

    // A grade lê a visibilidade só ao montar; o que o usuário liga fica salvo para a próxima abertura.
    await user.click(screen.getByTestId('ez-screen-config-toggle-excessHourlyRate'));
    // DMTE-527 T2: a preferência é gravada no servidor (mockGrid devolve lista para qualquer GET: vira padrões).
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/me/screen-preferences/contracts',
        expect.objectContaining({
          grid: expect.objectContaining({ columnVisibility: expect.objectContaining({ excessHourlyRate: true }) }),
        }),
      ),
    );
    expect(localStorage.getItem('aponta_screen_config_u-1_contracts')).toBeNull();
  });

  it('DMTE-541 AC-08: the filter panel sits in a positioned container so it can overlay the grid below xl', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: contracts });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    expect(drawer.parentElement).toHaveClass('relative');
    expect(drawer).toHaveClass('absolute', 'xl:relative');
  });
});

// Erro do formulário (SPEC DMTE-539): o alerta vai para a vista e recebe o foco, para quem está no botão Salvar.
describe('ContractsPage form errors (DMTE-539)', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    localStorage.clear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  async function openNewForm() {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url === '/organizations' ? [{ id: 'org-1', name: 'Empresa A' }] : [],
    }));
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Novo contrato' }));
    await screen.findByRole('option', { name: 'Empresa A', hidden: true });
    return user;
  }

  it('moves focus to the validation alert and scrolls it into view when the form is invalid', async () => {
    const user = await openNewForm();

    await user.click(screen.getByRole('button', { name: 'Salvar contrato' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Selecione a empresa.');
    expect(alert.parentElement).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('moves focus to the alert with the API message when saving fails', async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { data: { message: 'Contrato duplicado.' } },
    });
    const user = await openNewForm();
    fireEvent.change(await screen.findByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org-1' },
    });

    await user.click(screen.getByRole('button', { name: 'Salvar contrato' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Contrato duplicado.');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('moves focus again on every failed attempt, even with the same message', async () => {
    const user = await openNewForm();

    await user.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect((await screen.findByRole('alert')).parentElement).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(screen.getByRole('alert').parentElement).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
