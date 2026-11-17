import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { OrganizationsPage } from './OrganizationsPage';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const orgDetail = {
  id: 'org-1', name: 'Empresa A', legalName: 'Empresa A Ltda', cnpj: '19131243000197', cpf: null,
  documentType: 'CNPJ', active: true, visibleToClients: true, quarterlyBilling: false,
  users: [], addresses: [], contacts: [], serviceDesks: [], agentGroups: [],
};

// DMTE-554: editar um cliente já cadastrado também falhava em silêncio quando a API recusava.
describe('OrganizationsPage: falha ao salvar a edição de um cliente (DMTE-554)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ token: 'fake-token', user: { sub: 'u-1', email: 'u@aponta.com', role: 'ADMIN' } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/me/screen-preferences/organizations') return Promise.resolve({ data: {} });
      if (url === '/organizations') return Promise.resolve({ data: [{ id: 'org-1', name: 'Empresa A', _count: { users: 0 } }] });
      if (url === '/users' || url === '/service-desks') return Promise.resolve({ data: [] });
      if (url === '/organizations/org-1') return Promise.resolve({ data: orgDetail });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('shows the API message in an alert when the PATCH of the registration is refused', async () => {
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 409, data: { message: 'Já existe um cliente com este CNPJ.' } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/organizations']}>
          <Routes><Route path="/organizations" element={<OrganizationsPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /abrir cadastro de empresa a/i }));
    await screen.findByText('Empresa A Ltda');

    await user.click(screen.getByLabelText(/visível para clientes/i));

    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um cliente com este CNPJ.');
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  });
});

describe('OrganizationsPage: mensagem do cadastro e documento no payload (DMTE-554, code-review)', () => {
  const typeCnpj = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
  };

  async function submitManualForm(fill?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/organizations']}>
          <Routes><Route path="/organizations" element={<OrganizationsPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Empresa A');
    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
    await screen.findByText('Nova Empresa');
    await user.type(screen.getByLabelText(/nome fantasia/i), 'Empresa D');
    await fill?.(user);
    await user.click(screen.getByRole('button', { name: /cadastrar/i }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ token: 'fake-token', user: { sub: 'u-1', email: 'u@aponta.com', role: 'ADMIN' } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/me/screen-preferences/organizations') return Promise.resolve({ data: {} });
      if (url === '/organizations') return Promise.resolve({ data: [{ id: 'org-1', name: 'Empresa A', _count: { users: 0 } }] });
      if (url === '/users' || url === '/service-desks') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('shows the pt-BR message, not the raw "Internal server error", when the API answers 500', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 500, data: { statusCode: 500, message: 'Internal server error' } } });

    await submitManualForm(typeCnpj);

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível cadastrar o cliente. Tente novamente.');
  });

  it('shows every validation message when the API answers 400 with a list', async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { status: 400, data: { message: ['billingDueDay must not be greater than 31', 'name should not be empty'] } },
    });

    await submitManualForm(typeCnpj);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('billingDueDay must not be greater than 31 name should not be empty');
  });

  it('sends a filled CNPJ and leaves blank CPF out of the payload', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'org-4', name: 'Empresa D' } });

    await submitManualForm(async (user) => {
      await user.type(screen.getByLabelText(/cnpj/i), '19131243000197');
    });

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.cnpj).toBe('19131243000197');
    expect(payload.cpf).toBeUndefined();
  });
});

// DMTE-559: CNPJ obrigatório e pop-up quando o CNPJ já está cadastrado.
describe('OrganizationsPage: CNPJ obrigatório e repetido (DMTE-559)', () => {
  const duplicate = { response: { status: 409, data: { message: 'Já existe um cliente com este CNPJ.' } } };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ token: 'fake-token', user: { sub: 'u-1', email: 'u@aponta.com', role: 'ADMIN' } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/me/screen-preferences/organizations') return Promise.resolve({ data: {} });
      if (url === '/organizations') {
        return Promise.resolve({
          data: [{ id: 'org-1', name: 'Empresa A', documentType: 'CNPJ', cnpj: '19131243000197', _count: { users: 0 } }],
        });
      }
      if (url === '/users' || url === '/service-desks') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  async function openManualForm() {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/organizations']}>
          <Routes><Route path="/organizations" element={<OrganizationsPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Empresa A');
    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    await user.click(screen.getByRole('menuitem', { name: /cadastrar manualmente/i }));
    await screen.findByText('Nova Empresa');
    await user.type(screen.getByLabelText(/nome fantasia/i), 'Empresa D');
    return user;
  }

  it('AC-07: com o CNPJ vazio mostra a mensagem no campo e não envia o cadastro', async () => {
    const user = await openManualForm();

    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('CNPJ é obrigatório')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('AC-08: quando o cadastro volta 409 abre o pop-up e o formulário continua preenchido', async () => {
    vi.mocked(api.post).mockRejectedValue(duplicate);
    const user = await openManualForm();
    await user.type(screen.getByLabelText(/cnpj/i), '19.131.243/0001-97');

    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    const dialog = await screen.findByRole('dialog', { name: /cnpj já cadastrado/i });
    expect(dialog).toHaveTextContent('Já existe um cliente com este CNPJ.');
    await user.click(within(dialog).getByRole('button', { name: /entendi/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /cnpj já cadastrado/i })).not.toBeInTheDocument());
    expect(screen.getByLabelText(/nome fantasia/i)).toHaveValue('Empresa D');
    expect(screen.getByLabelText(/cnpj/i)).toHaveValue('19.131.243/0001-97');
  });

  it('AC-09: quando a edição direta do CNPJ na grade volta 409 abre o mesmo pop-up', async () => {
    vi.mocked(api.patch).mockRejectedValue(duplicate);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/organizations']}>
          <Routes><Route path="/organizations" element={<OrganizationsPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: '19.131.243/0001-97' }));
    const input = screen.getByDisplayValue('19.131.243/0001-97');
    await user.clear(input);
    await user.type(input, '07671166000189{Enter}');

    const dialog = await screen.findByRole('dialog', { name: /cnpj já cadastrado/i });
    expect(dialog).toHaveTextContent('Já existe um cliente com este CNPJ.');
    expect(api.patch).toHaveBeenCalledWith('/organizations/org-1', { cnpj: '07671166000189' });
  });
});
