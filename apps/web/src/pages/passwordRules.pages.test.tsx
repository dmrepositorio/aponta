import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { MyAccountPage } from './MyAccountPage';
import { RegisterPage } from './RegisterPage';
import { SetPasswordPage } from './SetPasswordPage';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

// DMTE-551 T1, AC-07: cadastro, troca de senha e definição pelo link mostram a regra e o que o servidor recusou.
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const STRONG = 'Cavalo#Azul-7418';
const serverRules = ['A senha precisa ter pelo menos 10 caracteres.', 'A senha precisa ter um símbolo.'];
const badRequest = (message: unknown) => ({ isAxiosError: true, response: { status: 400, data: { message } } });
const rulesList = () => screen.queryByRole('list', { name: /regras da senha/i });

describe('Regra de senha nas telas (DMTE-551)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
  });

  it('AC-07: o cadastro mostra a regra e confere nome e e-mail enquanto a pessoa digita', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    expect(rulesList()).toBeInTheDocument();

    await user.type(screen.getByLabelText(/nome/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'Jane#2026-xyz');

    const personal = within(rulesList()!).getAllByRole('listitem').find((li) => /seu nome/i.test(li.textContent ?? ''));
    expect(personal).toHaveTextContent(/pendente/i);
  });

  it('AC-07: o cadastro mostra o que o servidor recusou na senha, sem dizer "algo deu errado"', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(badRequest(serverRules));
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    await user.type(screen.getByLabelText(/nome/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), STRONG);
    await user.type(screen.getByLabelText(/confirmar senha/i), STRONG);
    await user.click(screen.getByRole('button', { name: /criar conta/i }));

    expect(await screen.findByText(serverRules[0])).toBeInTheDocument();
    expect(screen.queryByText(/algo deu errado/i)).not.toBeInTheDocument();
  });

  it('AC-07: a definição pelo link mostra a regra e, se o servidor recusar a senha, mostra o motivo e mantém o formulário', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/definir-senha#t=${TOKEN}`);
    vi.mocked(api.post).mockRejectedValueOnce(badRequest(serverRules));
    render(<BrowserRouter><SetPasswordPage /></BrowserRouter>);
    expect(rulesList()).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^nova senha/i), STRONG);
    await user.type(screen.getByLabelText(/^confirmar senha/i), STRONG);
    await user.click(screen.getByRole('button', { name: 'Definir senha' }));

    expect(await screen.findByText(serverRules[1])).toBeInTheDocument();
    expect(screen.queryByText(/link inválido ou expirado/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^nova senha/i)).toBeInTheDocument();
  });

  it('AC-07: a definição pelo link continua tratando link recusado (400 com texto) como link inválido', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/definir-senha#t=${TOKEN}`);
    vi.mocked(api.post).mockRejectedValueOnce(badRequest('Link inválido ou expirado.'));
    render(<BrowserRouter><SetPasswordPage /></BrowserRouter>);

    await user.type(screen.getByLabelText(/^nova senha/i), STRONG);
    await user.type(screen.getByLabelText(/^confirmar senha/i), STRONG);
    await user.click(screen.getByRole('button', { name: 'Definir senha' }));

    expect(await screen.findByText(/link inválido ou expirado/i)).toBeInTheDocument();
  });

  it('AC-07: a troca de senha mostra a regra e o motivo recusado pelo servidor', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ token: 't', user: { sub: 'u-1', email: 'jane@example.com', role: 'AGENT' } });
    vi.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/auth/me' ? { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' } : [] }),
    );
    vi.mocked(api.post).mockRejectedValueOnce(badRequest(serverRules));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><MyAccountPage /></MemoryRouter></QueryClientProvider>);

    await user.click(await screen.findByRole('tab', { name: /segurança/i }));
    expect(rulesList()).toBeInTheDocument();
    await user.type(screen.getByLabelText(/senha atual/i), 'Senha#Antiga1');
    await user.type(screen.getByLabelText(/nova senha/i), 'curta12345');
    await user.click(screen.getByRole('button', { name: /trocar senha/i }));

    await waitFor(() => expect(screen.getByText(serverRules[0])).toBeInTheDocument());
  });
});
