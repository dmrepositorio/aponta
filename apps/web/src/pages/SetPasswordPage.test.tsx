import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { SetPasswordPage } from './SetPasswordPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// DMTE-550 D12/AC-19: a página pública /definir-senha. O token vem no fragmento (#t=…), sai da barra de
// endereço e viaja só no corpo do POST /auth/password/set, junto com a senha e mais nada.
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PASSWORD = 'Uma senha longa #123';

function openLink(hash: string) {
  window.history.replaceState(null, '', `/definir-senha${hash}`);
}

function renderPage() {
  return render(
    <BrowserRouter>
      <SetPasswordPage />
    </BrowserRouter>,
  );
}

const newPassword = () => screen.getByLabelText(/^nova senha/i);
const confirmation = () => screen.getByLabelText(/^confirmar senha/i);
const submit = () => screen.getByRole('button', { name: 'Definir senha' });

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = PASSWORD, again = password) {
  await user.type(newPassword(), password);
  await user.type(confirmation(), again);
  await user.click(submit());
}

describe('SetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    openLink(`#t=${TOKEN}`);
  });

  it('AC-19: shows the Definir senha page with new password and confirmation, both new-password', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Definir senha' })).toBeInTheDocument();
    for (const field of [newPassword(), confirmation()]) {
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveAttribute('autocomplete', 'new-password');
    }
    expect(submit()).toBeEnabled();
  });

  it('AC-19: reads the token from the fragment and clears it from the address bar and the page', () => {
    renderPage();

    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/definir-senha');
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('AC-19: makes no request on its own, since the token only travels in the POST', () => {
    renderPage();

    expect(newPassword()).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('AC-19: refuses an empty form inline, with the focus on the first invalid field, and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(submit());

    expect(await screen.findByText(/a senha deve ter de 10 a 128 caracteres/i)).toBeInTheDocument();
    expect(newPassword()).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('AC-19: refuses a short password and a confirmation that does not match, inline', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user, 'curta1');
    expect(await screen.findByText(/a senha deve ter de 10 a 128 caracteres/i)).toBeInTheDocument();

    await user.clear(newPassword());
    await user.clear(confirmation());
    await fillAndSubmit(user, PASSWORD, `${PASSWORD}x`);
    expect(await screen.findByText(/as senhas não conferem/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('AC-19: refuses a password longer than 128 characters before sending', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user, 'a'.repeat(129));

    expect(await screen.findByText(/a senha deve ter de 10 a 128 caracteres/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('SET-04: keeps the fields and rules out of any live region, and the error message in its own alert region', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(submit());

    const message = await screen.findByText(/a senha deve ter de 10 a 128 caracteres/i);
    expect(message.closest('[role="alert"], [aria-live]')).not.toBeNull();
    expect(newPassword().closest('[aria-live]')).toBeNull();
    expect(confirmation().closest('[aria-live]')).toBeNull();
    expect(newPassword()).toHaveAccessibleDescription(/a senha deve ter de 10 a 128 caracteres/i);
  });

  it('SET-01: refuses a password with 10+ characters that breaks the listed rules, sends nothing and focuses the field', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user, 'abcdefghij1');

    expect(await screen.findByText(/não atende a todas as regras/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(newPassword()).toHaveFocus();
    expect(newPassword()).toHaveAttribute('aria-invalid', 'true');
  });

  it('SET-01: sends a password that meets every listed rule', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ok: true } });
    renderPage();

    await fillAndSubmit(user, 'Abcdefghi1#');

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/não atende a todas as regras/i)).not.toBeInTheDocument();
  });

  it('AC-19, AC-27: posts only token and password to /auth/password/set, with no e-mail and no user id', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ok: true } });
    renderPage();

    await fillAndSubmit(user);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/auth/password/set');
    expect(Object.keys(body as object).sort()).toEqual(['password', 'token']);
    expect(body).toEqual({ token: TOKEN, password: PASSWORD });
  });

  it('AC-19: on success says the password was set and offers the way back to the login, without signing in', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ok: true } });
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText(/senha definida/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir para o login/i })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText(/^nova senha/i)).not.toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it.each([400, 404])(
    'AC-19: a %i from the server shows the fixed invalid-or-expired message with the way to ask for another link',
    async (status) => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status, data: { message: 'qualquer texto do servidor' } } });
      renderPage();

      await fillAndSubmit(user);

      expect(await screen.findByText('Link inválido ou expirado.')).toBeInTheDocument();
      expect(screen.getByText(/esqueci minha senha/i)).toBeInTheDocument();
      expect(screen.queryByText(/qualquer texto do servidor/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^nova senha/i)).not.toBeInTheDocument();
    },
  );

  it('AC-19: a failure that is not about the link keeps the form so the person can try again', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } });
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText(/algo deu errado\. tente novamente/i)).toBeInTheDocument();
    expect(newPassword()).toBeInTheDocument();
    expect(screen.queryByText('Link inválido ou expirado.')).not.toBeInTheDocument();
  });

  it.each([
    ['with an empty token', '#t='],
    ['with a token that is not 64 hex characters', '#t=<script>alert(1)</script>'],
    ['with a token that is too short', '#t=abc123'],
  ])('AC-19, AC-26: a link %s shows the invalid message at once, with no form and no request', (_label, hash) => {
    openLink(hash);
    renderPage();

    expect(screen.getByText('Link inválido ou expirado.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^nova senha/i)).not.toBeInTheDocument();
    expect(document.body.querySelector('script')).toBeNull();
    expect(document.body.innerHTML).not.toContain('alert(1)');
    expect(api.post).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('SET-02: a link opened without a fragment (for example after F5) asks to open the e-mailed link again, without saying expired', () => {
    openLink('');
    renderPage();

    expect(screen.getByText(/abra de novo o link recebido por e-mail/i)).toBeInTheDocument();
    expect(screen.queryByText(/expirado/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^nova senha/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voltar para o login/i })).toHaveAttribute('href', '/login');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('AC-19, AC-26: what was typed never comes back as HTML', async () => {
    const user = userEvent.setup();
    const hostile = '<img src=x onerror=alert(1)> Ab1';
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ok: true } });
    const { container } = renderPage();

    await fillAndSubmit(user, hostile);

    await screen.findByText(/senha definida/i);
    expect(container.querySelector('img')).toBeNull();
    expect(document.body.innerHTML).not.toContain('onerror');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ token: TOKEN, password: hostile });
  });

  it('AC-19: disables the button while the password is being sent, so a double click sends once', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    renderPage();

    await fillAndSubmit(user);

    await waitFor(() => expect(submit()).toBeDisabled());
    await user.click(submit());
    expect(api.post).toHaveBeenCalledTimes(1);
    release({ data: { ok: true } });
    await screen.findByText(/senha definida/i);
  });
});
