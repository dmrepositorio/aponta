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
  users: [],
  addresses: [{ id: 'addr-1', street: 'Av Paulista', city: 'Sao Paulo', state: 'SP', zipCode: '01310100', neighborhood: 'Bela Vista', complement: null }],
  contacts: [{ id: 'contact-1', name: 'Jane Doe', email: 'jane@example.com', phone: '11999999999', type: 'Financeiro' }],
  serviceDesks: [{ id: 'desk-1', name: 'Avulso' }],
  agentGroups: [{ id: 'group-1', name: 'Grupo Suporte', active: true, members: [] }],
};

const users = [
  { id: 'u-1', name: 'Cliente Um', email: 'c1@example.com', role: 'CLIENT', organizationId: null },
];

const API_MESSAGE = 'A API recusou a operação.';
const refusal = { response: { status: 422, data: { message: API_MESSAGE } } };

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/organizations']}>
        <Routes><Route path="/organizations" element={<OrganizationsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  renderPage();
  await user.click(await screen.findByRole('button', { name: /abrir cadastro de empresa a/i }));
  await screen.findByText('Empresa A Ltda');
}

/** A remoção pode pedir confirmação (ORG-03); o teste de erro não depende de ela existir. */
async function confirmIfAsked(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.queryByRole('dialog');
  if (dialog) await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
}

async function expectApiAlert() {
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(API_MESSAGE);
}

// ORG-02 (#463): as mutações da aba Geral, Relacionamentos e Usuários falhavam em silêncio.
describe('OrganizationsPage: falha das mutações do detalhe do cliente (ORG-02)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    useAuthStore.setState({ token: 'fake-token', user: { sub: 'u-1', email: 'u@aponta.com', role: 'ADMIN' } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/me/screen-preferences/organizations') return Promise.resolve({ data: {} });
      if (url === '/organizations') return Promise.resolve({ data: [{ id: 'org-1', name: 'Empresa A', _count: { users: 0 } }] });
      if (url === '/users') return Promise.resolve({ data: users });
      if (url === '/service-desks') return Promise.resolve({ data: [{ id: 'desk-1', name: 'Avulso' }, { id: 'desk-2', name: 'Contrato' }] });
      if (url === '/organizations/org-1') return Promise.resolve({ data: orgDetail });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('shows the API message and keeps the typed address when adding an address fails', async () => {
    vi.mocked(api.post).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);

    await user.type(screen.getByLabelText('Logradouro'), 'Rua Nova');
    await user.click(screen.getByRole('button', { name: /adicionar endereço/i }));

    await expectApiAlert();
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Nova');
  });

  it('shows the API message and keeps the typed contact when adding a contact fails', async () => {
    vi.mocked(api.post).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);

    await user.type(screen.getByLabelText(/^nome$/i), 'Maria Silva');
    await user.click(screen.getByRole('button', { name: /adicionar contato/i }));

    await expectApiAlert();
    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Maria Silva');
  });

  it('shows the API message when removing an address fails', async () => {
    vi.mocked(api.delete).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);

    const row = screen.getByText(/av paulista/i).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button'));
    await confirmIfAsked(user);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/addresses/addr-1'));
    await expectApiAlert();
  });

  it('shows the API message when removing a contact fails', async () => {
    vi.mocked(api.delete).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);

    const row = screen.getByText(/jane doe/i).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button'));
    await confirmIfAsked(user);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/contacts/contact-1'));
    await expectApiAlert();
  });

  it('shows the API message and keeps the selected desk when linking a desk fails', async () => {
    vi.mocked(api.post).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: /relacionamentos/i }));

    await user.selectOptions(screen.getByLabelText(/adicionar mesa de serviço/i, { selector: 'select' }), 'desk-2');
    await user.click(screen.getByRole('button', { name: /^vincular$/i }));

    await expectApiAlert();
    expect(screen.getByLabelText(/adicionar mesa de serviço/i, { selector: 'select' })).toHaveValue('desk-2');
  });

  it('shows the API message when unlinking a desk fails', async () => {
    vi.mocked(api.delete).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: /relacionamentos/i }));

    await user.click(await screen.findByRole('button', { name: /desvincular/i }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/service-desks/desk-1'));
    await expectApiAlert();
  });

  it('shows the API message and keeps the typed name when creating an agent group fails', async () => {
    vi.mocked(api.post).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: /relacionamentos/i }));

    await user.type(await screen.findByLabelText(/nome do grupo/i), 'Grupo Vendas');
    await user.click(screen.getByRole('button', { name: /adicionar grupo de atendentes/i }));

    await expectApiAlert();
    expect(screen.getByLabelText(/nome do grupo/i)).toHaveValue('Grupo Vendas');
  });

  it('shows the API message when removing an agent group fails', async () => {
    vi.mocked(api.delete).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: /relacionamentos/i }));

    const row = (await screen.findByText('Grupo Suporte')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button'));
    await confirmIfAsked(user);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/agent-groups/group-1'));
    await expectApiAlert();
  });

  it('shows the API message when linking a user fails', async () => {
    vi.mocked(api.patch).mockRejectedValue(refusal);
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: 'Usuários' }));

    await user.click(await screen.findByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/u-1', { organizationId: 'org-1' }));
    await expectApiAlert();
  });
});
