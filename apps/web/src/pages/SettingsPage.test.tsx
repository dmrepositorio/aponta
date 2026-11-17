import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockMe(overrides: { isAdmin?: boolean; permissions?: string[] }) {
  vi.mocked(api.get).mockResolvedValue({
    data: { id: 'u-1', isAdmin: false, permissions: [], ...overrides },
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
  });

  it('always shows Minha conta inside the Usuários submenu, regardless of permissions', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'agent@aponta.com', role: 'AGENT' },
    });
    mockMe({ permissions: [] });

    renderSettingsPage();

    expect(
      await screen.findByRole('link', { name: /minha conta/i }),
    ).toHaveAttribute('href', '/my-account');
  });

  it('shows Usuários and Grupos de atendentes only for a user with MANAGE_USERS', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'agent@aponta.com', role: 'AGENT' },
    });
    mockMe({ permissions: ['MANAGE_USERS'] });

    renderSettingsPage();

    expect(await screen.findByRole('link', { name: /^usuários$/i })).toHaveAttribute(
      'href',
      '/settings/users',
    );
    expect(screen.getByRole('link', { name: /grupos de atendentes/i })).toHaveAttribute(
      'href',
      '/settings/technical-groups',
    );
    expect(screen.queryByRole('link', { name: /grupos de permissões/i })).not.toBeInTheDocument();
  });

  it('shows Grupos de permissões only for a user with MANAGE_PERMISSION_GROUPS', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'agent@aponta.com', role: 'AGENT' },
    });
    mockMe({ permissions: ['MANAGE_PERMISSION_GROUPS'] });

    renderSettingsPage();

    expect(
      await screen.findByRole('link', { name: /grupos de permissões/i }),
    ).toHaveAttribute('href', '/settings/permission-groups');
    expect(screen.queryByRole('link', { name: /^usuários$/i })).not.toBeInTheDocument();
  });

  it('shows every Usuários submenu item for an ADMIN even with no PermissionGroup linked', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'admin-1', email: 'admin@aponta.com', role: 'ADMIN' },
    });
    mockMe({ isAdmin: true, permissions: [] });

    renderSettingsPage();

    expect(await screen.findByRole('link', { name: /^usuários$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /grupos de atendentes/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /grupos de permissões/i })).toBeInTheDocument();
  });

  it('does not show Usuários/Grupos links for a user without MANAGE_USERS or MANAGE_PERMISSION_GROUPS', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'client@aponta.com', role: 'CLIENT' },
    });
    mockMe({ permissions: [] });

    renderSettingsPage();

    await screen.findByRole('link', { name: /minha conta/i });
    expect(screen.queryByRole('link', { name: /^usuários$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /grupos de atendentes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /grupos de permissões/i })).not.toBeInTheDocument();
  });

  it('should render a link to Mesa only for ADMIN', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'admin@aponta.com', role: 'ADMIN' },
    });
    mockMe({ isAdmin: true, permissions: [] });

    renderSettingsPage();

    expect(
      await screen.findByRole('link', { name: /^mesa$/i }),
    ).toHaveAttribute('href', '/service-desks');
  });

  it('should not render the Mesa link for a non-ADMIN user', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'client@aponta.com', role: 'CLIENT' },
    });
    mockMe({ permissions: [] });

    renderSettingsPage();

    await screen.findByRole('link', { name: /minha conta/i });
    expect(screen.queryByRole('link', { name: /^mesa$/i })).not.toBeInTheDocument();
  });
});

describe('SettingsPage: tarefas agendadas (DMTE-462 T3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: 'fake-token', user: { sub: 'u-1', email: 'agent@aponta.com', role: 'AGENT' } });
  });

  it('AC-16: o link Tarefas agendadas aparece só com MANAGE_SCHEDULED_JOBS', async () => {
    mockMe({ permissions: ['MANAGE_SCHEDULED_JOBS'] });
    renderSettingsPage();
    expect(await screen.findByRole('link', { name: /tarefas agendadas/i })).toHaveAttribute('href', '/settings/scheduled-jobs');
  });

  it('AC-16: sem a permissão o link não aparece', async () => {
    mockMe({ permissions: [] });
    renderSettingsPage();
    await screen.findByRole('link', { name: /minha conta/i });
    expect(screen.queryByRole('link', { name: /tarefas agendadas/i })).not.toBeInTheDocument();
  });
});

describe('SettingsPage: auditoria de interface (DMTE-524)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'admin-1', email: 'admin@aponta.com', role: 'ADMIN' },
    });
  });

  it('shows a busy skeleton and no links until GET /auth/me responds', async () => {
    let respond: (value: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );

    const { container } = renderSettingsPage();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    await act(async () => {
      respond({ data: { id: 'admin-1', isAdmin: true, permissions: [] } });
    });

    expect(await screen.findByRole('link', { name: /^usuários$/i })).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });

  it('keeps hover inside the rounded card and gives links a focus ring', async () => {
    mockMe({ isAdmin: true, permissions: [] });
    renderSettingsPage();

    const link = await screen.findByRole('link', { name: /minha conta/i });

    expect(link.closest('.overflow-hidden')).not.toBeNull();
    expect(link.className).toContain('ez-focus-inset');
    expect(link.className).toContain('active:bg-gray-100');
  });

  it('renders every row with the control height token', async () => {
    mockMe({ isAdmin: true, permissions: [] });
    const { container } = renderSettingsPage();

    await screen.findByRole('link', { name: /^usuários$/i });

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-[var(--control-height-md)]');
    }
    expect(container.querySelector('.divide-gray-90')).not.toBeNull();
  });

  it('groups the links under Conta, Usuários and Sistema, with Mesa under Sistema for an admin', async () => {
    mockMe({ isAdmin: true, permissions: [] });
    renderSettingsPage();

    await screen.findByRole('link', { name: /^usuários$/i });

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Conta', 'Usuários', 'Sistema']);
    const sistema = screen.getByRole('region', { name: 'Sistema' });
    expect(
      within(sistema)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Tarefas agendadas', 'Mesa']);
  });

  it('omits the Sistema group when the user has no system item', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'client@aponta.com', role: 'CLIENT' },
    });
    mockMe({ permissions: [] });
    renderSettingsPage();

    await screen.findByRole('link', { name: /minha conta/i });

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Conta']);
  });

  it('centers the content in a max-w-2xl column', async () => {
    mockMe({ isAdmin: true, permissions: [] });
    renderSettingsPage();

    await screen.findByRole('link', { name: /minha conta/i });

    const column = screen.getByRole('heading', { level: 1, name: 'Configurações' }).closest('.max-w-2xl');
    expect(column).not.toBeNull();
    expect(column?.className).toContain('mx-auto');
  });

  it('falls back to Minha conta right after the first GET /auth/me failure, while retries are pending', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 60_000 } },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByRole('link', { name: /minha conta/i })).toHaveAttribute('href', '/my-account');
    expect(screen.queryByRole('link', { name: /^usuários$/i })).not.toBeInTheDocument();
  });
});
