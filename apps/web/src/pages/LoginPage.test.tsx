import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const FLAG = 'convite-e-redefinicao-usuario';

/** DMTE-550: a tela lê GET /feature-flags (público); por padrão a flag está desligada. */
function mockFlag(on: boolean) {
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/feature-flags' ? Promise.resolve({ data: { [FLAG]: on } }) : Promise.reject(new Error(`Unexpected GET ${url}`)),
  );
}

function renderLoginPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlag(false);
    useAuthStore.setState({ token: null, user: null });
  });

  it('should render login form', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /entrar/i }),
    ).toBeInTheDocument();
  });

  it('should show validation errors when submitted empty', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(
      await screen.findByText(/e-mail inválido/i),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('should call login on submit and store the token', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { access_token: 'fake.jwt.token' },
    });

    renderLoginPage();

    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText('Senha'), 'password123');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'jane@example.com',
        password: 'password123',
      });
    });

    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('fake.jwt.token');
    });
  });

  it('should show an error message on invalid credentials', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401 },
    });

    renderLoginPage();

    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText('Senha'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(
      await screen.findByText(/e-mail ou senha inválidos/i),
    ).toBeInTheDocument();
  });

  it('LOG-02: após 401 o foco vai para o campo de senha, que mantém o valor, e o erro é um alerta', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });

    renderLoginPage();

    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText('Senha'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/e-mail ou senha inválidos/i);
    await waitFor(() => expect(screen.getByLabelText('Senha')).toHaveFocus());
    expect(screen.getByLabelText('Senha')).toHaveValue('wrongpassword');
  });

  it('LOG-02: com a flag ligada, "Esqueci minha senha" vem depois do campo Senha e antes do botão Entrar', async () => {
    mockFlag(true);
    renderLoginPage();

    const forgot = await screen.findByRole('button', { name: 'Esqueci minha senha' });
    const password = screen.getByLabelText('Senha');
    const submit = screen.getByRole('button', { name: 'Entrar' });
    expect(password.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(forgot.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('LOG-07: 429 no login por senha mostra a frase de limite, a mesma do segundo fator', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } });

    renderLoginPage();

    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText('Senha'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Muitas tentativas. Aguarde um minuto e tente de novo.')).toBeInTheDocument();
    expect(screen.queryByText(/algo deu errado/i)).not.toBeInTheDocument();
  });

  describe('DMTE-550: Esqueci minha senha', () => {
    const ASK = { name: 'Esqueci minha senha' };

    async function openModal(user: ReturnType<typeof userEvent.setup>) {
      mockFlag(true);
      renderLoginPage();
      await user.click(await screen.findByRole('button', ASK));
      return screen.findByRole('dialog');
    }

    it('AC-21: with the flag off the Esqueci minha senha link does not appear', async () => {
      renderLoginPage();
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/feature-flags'));
      expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', ASK)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', ASK)).not.toBeInTheDocument();
    });

    it('AC-24: with the flag on the link opens a modal asking only for the e-mail', async () => {
      const user = userEvent.setup();
      const dialog = await openModal(user);

      expect(within(dialog).getByText('Esqueci minha senha')).toBeInTheDocument();
      expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
      expect(within(dialog).getByLabelText(/e-mail/i)).toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/senha/i)).not.toBeInTheDocument();
    });

    it('AC-24: validates before sending and shows no request for an empty or malformed e-mail', async () => {
      const user = userEvent.setup();
      const dialog = await openModal(user);

      await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));
      expect(await within(dialog).findByText(/e-mail inválido/i)).toBeInTheDocument();

      await user.type(within(dialog).getByLabelText(/e-mail/i), 'sem-arroba');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));
      expect(within(dialog).getByText(/e-mail inválido/i)).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('AC-24: sends only the e-mail to POST /auth/forgot-password and shows the fixed message', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({ data: { ok: true } });
      const dialog = await openModal(user);

      await user.type(within(dialog).getByLabelText(/e-mail/i), 'jane@example.com');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

      expect(await within(dialog).findByText(/se o e-mail estiver cadastrado/i)).toBeInTheDocument();
      expect(vi.mocked(api.post).mock.calls).toHaveLength(1);
      expect(vi.mocked(api.post).mock.calls[0].slice(0, 2)).toEqual(['/auth/forgot-password', { email: 'jane@example.com' }]);
    });

    it('AC-24: shows the same message whichever e-mail was typed, so it does not reveal who has an account', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValue({ data: { ok: true } });
      const dialog = await openModal(user);

      await user.type(within(dialog).getByLabelText(/e-mail/i), 'quem-nao-existe@example.com');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

      const message = await within(dialog).findByText(/se o e-mail estiver cadastrado/i);
      expect(message.textContent).not.toContain('quem-nao-existe@example.com');
    });

    it('AC-24: Escape closes the modal and the focus goes back to Esqueci minha senha', async () => {
      const user = userEvent.setup();
      const dialog = await openModal(user);
      const trigger = screen.getByRole('button', ASK);

      // O primeiro Esc, dentro de um campo de texto, só tira o foco dele (useEscapeLayer): parte do botão Cancelar.
      within(dialog).getByRole('button', { name: 'Cancelar' }).focus();
      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(trigger).toHaveFocus();
    });

    it('AC-24: Tab and Shift+Tab stay inside the open modal', async () => {
      const user = userEvent.setup();
      const dialog = await openModal(user);

      for (let i = 0; i < 8; i += 1) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
      for (let i = 0; i < 8; i += 1) {
        await user.tab({ shift: true });
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });

    it('AC-26: a hostile e-mail is refused before sending, and nothing typed comes back as HTML', async () => {
      const user = userEvent.setup();
      const dialog = await openModal(user);
      const hostile = '<script>alert(1)</script>@x.com';

      await user.type(within(dialog).getByLabelText(/e-mail/i), hostile);
      await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

      expect(await within(dialog).findByText(/e-mail inválido/i)).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
      expect(document.body.querySelector('script')).toBeNull();
      expect(dialog.textContent).not.toContain('alert(1)');
    });
  });
});
