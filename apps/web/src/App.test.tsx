import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { api } from './lib/api';
import { useAuthStore } from './stores/authStore';

vi.mock('./lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/service-desks') {
        return Promise.resolve({ data: [] });
      }
      if (url === '/tickets') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    useAuthStore.setState({ token: null, user: null });
    window.history.pushState({}, '', '/');
  });

  it('redirects unauthenticated users to the login page', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /entrar/i }),
    ).toBeInTheDocument();
  });

  it('renders the dashboard page for authenticated users', async () => {
    useAuthStore.setState({
      token: 'fake.jwt.token',
      user: { sub: '1', email: 'jane@example.com', role: 'CLIENT' },
    });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Tickets' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['AC-01', '/tickets'],
    ['AC-02', '/tickets?mine=true'],
  ])(
    'DMTE-460 %s: renders the tickets list at %s',
    async (_ac, url) => {
      useAuthStore.setState({
        token: 'fake.jwt.token',
        user: { sub: '1', email: 'jane@example.com', role: 'CLIENT' },
      });
      window.history.pushState({}, '', url);

      render(<App />);

      const heading = await screen.findByRole('heading', { name: 'Tickets' });
      expect(heading).toBeInTheDocument();
    },
  );
});

describe('App: rotas /settings/* (F3-22 SET-01)', () => {
  const restrictedCalls = ['/users', '/technical-groups', '/permission-groups', '/scheduled-jobs'];

  function mockMe(me: { isAdmin: boolean; permissions: string[] }) {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-1', ...me } });
      if (url === '/service-desks' || url === '/tickets') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['/settings/technical-groups', 'AGENT', ['MANAGE_PERMISSION_GROUPS']],
    ['/settings/technical-groups', 'CLIENT', []],
    ['/settings/permission-groups', 'AGENT', ['MANAGE_USERS']],
    ['/settings/permission-groups', 'CLIENT_MASTER', []],
    ['/settings/scheduled-jobs', 'AGENT', ['MANAGE_USERS', 'MANAGE_PERMISSION_GROUPS']],
    ['/settings/scheduled-jobs', 'CLIENT', []],
  ] as const)('%s para %s com %j mostra "Sem acesso a esta área" e não consulta a página', async (url, role, permissions) => {
    useAuthStore.setState({ token: 'fake.jwt.token', user: { sub: 'u-1', email: 'u@example.com', role } });
    mockMe({ isAdmin: false, permissions: [...permissions] });
    window.history.pushState({}, '', url);

    render(<App />);

    expect(await screen.findByText('Sem acesso a esta área')).toBeInTheDocument();
    for (const restricted of restrictedCalls) {
      expect(api.get).not.toHaveBeenCalledWith(restricted, expect.anything());
      expect(api.get).not.toHaveBeenCalledWith(restricted);
    }
  });

  it('/settings/users sem MANAGE_USERS mostra o acesso restrito da própria página e não lista usuários', async () => {
    useAuthStore.setState({ token: 'fake.jwt.token', user: { sub: 'u-1', email: 'u@example.com', role: 'CLIENT' } });
    mockMe({ isAdmin: false, permissions: [] });
    window.history.pushState({}, '', '/settings/users');

    render(<App />);

    expect(await screen.findByText('Acesso restrito')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/users', expect.anything());
    expect(api.get).not.toHaveBeenCalledWith('/users');
  });

  it.each([
    ['/settings/technical-groups', 'MANAGE_USERS', '/technical-groups'],
    ['/settings/permission-groups', 'MANAGE_PERMISSION_GROUPS', '/permission-groups'],
    ['/settings/scheduled-jobs', 'MANAGE_SCHEDULED_JOBS', '/scheduled-jobs'],
  ] as const)('%s abre para quem tem %s (a página monta e consulta %s)', async (url, permission, expectedGet) => {
    useAuthStore.setState({ token: 'fake.jwt.token', user: { sub: 'u-1', email: 'u@example.com', role: 'AGENT' } });
    mockMe({ isAdmin: false, permissions: [permission] });
    window.history.pushState({}, '', url);

    render(<App />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expectedGet));
    expect(screen.queryByText('Sem acesso a esta área')).not.toBeInTheDocument();
  });

  it('ADMIN abre /settings/permission-groups sem a chave no grupo', async () => {
    useAuthStore.setState({ token: 'fake.jwt.token', user: { sub: 'a-1', email: 'a@example.com', role: 'ADMIN' } });
    mockMe({ isAdmin: true, permissions: [] });
    window.history.pushState({}, '', '/settings/permission-groups');

    render(<App />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/permission-groups'));
    expect(screen.queryByText('Sem acesso a esta área')).not.toBeInTheDocument();
  });
});
