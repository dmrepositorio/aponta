import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
