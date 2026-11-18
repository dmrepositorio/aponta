import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { ServiceDesksPage } from './ServiceDesksPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const serviceDesks = [
  {
    id: 'sd-1',
    name: 'Suporte N1',
    createdAt: '2026-09-29T10:00:00.000Z',
    priorities: [
      { id: 'p1', ticketPriority: 'HIGH', label: 'Alta', enabled: true },
      { id: 'p2', ticketPriority: 'LOW', label: 'Baixa', enabled: false },
    ],
    ticketSections: [
      { id: 's1', key: 'GENERAL_INFO', enabled: true, sortOrder: 0 },
      { id: 's2', key: 'WORKLOGS', enabled: true, sortOrder: 1 },
    ],
  },
  { id: 'sd-2', name: 'Infraestrutura', createdAt: '2026-09-29T10:00:00.000Z' },
];

const organizations = [{ id: 'org-1', name: 'Acme Ltda' }];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/service-desks') {
      return Promise.resolve({ data: serviceDesks });
    }
    if (url === '/organizations') {
      return Promise.resolve({ data: organizations });
    }
    if (url === '/users/agents') {
      return Promise.resolve({ data: [] });
    }
    if (String(url).includes('/stages')) {
      return Promise.resolve({
        data: [
          {
            id: 'st-1',
            name: 'Pendente',
            position: 0,
            isInitial: true,
            isFinal: false,
            transitionToIds: [],
          },
        ],
      });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/service-desks']}>
        <Routes>
          <Route path="/service-desks" element={<ServiceDesksPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginAs(role: 'ADMIN' | 'AGENT' | 'CLIENT') {
  // Same decode-free shortcut the rest of the web suite uses: set the
  // store's `user` directly rather than crafting a real JWT, since the
  // page only reads `useAuthStore` state, never decodes a token itself.
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'admin@aponta.com', role },
  });
}

describe('ServiceDesksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet();
    useAuthStore.setState({ token: null, user: null });
  });

  it('should list existing service desks for an ADMIN user', async () => {
    loginAs('ADMIN');
    renderPage();

    expect(await screen.findByText('Suporte N1')).toBeInTheDocument();
    expect(screen.getByText('Infraestrutura')).toBeInTheDocument();
    expect(screen.getByTestId('ez-entity-grid-pagination-count')).toHaveTextContent('1-2 de 2');
    expect(screen.getByLabelText(/linhas por página/i, { selector: 'select' })).toBeInTheDocument();
  });

  it('keeps the grid scrollable by touch in both axes on phones (DMTE-455)', async () => {
    loginAs('ADMIN');
    renderPage();

    await screen.findByText('Suporte N1');
    const content = screen.getByTestId('service-desks-grid-content');
    expect(content).toHaveClass('touch-pan-x', 'touch-pan-y', 'overscroll-x-contain');
  });

  it('should show the Sankhya-standard entity toolbar with Incluir, Recarregar, and column config', async () => {
    loginAs('ADMIN');
    renderPage();
    await screen.findByText('Suporte N1');

    expect(screen.getByTestId('ez-entity-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-insert-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-refresh-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-screen-config-button')).toBeInTheDocument();

    // Delete and Duplicate are present but disabled until a row is selected.
    expect(screen.getByTestId('ez-toolbar-delete-button')).toBeDisabled();
    expect(screen.getByTestId('ez-toolbar-clone-button')).toBeDisabled();
  });

  it('should enable Excluir and Duplicar once a row is selected, and call the delete endpoint on confirmation', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();
    await screen.findByText('Suporte N1');

    const rowCheckboxes = screen.getAllByRole('checkbox');
    // First checkbox in the grid body belongs to the "Suporte N1" row.
    await user.click(rowCheckboxes[1]);

    expect(screen.getByTestId('ez-toolbar-delete-button')).toBeEnabled();
    expect(screen.getByTestId('ez-toolbar-clone-button')).toBeEnabled();

    await user.click(screen.getByTestId('ez-toolbar-delete-button'));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/service-desks/sd-1');
    });

    confirmSpy.mockRestore();
  });

  it('should open the create form only after clicking Incluir, and create a new service desk', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    const created = {
      id: 'sd-3',
      name: 'Financeiro',
      createdAt: '2026-09-30T10:00:00.000Z',
    };
    vi.mocked(api.post).mockResolvedValue({ data: created });

    renderPage();
    await screen.findByText('Suporte N1');

    // The create form is not shown until the user explicitly asks for it.
    expect(screen.queryByLabelText(/^nome \*?$/i)).not.toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-insert-button'));

    const nameInput = await screen.findByRole('textbox', { name: /^nome \*$/i });
    await user.type(nameInput, 'Financeiro');
    await user.click(screen.getByRole('button', { name: /criar/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/service-desks', {
        name: 'Financeiro',
      });
    });
  });

  it('should not submit when the name field is empty', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');

    await user.click(screen.getByTestId('ez-toolbar-insert-button'));
    await user.click(screen.getByRole('button', { name: /criar/i }));

    expect(await screen.findByText(/nome é obrigatório/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('should show an access-denied message for a non-ADMIN user', () => {
    loginAs('CLIENT');
    renderPage();

    expect(
      screen.getByText(/não tem permissão/i),
    ).toBeInTheDocument();
    // Só a preferência de tela do próprio usuário é lida (DMTE-527 T2); nenhum dado de Mesa.
    expect(vi.mocked(api.get).mock.calls.every(([url]) => url === '/me/screen-preferences/service-desks')).toBe(true);
  });

  it('shows Portuguese labels for ticket sections instead of database keys', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));
    await user.click(await screen.findByRole('tab', { name: 'Seções do ticket' }));

    expect(await screen.findByLabelText('Informações gerais')).toBeInTheDocument();
    expect(screen.getByLabelText('Apontamentos')).toBeInTheDocument();
    expect(screen.queryByText('GENERAL_INFO')).not.toBeInTheDocument();
    expect(screen.queryByText('WORKLOGS')).not.toBeInTheDocument();
  });

  it('should link a service desk to a client and save its SLA overrides', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });

    renderPage();
    await screen.findByText('Suporte N1');

    // The grid only shows a summary; opening the desk's name navigates
    // into the detail view (Sankhya "Modo Formulário") where the full
    // editors (incl. SLA) live.
    await user.click(screen.getByText('Suporte N1'));

    expect(await screen.findByRole('tab', { name: 'Informações básicas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Parâmetros' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Estágio' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /editar cliente e sla/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Clientes' }));
    const editSlaButton = await screen.findByRole('button', { name: /editar cliente e sla/i });
    await user.click(editSlaButton);

    const orgSelect = await screen.findByLabelText(/adicionar cliente/i, { selector: 'select' });
    await user.selectOptions(orgSelect, 'org-1');

    const criticalResponseInput = screen.getByLabelText(/1ª resposta \(pad\. 1h\)/i);
    await user.clear(criticalResponseInput);
    await user.type(criticalResponseInput, '2');

    await user.click(screen.getByRole('button', { name: /salvar cliente e sla/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/service-desks/sd-1',
        expect.objectContaining({
          organizationIds: ['org-1'],
          slaCriticalResponseHours: 2,
        }),
      );
      // `organizationId` (vínculo único legado) não existe no DTO: a API recusa o campo (forbidNonWhitelisted).
      expect(vi.mocked(api.patch).mock.calls[0][1]).not.toHaveProperty('organizationId');
    });
  });

  it('DMTE-560 AC-27: a aba Clientes lista os clientes vinculados (N:N) e permite desvincular um deles', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/service-desks') {
        return Promise.resolve({
          data: [{ ...serviceDesks[0], organizations: [{ id: 'org-1', name: 'Acme Ltda' }, { id: 'org-2', name: 'Beta SA' }] }, serviceDesks[1]],
        });
      }
      if (url === '/organizations') {
        return Promise.resolve({ data: [...organizations, { id: 'org-2', name: 'Beta SA' }] });
      }
      return base(url);
    });

    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));
    await user.click(await screen.findByRole('tab', { name: 'Clientes' }));

    const panel = screen.getByRole('tabpanel');
    expect(within(within(panel).getByRole('list', { name: 'Clientes vinculados' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(panel).getByText('Acme Ltda')).toBeInTheDocument();
    expect(within(panel).getByText('Beta SA')).toBeInTheDocument();
    expect(within(panel).queryByText(/mesa compartilhada/i)).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: /editar cliente e sla/i }));
    await user.click(within(panel).getByRole('button', { name: 'Desvincular Beta SA' }));
    await user.click(within(panel).getByRole('button', { name: /salvar cliente e sla/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/service-desks/sd-1', expect.objectContaining({ organizationIds: ['org-1'] }));
    });
  });

  it('DMTE-560 AC-27: sem nenhum cliente a aba mostra "Mesa compartilhada (sem cliente)" e, ao editar, deixa adicionar um cliente', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));
    await user.click(await screen.findByRole('tab', { name: 'Clientes' }));

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Mesa compartilhada (sem cliente)')).toBeInTheDocument();
    expect(within(panel).queryByRole('list', { name: 'Clientes vinculados' })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: /editar cliente e sla/i }));
    expect(within(panel).getByText(/atende todos os clientes/i)).toBeInTheDocument();
    await user.selectOptions(await within(panel).findByLabelText(/adicionar cliente/i, { selector: 'select' }), 'org-1');

    const list = within(panel).getByRole('list', { name: 'Clientes vinculados' });
    expect(within(list).getByText('Acme Ltda')).toBeInTheDocument();
    expect(within(panel).queryByText(/atende todos os clientes/i)).not.toBeInTheDocument();
  });

  it("DMTE-485 AC-13: a opção de catálogo da mesa aparece como \"Mostrar o catálogo ao abrir (permite 'não catalogado')\"", async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));
    await user.click(await screen.findByRole('tab', { name: 'Parâmetros' }));

    expect(
      await screen.findByLabelText("Mostrar o catálogo ao abrir (permite 'não catalogado')"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Catálogo obrigatório ao abrir')).not.toBeInTheDocument();
  });

  it('shows the Sankhya-standard filter drawer with search, status and dynamic filter fields', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');

    expect(screen.getByTestId('ez-toolbar-filter-panel-button')).toBeInTheDocument();
    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));

    const drawer = screen.getByTestId('ez-filter-drawer');
    expect(drawer).toBeInTheDocument();
    expect(screen.getByText('Filtros de Mesas')).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/buscar mesa/i)).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/^status$/i)).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-filter-drawer-close'));
    expect(screen.queryByTestId('ez-filter-drawer')).not.toBeInTheDocument();
  });

  it('filters the grid by search text and status (Sankhya filter drawer)', async () => {
    const filterableDesks = [
      { id: 'sd-1', name: 'Suporte N1', active: true, createdAt: '2026-09-29T10:00:00.000Z' },
      { id: 'sd-2', name: 'Infraestrutura', active: false, createdAt: '2026-09-29T10:00:00.000Z' },
    ];
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/service-desks') return Promise.resolve({ data: filterableDesks });
      if (url === '/organizations') return Promise.resolve({ data: organizations });
      if (url === '/users/agents') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Suporte N1');
    expect(screen.getByText('Infraestrutura')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    // Search text narrows to the matching name only.
    await user.type(within(drawer).getByLabelText(/buscar mesa/i), 'Suporte');
    expect(screen.getByText('Suporte N1')).toBeInTheDocument();
    expect(screen.queryByText('Infraestrutura')).not.toBeInTheDocument();
    await user.clear(within(drawer).getByLabelText(/buscar mesa/i));

    // Status filter narrows to inactive desks only.
    await user.selectOptions(within(drawer).getByLabelText(/^status$/i), 'INACTIVE');
    expect(screen.queryByText('Suporte N1')).not.toBeInTheDocument();
    expect(screen.getByText('Infraestrutura')).toBeInTheDocument();

    // Clearing the drawer resets every filter back to showing both.
    await user.click(screen.getByTestId('ez-filter-drawer-clear'));
    expect(screen.getByText('Suporte N1')).toBeInTheDocument();
    expect(screen.getByText('Infraestrutura')).toBeInTheDocument();
  });

  it('filters dynamically by any column using the rule builder (Sankhya Filtros parity)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    await user.click(within(drawer).getByTestId('ez-dynamic-filter-add'));

    const rule = within(drawer).getByTestId('ez-dynamic-filter-rule');
    const fieldOptions = within(within(rule).getByLabelText('Campo', { selector: 'select' }))
      .getAllByRole('option', { hidden: true })
      .map((o) => o.textContent);
    expect(fieldOptions).toEqual(
      expect.arrayContaining(['Nome', 'Nome de exibição', 'Status', 'Recebendo', 'Agentes']),
    );

    await user.type(within(rule).getByLabelText('Valor'), 'Infraestrutura');
    expect(screen.queryByText('Suporte N1')).not.toBeInTheDocument();
    expect(screen.getByText('Infraestrutura')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-filter-drawer-clear'));
    expect(screen.getByText('Suporte N1')).toBeInTheDocument();
  });

  it('saves, applies, and deletes a saved filter from the drawer (Sankhya saved filters parity)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    await user.type(within(drawer).getByLabelText(/buscar mesa/i), 'Suporte');
    await user.click(within(drawer).getByTestId('ez-filter-drawer-save-btn'));
    await user.type(within(drawer).getByTestId('ez-filter-drawer-name-input'), 'Só Suporte');
    await user.click(within(drawer).getByTestId('ez-filter-drawer-confirm-save'));

    const savedList = await within(drawer).findByTestId('ez-filter-drawer-saved-list');
    expect(within(savedList).getByText('Só Suporte')).toBeInTheDocument();

    // Clear the live filter, then re-apply it from the saved entry.
    await user.clear(within(drawer).getByLabelText(/buscar mesa/i));
    await user.click(within(savedList).getByText('Só Suporte'));
    expect(within(drawer).getByLabelText(/buscar mesa/i)).toHaveValue('Suporte');

    // Delete the saved filter.
    await user.click(within(savedList).getByLabelText(/excluir filtro só suporte/i));
    expect(within(drawer).queryByText('Só Suporte')).not.toBeInTheDocument();
  });

  describe('DMTE-530: estado e densidade da grade', () => {
    const org = (name: string) => ({ id: `o-${name}`, name });
    const desks = [
      {
        id: 'd-1',
        name: 'Suporte N1',
        displayName: 'Suporte',
        active: true,
        acceptingNewTickets: true,
        organizations: [org('Acme Ltda'), org('Beta Ltda'), org('Gamma Ltda')],
        agents: [{ id: 'a1', name: 'Ana' }],
        createdAt: '2026-09-29T10:00:00.000Z',
      },
      {
        id: 'd-2',
        name: 'Financeiro',
        displayName: 'Fin',
        active: false,
        acceptingNewTickets: false,
        organizations: [org('Delta Ltda')],
        agents: [{ id: 'a1', name: 'Ana' }, { id: 'a2', name: 'Bia' }, { id: 'a3', name: 'Caio' }],
        createdAt: '2026-09-29T10:00:00.000Z',
      },
      {
        id: 'd-3',
        name: 'Comercial',
        displayName: null,
        organizations: [],
        agents: [],
        createdAt: '2026-09-29T10:00:00.000Z',
      },
    ];

    beforeEach(() => {
      const base = vi.mocked(api.get).getMockImplementation();
      vi.mocked(api.get).mockImplementation((url: string, ...rest: unknown[]) =>
        url === '/service-desks'
          ? Promise.resolve({ data: desks })
          : (base as (u: string, ...r: unknown[]) => Promise<unknown>)(url, ...rest),
      );
    });

    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

    it('shows Ativa and Recebendo as tags with text and icon, defaulting to true', async () => {
      loginAs('ADMIN');
      renderPage();
      await screen.findByText('Suporte N1');

      expect(within(rowOf('Suporte N1')).getByText('Ativa')).toBeInTheDocument();
      expect(within(rowOf('Suporte N1')).getByText('Recebendo')).toBeInTheDocument();
      expect(within(rowOf('Financeiro')).getByText('Inativa')).toBeInTheDocument();
      expect(within(rowOf('Financeiro')).getByText('Não recebe')).toBeInTheDocument();
      expect(within(rowOf('Comercial')).getByText('Ativa')).toBeInTheDocument();
      expect(within(rowOf('Comercial')).getByText('Recebendo')).toBeInTheDocument();
    });

    it('mutes the inactive desk row in gray-500 and keeps the name a button', async () => {
      loginAs('ADMIN');
      renderPage();
      await screen.findByText('Suporte N1');

      const name = screen.getByRole('button', { name: 'Financeiro' });
      expect(name).toHaveClass('text-gray-500');
      expect(name).not.toHaveClass('text-brand-700');
      expect(screen.getByText('Fin')).toHaveClass('text-gray-500');
      expect(screen.getByText('Delta Ltda')).toHaveClass('text-gray-500');
      expect(within(rowOf('Financeiro')).getByText('3')).toHaveClass('text-gray-500');

      expect(screen.getByRole('button', { name: 'Suporte N1' })).toHaveClass('text-brand-700');
      expect(screen.getByText('Suporte')).not.toHaveClass('text-gray-500');
    });

    it('mutes the +N chip on an inactive desk with 2 or more clients and keeps its tone on an active one', async () => {
      const base = vi.mocked(api.get).getMockImplementation() as (u: string, ...r: unknown[]) => Promise<unknown>;
      vi.mocked(api.get).mockImplementation((url: string, ...rest: unknown[]) =>
        url === '/service-desks'
          ? Promise.resolve({
              data: [
                { ...desks[0], organizations: [org('Acme Ltda'), org('Beta Ltda')] },
                { ...desks[1], organizations: [org('Delta Ltda'), org('Eta Ltda'), org('Teta Ltda')] },
              ],
            })
          : base(url, ...rest),
      );
      loginAs('ADMIN');
      renderPage();
      await screen.findByText('Suporte N1');

      const activeChip = within(rowOf('Suporte N1')).getByText('+1');
      expect(activeChip).toHaveClass('text-gray-700');
      expect(activeChip).not.toHaveClass('text-gray-500');

      const inactiveChip = within(rowOf('Financeiro')).getByText('+2');
      expect(inactiveChip).toHaveClass('text-gray-500');
      expect(inactiveChip).not.toHaveClass('text-gray-700');
      expect(inactiveChip).toHaveAttribute('title', 'Delta Ltda, Eta Ltda, Teta Ltda');
    });

    it('Clientes shows the first client and a +N chip with the full list in the title', async () => {
      loginAs('ADMIN');
      renderPage();
      await screen.findByText('Suporte N1');

      const row = rowOf('Suporte N1');
      expect(within(row).getByText('Acme Ltda')).toBeInTheDocument();
      expect(within(row).queryByText('Beta Ltda')).not.toBeInTheDocument();
      expect(within(row).getByText('+2')).toBeInTheDocument();
      const holder = within(row).getByText('Acme Ltda').parentElement as HTMLElement;
      expect(holder).toHaveAttribute('title', 'Acme Ltda, Beta Ltda, Gamma Ltda');
      expect(holder).toHaveClass('whitespace-nowrap');
      expect(within(row).getByText('Acme Ltda')).toHaveClass('truncate');

      expect(within(rowOf('Financeiro')).getByText('Delta Ltda')).toBeInTheDocument();
      expect(within(rowOf('Financeiro')).queryByText(/^\+/)).not.toBeInTheDocument();
      // Sem cliente e sem nome de exibição: dois traços na linha.
      expect(within(rowOf('Comercial')).getAllByText('—')).toHaveLength(2);
    });

    it('keeps the grid columns and their order unchanged', async () => {
      loginAs('ADMIN');
      renderPage();
      await screen.findByText('Suporte N1');

      const headers = screen
        .getAllByRole('columnheader')
        .map((h) => h.textContent?.trim())
        .filter(Boolean);
      expect(headers).toEqual(['#', 'Nome', 'Nome de exibição', 'Ativa', 'Recebendo', 'Clientes', 'Agentes']);
    });
  });

  it('DMTE-531 AC-05, AC-06: the desk tabs scroll in one row instead of wrapping, with the same 12 tabs in the same order', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));

    const first = await screen.findByRole('tab', { name: 'Informações básicas' });
    const tablist = first.parentElement as HTMLElement;
    expect(tablist).toHaveAttribute('role', 'tablist');
    expect(tablist.className).not.toContain('flex-wrap');
    expect(tablist.className).not.toContain('overflow-visible');
    expect(tablist).toHaveClass('overflow-x-auto');
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Informações básicas',
      'Parâmetros',
      'Campos obrigatórios',
      'Prioridades',
      'Clientes',
      'Grupos de atendentes',
      'Estágio',
      'Status',
      'Reabertura',
      'Seções do ticket',
      'Revisão',
      'Expediente',
    ]);
  });

  it('DMTE-541 AC-08: the filter panel sits in a positioned container so it can overlay the grid below xl', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    expect(drawer.parentElement).toHaveClass('relative');
    expect(drawer).toHaveClass('absolute', 'xl:relative');
  });

  it('DMTE-532 AC-06: the desk tabs control one labelled tabpanel that follows the active tab', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));
    await screen.findByRole('tab', { name: 'Informações básicas' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(12);
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls');

    const expectPanelOf = (name: string) => {
      const tab = screen.getByRole('tab', { name });
      expect(tab).toHaveAttribute('aria-selected', 'true');
      const panel = screen.getByRole('tabpanel');
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(panel).toHaveAttribute('id', tab.getAttribute('aria-controls'));
      expect(panel).toHaveAttribute('aria-labelledby', tab.getAttribute('id'));
    };

    expectPanelOf('Informações básicas');
    await user.click(screen.getByRole('tab', { name: 'Parâmetros' }));
    expectPanelOf('Parâmetros');

    screen.getByRole('tab', { name: 'Parâmetros' }).focus();
    await user.keyboard('{ArrowRight}');
    expectPanelOf('Campos obrigatórios');
    expect(screen.getByRole('tab', { name: 'Campos obrigatórios' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expectPanelOf('Parâmetros');
    expect(screen.getByRole('tab', { name: 'Parâmetros' })).toHaveFocus();

    // same 12 tabs, same order as before the semantics were added
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Informações básicas',
      'Parâmetros',
      'Campos obrigatórios',
      'Prioridades',
      'Clientes',
      'Grupos de atendentes',
      'Estágio',
      'Status',
      'Reabertura',
      'Seções do ticket',
      'Revisão',
      'Expediente',
    ]);
  });
});

describe('DMTE-533: um só modelo de salvamento, com retorno', () => {
  const PENDING = 'Alterações não salvas nesta aba.';

  async function openDesk(tab?: string) {
    loginAs('ADMIN');
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getByText('Suporte N1'));
    await screen.findByRole('tab', { name: 'Informações básicas' });
    if (tab) await user.click(screen.getByRole('tab', { name: tab }));
    return user;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet();
    useAuthStore.setState({ token: null, user: null });
  });

  it('AC-07: Parâmetros groups the 9 flags in 3 themed fieldsets and keeps the payload keys', async () => {
    const user = await openDesk('Parâmetros');
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => within(group).getByText(/^(Geral|SLA|Revisão e avaliação)$/).textContent)).toEqual([
      'Geral',
      'SLA',
      'Revisão e avaliação',
    ]);
    const labelsOf = (index: number) =>
      within(groups[index]).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
    expect(labelsOf(0)).toEqual([
      'Interação com outras mesas',
      'Permitir cancelar ticket',
      "Mostrar o catálogo ao abrir (permite 'não catalogado')",
      'Abertura só por atendentes',
    ]);
    expect(labelsOf(1)).toEqual([
      'Controle de SLA',
      'Permitir adicionar horas ao SLA',
      'Permitir parar e retomar o SLA',
    ]);
    expect(labelsOf(2)).toEqual(['Fluxo de revisão', 'Avaliação']);

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(Object.keys(vi.mocked(api.patch).mock.calls[0][1] as object).sort()).toEqual(
      [
        'allowAddSlaHours',
        'allowCancelTicket',
        'allowCrossDeskInteraction',
        'allowPauseResumeSla',
        'catalogRequiredOnOpen',
        'evaluationEnabled',
        'openByAgentsOnly',
        'reviewFlowEnabled',
        'slaControlEnabled',
      ].sort(),
    );
  });

  it('AC-04, AC-05: an unsaved flag shows the pending line and asks before leaving the tab; Cancelar keeps it, Confirmar discards it', async () => {
    const user = await openDesk('Parâmetros');
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    expect(screen.getByText(PENDING)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Prioridades' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Descartar alterações?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Parâmetros' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Permitir cancelar ticket')).not.toBeChecked();
    expect(screen.getByText(PENDING)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Prioridades' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('tab', { name: 'Prioridades' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Parâmetros' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Permitir cancelar ticket')).toBeChecked();
  });

  it('AC-04: undoing the edit clears the pending line, and leaving a clean tab never asks', async () => {
    const user = await openDesk('Parâmetros');
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    expect(screen.getByText(PENDING)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Reabertura' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reabertura' })).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-05: the back button and a new desk also ask before discarding', async () => {
    const user = await openDesk('Parâmetros');
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));

    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('tab', { name: 'Parâmetros' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova Mesa' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('tab', { name: 'Parâmetros' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Infraestrutura')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Parâmetros' })).not.toBeInTheDocument();
  });

  it('AC-01, AC-04: a successful save shows "Alterações salvas." as a status and clears the pending line', async () => {
    const user = await openDesk('Parâmetros');
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas.');
    expect(api.patch).toHaveBeenCalledWith(
      '/service-desks/sd-1',
      expect.objectContaining({ allowCancelTicket: false }),
    );
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Reabertura' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('AC-02: a failed save shows one alert with the next step and keeps the edit', async () => {
    const user = await openDesk('Parâmetros');
    vi.mocked(api.patch).mockRejectedValue(new Error('rede'));
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Não foi possível salvar.');
    expect(alerts[0]).toHaveTextContent('Tente novamente.');
    expect(screen.getByLabelText('Permitir cancelar ticket')).not.toBeChecked();
    expect(screen.getByText(PENDING)).toBeInTheDocument();
  });

  it('AC-03: Prioridades save only on Salvar, with every item, and a failure keeps the marks', async () => {
    const user = await openDesk('Prioridades');
    await user.click(screen.getByLabelText('Alta'));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByText(PENDING)).toBeInTheDocument();

    vi.mocked(api.patch).mockRejectedValueOnce(new Error('rede'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.');
    expect(screen.getByLabelText('Alta')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas.');
    expect(api.patch).toHaveBeenLastCalledWith('/service-desks/sd-1', {
      priorities: [
        { ticketPriority: 'HIGH', enabled: false },
        { ticketPriority: 'LOW', enabled: false },
      ],
    });
  });

  it('AC-03: Seções do ticket save only on Salvar, with every item', async () => {
    const user = await openDesk('Seções do ticket');
    await user.click(screen.getByLabelText('Apontamentos'));
    expect(api.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas.');
    expect(api.patch).toHaveBeenCalledWith('/service-desks/sd-1', {
      ticketSections: [
        { key: 'GENERAL_INFO', enabled: true },
        { key: 'WORKLOGS', enabled: false },
      ],
    });
  });

  it('AC-08: Dados básicos is controlled, keeps the payload and the button label, and reports the result', async () => {
    const user = await openDesk();
    const name = screen.getByLabelText('Nome de exibição');
    await user.type(name, 'Suporte');
    expect(name).toHaveValue('Suporte');
    expect(screen.getByText(PENDING)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar dados básicos' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas.');
    expect(api.patch).toHaveBeenCalledWith('/service-desks/sd-1', {
      displayName: 'Suporte',
      description: '',
    });
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
  });

  it('AC-08: Status is controlled, keeps the payload and the button label, and reports a failure', async () => {
    const user = await openDesk('Status');
    await user.selectOptions(screen.getByLabelText('Status ao fechar', { selector: 'select' }), 'RESOLVED');
    expect(screen.getByText(PENDING)).toBeInTheDocument();

    vi.mocked(api.patch).mockRejectedValue(new Error('rede'));
    await user.click(screen.getByRole('button', { name: 'Salvar status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.');
    expect(api.patch).toHaveBeenCalledWith('/service-desks/sd-1', {
      defaultOpenStatus: 'OPEN',
      defaultClosedStatus: 'RESOLVED',
    });
    expect(screen.getByLabelText('Status ao fechar', { selector: 'select' })).toHaveValue('RESOLVED');
  });

  it('AC-01: Cliente e SLA, Membros and Estágios report the result', async () => {
    const user = await openDesk('Clientes');
    await user.click(await screen.findByRole('button', { name: /editar cliente e sla/i }));
    await user.click(screen.getByRole('button', { name: /salvar cliente e sla/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas.');

    await user.click(screen.getByRole('tab', { name: 'Grupos de atendentes' }));
    await user.click(await screen.findByRole('button', { name: 'Editar Membros' }));
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('rede'));
    await user.click(screen.getByRole('button', { name: 'Salvar Membros' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.');
    await user.click(screen.getByRole('button', { name: 'Salvar Membros' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Alterações salvas.'));

    await user.click(screen.getByRole('tab', { name: 'Estágio' }));
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    await user.type(await screen.findByLabelText('Novo estágio'), 'Em análise');
    expect(screen.getByText(PENDING)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Estágio' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Alterações salvas.'));
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
  });

  it('AC-06: beforeunload is armed only while there is an unsaved change', async () => {
    const user = await openDesk('Parâmetros');
    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    expect(fire()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('status');
    expect(fire()).toBe(false);
  });

  it('AC-05: clicking the tab that is already active never asks and leaves the edit alone', async () => {
    const user = await openDesk('Parâmetros');
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));
    await user.click(screen.getByRole('tab', { name: 'Parâmetros' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Permitir cancelar ticket')).not.toBeChecked();
    expect(screen.getByText(PENDING)).toBeInTheDocument();
  });

  it('AC-05: Duplicar asks too, Escape keeps the edit and Confirmar opens the copy', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Suporte N1');
    await user.click(screen.getAllByRole('checkbox')[1]);
    await user.click(screen.getByText('Suporte N1'));
    await user.click(await screen.findByRole('tab', { name: 'Parâmetros' }));
    await user.click(screen.getByLabelText('Permitir cancelar ticket'));

    await user.click(screen.getByTestId('ez-toolbar-clone-button'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Parâmetros' })).toBeInTheDocument();
    expect(screen.getByLabelText('Permitir cancelar ticket')).not.toBeChecked();

    await user.click(screen.getByTestId('ez-toolbar-clone-button'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByDisplayValue('Suporte N1 (Cópia)')).toBeInTheDocument();
  });

  it('AC-02: a failed save in Cliente e SLA and in Estágios shows the alert and keeps the edit', async () => {
    const user = await openDesk('Clientes');
    await user.click(await screen.findByRole('button', { name: /editar cliente e sla/i }));
    const input = screen.getByLabelText(/1ª resposta \(pad\. 1h\)/i);
    await user.type(input, '2');
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('rede'));
    await user.click(screen.getByRole('button', { name: /salvar cliente e sla/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.');
    expect(screen.getByLabelText(/1ª resposta \(pad\. 1h\)/i)).toHaveValue(2);
    expect(screen.getByText(PENDING)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Estágio' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('rede'));
    await user.type(await screen.findByLabelText('Novo estágio'), 'Em análise');
    await user.click(screen.getByRole('button', { name: '+ Estágio' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível salvar.'));
    expect(screen.getByLabelText('Novo estágio')).toHaveValue('Em análise');
  });
});
