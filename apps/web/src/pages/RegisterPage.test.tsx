import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

vi.mock('../lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

function renderRegisterPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

const VALID_PASSWORD = 'Cavalo#Azul-7418';

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/nome/i), 'Jane Doe');
  await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
  await user.type(screen.getByLabelText(/^senha$/i), VALID_PASSWORD);
  await user.type(screen.getByLabelText(/confirmar senha/i), VALID_PASSWORD);
  await user.click(screen.getByRole('button', { name: /criar conta/i }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
  });

  it('should render register form', () => {
    renderRegisterPage();
    expect(screen.getByLabelText(/nome/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/confirmar senha/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /criar conta/i }),
    ).toBeInTheDocument();
  });

  it('should register and log in the user on success (happy path)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/auth/register') {
        return Promise.resolve({
          data: { id: '1', name: 'Jane Doe', email: 'jane@example.com' },
        });
      }
      if (url === '/auth/login') {
        return Promise.resolve({ data: { access_token: 'fake.jwt.token' } });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderRegisterPage();
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: VALID_PASSWORD,
      });
    });
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'jane@example.com',
        password: VALID_PASSWORD,
      });
    });
    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('fake.jwt.token');
    });
  });

  it('should show a generic/conflict error when registration itself fails (409)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409 },
    });

    renderRegisterPage();
    await fillAndSubmit(user);

    expect(
      await screen.findByText(/já existe uma conta com este e-mail/i),
    ).toBeInTheDocument();
    // Only the register call should have been attempted; login must not
    // have been called since registration itself failed.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/register', {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: VALID_PASSWORD,
    });
  });

  it('should show a distinguishing message and a path to /login when register succeeds but auto-login fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/auth/register') {
        return Promise.resolve({
          data: { id: '1', name: 'Jane Doe', email: 'jane@example.com' },
        });
      }
      if (url === '/auth/login') {
        return Promise.reject({
          isAxiosError: true,
          response: { status: 500 },
        });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderRegisterPage();
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'jane@example.com',
        password: VALID_PASSWORD,
      });
    });

    // Must NOT show the generic/ambiguous error that implies registration
    // itself failed.
    expect(
      screen.queryByText(/algo deu errado\. tente novamente\./i),
    ).not.toBeInTheDocument();

    // Must show a message that makes clear the account WAS created.
    expect(
      await screen.findByText(/conta criada/i),
    ).toBeInTheDocument();

    // Must provide a path to /login (either a visible link, or the page
    // navigated there automatically).
    const loginLink = screen.queryByRole('link', { name: /entre com sua conta/i });
    expect(loginLink).toBeInTheDocument();

    // The user should never have been logged in with a token.
    expect(useAuthStore.getState().token).toBeNull();

    // REG-03: sucesso parcial é aviso (não erro) e o formulário some, para
    // não permitir um reenvio que daria 409.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-yellow-100');
    expect(alert).not.toHaveClass('bg-red-100');
    expect(screen.queryByLabelText(/^senha$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /criar conta/i })).not.toBeInTheDocument();
  });

  it('REG-08: nome só com espaços é rejeitado com "Nome é obrigatório" e nada é enviado', async () => {
    const user = userEvent.setup();
    renderRegisterPage();
    await user.type(screen.getByLabelText(/nome/i), '   ');
    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), VALID_PASSWORD);
    await user.type(screen.getByLabelText(/confirmar senha/i), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: /criar conta/i }));

    expect(await screen.findByText('Nome é obrigatório')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('REG-08: o nome é enviado sem os espaços das pontas', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: { access_token: 't' } });
    renderRegisterPage();
    await user.type(screen.getByLabelText(/nome/i), '  Jane Doe  ');
    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), VALID_PASSWORD);
    await user.type(screen.getByLabelText(/confirmar senha/i), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: /criar conta/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ name: 'Jane Doe' });
  });

  it('REG-02: não envia senha que cumpre só o tamanho e mostra erro no campo', async () => {
    const user = userEvent.setup();
    renderRegisterPage();
    await user.type(screen.getByLabelText(/nome/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'aaaaaaaaaa');
    await user.type(screen.getByLabelText(/confirmar senha/i), 'aaaaaaaaaa');
    await user.click(screen.getByRole('button', { name: /criar conta/i }));

    expect(await screen.findByText(/senha não atende a todas as regras/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('REG-04: não envia quando a confirmação difere da senha e mostra erro no campo', async () => {
    const user = userEvent.setup();
    renderRegisterPage();
    await user.type(screen.getByLabelText(/nome/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/e-mail/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), VALID_PASSWORD);
    expect(screen.queryByLabelText(/confirmar senha/i)).toBeInTheDocument();
    const confirm = screen.getByLabelText(/confirmar senha/i);
    await user.type(confirm, 'Outra#Senha-9999');
    await user.click(screen.getByRole('button', { name: /criar conta/i }));

    expect(await screen.findByText(/as senhas não coincidem/i)).toBeInTheDocument();
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('REG-04: o envio não leva o campo de confirmação ao servidor', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: { access_token: 't' } });
    renderRegisterPage();
    await fillAndSubmit(user);
    expect(screen.queryByLabelText(/confirmar senha/i)).toBeInTheDocument();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/register', expect.not.objectContaining({ confirmPassword: expect.anything() })));
  });
});
