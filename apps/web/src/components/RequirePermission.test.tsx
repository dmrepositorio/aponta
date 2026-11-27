import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirePermission } from './RequirePermission';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const mounted = vi.fn();

function Probe() {
  useEffect(() => {
    mounted();
  }, []);
  return <div>Conteúdo restrito</div>;
}

function renderGuard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RequirePermission permission="MANAGE_USERS" title="Grupos de atendentes">
        <Probe />
      </RequirePermission>
    </QueryClientProvider>,
  );
}

function mockMe(overrides: { isAdmin?: boolean; permissions?: string[] }) {
  vi.mocked(api.get).mockResolvedValue({
    data: { id: 'u-1', isAdmin: false, permissions: [], ...overrides },
  });
}

function signIn(role: 'ADMIN' | 'AGENT' | 'CLIENT' | 'CLIENT_MASTER') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'u@aponta.com', role },
  });
}

describe('RequirePermission (F3-22 SET-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
  });

  it('ADMIN entra sem precisar da chave no grupo de permissões', async () => {
    signIn('ADMIN');
    mockMe({ isAdmin: true, permissions: [] });
    renderGuard();
    expect(await screen.findByText('Conteúdo restrito')).toBeInTheDocument();
    expect(screen.queryByText('Sem acesso a esta área')).not.toBeInTheDocument();
  });

  it('AGENT com a permissão exigida entra', async () => {
    signIn('AGENT');
    mockMe({ permissions: ['MANAGE_USERS'] });
    renderGuard();
    expect(await screen.findByText('Conteúdo restrito')).toBeInTheDocument();
  });

  it.each([
    ['AGENT', []],
    ['CLIENT', []],
    ['CLIENT_MASTER', []],
    // outra permissão de gestão não substitui a exigida
    ['AGENT', ['MANAGE_PERMISSION_GROUPS', 'MANAGE_SCHEDULED_JOBS']],
    ['CLIENT_MASTER', ['MANAGE_PERMISSION_GROUPS']],
  ] as const)('%s sem a permissão (%j) vê "Sem acesso a esta área" e a página nem monta', async (role, permissions) => {
    signIn(role);
    mockMe({ permissions: [...permissions] });
    renderGuard();

    expect(await screen.findByText('Sem acesso a esta área')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Grupos de atendentes' })).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo restrito')).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
  });

  it('enquanto /auth/me carrega não pisca "Sem acesso" nem mostra o conteúdo', async () => {
    signIn('AGENT');
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    renderGuard();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Sem acesso a esta área')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteúdo restrito')).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
  });

  it('com /auth/me em erro não pisca "Sem acesso", não mostra o conteúdo e Tentar de novo refaz o GET', async () => {
    signIn('AGENT');
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network down'));
    renderGuard();

    expect(await screen.findByText('Não foi possível verificar suas permissões.')).toBeInTheDocument();
    expect(screen.queryByText('Sem acesso a esta área')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteúdo restrito')).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(1);

    mockMe({ permissions: ['MANAGE_USERS'] });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Conteúdo restrito')).toBeInTheDocument();
  });
});
