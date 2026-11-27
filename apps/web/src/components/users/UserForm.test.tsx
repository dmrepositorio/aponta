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

  // USR-07 (#517): controle desabilitado por permissão diz o motivo, no padrão do convite (user-link-blocked).
  describe('P3-G USR-07: controles desabilitados por permissão explicam o motivo', () => {
    it('USR-07: without CHANGE_USER_ROLE the Tipo combobox is described by "Requer permissão"', () => {
      permissions = ['MANAGE_USERS', 'ACTIVATE_DEACTIVATE_USERS'];
      renderForm(USER);

      const tipo = screen.getByRole('combobox', { name: /Tipo/ });
      expect(tipo).toBeDisabled();
      expect(tipo).toHaveAccessibleDescription(/Requer permissão/);
    });

    it('USR-07: with CHANGE_USER_ROLE the Tipo combobox has no permission description', () => {
      renderForm(USER);

      const tipo = screen.getByRole('combobox', { name: /Tipo/ });
      expect(tipo).toBeEnabled();
      expect(tipo).not.toHaveAccessibleDescription(/Requer permissão/);
    });

    it('USR-07: without ACTIVATE_DEACTIVATE_USERS Inativar is described by "Requer permissão"', async () => {
      permissions = ['MANAGE_USERS', 'CHANGE_USER_ROLE'];
      await openSecurity(USER);

      const button = screen.getByRole('button', { name: 'Inativar' });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(/Requer permissão/);
    });

    it('USR-07: without ACTIVATE_DEACTIVATE_USERS Ativar is described by "Requer permissão"', async () => {
      permissions = ['MANAGE_USERS', 'CHANGE_USER_ROLE'];
      await openSecurity({ ...USER, active: false });

      expect(screen.getByRole('button', { name: 'Ativar' })).toHaveAccessibleDescription(/Requer permissão/);
    });
  });

  describe('F3-26 USR-09: obrigatórios e Salvar desabilitado explicados', () => {
    it('USR-09: the Tipo combobox is aria-required and its asterisk has the accessible text (obrigatório)', () => {
      renderForm(USER);

      const tipo = screen.getByRole('combobox', { name: 'Tipo' });
      expect(tipo).toHaveAttribute('aria-required', 'true');
      const label = document.querySelector('label[for="user-role"]') as HTMLElement;
      expect(label).toHaveTextContent('(obrigatório)');
    });

    it('USR-09: the required text inputs keep aria-required', () => {
      renderForm(USER);

      expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveAttribute('aria-required', 'true');
      expect(screen.getByRole('textbox', { name: 'E-mail' })).toHaveAttribute('aria-required', 'true');
    });

    it('USR-09: Salvar disabled with no changes is described by "Sem alterações", and enabled once the form changes', async () => {
      const user = userEvent.setup();
      renderForm(USER);

      const save = screen.getByRole('button', { name: 'Salvar' });
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleDescription('Sem alterações');

      await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'x');
      expect(save).toBeEnabled();
      expect(save).not.toHaveAccessibleDescription('Sem alterações');
      expect(screen.queryByText('Sem alterações')).not.toBeInTheDocument();
    });

    it('USR-09: a new user form has Salvar enabled, with no "Sem alterações" hint', () => {
      renderForm();

      expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
      expect(screen.queryByText('Sem alterações')).not.toBeInTheDocument();
    });
  });
});
