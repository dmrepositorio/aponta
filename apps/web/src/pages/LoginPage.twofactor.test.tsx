import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { LoginPage } from './LoginPage';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

// DMTE-551 T5, AC-16 (login): quem ativou o segundo fator informa o código depois da senha.
const JWT = `h.${btoa(JSON.stringify({ sub: 'u-1', email: 'ana@aponta.test', role: 'AGENT' }))}.s`;
const axiosError = (status: number, message: string) => ({ isAxiosError: true, response: { status, data: { message } } });

describe('LoginPage: segundo fator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    vi.mocked(api.get).mockResolvedValue({ data: {} });
  });

  const signIn = async (user: ReturnType<typeof userEvent.setup>) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);
    await user.type(screen.getByLabelText(/e-mail/i), 'ana@aponta.test');
    await user.type(screen.getByLabelText('Senha'), 'Senha#Antiga1');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));
  };
  const codeField = () => screen.findByLabelText(/código do aplicativo ou de recuperação/i);

  it('AC-16: com desafio no lugar do JWT, pede o código e não deixa a pessoa logada', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } });

    await signIn(user);

    expect(await codeField()).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('LOG-06: o campo do código tem ajuda de formato ligada por aria-describedby e teclado adequado', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } });

    await signIn(user);
    const field = await codeField();

    const help = screen.getByText(/6 dígitos/i);
    expect(help).toHaveAttribute('id');
    expect(field.getAttribute('aria-describedby') ?? '').toContain(help.getAttribute('id'));
    expect(field).toHaveAttribute('inputmode', 'text');
    expect(field).toHaveAttribute('autocapitalize', 'off');
  });

  it('LOG-06: orienta quem perdeu o aplicativo a usar o código de recuperação', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } });

    await signIn(user);
    const field = await codeField();

    const lost = screen.getByText(/perdi o aplicativo/i);
    expect(lost).toHaveTextContent(/código de recuperação/i);
    expect(field.getAttribute('aria-describedby') ?? '').toContain(lost.getAttribute('id'));
  });

  it('AC-16: o código válido troca o desafio pelo JWT e entra no sistema', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } })
      .mockResolvedValueOnce({ data: { access_token: JWT } });

    await signIn(user);
    await user.type(await codeField(), '123456');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    expect(api.post).toHaveBeenLastCalledWith('/auth/login/2fa', { challengeToken: 'desafio', code: '123456' });
    await waitFor(() => expect(useAuthStore.getState().token).toBe(JWT));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('AC-16: código recusado mostra o erro e deixa tentar de novo, sem sair do desafio', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } })
      .mockRejectedValueOnce(axiosError(401, 'Código inválido.'));

    await signIn(user);
    await user.type(await codeField(), '000000');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    expect(await screen.findByText(/código inválido/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/código do aplicativo ou de recuperação/i)).toBeEnabled();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('AC-16: excesso de tentativas (429) avisa para aguardar', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } })
      .mockRejectedValueOnce(axiosError(429, 'ThrottlerException: Too Many Requests'));

    await signIn(user);
    await user.type(await codeField(), '000000');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    expect(await screen.findByText(/muitas tentativas/i)).toBeInTheDocument();
  });

  it('AC-16: desafio vencido volta para e-mail e senha com o aviso para entrar de novo', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } })
      .mockRejectedValueOnce(axiosError(401, 'Sessão de login expirada. Entre de novo.'));

    await signIn(user);
    await user.type(await codeField(), '123456');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    expect(await screen.findByText(/entre de novo/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });

  it('AC-16: o link "Voltar" descarta o desafio e volta para e-mail e senha', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: 'desafio' } });

    await signIn(user);
    await codeField();
    await user.click(screen.getByRole('button', { name: /voltar/i }));

    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });
});
