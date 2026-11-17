import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersPage } from './UsersPage';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

const FLAG = 'convite-e-redefinicao-usuario';
const ALL_PERMISSIONS = [
  'MANAGE_USERS',
  'CREATE_USERS',
  'CHANGE_USER_ROLE',
  'ACTIVATE_DEACTIVATE_USERS',
  'SEND_USER_INVITES_AND_RESETS',
];

interface TestUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  pending: boolean;
  phone: string | null;
  extension: string | null;
  organizationId: string | null;
  technicalGroup: { id: string; name: string } | null;
  permissionGroups: { id: string; name: string }[];
}
interface UsersList {
  data: TestUser[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

const ANA: TestUser = {
  id: 'user-1',
  name: 'Ana Silva',
  email: 'ana@aponta.com',
  role: 'AGENT',
  active: true,
  pending: false,
  phone: '1133334444',
  extension: '210',
  organizationId: null,
  technicalGroup: { id: 'tg-1', name: 'Suporte N1' },
  permissionGroups: [{ id: 'pg-1', name: 'Grupo Atendimento' }],
};
const BRUNO: TestUser = {
  id: 'user-2',
  name: 'Bruno Costa',
  email: 'bruno@aponta.com',
  role: 'CLIENT',
  active: false,
  pending: false,
  phone: null,
  extension: null,
  organizationId: 'org-1',
  technicalGroup: null,
  permissionGroups: [],
};
const CARLA: TestUser = {
  id: 'user-3',
  name: 'Carla Dias',
  email: 'carla@aponta.com',
  role: 'AGENT_MASTER',
  active: true,
  pending: true,
  phone: null,
  extension: null,
  organizationId: null,
  technicalGroup: null,
  permissionGroups: [],
};
const CREATED = { ...CARLA, id: 'user-9', name: 'Dora Lima', email: 'dora@aponta.com', role: 'AGENT' };

const USERS_PAGE_1: UsersList = {
  data: [ANA, BRUNO],
  meta: { total: 2, page: 1, pageSize: 20, totalPages: 1 },
};
const WITH_CARLA: UsersList = { data: [ANA, BRUNO, CARLA], meta: { total: 3, page: 1, pageSize: 20, totalPages: 1 } };
const USERS_MANY: UsersList = { data: [ANA, BRUNO, CARLA], meta: { total: 45, page: 1, pageSize: 20, totalPages: 3 } };

interface ApiOptions {
  permissions?: string[];
  flag?: boolean;
  list?: UsersList;
  preference?: Record<string, unknown>;
  extraUsers?: TestUser[];
}

/** Servidor simulado: lista, detalhe, permissões da tela (/auth/me), flag, preferência de tela e listas de apoio do formulário. */
function mockApi({ permissions = ALL_PERMISSIONS, flag = false, list = USERS_PAGE_1, preference = {}, extraUsers = [] }: ApiOptions = {}) {
  const everyone = [...list.data, ...extraUsers];
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/users') return Promise.resolve({ data: list });
    if (url.startsWith('/users/')) return Promise.resolve({ data: everyone.find((u) => `/users/${u.id}` === url) });
    if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-0', isAdmin: false, permissions } });
    if (url === '/feature-flags') return Promise.resolve({ data: { [FLAG]: flag } });
    if (url === '/me/screen-preferences/users') return Promise.resolve({ data: preference });
    if (url === '/technical-groups') return Promise.resolve({ data: [{ id: 'tg-1', name: 'Suporte N1' }, { id: 'tg-2', name: 'Suporte N2' }] });
    if (url === '/permission-groups') return Promise.resolve({ data: [{ id: 'pg-1', name: 'Grupo Atendimento' }, { id: 'pg-2', name: 'Grupo Gestão' }] });
    if (url === '/organizations') return Promise.resolve({ data: [{ id: 'org-1', name: 'Acme Ltda' }] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function signIn() {
  useAuthStore.setState({ token: 'fake-token', user: { sub: 'u-0', email: 'admin@aponta.com', role: 'ADMIN' } });
}

function renderUsersPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const usersParams = () => {
  const calls = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/users');
  return (calls[calls.length - 1][1] as { params: Record<string, unknown> }).params;
};
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const axiosError = (status: number, message?: string) => ({ isAxiosError: true, response: { status, data: message ? { message } : {} } });
const tipoGroup = (drawer: HTMLElement) => within(drawer).getByRole('group', { name: 'Tipo' });
const patchCall = (index = 0) => vi.mocked(api.patch).mock.calls[index].slice(0, 2);

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Ana Silva');
  await user.click(screen.getByTestId('ez-toolbar-filter-panel-button'));
  return screen.getByTestId('ez-filter-drawer');
}

async function openUser(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByText(name));
  await screen.findByDisplayValue(name);
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    mockApi();
  });

  it('lists users paginated from GET /users with name, groups and status columns', async () => {
    renderUsersPage();

    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument();
    expect(screen.getByText('Suporte N1')).toBeInTheDocument();
    expect(screen.getByText('Grupo Atendimento')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({ params: expect.objectContaining({ page: 1 }) }),
    );
  });

  // DMTE-550: a busca mora no painel de filtros (dsgrid), então o teste abre o painel antes de digitar.
  it('searches by typing in the filter drawer, sending q to GET /users', async () => {
    const user = userEvent.setup();
    renderUsersPage();
    const drawer = await openFilters(user);

    await user.type(within(drawer).getByLabelText(/buscar usuário/i), 'ana');

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/users',
        expect.objectContaining({ params: expect.objectContaining({ q: 'ana', page: 1 }) }),
      ),
    );
  });

  // DMTE-550: as abas passam de Perfil e Segurança para Geral e Segurança.
  it('renders Geral and Segurança tabs in the detail view', async () => {
    const user = userEvent.setup();
    renderUsersPage();
    await user.click(await screen.findByText('Ana Silva'));

    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getByText('Geral')).toBeInTheDocument();
    expect(within(tabs).getByText('Segurança')).toBeInTheDocument();
  });

  it('DMTE-541 AC-03: the status in the list is the shared tag, text plus icon, no raw emerald', async () => {
    const { container } = renderUsersPage();

    const on = (await screen.findByText('Ativo')).closest('div') as HTMLElement;
    const off = screen.getByText('Inativo').closest('div') as HTMLElement;
    expect(on.querySelector('[data-glyph]')).not.toBeNull();
    expect(off.querySelector('[data-glyph]')).not.toBeNull();
    expect(on.querySelector('[data-glyph]')?.getAttribute('data-glyph')).not.toBe(
      off.querySelector('[data-glyph]')?.getAttribute('data-glyph'),
    );
    expect(container.innerHTML).not.toMatch(/emerald-/);
  });

  describe('AC-01: barra de ferramentas no padrão dsgrid', () => {
    it('AC-01: uses the entity toolbar with Novo usuário, Recarregar, column configuration, Grade/Formulário and Filtros, and no Excluir or Duplicar', async () => {
      signIn();
      renderUsersPage();
      await screen.findByText('Ana Silva');

      expect(screen.getByTestId('ez-entity-toolbar')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Novo usuário' })).toBeInTheDocument();
      expect(screen.getByTestId('ez-toolbar-refresh-button')).toBeInTheDocument();
      expect(screen.getByTestId('ez-toolbar-screen-config-button')).toBeInTheDocument();
      expect(screen.getByTestId('ez-toolbar-mode-toggle-button')).toHaveTextContent('Grade');
      expect(screen.getByTestId('ez-toolbar-filter-panel-button')).toBeInTheDocument();
      expect(screen.queryByTestId('ez-toolbar-delete-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ez-toolbar-clone-button')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /excluir|duplicar/i })).not.toBeInTheDocument();
    });

    it('AC-01: shows Novo usuário only to who has CREATE_USERS', async () => {
      mockApi({ permissions: ['MANAGE_USERS', 'ACTIVATE_DEACTIVATE_USERS'] });
      signIn();
      renderUsersPage();
      await screen.findByText('Ana Silva');
      // espera /auth/me chegar: o botão em lote só existe com ACTIVATE_DEACTIVATE_USERS
      await screen.findByRole('button', { name: 'Inativar' });

      expect(screen.queryByRole('button', { name: 'Novo usuário' })).not.toBeInTheDocument();
    });

    it('AC-01: Recarregar fetches the list again', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      await screen.findByText('Ana Silva');
      const before = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/users').length;

      await user.click(screen.getByTestId('ez-toolbar-refresh-button'));

      await waitFor(() =>
        expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/users').length).toBeGreaterThan(before),
      );
    });

    it('AC-01: the toggle switches the grid to the form of the first user and back', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      await screen.findByText('Ana Silva');

      await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
      expect(await screen.findByDisplayValue('Ana Silva')).toBeInTheDocument();
      expect(screen.getByTestId('ez-toolbar-mode-toggle-button')).toHaveTextContent('Formulário');

      await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
      expect(await screen.findByText('Bruno Costa')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
    });
  });

  describe('AC-03: painel de filtros, colunas e paginação', () => {
    it('AC-03: the drawer has Tipo with the five roles, Status, the groups, the search, dynamic filters and saved filters', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);

      expect(within(drawer).getByText('Filtros de Usuários')).toBeInTheDocument();
      const tipo = within(drawer).getByRole('group', { name: 'Tipo' });
      expect(
        within(tipo).getAllByRole('checkbox').map((box) => (box as HTMLInputElement).labels?.[0]?.textContent?.trim()),
      ).toEqual(expect.arrayContaining(['Administrador', 'Gerente de Atendimento', 'Atendente', 'Cliente Master', 'Cliente']));
      expect(within(tipo).getAllByRole('checkbox')).toHaveLength(5);
      expect(within(drawer).getByLabelText(/^status$/i)).toBeInTheDocument();
      expect(within(drawer).getByLabelText(/^grupo de atendentes$/i)).toBeInTheDocument();
      expect(within(drawer).getByLabelText(/^grupo de permissões$/i)).toBeInTheDocument();
      expect(within(drawer).getByLabelText(/buscar usuário/i)).toBeInTheDocument();
      expect(within(drawer).getByTestId('ez-dynamic-filter-add')).toBeInTheDocument();
      expect(within(drawer).getByTestId('ez-filter-drawer-save-btn')).toBeInTheDocument();
    });

    it('AC-03: Tipo is a multiple choice sent to the server as the roles list, separated by comma', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);
      expect(usersParams().roles).toBeUndefined();

      const tipo = within(drawer).getByRole('group', { name: 'Tipo' });
      await user.click(within(tipo).getByRole('checkbox', { name: 'Atendente' }));
      await user.click(within(tipo).getByRole('checkbox', { name: 'Administrador' }));

      await waitFor(() => expect((usersParams().roles as string).split(',').sort()).toEqual(['ADMIN', 'AGENT']));
      expect(typeof usersParams().roles).toBe('string');
    });

    it('AC-03: Status goes to the server, and Todos os status sends no status at all', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);
      const status = within(drawer).getByLabelText(/^status$/i);

      await user.selectOptions(status, 'INACTIVE');
      await waitFor(() => expect(usersParams().status).toBe('INACTIVE'));

      await user.selectOptions(status, 'ALL');
      await waitFor(() => expect(usersParams().status).toBeUndefined());
    });

    it('AC-03: the group filters go to the server as technicalGroupId and permissionGroupId', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);

      await user.selectOptions(await within(drawer).findByLabelText(/^grupo de atendentes$/i), 'tg-1');
      await user.selectOptions(await within(drawer).findByLabelText(/^grupo de permissões$/i), 'pg-1');

      await waitFor(() => expect(usersParams()).toEqual(expect.objectContaining({ technicalGroupId: 'tg-1', permissionGroupId: 'pg-1' })));
    });

    it('AC-03: changing a filter or the search goes back to page 1', async () => {
      mockApi({ list: USERS_MANY });
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);

      await user.click(screen.getByRole('button', { name: '2' }));
      await waitFor(() => expect(usersParams().page).toBe(2));
      await user.selectOptions(within(drawer).getByLabelText(/^status$/i), 'ACTIVE');
      await waitFor(() => expect(usersParams().page).toBe(1));

      await user.click(screen.getByRole('button', { name: '2' }));
      await waitFor(() => expect(usersParams().page).toBe(2));
      await user.type(within(drawer).getByLabelText(/buscar usuário/i), 'a');
      await waitFor(() => expect(usersParams()).toEqual(expect.objectContaining({ q: 'a', page: 1 })));

      await user.click(screen.getByRole('button', { name: '2' }));
      await waitFor(() => expect(usersParams().page).toBe(2));
      await user.click(within(tipoGroup(drawer)).getByRole('checkbox', { name: 'Cliente' }));
      await waitFor(() => expect(usersParams().page).toBe(1));
    });

    it('AC-03: keeps 20 per page with the page buttons and the total', async () => {
      mockApi({ list: USERS_MANY });
      renderUsersPage();
      await screen.findByText('Ana Silva');

      expect(usersParams().pageSize).toBe(20);
      expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
      expect(screen.getByTestId('ez-toolbar-record-count')).toHaveTextContent(/\bde 45\b/);
      expect(screen.queryByLabelText(/linhas por página/i)).not.toBeInTheDocument();
    });

    it('AC-03: saves a filter, clears it and reapplies it from Meus Filtros, keeping it per user', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);

      await user.selectOptions(within(drawer).getByLabelText(/^status$/i), 'PENDING');
      await user.click(within(drawer).getByTestId('ez-filter-drawer-save-btn'));
      await user.type(within(drawer).getByTestId('ez-filter-drawer-name-input'), 'Só pendentes');
      await user.click(within(drawer).getByTestId('ez-filter-drawer-confirm-save'));
      const saved = await within(drawer).findByTestId('ez-filter-drawer-saved-list');

      await user.click(within(drawer).getByTestId('ez-filter-drawer-clear'));
      expect(within(drawer).getByLabelText(/^status$/i)).toHaveValue('ALL');
      await waitFor(() => expect(usersParams().status).toBeUndefined());

      await user.click(within(saved).getByText('Só pendentes'));
      expect(within(drawer).getByLabelText(/^status$/i)).toHaveValue('PENDING');
      await waitFor(() => expect(usersParams().status).toBe('PENDING'));
      await waitFor(() =>
        expect(api.put).toHaveBeenCalledWith(
          '/me/screen-preferences/users',
          expect.objectContaining({ savedFilters: [expect.objectContaining({ name: 'Só pendentes' })] }),
        ),
      );
    });

    it('AC-03: columns are configurable per user: toggling one saves the preference, and a saved one starts hidden', async () => {
      const user = userEvent.setup();
      renderUsersPage();
      await screen.findByText('Ana Silva');

      await user.click(screen.getByTestId('ez-toolbar-screen-config-button'));
      const modal = screen.getByTestId('ez-entity-screen-config-modal');
      await user.click(within(modal).getByTestId('ez-screen-config-toggle-role'));
      await waitFor(() =>
        expect(api.put).toHaveBeenCalledWith(
          '/me/screen-preferences/users',
          expect.objectContaining({ grid: expect.objectContaining({ columnVisibility: expect.objectContaining({ role: false }) }) }),
        ),
      );
    });

    it('AC-03: a column the user hid before starts hidden', async () => {
      mockApi({ preference: { grid: { columnVisibility: { role: false }, density: 'compact' } } });
      renderUsersPage();
      await screen.findByText('Ana Silva');

      await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Tipo' })).not.toBeInTheDocument());
      expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument();
    });
  });

  describe('AC-04: celular', () => {
    it('AC-04: below 640 px the grid keeps Nome and Status, and the toolbar scrolls in one line', async () => {
      renderUsersPage();
      await screen.findByText('Ana Silva');

      for (const name of ['Grupos de permissões', 'Grupo de atendentes', 'Tipo']) {
        expect(screen.getByRole('columnheader', { name })).toHaveClass('hidden', 'sm:table-cell');
      }
      for (const name of ['Nome', 'Status']) {
        expect(screen.getByRole('columnheader', { name })).not.toHaveClass('hidden');
      }
      expect(within(rowOf('Ana Silva')).getByText('Ativo').closest('td')).not.toHaveClass('hidden');
      expect(screen.getByTestId('ez-entity-toolbar').querySelector('.max-sm\\:overflow-x-auto')).not.toBeNull();
      expect(screen.getByTestId('users-grid-content')).toHaveClass('touch-pan-x', 'touch-pan-y', 'overscroll-x-contain');
    });
  });

  describe('AC-20: Convite pendente', () => {
    it('AC-20: the grid shows Convite pendente as a tag with text and its own icon', async () => {
      mockApi({ list: WITH_CARLA });
      renderUsersPage();
      await screen.findByText('Carla Dias');

      const pending = within(rowOf('Carla Dias')).getByText('Convite pendente').closest('div') as HTMLElement;
      const active = within(rowOf('Ana Silva')).getByText('Ativo').closest('div') as HTMLElement;
      const glyph = pending.querySelector('[data-glyph]')?.getAttribute('data-glyph');
      expect(glyph).toBeTruthy();
      expect(glyph).not.toBe(active.querySelector('[data-glyph]')?.getAttribute('data-glyph'));
      expect(within(rowOf('Ana Silva')).queryByText('Convite pendente')).not.toBeInTheDocument();
    });

    it('AC-20: the Status filter offers Convite pendente and sends PENDING', async () => {
      mockApi({ list: WITH_CARLA });
      const user = userEvent.setup();
      renderUsersPage();
      const drawer = await openFilters(user);
      const status = within(drawer).getByLabelText(/^status$/i);

      expect(within(status).getAllByRole('option').map((o) => [(o as HTMLOptionElement).value, o.textContent])).toEqual([
        ['ALL', 'Todos os status'],
        ['ACTIVE', 'Ativo'],
        ['INACTIVE', 'Inativo'],
        ['PENDING', 'Convite pendente'],
      ]);
      await user.selectOptions(status, 'PENDING');
      await waitFor(() => expect(usersParams().status).toBe('PENDING'));
    });

    it('AC-20: the form of a pending user shows Convite pendente', async () => {
      mockApi({ list: WITH_CARLA });
      const user = userEvent.setup();
      renderUsersPage();
      await openUser(user, 'Carla Dias');

      expect(screen.getAllByText('Convite pendente').length).toBeGreaterThan(0);
      expect(screen.queryByText('Ativo')).not.toBeInTheDocument();
    });
  });

  describe('AC-07: Novo usuário', () => {
    async function openNewUser(user: ReturnType<typeof userEvent.setup>) {
      signIn();
      renderUsersPage();
      await user.click(await screen.findByRole('button', { name: 'Novo usuário' }));
      return screen.findByRole('button', { name: 'Salvar' });
    }

    it('AC-07: opens an empty form with no password field', async () => {
      const user = userEvent.setup();
      await openNewUser(user);

      expect(screen.getByLabelText(/^nome/i)).toHaveValue('');
      for (const label of [/^e-mail/i, /^tipo/i, /^telefone/i, /^ramal/i, /^cliente/i, /^grupo de atendentes/i]) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
      expect(screen.getByRole('group', { name: /grupos de permissões/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
    });

    it('AC-07: validates name, e-mail and tipo inline, focuses the first invalid field and sends nothing', async () => {
      const user = userEvent.setup();
      const save = await openNewUser(user);

      await user.click(save);

      expect(await screen.findByText('Nome é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('E-mail é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Tipo é obrigatório')).toBeInTheDocument();
      expect(screen.getByLabelText(/^nome/i)).toHaveFocus();
      expect(api.post).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText(/^nome/i), 'Dora Lima');
      await user.type(screen.getByLabelText(/^e-mail/i), 'sem-arroba');
      await user.click(save);
      expect(await screen.findByText('E-mail inválido')).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('AC-07: creates with the trimmed fields only, no password, and opens the new cadastro as Convite pendente', async () => {
      mockApi({ extraUsers: [CREATED] });
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({ data: CREATED });
      const save = await openNewUser(user);

      await user.type(screen.getByLabelText(/^nome/i), '  Dora Lima ');
      await user.type(screen.getByLabelText(/^e-mail/i), ' dora@aponta.com ');
      await user.selectOptions(screen.getByLabelText(/^tipo/i), 'AGENT');
      await user.click(save);

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.post).mock.calls[0].slice(0, 2)).toEqual([
        '/users',
        { name: 'Dora Lima', email: 'dora@aponta.com', role: 'AGENT' },
      ]);
      expect(await screen.findByDisplayValue('Dora Lima')).toBeInTheDocument();
      expect(screen.getAllByText('Convite pendente').length).toBeGreaterThan(0);
      expect(screen.getByRole('tab', { name: 'Segurança' })).toBeInTheDocument();
    });

    it('AC-07: sends the optional fields that were filled: phone, extension, cliente, grupo de atendentes and grupos de permissões', async () => {
      mockApi({ extraUsers: [CREATED] });
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({ data: CREATED });
      const save = await openNewUser(user);

      await user.type(screen.getByLabelText(/^nome/i), 'Dora Lima');
      await user.type(screen.getByLabelText(/^e-mail/i), 'dora@aponta.com');
      await user.selectOptions(screen.getByLabelText(/^tipo/i), 'AGENT');
      await user.type(screen.getByLabelText(/^telefone/i), '11999990000');
      await user.type(screen.getByLabelText(/^ramal/i), '123');
      await screen.findByRole('option', { name: 'Acme Ltda' });
      await user.selectOptions(screen.getByLabelText(/^cliente/i), 'org-1');
      await user.selectOptions(screen.getByLabelText(/^grupo de atendentes/i), 'tg-1');
      await user.click(await screen.findByRole('checkbox', { name: 'Grupo Gestão' }));
      await user.click(save);

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.post).mock.calls[0].slice(0, 2)).toEqual([
        '/users',
        {
          name: 'Dora Lima',
          email: 'dora@aponta.com',
          role: 'AGENT',
          phone: '11999990000',
          extension: '123',
          organizationId: 'org-1',
          technicalGroupId: 'tg-1',
          permissionGroupIds: ['pg-2'],
        },
      ]);
    });

    it('AC-07: shows the server error for an e-mail already registered and keeps the form', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockRejectedValueOnce(axiosError(409, 'E-mail já cadastrado'));
      const save = await openNewUser(user);

      await user.type(screen.getByLabelText(/^nome/i), 'Dora Lima');
      await user.type(screen.getByLabelText(/^e-mail/i), 'ANA@aponta.com');
      await user.selectOptions(screen.getByLabelText(/^tipo/i), 'AGENT');
      await user.click(save);

      expect(await screen.findByText('E-mail já cadastrado')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
      expect(screen.getByLabelText(/^e-mail/i)).toHaveValue('ANA@aponta.com');
    });

    it('AC-26: an e-mail with a line break, or longer than 254 characters, is refused before sending', async () => {
      const user = userEvent.setup();
      const save = await openNewUser(user);
      await user.type(screen.getByLabelText(/^nome/i), 'Dora Lima');
      await user.selectOptions(screen.getByLabelText(/^tipo/i), 'AGENT');

      fireEvent.change(screen.getByLabelText(/^e-mail/i), { target: { value: 'dora@aponta.com\r\nBcc: alvo@example.com' } });
      await user.click(save);
      expect(await screen.findByText('E-mail inválido')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/^e-mail/i), { target: { value: `${'a'.repeat(250)}@aponta.com` } });
      await user.click(save);
      expect(screen.getByText('E-mail inválido')).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('AC-26: a name with HTML is sent as plain text and shown as text, never as markup', async () => {
      const hostile = { ...CREATED, name: '<b>x</b><script>alert(1)</script>' };
      mockApi({ extraUsers: [hostile] });
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({ data: hostile });
      const save = await openNewUser(user);

      await user.type(screen.getByLabelText(/^nome/i), hostile.name);
      await user.type(screen.getByLabelText(/^e-mail/i), 'dora@aponta.com');
      await user.selectOptions(screen.getByLabelText(/^tipo/i), 'AGENT');
      await user.click(save);

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(expect.objectContaining({ name: hostile.name }));
      expect(await screen.findByDisplayValue(hostile.name)).toBeInTheDocument();
      expect(document.body.querySelector('b')).toBeNull();
      expect(document.body.querySelector('script')).toBeNull();
    });
  });

  describe('AC-10: Editar usuário', () => {
    it('AC-10: the Geral tab shows every field filled, with a single Salvar', async () => {
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await openUser(user, 'Ana Silva');

      expect(screen.getByLabelText(/^e-mail/i)).toHaveValue('ana@aponta.com');
      expect(screen.getByLabelText(/^telefone/i)).toHaveValue('1133334444');
      expect(screen.getByLabelText(/^ramal/i)).toHaveValue('210');
      expect(screen.getByLabelText(/^tipo/i)).toHaveValue('AGENT');
      expect(await screen.findByLabelText(/^grupo de atendentes/i)).toHaveValue('tg-1');
      expect(await screen.findByRole('checkbox', { name: 'Grupo Atendimento' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Grupo Gestão' })).not.toBeChecked();
      expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
    });

    it('AC-10: saves only what changed in one PATCH, and leaving afterwards asks nothing', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockResolvedValue({ data: { ...ANA, name: 'Ana Souza' } });
      renderUsersPage();
      await openUser(user, 'Ana Silva');
      await screen.findByRole('checkbox', { name: 'Grupo Gestão' });

      await user.clear(screen.getByLabelText(/^nome/i));
      await user.type(screen.getByLabelText(/^nome/i), 'Ana Souza');
      await user.selectOptions(screen.getByLabelText(/^grupo de atendentes/i), '');
      await user.click(screen.getByRole('checkbox', { name: 'Grupo Gestão' }));
      await user.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      const [url, body] = patchCall();
      expect(url).toBe('/users/user-1');
      expect(body).toEqual({ name: 'Ana Souza', technicalGroupId: null, permissionGroupIds: expect.any(Array) });
      expect([...(body as { permissionGroupIds: string[] }).permissionGroupIds].sort()).toEqual(['pg-1', 'pg-2']);

      await waitFor(() => expect(screen.queryByText(/^Alterações não salvas/)).not.toBeInTheDocument());
      await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText('Bruno Costa')).toBeInTheDocument();
    });

    it('AC-10: shows an error under each invalid field and does not send', async () => {
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await openUser(user, 'Ana Silva');

      await user.clear(screen.getByLabelText(/^nome/i));
      await user.clear(screen.getByLabelText(/^e-mail/i));
      await user.type(screen.getByLabelText(/^e-mail/i), 'quebrado');
      await user.click(screen.getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByText('Nome é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('E-mail inválido')).toBeInTheDocument();
      expect(screen.getByLabelText(/^nome/i)).toHaveFocus();
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('AC-10: shows the server error inline when the e-mail already belongs to another user', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockRejectedValueOnce(axiosError(409, 'E-mail já cadastrado'));
      renderUsersPage();
      await openUser(user, 'Ana Silva');

      await user.clear(screen.getByLabelText(/^e-mail/i));
      await user.type(screen.getByLabelText(/^e-mail/i), 'bruno@aponta.com');
      await user.click(screen.getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByText('E-mail já cadastrado')).toBeInTheDocument();
      expect(screen.getByLabelText(/^e-mail/i)).toHaveValue('bruno@aponta.com');
    });

    it('AC-10: an unsaved change shows the pending line and asks before leaving; Cancelar keeps it, Confirmar discards it', async () => {
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await openUser(user, 'Ana Silva');
      expect(screen.queryByText(/^Alterações não salvas/)).not.toBeInTheDocument();

      await user.type(screen.getByLabelText(/^ramal/i), '9');
      expect(screen.getByText(/^Alterações não salvas/)).toBeInTheDocument();

      await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Descartar alterações?')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^ramal/i)).toHaveValue('2109');

      await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
      expect(await screen.findByText('Bruno Costa')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('AC-10: changing the tipo warns that the permission groups are not changed, and sends the role', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockResolvedValue({ data: { ...ANA, role: 'AGENT_MASTER' } });
      renderUsersPage();
      await openUser(user, 'Ana Silva');
      await waitFor(() => expect(screen.getByLabelText(/^tipo/i)).toBeEnabled());

      await user.selectOptions(screen.getByLabelText(/^tipo/i), 'AGENT_MASTER');

      expect(screen.getByText(/não troca os grupos de permissões/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(patchCall()).toEqual(['/users/user-1', { role: 'AGENT_MASTER' }]));
    });

    it('AC-10: without CHANGE_USER_ROLE the tipo is read-only and the other fields stay editable', async () => {
      mockApi({ permissions: ['MANAGE_USERS'] });
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await openUser(user, 'Ana Silva');
      await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/auth/me'));

      expect(screen.getByLabelText(/^tipo/i)).toBeDisabled();
      expect(screen.getByLabelText(/^nome/i)).toBeEnabled();
      expect(screen.getByLabelText(/^e-mail/i)).toBeEnabled();
    });
  });

  describe('AC-14: ativar e inativar', () => {
    const selectRow = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
      user.click(within(rowOf(name)).getByRole('checkbox', { name: 'Selecionar linha' }));

    it('AC-14: Ativar and Inativar start disabled and enable once a row is selected', async () => {
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await screen.findByText('Ana Silva');
      const inativar = await screen.findByRole('button', { name: 'Inativar' });
      expect(inativar).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Ativar' })).toBeDisabled();

      await selectRow(user, 'Ana Silva');

      expect(screen.getByRole('button', { name: 'Inativar' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Ativar' })).toBeEnabled();
    });

    it('AC-14: Inativar in batch asks for confirmation in a modal and then sends ids and active to PATCH /users/active', async () => {
      mockApi({ list: WITH_CARLA });
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockResolvedValue({ data: { ok: true } });
      renderUsersPage();
      await screen.findByText('Ana Silva');

      await selectRow(user, 'Ana Silva');
      await selectRow(user, 'Carla Dias');
      await user.click(await screen.findByRole('button', { name: 'Inativar' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/inativar 2 usuários/i);
      expect(api.patch).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      const [url, body] = patchCall();
      expect(url).toBe('/users/active');
      expect((body as { active: boolean }).active).toBe(false);
      expect([...(body as { ids: string[] }).ids].sort()).toEqual(['user-1', 'user-3']);
    });

    it('AC-14: Ativar in batch confirms and sends active true', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockResolvedValue({ data: { ok: true } });
      renderUsersPage();
      await screen.findByText('Bruno Costa');

      await selectRow(user, 'Bruno Costa');
      await user.click(await screen.findByRole('button', { name: 'Ativar' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/ativar 1 usuário/i);
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(patchCall()).toEqual(['/users/active', { ids: ['user-2'], active: true }]));
    });

    it('AC-14: Cancelar in the confirmation sends nothing', async () => {
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await screen.findByText('Ana Silva');

      await selectRow(user, 'Ana Silva');
      await user.click(await screen.findByRole('button', { name: 'Inativar' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('AC-14: shows the reason when the server refuses the batch', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockRejectedValueOnce(axiosError(409, 'Não é possível inativar o último administrador ativo.'));
      renderUsersPage();
      await screen.findByText('Ana Silva');

      await selectRow(user, 'Ana Silva');
      await user.click(await screen.findByRole('button', { name: 'Inativar' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText('Não é possível inativar o último administrador ativo.')).toBeInTheDocument();
    });

    it('AC-14: without ACTIVATE_DEACTIVATE_USERS the batch buttons are not usable', async () => {
      mockApi({ permissions: ['MANAGE_USERS', 'CREATE_USERS'] });
      signIn();
      const user = userEvent.setup();
      renderUsersPage();
      await screen.findByRole('button', { name: 'Novo usuário' });
      await screen.findByText('Ana Silva');
      await selectRow(user, 'Ana Silva');

      for (const name of ['Ativar', 'Inativar']) {
        const button = screen.queryByRole('button', { name });
        expect(button === null || button.hasAttribute('disabled'), name).toBe(true);
      }
    });

    it('AC-14: the Segurança tab replaces the checkbox: Inativar asks for confirmation and PATCHes /users/:id/active', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockResolvedValue({ data: { ...ANA, active: false } });
      renderUsersPage();
      await openUser(user, 'Ana Silva');
      expect(screen.queryByRole('checkbox', { name: /usuário ativo/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Segurança' }));
      expect(screen.queryByRole('checkbox', { name: /usuário ativo/i })).not.toBeInTheDocument();
      const inativar = await screen.findByRole('button', { name: 'Inativar' });
      await waitFor(() => expect(inativar).toBeEnabled());
      await user.click(inativar);
      const dialog = await screen.findByRole('dialog');
      expect(api.patch).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(patchCall()).toEqual(['/users/user-1/active', { active: false }]));
    });

    it('AC-14: an inactive user shows Ativar in the Segurança tab, and a refusal shows its reason', async () => {
      signIn();
      const user = userEvent.setup();
      vi.mocked(api.patch).mockRejectedValueOnce(axiosError(409, 'Você não pode alterar a sua própria situação.'));
      renderUsersPage();
      await openUser(user, 'Bruno Costa');

      await user.click(screen.getByRole('tab', { name: 'Segurança' }));
      expect(screen.queryByRole('button', { name: 'Inativar' })).not.toBeInTheDocument();
      const ativar = await screen.findByRole('button', { name: 'Ativar' });
      await waitFor(() => expect(ativar).toBeEnabled());
      await user.click(ativar);
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText('Você não pode alterar a sua própria situação.')).toBeInTheDocument();
      expect(patchCall()).toEqual(['/users/user-2/active', { active: true }]);
    });
  });

  describe('AC-21: convite e redefinição atrás da flag', () => {
    async function openSecurity(user: ReturnType<typeof userEvent.setup>, name: string) {
      signIn();
      renderUsersPage();
      await openUser(user, name);
      await user.click(screen.getByRole('tab', { name: 'Segurança' }));
    }

    it('AC-21: with the flag off the invite and the reset buttons are disabled and explain why', async () => {
      const user = userEvent.setup();
      mockApi({ flag: false, list: WITH_CARLA });
      await openSecurity(user, 'Carla Dias');
      const invite = await screen.findByRole('button', { name: 'Enviar convite' });
      expect(invite).toBeDisabled();
      expect(invite).toHaveAccessibleDescription(/ainda não foi ativado/i);
      expect(screen.queryByRole('button', { name: 'Redefinir senha' })).not.toBeInTheDocument();
      await user.click(invite);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('AC-21: with the flag off Redefinir senha is disabled and explains why', async () => {
      const user = userEvent.setup();
      mockApi({ flag: false, list: WITH_CARLA });
      await openSecurity(user, 'Ana Silva');

      const reset = await screen.findByRole('button', { name: 'Redefinir senha' });
      expect(reset).toBeDisabled();
      expect(reset).toHaveAccessibleDescription(/ainda não foi ativado/i);
      expect(screen.queryByRole('button', { name: /enviar convite|reenviar convite/i })).not.toBeInTheDocument();
    });

    it('AC-21: with the flag on and the permission, Enviar convite posts to /users/:id/invite, then offers Reenviar convite', async () => {
      const user = userEvent.setup();
      mockApi({ flag: true, list: WITH_CARLA });
      vi.mocked(api.post).mockResolvedValue({ data: { ok: true } });
      await openSecurity(user, 'Carla Dias');
      const invite = await screen.findByRole('button', { name: 'Enviar convite' });
      await waitFor(() => expect(invite).toBeEnabled());

      await user.click(invite);

      expect(await screen.findByText(/convite enviado/i)).toBeInTheDocument();
      expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/users/user-3/invite');
      await user.click(await screen.findByRole('button', { name: 'Reenviar convite' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
      expect(vi.mocked(api.post).mock.calls[1][0]).toBe('/users/user-3/invite');
    });

    it('AC-21: a failure to send the e-mail says so and keeps Enviar convite', async () => {
      const user = userEvent.setup();
      mockApi({ flag: true, list: WITH_CARLA });
      vi.mocked(api.post).mockRejectedValueOnce(axiosError(502));
      await openSecurity(user, 'Carla Dias');
      const invite = await screen.findByRole('button', { name: 'Enviar convite' });
      await waitFor(() => expect(invite).toBeEnabled());

      await user.click(invite);

      expect(await screen.findByText(/não foi possível enviar o e-mail/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument();
      expect(screen.queryByText(/convite enviado/i)).not.toBeInTheDocument();
    });

    it('AC-21: with the flag on, Redefinir senha posts to /users/:id/password-reset for an active user', async () => {
      const user = userEvent.setup();
      mockApi({ flag: true, list: WITH_CARLA });
      vi.mocked(api.post).mockResolvedValue({ data: { ok: true } });
      await openSecurity(user, 'Ana Silva');
      const reset = await screen.findByRole('button', { name: 'Redefinir senha' });
      await waitFor(() => expect(reset).toBeEnabled());

      await user.click(reset);

      expect(await screen.findByText(/redefinição de senha enviada/i)).toBeInTheDocument();
      expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/users/user-1/password-reset');
    });

    it('AC-21: without SEND_USER_INVITES_AND_RESETS the buttons stay disabled even with the flag on', async () => {
      const user = userEvent.setup();
      mockApi({ flag: true, list: WITH_CARLA, permissions: ['MANAGE_USERS', 'ACTIVATE_DEACTIVATE_USERS'] });
      await openSecurity(user, 'Ana Silva');
      // espera /auth/me e a flag chegarem: Inativar só habilita com ACTIVATE_DEACTIVATE_USERS
      await waitFor(() => expect(screen.getByRole('button', { name: 'Inativar' })).toBeEnabled());
      await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/feature-flags'));

      expect(screen.getByRole('button', { name: 'Redefinir senha' })).toBeDisabled();
    });
  });
});
