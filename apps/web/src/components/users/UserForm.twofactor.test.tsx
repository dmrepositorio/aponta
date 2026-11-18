import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import type { UserListItem } from '../../hooks/useUsers';
import { UserForm } from './UserForm';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let permissions: string[] = [];
vi.mock('../../hooks/usePermissions', () => ({ useHasPermission: (key: string) => permissions.includes(key) }));
vi.mock('../../hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }));

// DMTE-551 T6, AC-16 (aba Segurança): quem tem a permissão desativa o segundo fator de outro usuário.
const USER: UserListItem = {
  id: 'user-1', name: 'Ana Silva', email: 'ana@aponta.test', role: 'AGENT', active: true, pending: false,
  phone: null, extension: null, organizationId: null, technicalGroup: null, permissionGroups: [], twoFactorEnabled: true,
};
const KEY = 'DISABLE_USER_TWO_FACTOR';

const openSecurity = async (user: UserListItem = USER) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UserForm user={user} /></QueryClientProvider>);
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Segurança' }));
};
const section = () => screen.getByRole('heading', { name: /^segundo fator$/i }).closest('section')!;

describe('UserForm: segundo fator na aba Segurança', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions = [KEY];
  });

  it('AC-16: mostra "Ativado" e o botão para quem tem a permissão; confirma e chama a rota do administrador', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: { ok: true } });
    await openSecurity();

    expect(within(section()).getByText(/ativado/i)).toBeInTheDocument();
    await user.click(within(section()).getByRole('button', { name: /desativar segundo fator/i }));
    expect(api.post).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/users/user-1/two-factor/disable'));
    expect(await screen.findByText(/segundo fator desativado/i)).toBeInTheDocument();
  });

  it('AC-16: sem a permissão o botão não aparece, mas o estado continua visível', async () => {
    permissions = ['MANAGE_USERS'];
    await openSecurity();

    expect(within(section()).getByText(/ativado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /desativar segundo fator/i })).not.toBeInTheDocument();
  });

  it('AC-16: quem não tem segundo fator mostra "Desativado" e nenhum botão', async () => {
    await openSecurity({ ...USER, twoFactorEnabled: false });

    expect(within(section()).getByText(/desativado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /desativar segundo fator/i })).not.toBeInTheDocument();
  });

  it('AC-16: recusa do servidor mostra o motivo e mantém o estado', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message: 'O segundo fator não está ativo.' } } });
    await openSecurity();

    await user.click(within(section()).getByRole('button', { name: /desativar segundo fator/i }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText(/o segundo fator não está ativo/i)).toBeInTheDocument();
  });
});
