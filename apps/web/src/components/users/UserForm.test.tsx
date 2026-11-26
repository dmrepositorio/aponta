import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import type { UserListItem } from '../../hooks/useUsers';
import { useAuthStore } from '../../stores/authStore';
import { UserForm } from './UserForm';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let permissions: string[] = [];
vi.mock('../../hooks/usePermissions', () => ({ useHasPermission: (key: string) => permissions.includes(key) }));
vi.mock('../../hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }));

const USER: UserListItem = {
  id: 'user-1', name: 'Ana Silva', email: 'ana@aponta.test', role: 'AGENT', active: true, pending: false,
  phone: null, extension: null, organizationId: null, technicalGroup: null, permissionGroups: [], twoFactorEnabled: false,
};

function renderForm(user?: UserListItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UserForm user={user} />
    </QueryClientProvider>,
  );
}
const openSecurity = async (user: UserListItem) => {
  renderForm(user);
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Segurança' }));
};

describe('UserForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions = ['MANAGE_USERS', 'CHANGE_USER_ROLE', 'ACTIVATE_DEACTIVATE_USERS'];
    useAuthStore.setState({ token: 'fake-token', user: { sub: 'user-9', email: 'adm@aponta.test', role: 'ADMIN' } });
    vi.mocked(api.get).mockResolvedValue({ data: [] });
  });

  describe('F3-26 USR-06: inativar a si mesmo na aba Segurança', () => {
    it('USR-06: Inativar is disabled for the logged user, with the reason as its description', async () => {
      useAuthStore.setState({ user: { sub: 'user-1', email: 'ana@aponta.test', role: 'AGENT' } });
      await openSecurity(USER);

      const button = screen.getByRole('button', { name: 'Inativar' });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('Você não pode inativar a si mesmo.');
    });

    it('USR-06: Inativar stays enabled for another user', async () => {
      await openSecurity(USER);

      expect(screen.getByRole('button', { name: 'Inativar' })).toBeEnabled();
    });

    it('USR-06: Ativar is not blocked for the logged user (only inactivating is)', async () => {
      useAuthStore.setState({ user: { sub: 'user-1', email: 'ana@aponta.test', role: 'AGENT' } });
      await openSecurity({ ...USER, active: false });

      expect(screen.getByRole('button', { name: 'Ativar' })).toBeEnabled();
    });

    it('USR-06: without ACTIVATE_DEACTIVATE_USERS Inativar stays disabled for another user', async () => {
      permissions = ['MANAGE_USERS'];
      await openSecurity(USER);

      expect(screen.getByRole('button', { name: 'Inativar' })).toBeDisabled();
    });
  });
});
