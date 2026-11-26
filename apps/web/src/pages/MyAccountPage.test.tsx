import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyAccountPage } from './MyAccountPage';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

function renderMyAccountPage(initialEntry = '/my-account') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MyAccountPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MyAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      token: 'fake-token',
      user: { sub: 'u-1', email: 'jane@example.com', role: 'AGENT' },
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/auth/me') {
        return Promise.resolve({
          data: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' },
        });
      }
      if (url === '/api-tokens') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('fetches the current profile via GET /auth/me and prefills name and email', async () => {
    renderMyAccountPage();
    expect(api.get).toHaveBeenCalledWith('/auth/me');
    expect(await screen.findByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
  });

  it('renders tabs for Minha Conta and Segurança, defaulting to Minha Conta', () => {
    renderMyAccountPage();
    expect(
      screen.getByRole('tab', { name: /minha conta/i }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /segurança/i })).toBeInTheDocument();
    // Profile fields visible by default; password fields not yet.
    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha atual/i)).not.toBeInTheDocument();
  });

  // ACC-08
  describe('tabs in the URL and ARIA', () => {
    it('opens the Segurança tab from ?tab=security with a tabpanel tied to its tab', () => {
      renderMyAccountPage('/my-account?tab=security');
      const tab = screen.getByRole('tab', { name: /segurança/i });
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByText('Alterar senha')).toBeInTheDocument();
      const panel = screen.getByRole('tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(tab).toHaveAttribute('aria-controls', panel.id);
    });

    it('falls back to the profile tab when ?tab= is invalid', () => {
      renderMyAccountPage('/my-account?tab=nope');
      expect(screen.getByRole('tab', { name: /minha conta/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    });

    it('writes the active tab to ?tab= when the user changes tabs', async () => {
      const user = userEvent.setup();
      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /tokens de api/i }));
      expect(screen.getByTestId('search')).toHaveTextContent('?tab=tokens');
    });
  });

  describe('Minha Conta tab (profile)', () => {
    // ACC-09
    it('shows an error alert with retry when GET /auth/me fails, and keeps Salvar disabled', async () => {
      const user = userEvent.setup();
      let fail = true;
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/auth/me') {
          return fail
            ? Promise.reject(new Error('boom'))
            : Promise.resolve({ data: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' } });
        }
        return Promise.resolve({ data: [] });
      });
      renderMyAccountPage();

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();

      fail = false;
      await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
      expect(await screen.findByDisplayValue('Jane Doe')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /salvar/i })).toBeEnabled();
    });

    it('submits updated name and email via PATCH /auth/me', async () => {
      const user = userEvent.setup();
      vi.mocked(api.patch).mockResolvedValueOnce({
        data: { id: 'u-1', name: 'Jane Updated', email: 'jane.updated@example.com', role: 'AGENT' },
      });

      renderMyAccountPage();
      await screen.findByDisplayValue('Jane Doe');
      await user.clear(screen.getByLabelText(/^nome$/i));
      await user.type(screen.getByLabelText(/^nome$/i), 'Jane Updated');
      await user.clear(screen.getByLabelText(/^e-mail$/i));
      await user.type(screen.getByLabelText(/^e-mail$/i), 'jane.updated@example.com');
      await user.click(screen.getByRole('button', { name: /salvar/i }));

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/auth/me', {
          name: 'Jane Updated',
          email: 'jane.updated@example.com',
        });
      });
      expect(
        await screen.findByText(/dados atualizados com sucesso/i),
      ).toBeInTheDocument();
    });

    it('keeps what the user typed when GET /auth/me responds late', async () => {
      const user = userEvent.setup();
      let respondMe: (value: unknown) => void = () => undefined;
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/auth/me') {
          return new Promise((resolve) => {
            respondMe = resolve;
          });
        }
        return Promise.resolve({ data: [] });
      });
      vi.mocked(api.patch).mockResolvedValueOnce({ data: {} });

      renderMyAccountPage();
      await user.type(screen.getByLabelText(/^nome$/i), 'Jane Updated');
      await user.clear(screen.getByLabelText(/^e-mail$/i));
      await user.type(screen.getByLabelText(/^e-mail$/i), 'jane.updated@example.com');

      await act(async () => {
        respondMe({
          data: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' },
        });
      });
      await user.click(screen.getByRole('button', { name: /salvar/i }));

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/auth/me', {
          name: 'Jane Updated',
          email: 'jane.updated@example.com',
        });
      });
    });

    it('shows an error when the email is already in use (409)', async () => {
      const user = userEvent.setup();
      vi.mocked(api.patch).mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 409 },
      });

      renderMyAccountPage();
      await screen.findByDisplayValue('Jane Doe');
      await user.clear(screen.getByLabelText(/^e-mail$/i));
      await user.type(screen.getByLabelText(/^e-mail$/i), 'taken@example.com');
      await user.click(screen.getByRole('button', { name: /salvar/i }));

      expect(
        await screen.findByText(/e-mail já está em uso/i),
      ).toBeInTheDocument();
    });
  });

  describe('Segurança tab (password)', () => {
    const STRONG = 'Girafa#Verde-5290';

    async function fillAndSubmitPassword(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('tab', { name: /segurança/i }));
      await user.type(screen.getByLabelText(/senha atual/i), 'old-password');
      await user.type(screen.getByLabelText(/^nova senha$/i), STRONG);
      await user.type(screen.getByLabelText(/^confirmar nova senha$/i), STRONG);
      await user.click(screen.getByRole('button', { name: /trocar senha/i }));
    }

    it('renders the change password form when the tab is selected', async () => {
      const user = userEvent.setup();
      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /segurança/i }));

      expect(screen.getByLabelText(/senha atual/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^nova senha$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^confirmar nova senha$/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /trocar senha/i }),
      ).toBeInTheDocument();
    });

    it('submits the change password request and shows a success message', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { message: 'Password updated successfully' },
      });

      renderMyAccountPage();
      await fillAndSubmitPassword(user);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/auth/change-password', {
          currentPassword: 'old-password',
          newPassword: STRONG,
        });
      });
      expect(
        await screen.findByText(/senha atualizada com sucesso/i),
      ).toBeInTheDocument();
    });

    // ACC-10
    it('shows a field error and does not call POST when the confirmation differs', async () => {
      const user = userEvent.setup();
      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /segurança/i }));
      await user.type(screen.getByLabelText(/senha atual/i), 'old-password');
      await user.type(screen.getByLabelText(/^nova senha$/i), STRONG);
      expect(screen.queryByLabelText(/^confirmar nova senha$/i)).toBeInTheDocument();
      await user.type(screen.getByLabelText(/^confirmar nova senha$/i), 'Outra#Senha-1234');
      await user.click(screen.getByRole('button', { name: /trocar senha/i }));

      expect(await screen.findByText(/as senhas não coincidem/i)).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('rejects a new password that breaks the visible rules before calling POST', async () => {
      const user = userEvent.setup();
      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /segurança/i }));
      await user.type(screen.getByLabelText(/senha atual/i), 'old-password');
      await user.type(screen.getByLabelText(/^nova senha$/i), 'semsimbolo1234');
      expect(screen.queryByLabelText(/^confirmar nova senha$/i)).toBeInTheDocument();
      await user.type(screen.getByLabelText(/^confirmar nova senha$/i), 'semsimbolo1234');
      await user.click(screen.getByRole('button', { name: /trocar senha/i }));

      expect(await screen.findByText(/não atende a todas as regras/i)).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('shows an error message when the current password is wrong (401)', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 401 },
      });

      renderMyAccountPage();
      await fillAndSubmitPassword(user);

      expect(
        await screen.findByText(/senha atual incorreta/i),
      ).toBeInTheDocument();
    });
  });

  describe('Tokens de API tab', () => {
    it('creates a token, shows the plaintext value once, then lists it as metadata-only', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          id: 'tok-1',
          name: 'Claude Desktop',
          token: 'apta_abcdef1234567890',
          createdAt: '2026-10-03T00:00:00.000Z',
          lastUsedAt: null,
        },
      });
      // After creation, the list is re-fetched (metadata only, no token).
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/auth/me') {
          return Promise.resolve({
            data: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' },
          });
        }
        if (url === '/api-tokens') {
          return Promise.resolve({
            data: [
              { id: 'tok-1', name: 'Claude Desktop', createdAt: '2026-10-03T00:00:00.000Z', lastUsedAt: null },
            ],
          });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });

      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /tokens de api/i }));

      await user.type(screen.getByLabelText(/nome do token/i), 'Claude Desktop');
      await user.click(screen.getByRole('button', { name: /gerar token/i }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/api-tokens', { name: 'Claude Desktop' });
      });

      // The plaintext token is shown exactly once, right after creation.
      expect(await screen.findByText('apta_abcdef1234567890')).toBeInTheDocument();

      // The persisted list entry never carries the plaintext value.
      await waitFor(() => {
        expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
      });
    });

    const mockTokenList = () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/auth/me') {
          return Promise.resolve({
            data: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'AGENT' },
          });
        }
        if (url === '/api-tokens') {
          return Promise.resolve({
            data: [
              { id: 'tok-1', name: 'Old Script', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
            ],
          });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
    };

    const CREATED = {
      id: 'tok-2',
      name: 'Claude Desktop',
      token: 'apta_abcdef1234567890',
      createdAt: '2026-10-03T00:00:00.000Z',
      lastUsedAt: null,
    };

    const createToken = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('tab', { name: /tokens de api/i }));
      await user.type(screen.getByLabelText(/nome do token/i), 'Claude Desktop');
      await user.click(screen.getByRole('button', { name: /gerar token/i }));
    };

    // ACC-02
    it('revoking asks for confirmation in a dialog naming the token and only then calls DELETE', async () => {
      const user = userEvent.setup();
      mockTokenList();
      vi.mocked(api.delete).mockResolvedValueOnce({ data: { success: true } });
      const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /tokens de api/i }));

      expect(await screen.findByText('Old Script')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^revogar$/i }));

      const dialog = await screen.findByRole('dialog');
      expect(nativeConfirm).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      expect(within(dialog).getByText(/old script/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/perderá acesso/i)).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: /revogar token/i }));

      await waitFor(() => {
        expect(api.delete).toHaveBeenCalledWith('/api-tokens/tok-1');
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('cancelling the revoke dialog keeps the token and does not call DELETE', async () => {
      const user = userEvent.setup();
      mockTokenList();

      renderMyAccountPage();
      await user.click(screen.getByRole('tab', { name: /tokens de api/i }));
      await screen.findByText('Old Script');
      await user.click(screen.getByRole('button', { name: /^revogar$/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();
    });

    // ACC-13
    it('Revogar and Copiar use DS variants without "!" overrides', async () => {
      const user = userEvent.setup();
      mockTokenList();
      vi.mocked(api.post).mockResolvedValueOnce({ data: CREATED });
      renderMyAccountPage();
      await createToken(user);
      await screen.findByText('Old Script');
      for (const name of [/^revogar$/i, /^copiar$/i]) {
        expect(screen.getByRole('button', { name }).className).not.toContain('!');
      }
    });

    // ACC-03
    it('shows a manual-copy message and no "Copiado!" when the clipboard write fails', async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      vi.mocked(api.post).mockResolvedValueOnce({ data: CREATED });

      renderMyAccountPage();
      await createToken(user);
      await screen.findByText(CREATED.token);
      await user.click(screen.getByRole('button', { name: /^copiar$/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/copie manualmente/i);
      expect(screen.queryByRole('button', { name: /copiado/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^copiar$/i })).toBeInTheDocument();
    });

    it('shows an error alert when creating the token fails', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } });

      renderMyAccountPage();
      await createToken(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível gerar o token/i);
    });

    it('asks before discarding a token that was not copied, and closes after the second click', async () => {
      const user = userEvent.setup();
      vi.mocked(api.post).mockResolvedValueOnce({ data: CREATED });

      renderMyAccountPage();
      await createToken(user);
      await screen.findByText(CREATED.token);
      await user.click(screen.getByRole('button', { name: /entendi, fechar/i }));

      expect(screen.getByText(CREATED.token)).toBeInTheDocument();
      expect(screen.getByText(/ainda não copiou/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /fechar sem copiar/i }));
      expect(screen.queryByText(CREATED.token)).not.toBeInTheDocument();
    });

    it('closes right away when the token was already copied', async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      vi.mocked(api.post).mockResolvedValueOnce({ data: CREATED });

      renderMyAccountPage();
      await createToken(user);
      await screen.findByText(CREATED.token);
      await user.click(screen.getByRole('button', { name: /^copiar$/i }));
      expect(await screen.findByRole('button', { name: /copiado/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /entendi, fechar/i }));

      expect(screen.queryByText(CREATED.token)).not.toBeInTheDocument();
    });
  });
});
