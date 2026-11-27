import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const sistemaLinks = within(sistema).getAllByRole('link');
    expect(sistemaLinks).toHaveLength(2);
    expect(sistemaLinks[0]).toHaveAccessibleName('Tarefas agendadas');
    expect(sistemaLinks[1]).toHaveAccessibleName('Mesa');
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

  it('renders the title in the page header band and keeps the content out of a centered column', async () => {
    mockMe({ isAdmin: true, permissions: [] });
    const { container } = renderSettingsPage();

    await screen.findByRole('link', { name: /minha conta/i });

    const title = screen.getByRole('heading', { level: 1, name: 'Configurações' });
    expect(title.closest('.bg-white.border-b')).not.toBeNull();
    expect(container.querySelector('.mx-auto, [class*="max-w-"]')).toBeNull();
  });

  it('gives the skeleton the shape of the groups: 3 groups and 6 rows for an admin, 1 and 1 for other roles', async () => {
    let respond: (value: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );

    const { container, unmount } = renderSettingsPage();

    const busy = container.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(within(busy).getAllByRole('list')).toHaveLength(3);
    const skeletonRows = within(busy).getAllByRole('listitem');
    expect(skeletonRows).toHaveLength(6);
    for (const row of skeletonRows) {
      expect(row.className).toContain('min-h-[var(--control-height-md)]');
    }

    await act(async () => {
      respond({ data: { id: 'admin-1', isAdmin: true, permissions: [] } });
    });
    await screen.findByRole('link', { name: /^usuários$/i });
    expect(screen.getAllByRole('list')).toHaveLength(3);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    unmount();

    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'client@aponta.com', role: 'CLIENT' },
    });
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    const other = renderSettingsPage();
    const otherBusy = other.container.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(within(otherBusy).getAllByRole('list')).toHaveLength(1);
    expect(within(otherBusy).getAllByRole('listitem')).toHaveLength(1);
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

describe('SettingsPage: descrições, aviso de falha e dica de acesso (F3-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'admin-1', email: 'admin@aponta.com', role: 'ADMIN' },
    });
  });

  it('SET-03: cada link do hub exibe sua descrição, associada por aria-describedby, sem mudar o nome do link', async () => {
    mockMe({ isAdmin: true, permissions: [] });
    renderSettingsPage();
    await screen.findByRole('link', { name: /^usuários$/i });

    const expected: Array<[string, string]> = [
      ['Minha conta', 'Seus dados, senha e autenticação em duas etapas'],
      ['Usuários', 'Quem acessa o Aponta e com qual perfil'],
      ['Grupos de atendentes', 'Equipes que recebem chamados'],
      ['Grupos de permissões', 'O que cada perfil pode fazer'],
      ['Tarefas agendadas', 'Rotinas automáticas e histórico de execuções'],
      ['Mesa', 'Mesas de serviço e suas etapas'],
    ];
    expect(screen.getAllByRole('link')).toHaveLength(expected.length);
    for (const [name, description] of expected) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAccessibleName(name);
      expect(link).toHaveAccessibleDescription(description);
      expect(link.getAttribute('aria-describedby')).toBeTruthy();
    }
  });

  it('SET-04: após falha de /auth/me mostra o alerta, mantém Minha conta e Tentar de novo dispara novo GET', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network down'));
    renderSettingsPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar suas permissões');
    expect(screen.getByRole('link', { name: 'Minha conta' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^usuários$/i })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);

    mockMe({ isAdmin: true, permissions: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('link', { name: /^usuários$/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('SET-04: já na primeira falha, com retries pendentes, o alerta aparece', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 60_000 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar suas permissões');
  });

  it('SET-04: sem falha e durante o carregamento não há alerta', async () => {
    let respond: (value: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    renderSettingsPage();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => {
      respond({ data: { id: 'admin-1', isAdmin: true, permissions: [] } });
    });
    await screen.findByRole('link', { name: /^usuários$/i });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('SET-01: quem não vê todas as áreas recebe a dica de acesso ao final; ADMIN e erro de carga não', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'agent@aponta.com', role: 'AGENT' },
    });
    mockMe({ permissions: ['MANAGE_USERS'] });
    const agent = renderSettingsPage();

    const hint = await screen.findByText(/dependem de permissão/i);
    expect(hint).toHaveTextContent('Algumas áreas dependem de permissão. Se faltar uma, peça acesso a um administrador.');
    const lastLink = screen.getAllByRole('link').at(-1) as HTMLElement;
    expect(lastLink.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    agent.unmount();

    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'admin-1', email: 'admin@aponta.com', role: 'ADMIN' },
    });
    mockMe({ isAdmin: true, permissions: [] });
    const admin = renderSettingsPage();
    await screen.findByRole('link', { name: /^usuários$/i });
    expect(screen.queryByText(/dependem de permissão/i)).not.toBeInTheDocument();
    admin.unmount();

    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    renderSettingsPage();
    await screen.findByRole('alert');
    expect(screen.queryByText(/dependem de permissão/i)).not.toBeInTheDocument();
  });
});
