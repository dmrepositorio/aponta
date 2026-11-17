import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { OrganizationsPage } from './OrganizationsPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const orgs = [
  { id: 'org-1', name: 'Empresa A', _count: { users: 2 } },
  { id: 'org-2', name: 'Empresa B', _count: { users: 0 } },
];

const users = [
  { id: 'u-1', name: 'Cliente Um', email: 'c1@example.com', role: 'CLIENT', organizationId: 'org-1' },
  { id: 'u-2', name: 'Cliente Dois', email: 'c2@example.com', role: 'CLIENT_MASTER', organizationId: null },
  { id: 'u-3', name: 'Agente', email: 'agent@example.com', role: 'AGENT', organizationId: null },
];

const serviceDesks = [
  { id: 'desk-1', name: 'Avulso' },
  { id: 'desk-2', name: 'Contrato' },
];

const orgDetail = {
  id: 'org-1',
  name: 'Empresa A',
  legalName: 'Empresa A Ltda',
  cnpj: '19131243000197',
  cpf: null,
  documentType: 'CNPJ',
  municipalRegistration: '123',
  stateRegistration: '456',
  active: true,
  serviceType: null,
  healthStatus: null,
  workFolder: '/clientes/empresa-a',
  notes: 'Cliente VIP',
  visibleToClients: true,
  quarterlyBilling: false,
  users: [],
  addresses: [
    { id: 'addr-1', street: 'Av Paulista', city: 'Sao Paulo', state: 'SP', zipCode: '01310100', neighborhood: 'Bela Vista', complement: null },
  ],
  contacts: [
    { id: 'contact-1', name: 'Jane Doe', email: 'jane@example.com', phone: '11999999999', type: 'Financeiro' },
  ],
  serviceDesks: [{ id: 'desk-1', name: 'Avulso' }],
  agentGroups: [
    { id: 'group-1', name: 'Grupo Suporte', active: true, members: [{ id: 'u-3', name: 'Agente', email: 'agent@example.com' }] },
  ],
};

const PREF_URL = '/me/screen-preferences/organizations';

/** `screenPreference` é o que o servidor devolve em GET /me/screen-preferences/organizations ({} = sem linha). */
function mockApiGet(screenPreference: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === PREF_URL) return Promise.resolve({ data: screenPreference });
    if (url === '/organizations') return Promise.resolve({ data: orgs });
    if (url === '/users') return Promise.resolve({ data: users });
    if (url === '/service-desks') return Promise.resolve({ data: serviceDesks });
    if (url === '/organizations/org-1') return Promise.resolve({ data: orgDetail });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/organizations']}>
        <Routes>
          <Route path="/organizations" element={<OrganizationsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginAs(role: 'ADMIN' | 'AGENT') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'user@aponta.com', role },
  });
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: /abrir cadastro de empresa a/i }));
  await waitFor(() => {
    expect(screen.getByText('Empresa A Ltda')).toBeInTheDocument();
  });
}

describe('OrganizationsPage', { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet();
    useAuthStore.setState({ token: null, user: null });
    localStorage.clear();
  });

  it('keeps the grid scrollable by touch in both axes on phones (DMTE-455)', async () => {
    loginAs('ADMIN');
    renderPage();

    await screen.findByText('Empresa A');
    const content = screen.getByTestId('organizations-grid-content');
    expect(content).toHaveClass('touch-pan-x', 'touch-pan-y', 'overscroll-x-contain');
  });

  it('shows an access-denied message for non-ADMIN roles', () => {
    loginAs('AGENT');
    renderPage();

    expect(
      screen.getByText(/somente administradores podem gerenciar empresas/i),
    ).toBeInTheDocument();
    // Só a preferência de tela do próprio usuário é lida (DMTE-527 T2); nenhum dado de empresa.
    expect(vi.mocked(api.get).mock.calls.every(([url]) => url === PREF_URL)).toBe(true);
  });

  it('shows the list view by default with a mode toggle (Tiflux/Sankhya-parity, issue #57)', async () => {
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Usuários' })).toBeInTheDocument();

    const [rowA, rowB] = screen.getAllByRole('row').slice(1);
    expect(within(rowA).getByText('Empresa A')).toBeInTheDocument();
    expect(within(rowA).getByText('Ativo')).toBeInTheDocument();
    expect(within(rowA).getByText('2')).toBeInTheDocument();

    expect(within(rowB).getByText('Empresa B')).toBeInTheDocument();
    expect(within(rowB).getByText('0')).toBeInTheDocument();

    // Botão "Novo Cliente" continua removido a pedido (criação só via
    // Ações > Cadastrar manualmente); o alternador Grade/Formulário, porém,
    // deve ficar visível (padrão igual a Mesas e Contratos).
    expect(screen.getByTestId('ez-toolbar-mode-toggle-button')).toBeInTheDocument();
    expect(screen.queryByTestId('ez-toolbar-insert-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /novo cliente/i })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '#' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Código' })).not.toBeInTheDocument();
  });

  it('switches to the full-page form via Ações > Cadastrar manualmente and validates it', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));

    await waitFor(() => {
      expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(screen.getByText(/nome é obrigatório/i)).toBeInTheDocument();
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('switches between Grid Mode and Form Mode via the toolbar toggle', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));

    await waitFor(() => {
      expect(screen.getByText('Empresa A Ltda')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Voltar'));

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument();
    });
  });

  it('creates a new organization with rich fields', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'org-3', name: 'Empresa C' } });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
    await waitFor(() => {
      expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
    });

    // CNPJ e Razão Social digitados manualmente (sem usar "Buscar CNPJ"): devem
    // permanecer sempre editáveis — o cadastro manual não depende da consulta à Receita.
    expect(screen.getByLabelText(/cnpj/i)).toBeEnabled();
    await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
    await user.type(screen.getByLabelText(/nome fantasia/i), 'Empresa C');
    await user.type(screen.getByLabelText(/razão social/i), 'Empresa C Ltda');
    await user.click(screen.getByLabelText(/faturamento quarteirizado/i));
    await user.type(screen.getByLabelText(/e-mails de faturamento/i), 'financeiro@empresac.com');
    await user.type(screen.getByLabelText(/dia de vencimento/i), '15');
    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/organizations', expect.objectContaining({
        name: 'Empresa C',
        legalName: 'Empresa C Ltda',
        cnpj: '19131243000197',
        quarterlyBilling: true,
        billingEmails: 'financeiro@empresac.com',
        billingDueDay: 15,
      }));
    });
  });

  describe('cadastro manual: falha ao salvar (DMTE-554)', () => {
    async function openManualForm(user: ReturnType<typeof userEvent.setup>) {
      await waitFor(() => {
        expect(screen.getByText('Empresa A')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('ez-toolbar-actions-button'));
      await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
      await waitFor(() => {
        expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
      });
    }

    it('shows the API message in an alert when the server refuses the new client', async () => {
      vi.mocked(api.post).mockRejectedValue({
        response: { status: 409, data: { message: 'Já existe um cliente com este CNPJ.' } },
      });
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await openManualForm(user);

      await user.type(screen.getByLabelText(/nome fantasia/i), 'Empresa D');
      await user.click(screen.getByRole('button', { name: /cadastrar/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Já existe um cliente com este CNPJ.');
      // continua no formulário, com o que o usuário digitou
      expect(screen.getByLabelText(/nome fantasia/i)).toHaveValue('Empresa D');
    });

    it('shows a generic alert when the server fails without a message', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network Error'));
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await openManualForm(user);

      await user.type(screen.getByLabelText(/nome fantasia/i), 'Empresa D');
      await user.click(screen.getByRole('button', { name: /cadastrar/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível cadastrar o cliente/i);
    });

    it('does not send blank CNPJ/CPF, which would collide on the unique columns', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'org-4', name: 'Empresa D' } });
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await openManualForm(user);

      await user.type(screen.getByLabelText(/nome fantasia/i), 'Empresa D');
      await user.click(screen.getByRole('button', { name: /cadastrar/i }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/organizations', expect.objectContaining({ name: 'Empresa D' }));
      });
      const payload = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('cnpj', '');
      expect(payload).not.toHaveProperty('cpf', '');
    });
  });

  describe('cadastro por CNPJ: falha na consulta (DMTE-556)', () => {
    async function consult(lookupError: unknown) {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/organizations') return Promise.resolve({ data: orgs });
        if (url === '/organizations/cnpj-lookup') return Promise.reject(lookupError);
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Empresa A')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('ez-toolbar-actions-button'));
      await user.click(screen.getByRole('menuitem', { name: /cadastrar por cnpj/i }));
      await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
      await user.click(screen.getByRole('button', { name: /consultar e abrir cadastro/i }));
    }

    it.each([404, 400])('says the CNPJ was not found or is invalid when the API answers %i', async (code) => {
      await consult({ response: { status: code } });

      expect(await screen.findByText('CNPJ não encontrado ou inválido na Receita Federal.')).toBeInTheDocument();
      expect(screen.getByText('Cadastrar Parceiro por CNPJ')).toBeInTheDocument();
      expect(screen.getByLabelText(/cnpj/i)).toHaveValue('19131243000197');
    });

    it.each([
      ['502', { response: { status: 502 } }],
      ['no response', new Error('Network Error')],
    ])('says the lookup is unavailable when it fails with %s', async (_label, error) => {
      await consult(error);

      expect(
        await screen.findByText('Não foi possível consultar a Receita Federal agora. Tente novamente em instantes.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('CNPJ não encontrado ou inválido na Receita Federal.')).not.toBeInTheDocument();
      expect(screen.getByText('Cadastrar Parceiro por CNPJ')).toBeInTheDocument();
      expect(screen.getByLabelText(/cnpj/i)).toHaveValue('19131243000197');
    });
  });

  it('looks up a CNPJ and autofills legal name / trade name', async () => {
    vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
      if (url === '/organizations') return Promise.resolve({ data: orgs });
      if (url === '/organizations/cnpj-lookup') {
        expect(config?.params?.cnpj).toBe('19131243000197');
        return Promise.resolve({
          data: {
            cnpj: '19131243000197',
            legalName: 'Empresa Teste LTDA',
            tradeName: 'Teste',
            address: { zipCode: null, street: null, neighborhood: null, city: null, state: null, complement: null },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
    await waitFor(() => {
      expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
    await user.click(screen.getByRole('button', { name: /buscar cnpj/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/razão social/i)).toHaveValue('Empresa Teste LTDA');
    });
    expect(screen.getByLabelText(/nome fantasia/i)).toHaveValue('Teste');
  });

  it('locks CNPJ and Razão Social after a Receita lookup, standardizing form-mode editability (Sankhya parity)', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/organizations') return Promise.resolve({ data: orgs });
      if (url === '/organizations/cnpj-lookup') {
        return Promise.resolve({
          data: {
            cnpj: '19131243000197',
            legalName: 'Empresa Teste LTDA',
            tradeName: 'Teste',
            address: { zipCode: null, street: null, neighborhood: null, city: null, state: null, complement: null },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
    await waitFor(() => {
      expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
    });

    // Antes da consulta, os campos são livremente editáveis.
    expect(screen.getByLabelText(/cnpj/i)).toBeEnabled();
    expect(screen.getByLabelText(/razão social/i)).toBeEnabled();

    await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
    await user.click(screen.getByRole('button', { name: /buscar cnpj/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/razão social/i)).toHaveValue('Empresa Teste LTDA');
    });

    // Dados oficiais da Receita Federal (CNPJ/Razão Social) ficam travados até edição explícita.
    expect(screen.getByLabelText(/cnpj/i)).toBeDisabled();
    expect(screen.getByLabelText(/razão social/i)).toBeDisabled();
    expect(screen.getByLabelText(/nome fantasia/i)).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /editar manualmente/i }));
    expect(screen.getByLabelText(/cnpj/i)).toBeEnabled();
    expect(screen.getByLabelText(/razão social/i)).toBeEnabled();
  });

  it('toggles CPF/CNPJ fields based on document type (Tiflux-parity, issue #56)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
    await waitFor(() => {
      expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/^cnpj$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^cpf$/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/tipo de documento/i, { selector: 'select' }), 'CPF');

    expect(screen.getByLabelText(/^cpf$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^cnpj$/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no organizations', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/organizations') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/nenhuma empresa cadastrada/i)).toBeInTheDocument();
    });

    // Regressão: a grade (EzEntityGrid) não deve renderizar seu próprio
    // estado vazio ao mesmo tempo que o EzEmptyCard da página — só um
    // estado de "lista vazia" deve aparecer por vez.
    expect(screen.queryByText(/nenhum registro encontrado/i)).not.toBeInTheDocument();
  });

  it('opens the full-page detail with the Tiflux-parity 3-column panel', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    expect(screen.getByText('19.131.243/0001-97')).toBeInTheDocument();
    expect(screen.getByText('/clientes/empresa-a')).toBeInTheDocument();
    expect(screen.getByText('Cliente VIP')).toBeInTheDocument();
    expect(screen.getByLabelText(/visível para clientes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/faturamento quarteirizado/i)).toBeInTheDocument();
  });

  it('shows the "Cliente ativo" toggle and inactivates the organization', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...orgDetail, active: false } });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    const toggle = screen.getByLabelText(/cliente ativo/i);
    await user.click(toggle);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { active: false });
    });
  });

  it('lists only CLIENT/CLIENT_MASTER users in the Usuários tab and allows linking', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: 'Usuários' }));

    await waitFor(() => {
      expect(screen.getByText('Cliente Um')).toBeInTheDocument();
    });
    expect(screen.getByText('Cliente Dois')).toBeInTheDocument();
    expect(screen.queryByText('Agente')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/users/u-2', { organizationId: 'org-1' });
    });

    await user.click(screen.getByRole('button', { name: 'Remover' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/users/u-1', { organizationId: null });
    });
  });

  it('updates organization name and legal name on blur in Geral tab', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: orgDetail });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    const legalNameInput = screen.getByLabelText(/razão social/i);
    await user.clear(legalNameInput);
    await user.type(legalNameInput, 'Empresa A Nova Razao');
    await user.tab();

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { legalName: 'Empresa A Nova Razao' });
    });

    const nameInput = screen.getByLabelText(/nome fantasia/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Empresa A Novo Nome');
    await user.tab();

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { name: 'Empresa A Novo Nome' });
    });
  });

  it('toggles visibility and quarterly billing from the detail header', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: orgDetail });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await user.click(screen.getByLabelText(/visível para clientes/i));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { visibleToClients: false });
    });

    await user.click(screen.getByLabelText(/faturamento quarteirizado/i));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { quarterlyBilling: true });
    });
  });

  it('adds a new contact from the Geral tab', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'contact-2', name: 'New Contact' } });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await waitFor(() => {
      expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^nome$/i), 'New Contact');
    await user.click(screen.getByRole('button', { name: /adicionar contato/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/organizations/org-1/contacts', expect.objectContaining({
        name: 'New Contact',
      }));
    });
  });

  it('saves serviceType/healthStatus from the Geral tab (Perfil do Cliente, issue #56)', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: orgDetail });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await waitFor(() => {
      expect(screen.getByLabelText(/tipo de atendimento/i, { selector: 'select' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/tipo de atendimento/i, { selector: 'select' }), 'SUPORTE');
    await user.selectOptions(screen.getByLabelText(/^saúde$/i, { selector: 'select' }), 'SAUDAVEL');
    await user.click(screen.getByRole('button', { name: /salvar perfil/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', {
        serviceType: 'SUPORTE',
        healthStatus: 'SAUDAVEL',
      });
    });
  });

  it('shows an honest stub in the Recursos tab (no fabricated module)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await user.click(screen.getByRole('tab', { name: /recursos/i }));

    await waitFor(() => {
      expect(screen.getByText(/nenhum recurso cadastrado/i)).toBeInTheDocument();
    });
  });

  it('manages Mesas (N:N) and Grupo de Atendentes in the Relacionamentos tab (Tiflux-parity, issue #57)', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await user.click(screen.getByRole('tab', { name: /relacionamentos/i }));

    await waitFor(() => {
      expect(screen.getByText('Avulso')).toBeInTheDocument();
    });
    expect(screen.getByText('Grupo Suporte')).toBeInTheDocument();

    // Vincula uma nova mesa (apenas "Contrato" está disponível, pois "Avulso" já está vinculada)
    await user.selectOptions(screen.getByLabelText(/adicionar mesa de serviço/i, { selector: 'select' }), 'desk-2');
    await user.click(screen.getByRole('button', { name: /^vincular$/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/organizations/org-1/service-desks/desk-2');
    });

    // Desvincula a mesa existente
    await user.click(screen.getByRole('button', { name: /desvincular/i }));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/service-desks/desk-1');
    });

    // Cria um novo grupo de atendentes
    await user.type(screen.getByLabelText(/nome do grupo/i), 'Grupo Vendas');
    await user.click(screen.getByRole('button', { name: /adicionar grupo de atendentes/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/organizations/org-1/agent-groups', expect.objectContaining({
        name: 'Grupo Vendas',
      }));
    });
  });

  it('renders billing preferences and updates quarterly billing in Faturamento tab (issue #58)', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...orgDetail, quarterlyBilling: true } });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await user.click(screen.getByRole('tab', { name: /faturamento/i }));

    const billingContent = screen.getByTestId('org-billing-tab-content');
    expect(billingContent).toBeInTheDocument();

    const quarterlyToggle = within(billingContent).getByLabelText(/habilitar faturamento quarteirizado/i);
    expect(quarterlyToggle).toBeInTheDocument();
    expect(within(billingContent).getByLabelText(/e-mails para envio de cobrança/i)).toBeInTheDocument();
    expect(within(billingContent).getByLabelText(/dia de vencimento/i)).toBeInTheDocument();
    expect(within(billingContent).getByLabelText(/forma de pagamento/i, { selector: 'select' })).toBeInTheDocument();
    expect(within(billingContent).getByLabelText(/instruções e observações/i)).toBeInTheDocument();

    // Toggle quarterly billing
    await user.click(quarterlyToggle);

    // Fill in billing inputs
    await user.type(within(billingContent).getByLabelText(/e-mails para envio de cobrança/i), 'cobranca@empresa.com');
    await user.type(within(billingContent).getByLabelText(/dia de vencimento/i), '20');
    await user.selectOptions(within(billingContent).getByLabelText(/forma de pagamento/i, { selector: 'select' }), 'PIX');
    await user.type(within(billingContent).getByLabelText(/instruções e observações/i), 'Nota no 1o dia útil');

    // Save preferences
    await user.click(within(billingContent).getByRole('button', { name: /salvar preferências/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/organizations/org-1',
        expect.objectContaining({
          quarterlyBilling: true,
          billingEmails: 'cobranca@empresa.com',
          billingDueDay: 20,
          billingMethod: 'PIX',
          billingNotes: 'Nota no 1o dia útil',
        }),
      );
    });
  });

  it('supports inline editing of cells and Cadastrar por CNPJ via toolbar actions (Sankhya parity)', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'org-1', active: false } });
    vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
      if (url === '/organizations') return Promise.resolve({ data: orgs });
      if (url === '/organizations/cnpj-lookup') {
        return Promise.resolve({
          data: {
            cnpj: '19131243000197',
            legalName: 'Parceiro CNPJ S/A',
            tradeName: 'Parceiro CNPJ',
            address: { zipCode: '01310100', street: 'Av Paulista', neighborhood: 'Bela Vista', city: 'SP', state: 'SP', complement: null },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    // 1. O status na grade é só de leitura (DMTE-541 AC-03): sem botão para alternar
    expect(screen.queryByTitle(/alternar status/i)).not.toBeInTheDocument();

    // 2. Toolbar action: Cadastrar por CNPJ
    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar por cnpj/i }));

    expect(screen.getByText('Cadastrar Parceiro por CNPJ')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
    await user.click(screen.getByRole('button', { name: /consultar e abrir cadastro/i }));

    await waitFor(() => {
      expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
      expect(screen.getByLabelText(/razão social/i)).toHaveValue('Parceiro CNPJ S/A');
    });
  });

  it('renders Sankhya standard entity toolbar, filter drawer, and screen config modal (br.com.sankhya.core.cad.parceiros parity)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    // 1. Toolbar Sankhya is rendered with standard controls
    expect(screen.getByTestId('ez-entity-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-filter-panel-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-refresh-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-screen-config-button')).toBeInTheDocument();

    // 2. Open and test Filter Drawer
    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    expect(drawer).toBeInTheDocument();
    expect(screen.getByText('Filtros de Clientes')).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/buscar parceiro/i)).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/^status$/i)).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/tipo de documento/i, { selector: 'select' })).toBeInTheDocument();

    // Close drawer
    await user.click(screen.getByTestId('ez-filter-drawer-close'));
    expect(screen.queryByTestId('ez-filter-drawer')).not.toBeInTheDocument();

    // 3. Open and test Screen Configuration Modal (Per-User Personalization)
    await user.click(screen.getByTestId('ez-toolbar-screen-config-button'));
    const modal = screen.getByTestId('ez-entity-screen-config-modal');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText('Personalização da Tela (Usuário)')).toBeInTheDocument();
    expect(within(modal).getByText('Razão Social')).toBeInTheDocument();
    expect(within(modal).getByText('Densidade das Linhas')).toBeInTheDocument();

    // Close modal
    await user.click(within(modal).getByLabelText('Fechar'));
    expect(screen.queryByTestId('ez-entity-screen-config-modal')).not.toBeInTheDocument();
  });

  it('filters the grid by search text, status, and document type (Sankhya filter drawer)', async () => {
    const filterableOrgs = [
      { id: 'org-1', name: 'Empresa A', cnpj: '19131243000197', documentType: 'CNPJ', active: true, _count: { users: 2 } },
      { id: 'org-2', name: 'Empresa B', documentType: 'CPF', active: false, _count: { users: 0 } },
    ];
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/organizations') return Promise.resolve({ data: filterableOrgs });
      if (url === '/users') return Promise.resolve({ data: users });
      if (url === '/service-desks') return Promise.resolve({ data: serviceDesks });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
      expect(screen.getByText('Empresa B')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    // Search text narrows to the matching name only.
    await user.type(within(drawer).getByLabelText(/buscar parceiro/i), 'Empresa A');
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.queryByText('Empresa B')).not.toBeInTheDocument();
    await user.clear(within(drawer).getByLabelText(/buscar parceiro/i));

    // Status filter narrows to inactive organizations only.
    await user.selectOptions(within(drawer).getByLabelText(/^status$/i), 'INACTIVE');
    expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
    await user.selectOptions(within(drawer).getByLabelText(/^status$/i), 'ALL');

    // Document type filter narrows to CPF-only partners.
    await user.selectOptions(within(drawer).getByLabelText(/tipo de documento/i, { selector: 'select' }), 'CPF');
    expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    // Clearing the drawer resets every filter back to showing both.
    await user.click(screen.getByTestId('ez-filter-drawer-clear'));
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
  });

  it('saves, applies, and deletes a saved filter from the drawer (Sankhya saved filters parity)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');

    await user.type(within(drawer).getByLabelText(/buscar parceiro/i), 'Empresa A');
    await user.click(within(drawer).getByTestId('ez-filter-drawer-save-btn'));
    await user.type(within(drawer).getByTestId('ez-filter-drawer-name-input'), 'Só Empresa A');
    await user.click(within(drawer).getByTestId('ez-filter-drawer-confirm-save'));

    const savedList = await within(drawer).findByTestId('ez-filter-drawer-saved-list');
    expect(within(savedList).getByText('Só Empresa A')).toBeInTheDocument();

    // Clear the live filter, then re-apply it from the saved entry.
    await user.clear(within(drawer).getByLabelText(/buscar parceiro/i));
    await user.click(within(savedList).getByText('Só Empresa A'));
    expect(within(drawer).getByLabelText(/buscar parceiro/i)).toHaveValue('Empresa A');

    // Delete the saved filter.
    await user.click(within(savedList).getByLabelText(/excluir filtro só empresa a/i));
    expect(within(drawer).queryByText('Só Empresa A')).not.toBeInTheDocument();
  });

  it('navigates between organizations from the detail view using toolbar Anterior/Próximo', async () => {
    const orgBDetail = {
      ...orgDetail,
      id: 'org-2',
      name: 'Empresa B',
      legalName: 'Empresa B Ltda',
      serviceDesks: [],
      agentGroups: [],
      addresses: [],
      contacts: [],
    };
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/organizations') return Promise.resolve({ data: orgs });
      if (url === '/users') return Promise.resolve({ data: users });
      if (url === '/service-desks') return Promise.resolve({ data: serviceDesks });
      if (url === '/organizations/org-1') return Promise.resolve({ data: orgDetail });
      if (url === '/organizations/org-2') return Promise.resolve({ data: orgBDetail });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await openDetail(user);

    await user.click(screen.getByTestId('ez-toolbar-next-button'));
    await waitFor(() => {
      expect(screen.getByText('Empresa B Ltda')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-previous-button'));
    await waitFor(() => {
      expect(screen.getByText('Empresa A Ltda')).toBeInTheDocument();
    });
  });

  it('duplicates a selected organization into a prefilled Nova Empresa form (Duplicar)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    const rowCheckboxes = screen.getAllByRole('checkbox');
    await user.click(rowCheckboxes[1]); // select "Empresa A"

    await user.click(screen.getByTestId('ez-toolbar-clone-button'));

    expect(screen.getByText('Nova Empresa')).toBeInTheDocument();
    expect(screen.getByLabelText(/nome fantasia/i)).toHaveValue('Empresa A (Cópia)');
  });

  it('DMTE-481 AC-04: a lixeira avisa que o cliente será apenas inativado e chama DELETE /organizations/:id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.delete).mockResolvedValue({ data: { id: 'org-1', active: false } });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    await user.click(screen.getAllByRole('checkbox')[1]); // "Empresa A"
    await user.click(screen.getByTestId('ez-toolbar-delete-button'));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/apenas inativad/i));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/organizations/org-1');
    });
    expect(api.patch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('DMTE-481 AC-04: mostra a mensagem da API quando a exclusão é recusada (contrato ativo/ticket aberto)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.delete).mockRejectedValue({
      response: { data: { message: 'Cliente com contrato ativo não pode ser excluído' } },
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    await user.click(screen.getAllByRole('checkbox')[1]);
    await user.click(screen.getByTestId('ez-toolbar-delete-button'));

    expect(await screen.findByText(/cliente com contrato ativo não pode ser excluído/i)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('persists column visibility toggles to the per-user screen config (server, DMTE-527 T2)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-screen-config-button'));
    const modal = screen.getByTestId('ez-entity-screen-config-modal');
    await user.click(within(modal).getByTestId('ez-screen-config-toggle-stateRegistration'));

    expect(within(modal).getByTestId('ez-screen-config-toggle-stateRegistration')).toBeChecked();
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        PREF_URL,
        expect.objectContaining({
          grid: expect.objectContaining({ columnVisibility: expect.objectContaining({ stateRegistration: true }) }),
        }),
      ),
    );
    expect(localStorage.getItem('aponta_screen_config_u-1_organizations')).toBeNull();
  });

  it('edits the optional grid columns (IE, IM, Pasta, Perfil, Saúde) once made visible via screen config', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();

    // Simulate a returning user who already revealed these optional
    // columns via the screen configurator in a previous session — the
    // preference lives on the server (useUserScreenConfig, DMTE-527 T2) and is
    // read back as EzEntityGrid's *initial* column visibility on mount (see the
    // dedicated persistence test above for the toggle-write side).
    mockApiGet({
      grid: {
        columnVisibility: {
          stateRegistration: true,
          municipalRegistration: true,
          workFolder: true,
          serviceType: true,
          healthStatus: true,
        },
        density: 'compact',
      },
      form: { layout: 'CASCADE' },
      viewMode: 'GRID',
      savedFilters: [],
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    // EzTextEdit cells render as a plain "click to edit" button showing the
    // placeholder until clicked; clicking swaps it for a real <input> (see
    // EzTextEdit.tsx), which is what we then type into and blur to commit.
    async function editFirstCell(placeholder: string, text: string, expectedPatch: Record<string, string>) {
      await user.click(screen.getAllByRole('button', { name: placeholder })[0]);
      const input = screen.getAllByPlaceholderText(placeholder)[0];
      await user.type(input, text);
      await user.tab();
      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', expectedPatch);
      });
    }

    await editFirstCell('IE', '789', { stateRegistration: '789' });
    await editFirstCell('IM', '321', { municipalRegistration: '321' });
    await editFirstCell('/pasta', '/novo', { workFolder: '/novo' });
    await editFirstCell('Perfil', 'Premium', { serviceType: 'Premium' });
    await editFirstCell('Saúde', 'OK', { healthStatus: 'OK' });
  });

  it('restores default screen configuration from the config modal', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-screen-config-button'));
    const modal = screen.getByTestId('ez-entity-screen-config-modal');
    await user.click(within(modal).getByTestId('ez-config-density-comfortable'));
    await user.click(within(modal).getByText('Restaurar Padrão'));

    expect(within(modal).getByTestId('ez-config-density-compact')).toHaveClass('bg-brand-600');
  });

  it('filters dynamically by any column using the rule builder (Sankhya Filtros parity)', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    await user.click(within(drawer).getByTestId('ez-dynamic-filter-add'));

    const rule = within(drawer).getByTestId('ez-dynamic-filter-rule');
    const fieldOptions = within(within(rule).getByLabelText('Campo', { selector: 'select' })).getAllByRole('option', { hidden: true }).map((o) => o.textContent);
    expect(fieldOptions).toEqual(
      expect.arrayContaining(['Nome', 'Razão Social', 'CPF / CNPJ', 'Status', 'Usuários', 'Inscrição Estadual', 'Perfil', 'Saúde']),
    );

    await user.type(within(rule).getByLabelText('Valor'), 'Empresa B');
    expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
    expect(screen.getByText('Empresa B')).toBeInTheDocument();

    await user.click(screen.getByTestId('ez-filter-drawer-clear'));
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
  });

  it('does not offer grouping and shows the record count in a single place', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Empresa A')).toBeInTheDocument();
    });

    expect(screen.queryByText(/agrupar/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/1\s?-\s?2 de 2/)).toHaveLength(1);
    expect(screen.queryByText(/^Total:/)).not.toBeInTheDocument();
    void user;
  });
});

describe('OrganizationsPage DMTE-541', { timeout: 15000 }, () => {
  const longName = 'Associação Beneficente dos Moradores e Amigos do Bairro Jardim das Acácias Ltda';
  const richOrgs = [
    { id: 'org-1', name: 'Empresa A', legalName: 'Empresa A Ltda', cnpj: '19131243000197', documentType: 'CNPJ', active: true, _count: { users: 7 } },
    { id: 'org-2', name: 'Empresa B', legalName: 'Empresa B ME', cpf: '12345678901', documentType: 'CPF', active: false, _count: { users: 3 } },
    { id: 'org-3', name: longName, legalName: longName, cnpj: '11222333000181', documentType: 'CNPJ', active: true, _count: { users: 0 } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/organizations') return Promise.resolve({ data: richOrgs });
      if (url === '/users') return Promise.resolve({ data: users });
      if (url === '/service-desks') return Promise.resolve({ data: serviceDesks });
      if (url === '/organizations/org-1') return Promise.resolve({ data: { ...orgDetail, cpf: '12345678901', documentType: 'CPF' } });
      if (url === '/organizations/org-2') return Promise.resolve({ data: { ...orgDetail, id: 'org-2', name: 'Empresa B', legalName: 'Empresa B ME' } });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    useAuthStore.setState({ token: null, user: null });
    localStorage.clear();
  });

  const rowOf = async (name: string) => {
    const [cell] = await screen.findAllByText(name);
    return cell.closest('tr') as HTMLElement;
  };

  it('AC-01: the name is a button that opens the registration by click and by Enter, with no edit input and no external-link icon', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    const { container } = renderPage();

    const nameButton = await screen.findByRole('button', { name: 'Abrir cadastro de Empresa A' });
    expect(container.querySelector('.lucide-external-link')).toBeNull();
    expect(screen.queryByTitle('Abrir cadastro (modo formulário)')).not.toBeInTheDocument();

    await user.click(nameButton);
    expect(await screen.findByText('Dados do Parceiro / Cliente')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nome')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();

    // volta para a lista e abre pelo teclado
    await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
    const again = await screen.findByRole('button', { name: 'Abrir cadastro de Empresa B' });
    again.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Dados do Parceiro / Cliente')).toBeInTheDocument();
  });

  it('AC-02: Razão Social stays editable by click, and a failed PATCH shows the reason and the cell keeps the previous value', async () => {
    vi.mocked(api.patch).mockRejectedValue({ response: { data: { message: 'Razão Social já cadastrada para outro cliente' } } });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Empresa A Ltda' }));
    const input = screen.getByDisplayValue('Empresa A Ltda');
    await user.clear(input);
    await user.type(input, 'Outra Razão{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Razão Social já cadastrada para outro cliente');
    expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { legalName: 'Outra Razão' });
    expect(screen.getByRole('button', { name: 'Empresa A Ltda' })).toBeInTheDocument();
    expect(screen.queryByText('Outra Razão')).not.toBeInTheDocument();

    await user.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('AC-02: a failed PATCH without a message from the API still shows a visible error', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Network Error'));
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Empresa B ME' }));
    await user.type(screen.getByDisplayValue('Empresa B ME'), ' X{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível salvar/i);
  });

  it('AC-02: a successful PATCH shows no notice', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Empresa A Ltda' }));
    const input = screen.getByDisplayValue('Empresa A Ltda');
    await user.clear(input);
    await user.type(input, 'Empresa A Nova{Enter}');

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { legalName: 'Empresa A Nova' });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('AC-03: the status is read-only text with an icon, no raw emerald, and clicking it does not save', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    const { container } = renderPage();

    const rowA = await rowOf('Empresa A');
    const rowB = await rowOf('Empresa B');
    expect(within(rowA).queryByRole('button', { name: 'Ativo' })).not.toBeInTheDocument();
    expect(within(rowB).queryByRole('button', { name: 'Inativo' })).not.toBeInTheDocument();
    expect(within(rowA).getByText('Ativo').closest('div')?.querySelector('[data-glyph]')).not.toBeNull();
    expect(within(rowB).getByText('Inativo').closest('div')?.querySelector('[data-glyph]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/emerald-/);

    await user.click(within(rowA).getByText('Ativo'));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('AC-04: the count column is "Usuários", right-aligned with tabular numbers, and the row numbering is "#"', async () => {
    loginAs('ADMIN');
    renderPage();

    const rowA = await rowOf('Empresa A');
    expect(screen.getByRole('columnheader', { name: 'Usuários' })).toHaveClass('text-right');
    expect(screen.getByRole('columnheader', { name: '#' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Código' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Clientes' })).not.toBeInTheDocument();
    const count = within(rowA).getByText('7').closest('td') as HTMLElement;
    expect(count).toHaveClass('text-right', 'tabular-nums');
  });

  it('AC-05: the CPF shows masked in the grid and in the registration summary, and the CNPJ stays masked', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    const rowB = await rowOf('Empresa B');
    expect(within(rowB).getByRole('button', { name: '123.456.789-01' })).toBeInTheDocument();
    expect(within(await rowOf('Empresa A')).getByRole('button', { name: '19.131.243/0001-97' })).toBeInTheDocument();

    await user.click(within(await rowOf('Empresa A')).getByRole('button', { name: 'Abrir cadastro de Empresa A' }));
    expect(await screen.findByText('123.456.789-01')).toBeInTheDocument();
  });

  it('AC-06: Nome and Razão Social are one line with ellipsis and the full text in title; other columns are not truncated', async () => {
    loginAs('ADMIN');
    renderPage();

    const row = await rowOf(longName);
    const nameCell = within(row).getByRole('button', { name: `Abrir cadastro de ${longName}` }).closest('td') as HTMLElement;
    expect(nameCell).toHaveClass('truncate');
    expect(nameCell).toHaveAttribute('title', longName);
    const legalCell = within(row).getByRole('button', { name: longName }).closest('td') as HTMLElement;
    expect(legalCell).toHaveClass('truncate');
    expect(legalCell).toHaveAttribute('title', longName);
    const statusCell = within(row).getByText('Ativo').closest('td') as HTMLElement;
    expect(statusCell).not.toHaveClass('truncate');
  });

  it('AC-08: the filter panel sits in a positioned container so it can overlay the grid below xl', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Empresa A');
    await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
    const drawer = screen.getByTestId('ez-filter-drawer');
    expect(drawer.parentElement).toHaveClass('relative');
    expect(drawer).toHaveClass('absolute', 'xl:relative');
  });

  it('AC-11: the registration has the tabs Geral, Usuários, Recursos, Relacionamentos and Faturamento, with Geral open', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Abrir cadastro de Empresa A' }));
    await screen.findByText('Dados do Parceiro / Cliente');

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Geral',
      'Usuários',
      'Recursos',
      'Relacionamentos',
      'Faturamento',
    ]);
    expect(screen.getByRole('tab', { name: 'Geral' })).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-11: Geral shows Razão Social, Nome Fantasia, Perfil, Endereços and Contatos, and not the linked users', async () => {
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Abrir cadastro de Empresa A' }));
    await screen.findByText('Dados do Parceiro / Cliente');

    expect(await screen.findByLabelText(/razão social/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nome fantasia/i)).toBeInTheDocument();
    for (const heading of ['Perfil do Cliente', 'Endereços', 'Contatos']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.queryByText('Usuários vinculados')).not.toBeInTheDocument();
    expect(screen.queryByText('Cliente Um')).not.toBeInTheDocument();
  });

  it('AC-11: Usuários shows only the linked users with Adicionar/Remover, and none of the Geral content', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Abrir cadastro de Empresa A' }));
    await screen.findByText('Dados do Parceiro / Cliente');
    await user.click(screen.getByRole('tab', { name: 'Usuários' }));

    expect(await screen.findByText('Cliente Um')).toBeInTheDocument();
    expect(screen.getByText('Cliente Dois')).toBeInTheDocument();
    expect(screen.queryByText('Agente')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Usuários vinculados' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Perfil do Cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Endereços' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/users/u-1', { organizationId: null });
    });
  });

  it('AC-12: below 640 px the grid hides # and the selection plus Razão Social and CPF/CNPJ, keeping Nome and Status', async () => {
    loginAs('ADMIN');
    renderPage();

    const rowA = await rowOf('Empresa A');
    const hiddenHeaders = ['#', 'Razão Social', 'CPF / CNPJ'];
    for (const name of hiddenHeaders) {
      expect(screen.getByRole('columnheader', { name })).toHaveClass('hidden', 'sm:table-cell');
    }
    for (const name of ['Nome', 'Status', 'Usuários']) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveClass('hidden');
    }
    expect(within(rowA).getByRole('checkbox', { name: 'Selecionar linha' }).closest('td')).toHaveClass('hidden', 'sm:table-cell');
    expect(within(rowA).getByRole('button', { name: 'Empresa A Ltda' }).closest('td')).toHaveClass('hidden', 'sm:table-cell');
    expect(within(rowA).getByText('Ativo').closest('td')).not.toHaveClass('hidden');
  });
});

