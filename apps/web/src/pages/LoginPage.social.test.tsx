import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { LoginPage } from './LoginPage';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

// DMTE-551 T7: botões de provedor e retorno do login social (código de troca ou motivo da falha no fragmento da URL).
const JWT = `h.${btoa(JSON.stringify({ sub: 'u-1', email: 'ana@aponta.test', role: 'AGENT' }))}.s`;

const providers = (list: string[]) =>
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/auth/social/providers' ? Promise.resolve({ data: { providers: list } }) : Promise.resolve({ data: {} }),
  );
const renderLogin = (hash = '') => {
  window.history.replaceState(null, '', `/login${hash}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);
};

describe('LoginPage: login social', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    providers([]);
  });

  it('AC-22: mostra um botão por provedor oferecido, apontando para o início do fluxo na API', async () => {
    providers(['google']);
    renderLogin();

    const google = await screen.findByRole('link', { name: /entrar com google/i });
    expect(google).toHaveAttribute('href', '/api/auth/social/google/start');
    expect(screen.queryByRole('link', { name: /github|facebook/i })).not.toBeInTheDocument();
  });

  it('AC-22: sem provedores, ou se a lista não carrega, não mostra botão e o login por senha segue normal', async () => {
    renderLogin();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/social/providers'));
    expect(screen.queryByRole('link', { name: /entrar com/i })).not.toBeInTheDocument();

    vi.mocked(api.get).mockRejectedValue(new Error('rede'));
    renderLogin();
    expect(await screen.findAllByLabelText('Senha')).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: /entrar com/i })).not.toBeInTheDocument();
  });

  it('AC-17: com o código de troca no fragmento, troca por JWT uma vez só, apaga o fragmento e entra', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { access_token: JWT } });
    renderLogin('#social=abc123');

    await waitFor(() => expect(useAuthStore.getState().token).toBe(JWT));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/social/exchange', { code: 'abc123' });
    expect(window.location.hash).toBe('');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('AC-21: se a troca devolve o desafio do segundo fator, pede o código em vez de entrar', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { twoFactorRequired: true, challengeToken: 'desafio' } });
    renderLogin('#social=abc123');

    expect(await screen.findByLabelText(/código do aplicativo ou de recuperação/i)).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('AC-18: troca recusada mostra o aviso e deixa entrar com e-mail e senha', async () => {
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status: 401, data: {} } });
    renderLogin('#social=vencido');

    expect(await screen.findByText(/não foi possível entrar com a conta social/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });

  it.each([
    ['not_found', /não há conta no aponta com esse e-mail/i],
    ['inactive', /conta está inativa/i],
    ['unverified', /não confirmou o seu e-mail/i],
    ['failed', /não foi possível entrar com a conta social/i],
    ['qualquer-coisa', /não foi possível entrar com a conta social/i],
  ])('AC-18: o motivo "%s" no fragmento vira um aviso claro e o fragmento some da URL', async (reason, message) => {
    renderLogin(`#social_error=${reason}`);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(api.post).not.toHaveBeenCalled();
  });
});
