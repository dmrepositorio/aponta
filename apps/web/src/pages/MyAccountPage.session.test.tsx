import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { MyAccountPage } from './MyAccountPage';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

// DMTE-551 T2, AC-04: trocar a senha derruba os outros tokens; a sessão que trocou guarda o token novo e segue logada.
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload))}.s`;
const NEW_TOKEN = jwt({ sub: 'u-1', email: 'jane@example.com', role: 'AGENT', pv: 1 });

describe('MyAccountPage: sessão depois da troca de senha (DMTE-551)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: 'token-antigo', user: { sub: 'u-1', email: 'jane@example.com', role: 'AGENT' } });
    vi.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/auth/me' ? { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' } : [] }),
    );
  });

  const changePassword = async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><MyAccountPage /></MemoryRouter></QueryClientProvider>);
    await user.click(await screen.findByRole('tab', { name: /segurança/i }));
    await user.type(screen.getByLabelText(/senha atual/i), 'Senha#Antiga1');
    await user.type(screen.getByLabelText(/nova senha/i), 'Cavalo#Azul-7418');
    await user.click(screen.getByRole('button', { name: /trocar senha/i }));
  };

  it('AC-04: guarda o token novo devolvido pela troca de senha e continua logado', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { message: 'ok', access_token: NEW_TOKEN } });

    await changePassword();

    expect(await screen.findByRole('status')).toHaveTextContent(/outros aparelhos/i);
    expect(useAuthStore.getState().token).toBe(NEW_TOKEN);
    expect(useAuthStore.getState().user?.email).toBe('jane@example.com');
  });

  it('AC-04: troca recusada não mexe no token da sessão', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 401, data: {} } });

    await changePassword();

    await waitFor(() => expect(screen.getByText(/senha atual incorreta/i)).toBeInTheDocument());
    expect(useAuthStore.getState().token).toBe('token-antigo');
  });
});
