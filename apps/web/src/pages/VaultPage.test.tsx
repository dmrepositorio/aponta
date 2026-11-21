import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { VaultPage } from './VaultPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const folders = [{ id: 'f1', name: 'Servidores', organizationId: 'org-1', credentialCount: 1, createdAt: '', updatedAt: '' }];

const credentials = [
  {
    id: 'cred-1',
    name: 'Servidor FTP',
    url: 'https://ftp.example.com',
    description: null,
    organizationId: 'org-1',
    folderId: null,
    hasUsername: true,
    hasPassword: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cred-2',
    name: 'VPN Interna',
    url: null,
    description: null,
    organizationId: 'org-1',
    folderId: null,
    hasUsername: false,
    hasPassword: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'cred-3',
    name: 'Backup Interno',
    url: null,
    description: null,
    organizationId: 'org-1',
    folderId: null,
    hasUsername: true,
    hasPassword: false,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
];

function mockDefaultGets() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/vault/folders') return { data: folders };
    if (url === '/vault/credentials') {
      return { data: { data: credentials, meta: { total: 2, page: 1, limit: 10, totalPages: 1 } } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/vault']}>
        <Routes>
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/vault/audit" element={<div>Tela de auditoria</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ) };
}

function loginAs(role: 'ADMIN' | 'AGENT') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'user@aponta.com', role },
  });
}

/**
 * The `EzTextInput`/select fields rendered by `FolderModal`/`CredentialModal`
 * don't wire an `id`/`htmlFor` pair, so `getByLabelText` can't associate them.
 * The DOM testing library's default text matcher only looks at an element's
 * own direct text nodes, so an exact label match is unambiguous even though
 * other elements (buttons, titles) may contain the same words. We use that to
 * walk from the `<label>` to its sibling `<input>`/`<select>`.
 */
function fieldFor(root: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = within(root).getByText(labelText, { selector: 'label' });
  const field = (label.parentElement as HTMLElement).querySelector('input, select');
  if (!field) throw new Error(`Could not find an input/select for label "${labelText}"`);
  return field as HTMLInputElement | HTMLSelectElement;
}

function lastCredentialsCallParams() {
  const calls = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/vault/credentials');
  const lastCall = calls[calls.length - 1];
  return (lastCall?.[1] as { params?: Record<string, unknown> } | undefined)?.params;
}

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Ações' }));
}

describe('VaultPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    window.confirm = vi.fn(() => true);
  });

  it('shows a loading state while credentials are being fetched', () => {
    vi.mocked(api.get).mockReturnValue(
      new Promise(() => {
        // Never resolves, keeping the query in its loading state.
      }),
    );
    loginAs('ADMIN');
    renderPage();

    expect(screen.getByText(/carregando cofre/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network error'));
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/erro ao carregar o cofre/i)).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no credentials in the selected folder', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/vault/folders') return { data: [] };
      if (url === '/vault/credentials') {
        return { data: { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 1 } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/nenhuma credencial liberada/i)).toBeInTheDocument();
    });
  });

  it('renders the folder tree and masks every password/username by default (acceptance criterion #1)', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    expect(screen.getByText(/Servidores \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('VPN Interna')).toBeInTheDocument();
    expect(screen.queryByText('super-secret')).not.toBeInTheDocument();
    expect(screen.getAllByText('••••••••').length).toBeGreaterThan(0);
  });

  it('allows ADMIN to delete a credential after confirming', async () => {
    mockDefaultGets();
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByTitle('Excluir');
    await user.click(deleteBtns[0]);

    expect(window.confirm).toHaveBeenCalledWith('Excluir senha definitivamente?');
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/vault/credentials/cred-1');
    });
  });

  it('hides destructive/management actions for a non-ADMIN role (AGENT)', async () => {
    mockDefaultGets();
    loginAs('AGENT');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    expect(screen.queryByTitle('Excluir')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ações/i })).not.toBeInTheDocument();
  });

  it('copies the username via the reveal endpoint (intent=copy) without ever rendering it', async () => {
    mockDefaultGets();
    vi.mocked(api.post).mockResolvedValue({ data: { value: 'ftpuser' } });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: writeTextMock,
      configurable: true,
    });

    const row = screen.getByText('Servidor FTP').closest('tr') as HTMLElement;
    const copyUsernameBtn = within(row).getByTitle('Copiar usuário');
    copyUsernameBtn.click();

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/vault/credentials/cred-1/reveal', { field: 'username', intent: 'copy' });
    });
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('ftpuser');
    });
    expect(screen.queryByText('ftpuser')).not.toBeInTheDocument();
  });

  it('navigates to /vault/audit when ADMIN clicks "Auditoria"', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Auditoria' }));

    expect(await screen.findByText('Tela de auditoria')).toBeInTheDocument();
  });

  it('selecting a non-root folder shows its header actions and resets page/revealed state', async () => {
    mockDefaultGets();
    vi.mocked(api.post).mockImplementation(async (_url: string, body: any) => {
      if (body.field === 'username') return { data: { value: 'ftpuser' } };
      return { data: { value: 'fake-password-123' } };
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const row = screen.getByText('Servidor FTP').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Revelar senha de Servidor FTP' }));
    await waitFor(() => {
      expect(screen.getByText('fake-password-123')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('tree-node-f1'));

    await waitFor(() => {
      expect(screen.getByText('Pasta:')).toBeInTheDocument();
    });
    expect(screen.getByText('Servidores')).toBeInTheDocument();
    expect(screen.getByTitle('Editar pasta')).toBeInTheDocument();
    expect(screen.getByTitle('Remover pasta')).toBeInTheDocument();

    // selection resets the page/revealed state
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(lastCredentialsCallParams()).toMatchObject({ folderId: 'f1', page: 1 });
    });
  });

  it('creates a folder via "Nova pasta" and edits a selected folder\'s name', async () => {
    mockDefaultGets();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova pasta' }));

    const createDialog = screen.getByRole('dialog');
    await user.type(fieldFor(createDialog, 'Nome da pasta'), 'Rede');
    await user.click(within(createDialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/vault/folders', { name: 'Rede' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByTestId('tree-node-f1'));
    await waitFor(() => {
      expect(screen.getByTitle('Editar pasta')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Editar pasta'));

    const editDialog = screen.getByRole('dialog');
    const nameInput = fieldFor(editDialog, 'Nome da pasta');
    expect(nameInput).toHaveValue('Servidores');
    await user.clear(nameInput);
    await user.type(nameInput, 'Servidores Prod');
    await user.click(within(editDialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/vault/folders/f1', { name: 'Servidores Prod' });
    });
  });

  it('does not delete the folder when confirm is cancelled, but does when confirmed', async () => {
    mockDefaultGets();
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('tree-node-f1'));
    await waitFor(() => {
      expect(screen.getByTitle('Remover pasta')).toBeInTheDocument();
    });

    window.confirm = vi.fn(() => false);
    await user.click(screen.getByTitle('Remover pasta'));
    expect(window.confirm).toHaveBeenCalledWith('Remover a pasta "Servidores"?');
    expect(api.delete).not.toHaveBeenCalledWith('/vault/folders/f1');

    window.confirm = vi.fn(() => true);
    await user.click(screen.getByTitle('Remover pasta'));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/vault/folders/f1');
    });
  });

  it('creates a credential via "Nova senha" and edits one without touching blank username/password', async () => {
    mockDefaultGets();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova senha' }));

    const createDialog = screen.getByRole('dialog');
    await user.type(fieldFor(createDialog, 'Nome'), 'Novo Serviço');
    await user.type(fieldFor(createDialog, 'Senha'), 'fake-password-123');
    await user.click(within(createDialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/vault/credentials',
        expect.objectContaining({ name: 'Novo Serviço', password: 'fake-password-123' }),
      );
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const editBtns = screen.getAllByTitle('Editar');
    await user.click(editBtns[0]);

    const editDialog = screen.getByRole('dialog');
    expect(fieldFor(editDialog, 'Usuário (deixe em branco para não alterar)')).toHaveValue('');
    expect(fieldFor(editDialog, 'Senha (deixe em branco para não alterar)')).toHaveValue('');
    const nameInput = fieldFor(editDialog, 'Nome');
    await user.clear(nameInput);
    await user.type(nameInput, 'Servidor FTP Renomeado');
    await user.click(within(editDialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalled();
    });
    const patchCall = vi.mocked(api.patch).mock.calls.find(([url]) => url === '/vault/credentials/cred-1');
    expect(patchCall?.[1]).toMatchObject({ name: 'Servidor FTP Renomeado' });
    expect(patchCall?.[1]).not.toHaveProperty('username');
    expect(patchCall?.[1]).not.toHaveProperty('password');
  });

  it('does not save a new credential with a blank/whitespace-only name, nor without a password', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova senha' }));
    const dialog = screen.getByRole('dialog');

    // Whitespace-only name (passes the native "required" check, but fails `name.trim()`).
    await user.type(fieldFor(dialog, 'Nome'), '   ');
    await user.type(fieldFor(dialog, 'Senha'), 'fake-password-123');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Valid name, but whitespace-only password while creating (not editing).
    await user.clear(fieldFor(dialog, 'Nome'));
    await user.type(fieldFor(dialog, 'Nome'), 'Nome Válido');
    await user.clear(fieldFor(dialog, 'Senha'));
    await user.type(fieldFor(dialog, 'Senha'), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('copies the password via the reveal endpoint (intent=copy) without ever rendering it', async () => {
    mockDefaultGets();
    vi.mocked(api.post).mockResolvedValue({ data: { value: 'fake-password-123' } });
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: writeTextMock,
      configurable: true,
    });

    const row = screen.getByText('Servidor FTP').closest('tr') as HTMLElement;
    const copyPasswordBtn = within(row).getByTitle('Copiar senha');
    copyPasswordBtn.click();

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/vault/credentials/cred-1/reveal', { field: 'password', intent: 'copy' });
    });
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('fake-password-123');
    });
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
  });

  it('shows "—" placeholders for missing username, password, and url columns', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('VPN Interna')).toBeInTheDocument();
    });

    const vpnRow = screen.getByText('VPN Interna').closest('tr') as HTMLElement; // hasUsername: false, url: null
    expect(within(vpnRow).queryByTitle('Copiar usuário')).not.toBeInTheDocument();
    expect(within(vpnRow).queryByTitle('Copiar URL')).not.toBeInTheDocument();
    expect(within(vpnRow).getAllByText('—')).toHaveLength(2);

    const backupRow = screen.getByText('Backup Interno').closest('tr') as HTMLElement; // hasPassword: false, url: null
    expect(within(backupRow).queryByTitle('Copiar senha')).not.toBeInTheDocument();
    expect(within(backupRow).getAllByText('—')).toHaveLength(2);
  });

  it('lets ADMIN copy and open the URL of a credential that has one', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: writeTextMock,
      configurable: true,
    });

    const row = screen.getByText('Servidor FTP').closest('tr') as HTMLElement;
    within(row).getByTitle('Copiar URL').click();
    expect(writeTextMock).toHaveBeenCalledWith('https://ftp.example.com');

    const openLink = within(row).getByTitle('Abrir URL');
    expect(openLink).toHaveAttribute('href', 'https://ftp.example.com');
    expect(openLink).toHaveAttribute('target', '_blank');
  });

  it('renders pagination when there is more than one page and refetches for the clicked page', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/vault/folders') return { data: folders };
      if (url === '/vault/credentials') {
        return { data: { data: credentials, meta: { total: 25, page: 1, limit: 10, totalPages: 2 } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const pageTwoBtn = screen.getByRole('button', { name: '2' });
    await user.click(pageTwoBtn);

    await waitFor(() => {
      expect(lastCredentialsCallParams()).toMatchObject({ page: 2 });
    });
  });

  it('searches credentials by text and resets to page 1', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Buscar senha...');
    const user = userEvent.setup();
    // Types character-by-character: each keystroke changes the
    // credentialsQuery key and triggers a refetch. useVaultCredentials uses
    // `placeholderData: keepPreviousData` so the panel (and this input) stays
    // mounted across those refetches instead of flashing back to the
    // top-level loading spinner and dropping keystrokes.
    await user.type(searchInput, 'ftp');

    await waitFor(() => {
      expect(lastCredentialsCallParams()).toMatchObject({ search: 'ftp', page: 1 });
    });
    expect(searchInput).toHaveValue('ftp');
  });

  it('closes folder and credential modals via "Cancelar" without calling the API', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova pasta' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith('/vault/folders', expect.anything());

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova senha' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith('/vault/credentials', expect.anything());
  });
});

describe('VaultPage — header, toolbar and table at the app scale (DMTE-546)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    window.confirm = vi.fn(() => true);
  });

  it('renders the title inside EzPageHeader, at the app scale, without the decorative lock icon, with "Auditoria" in the header (AC-01)', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const heading = screen.getByRole('heading', { name: 'Cofre de Senhas' });
    expect(heading.tagName).toBe('H1');
    expect(heading).toHaveClass('text-[20px]', 'font-semibold');
    expect(heading.querySelector('svg')).not.toBeInTheDocument();

    const header = heading.closest('.bg-white.border-b') as HTMLElement;
    expect(header).not.toBeNull();
    expect(within(header).getByRole('button', { name: 'Auditoria' })).toBeInTheDocument();
  });

  it('keeps the selected folder\'s actions inside the toolbar row, leaving only the toolbar and the table head above the first row (AC-02)', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('tree-node-f1'));
    await waitFor(() => {
      expect(screen.getByText('Pasta:')).toBeInTheDocument();
    });

    const toolbar = screen.getByPlaceholderText('Buscar senha...').closest('div.border-b') as HTMLElement;
    expect(within(toolbar).getByText('Pasta:')).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Ações' })).toBeInTheDocument();

    const card = toolbar.parentElement as HTMLElement;
    expect(card.querySelectorAll(':scope > div.border-b')).toHaveLength(1);
  });

  it('gives the truncated URL a title with the full value (AC-05)', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const row = screen.getByText('Servidor FTP').closest('tr') as HTMLElement;
    expect(within(row).getByText('https://ftp.example.com')).toHaveAttribute('title', 'https://ftp.example.com');
  });

  it('wraps the table in a horizontal-scroll container and stacks the tree above it until lg (AC-03/AC-04)', async () => {
    mockDefaultGets();
    loginAs('ADMIN');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('overflow-x-auto');

    const grid = screen.getByTestId('tree-node-root').closest('.grid') as HTMLElement;
    expect(grid).toHaveClass('lg:grid-cols-[260px_1fr]');
    expect(grid).not.toHaveClass('md:grid-cols-[260px_1fr]');
  });
});

describe('VaultPage — row actions and per-field reveal (DMTE-544)', () => {
  const REVEAL_VALUES: Record<string, string> = { username: 'ftpuser', password: 'fake-password-123' };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockReveal() {
    vi.mocked(api.post).mockImplementation(async (_url: string, body: any) => ({ data: { value: REVEAL_VALUES[body.field] } }));
  }

  function setClipboard(writeText: unknown) {
    Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
  }

  async function renderLoaded(options: { fakeTimers?: boolean; role?: 'ADMIN' | 'AGENT' } = {}) {
    if (options.fakeTimers) vi.useFakeTimers({ shouldAdvanceTime: true });
    mockDefaultGets();
    loginAs(options.role ?? 'ADMIN');
    const user = userEvent.setup(options.fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : undefined);
    const view = renderPage();
    await waitFor(() => expect(screen.getByText('Servidor FTP')).toBeInTheDocument());
    return { user, ...view };
  }

  const ftpRow = () => screen.getByText('Servidor FTP').closest('tr') as HTMLElement;
  const eye = (field: 'usuário' | 'senha', name = 'Servidor FTP') => screen.getByRole('button', { name: `Revelar ${field} de ${name}` });
  const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
  const revealCalls = () => vi.mocked(api.post).mock.calls.filter(([, body]) => (body as any).intent === 'reveal');

  it('gives every row and folder icon button an accessible name with the action and the item', async () => {
    const { user } = await renderLoaded();
    const row = within(ftpRow());
    for (const name of [
      'Copiar usuário de Servidor FTP',
      'Copiar senha de Servidor FTP',
      'Copiar URL de Servidor FTP',
      'Editar Servidor FTP',
      'Excluir Servidor FTP',
    ]) {
      expect(row.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(row.getByRole('link', { name: 'Abrir URL de Servidor FTP' })).toHaveAttribute('href', 'https://ftp.example.com');

    await user.click(screen.getByTestId('tree-node-f1'));
    expect(await screen.findByRole('button', { name: 'Editar pasta Servidores' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover pasta Servidores' })).toBeInTheDocument();
  });

  it('renders the icon buttons at 32px with the DS focus ring', async () => {
    const { user } = await renderLoaded();
    const row = within(ftpRow());
    const controls = [
      row.getByRole('button', { name: 'Copiar usuário de Servidor FTP' }),
      row.getByRole('button', { name: 'Copiar senha de Servidor FTP' }),
      row.getByRole('button', { name: 'Copiar URL de Servidor FTP' }),
      row.getByRole('button', { name: 'Revelar usuário de Servidor FTP' }),
      row.getByRole('button', { name: 'Revelar senha de Servidor FTP' }),
      row.getByRole('button', { name: 'Editar Servidor FTP' }),
      row.getByRole('button', { name: 'Excluir Servidor FTP' }),
      row.getByRole('link', { name: 'Abrir URL de Servidor FTP' }),
    ];
    await user.click(screen.getByTestId('tree-node-f1'));
    controls.push(
      await screen.findByRole('button', { name: 'Editar pasta Servidores' }),
      screen.getByRole('button', { name: 'Remover pasta Servidores' }),
    );
    for (const control of controls) {
      expect(control).toHaveClass('h-[32px]', 'w-[32px]', 'ez-focus');
    }
  });

  it('confirms a successful copy in a polite status region that clears by itself', async () => {
    const { user } = await renderLoaded({ fakeTimers: true });
    mockReveal();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Copiar senha de Servidor FTP' }));
    expect(await within(status).findByText('Senha copiada')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('fake-password-123');
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();

    await advance(5000);
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Copiar usuário de Servidor FTP' }));
    expect(await within(status).findByText('Usuário copiado')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copiar URL de Servidor FTP' }));
    expect(await within(status).findByText('URL copiada')).toBeInTheDocument();
  });

  it('shows a visible error when the copy fails (reveal rejected, clipboard rejected or missing)', async () => {
    const { user } = await renderLoaded();

    vi.mocked(api.post).mockRejectedValue(new Error('403'));
    setClipboard(vi.fn().mockResolvedValue(undefined));
    await user.click(screen.getByRole('button', { name: 'Copiar senha de Servidor FTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível copiar a senha.');

    mockReveal();
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await user.click(screen.getByRole('button', { name: 'Copiar usuário de Servidor FTP' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível copiar o usuário.'));

    setClipboard(undefined);
    await user.click(screen.getByRole('button', { name: 'Copiar URL de Servidor FTP' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível copiar a URL.'));

    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await user.click(screen.getByRole('button', { name: 'Copiar URL de Servidor FTP' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível copiar a URL.'));
    expect(screen.queryByText('Senha copiada')).not.toBeInTheDocument();
  });

  it('reveals one field at a time with a pressed toggle, one audited call per field, and no lock in the name column', async () => {
    const { user } = await renderLoaded();
    mockReveal();

    expect(within(ftpRow()).queryByTitle('Revelar linha')).not.toBeInTheDocument();
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'false');
    expect(eye('usuário')).toHaveAttribute('aria-pressed', 'false');

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'true');
    expect(eye('usuário')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('ftpuser')).not.toBeInTheDocument();
    expect(revealCalls()).toEqual([['/vault/credentials/cred-1/reveal', { field: 'password', intent: 'reveal' }]]);

    await user.click(eye('usuário'));
    expect(await screen.findByText('ftpuser')).toBeInTheDocument();
    expect(revealCalls()).toHaveLength(2);

    await user.click(eye('senha'));
    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('ftpuser')).toBeInTheDocument();
    expect(revealCalls()).toHaveLength(2);
  });

  it('only offers an eye for the fields a credential has', async () => {
    await renderLoaded();
    expect(screen.queryByRole('button', { name: 'Revelar usuário de VPN Interna' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revelar senha de VPN Interna' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revelar senha de Backup Interno' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revelar usuário de Backup Interno' })).toBeInTheDocument();
  });

  it('keeps the field masked and shows an error when the reveal fails', async () => {
    const { user } = await renderLoaded();
    vi.mocked(api.post).mockRejectedValue(new Error('500'));

    await user.click(eye('senha'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível revelar a senha.');
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();

    await user.click(eye('usuário'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível revelar o usuário.'));
  });

  it('disables the eye while its reveal is in flight, so a second click makes no second call', async () => {
    const { user } = await renderLoaded();
    let resolveReveal: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { resolveReveal = resolve; }));

    await user.click(eye('senha'));
    await waitFor(() => expect(eye('senha')).toBeDisabled());
    await user.click(eye('senha'));
    expect(revealCalls()).toHaveLength(1);

    await act(async () => resolveReveal({ data: { value: 'fake-password-123' } }));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    expect(eye('senha')).toBeEnabled();
  });

  it('masks each revealed field again 30 seconds after it was revealed, counted per field', async () => {
    const { user } = await renderLoaded({ fakeTimers: true });
    mockReveal();

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    await advance(20_000);
    await user.click(eye('usuário'));
    expect(await screen.findByText('ftpuser')).toBeInTheDocument();

    await advance(9_000);
    expect(screen.getByText('fake-password-123')).toBeInTheDocument();
    await advance(1_500);
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('ftpuser')).toBeInTheDocument();

    await advance(20_000);
    expect(screen.queryByText('ftpuser')).not.toBeInTheDocument();
    expect(eye('usuário')).toHaveAttribute('aria-pressed', 'false');
  });

  it('cancels the old timer when a field is hidden by hand and revealed again', async () => {
    const { user } = await renderLoaded({ fakeTimers: true });
    mockReveal();

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    await advance(10_000);
    await user.click(eye('senha'));
    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());
    await advance(10_000);
    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();

    await advance(25_000); // 35s after the first reveal, 25s after the second
    expect(screen.getByText('fake-password-123')).toBeInTheDocument();
    await advance(6_000);
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
  });

  it('clears the 30s reveal timer when the page unmounts', async () => {
    const { user, unmount } = await renderLoaded({ fakeTimers: true });
    mockReveal();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await user.click(eye('senha'));
    await screen.findByText('fake-password-123');
    const revealTimerIds = setTimeoutSpy.mock.calls
      .map((call, index) => (call[1] === 30_000 ? setTimeoutSpy.mock.results[index].value : undefined))
      .filter((id) => id !== undefined);
    expect(revealTimerIds).toHaveLength(1);

    unmount();
    expect(clearTimeoutSpy.mock.calls.some(([id]) => id === revealTimerIds[0])).toBe(true);
  });

  it('keeps no revealed or copied value in the query client after use', async () => {
    const { user, queryClient } = await renderLoaded();
    mockReveal();
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const heldValues = () => queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data);

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    await waitFor(() => expect(heldValues()).not.toContain('fake-password-123'));

    await user.click(screen.getByRole('button', { name: 'Copiar usuário de Servidor FTP' }));
    expect(await screen.findByText('Usuário copiado')).toBeInTheDocument();
    await waitFor(() => expect(heldValues()).not.toContain('ftpuser'));
    expect(screen.getByText('fake-password-123')).toBeInTheDocument();
  });

  it('masks every revealed field when the user searches', async () => {
    const { user } = await renderLoaded();
    mockReveal();
    await user.click(eye('senha'));
    await user.click(eye('usuário'));
    expect(await screen.findByText('ftpuser')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Buscar senha...'), 'f');

    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());
    expect(screen.queryByText('ftpuser')).not.toBeInTheDocument();
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'false');
  });

  it('masks every revealed field when the user changes page', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/vault/folders') return { data: folders };
      return { data: { data: credentials, meta: { total: 25, page: 1, limit: 10, totalPages: 2 } } };
    });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Servidor FTP')).toBeInTheDocument());
    mockReveal();

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());
  });

  it('masks every revealed field after a credential is saved or deleted', async () => {
    const { user } = await renderLoaded();
    mockReveal();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar Servidor FTP' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());

    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Excluir Servidor FTP' }));
    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());
  });

  it('drops a reveal response that arrives after the values were cleared', async () => {
    const { user } = await renderLoaded();
    let resolveReveal: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { resolveReveal = resolve; }));

    await user.click(eye('senha'));
    await waitFor(() => expect(eye('senha')).toBeDisabled());
    await user.type(screen.getByPlaceholderText('Buscar senha...'), 'f');
    await act(async () => resolveReveal({ data: { value: 'fake-password-123' } }));

    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
    expect(eye('senha')).toHaveAttribute('aria-pressed', 'false');
  });

  it('hides revealed values when the selected folder is removed', async () => {
    const { user } = await renderLoaded();
    mockReveal();
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    await user.click(screen.getByTestId('tree-node-f1'));
    await screen.findByRole('button', { name: 'Remover pasta Servidores' });
    await user.click(eye('senha'));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover pasta Servidores' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/vault/folders/f1'));
    await waitFor(() => expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument());
  });

  it('keeps the eye disabled and busy until a discarded reveal settles, so no second call starts', async () => {
    const { user } = await renderLoaded();
    let resolveReveal: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { resolveReveal = resolve; }));

    await user.click(eye('senha'));
    await waitFor(() => expect(eye('senha')).toBeDisabled());
    expect(eye('senha')).toHaveAttribute('aria-busy', 'true');

    await user.type(screen.getByPlaceholderText('Buscar senha...'), 'f');
    expect(eye('senha')).toBeDisabled();
    expect(revealCalls()).toHaveLength(1);

    await act(async () => resolveReveal({ data: { value: 'fake-password-123' } }));
    await waitFor(() => expect(eye('senha')).toBeEnabled());
    expect(eye('senha')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
  });

  it('starts no reveal timer when the page unmounts with a reveal still in flight', async () => {
    const { user, unmount } = await renderLoaded({ fakeTimers: true });
    let resolveReveal: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { resolveReveal = resolve; }));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await user.click(eye('senha'));
    await waitFor(() => expect(eye('senha')).toBeDisabled());
    unmount();
    await act(async () => resolveReveal({ data: { value: 'fake-password-123' } }));

    expect(setTimeoutSpy.mock.calls.filter((call) => call[1] === 30_000)).toHaveLength(0);
  });
});


describe('VaultPage modals and load error (DMTE-545)', () => {
  const REVEAL_URL = /\/reveal$/;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    window.confirm = vi.fn(() => true);
    mockDefaultGets();
    loginAs('ADMIN');
  });

  const refusal = (message?: string) =>
    Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 400, data: message ? { message } : {} } });

  const deferred = () => {
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  async function loaded() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Servidor FTP');
    return user;
  }

  async function openNewFolder(user: ReturnType<typeof userEvent.setup>) {
    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova pasta' }));
    const dialog = screen.getByRole('dialog');
    await user.type(fieldFor(dialog, 'Nome da pasta'), 'Rede');
    return dialog;
  }

  async function openNewCredential(user: ReturnType<typeof userEvent.setup>) {
    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova senha' }));
    const dialog = screen.getByRole('dialog');
    await user.type(fieldFor(dialog, 'Nome'), 'Novo Serviço');
    await user.type(fieldFor(dialog, 'Senha'), 'fake-password-123');
    return dialog;
  }

  const save = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /^Salv/ });

  it('uses the DS modal for folder and credential, with an accessible name and a discard prompt on Esc', async () => {
    const user = await loaded();

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova pasta' }));
    const folderDialog = screen.getByRole('dialog', { name: 'Nova pasta' });
    // The DS gives the first Esc to the focused text field; leave it first so Esc reaches the modal.
    await user.click(within(folderDialog).getByText('Nova pasta'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova senha' }));
    const credentialDialog = screen.getByRole('dialog', { name: 'Nova senha' });
    expect(within(credentialDialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(credentialDialog).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
    await user.type(fieldFor(credentialDialog, 'Nome'), 'Algo digitado');
    await user.click(within(credentialDialog).getByText('Nova senha'));
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Descartar alterações?')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Nova senha' })).toBeInTheDocument();
  });

  it('keeps the modal open until the API answers, then closes it and masks the revealed values', async () => {
    const user = await loaded();
    const saving = deferred();
    vi.mocked(api.post).mockImplementation((url: string) =>
      REVEAL_URL.test(url) ? Promise.resolve({ data: { value: 'fake-password-123' } }) : (saving.promise as Promise<never>),
    );

    await user.click(screen.getByRole('button', { name: 'Revelar senha de Servidor FTP' }));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    const dialog = await openNewFolder(user);
    await user.click(save(dialog));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/vault/folders', { name: 'Rede' }));
    expect(screen.getByRole('dialog', { name: 'Nova pasta' })).toBeInTheDocument();
    expect(screen.getByText('fake-password-123')).toBeInTheDocument();

    await act(async () => saving.resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
  });

  it('disables saving while the request is in flight and ignores a second submit', async () => {
    const user = await loaded();
    const saving = deferred();
    vi.mocked(api.post).mockReturnValue(saving.promise as Promise<never>);

    const dialog = await openNewFolder(user);
    await user.click(save(dialog));

    const busy = await within(dialog).findByRole('button', { name: 'Salvando…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();

    await user.type(fieldFor(dialog, 'Nome da pasta'), '{Enter}');
    expect(api.post).toHaveBeenCalledTimes(1);

    await act(async () => saving.resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open with the typed values and an error when the API refuses (folder and credential, create and edit)', async () => {
    const cases = [
      {
        name: 'folder create',
        open: async (user: ReturnType<typeof userEvent.setup>) => openNewFolder(user),
        method: 'post' as const,
        url: '/vault/folders',
        payload: { name: 'Rede' },
        message: 'Já existe uma pasta com esse nome.',
        expected: 'Já existe uma pasta com esse nome.',
        fields: [['Nome da pasta', 'Rede']],
      },
      {
        name: 'folder edit',
        open: async (user: ReturnType<typeof userEvent.setup>) => {
          await user.click(screen.getByTestId('tree-node-f1'));
          await user.click(await screen.findByRole('button', { name: 'Editar pasta Servidores' }));
          const dialog = screen.getByRole('dialog');
          await user.type(fieldFor(dialog, 'Nome da pasta'), ' Prod');
          return dialog;
        },
        method: 'patch' as const,
        url: '/vault/folders/f1',
        payload: { name: 'Servidores Prod' },
        message: undefined,
        expected: 'Não foi possível salvar a pasta. Tente novamente.',
        fields: [['Nome da pasta', 'Servidores Prod']],
      },
      {
        name: 'credential create',
        open: async (user: ReturnType<typeof userEvent.setup>) => openNewCredential(user),
        method: 'post' as const,
        url: '/vault/credentials',
        payload: expect.objectContaining({ name: 'Novo Serviço', password: 'fake-password-123' }),
        message: undefined,
        expected: 'Não foi possível salvar a senha. Tente novamente.',
        fields: [['Nome', 'Novo Serviço'], ['Senha', 'fake-password-123']],
      },
      {
        name: 'credential edit',
        open: async (user: ReturnType<typeof userEvent.setup>) => {
          await user.click(screen.getByRole('button', { name: 'Editar Servidor FTP' }));
          const dialog = screen.getByRole('dialog');
          await user.type(fieldFor(dialog, 'Senha (deixe em branco para não alterar)'), 'fake-new-password');
          return dialog;
        },
        method: 'patch' as const,
        url: '/vault/credentials/cred-1',
        payload: expect.objectContaining({ password: 'fake-new-password' }),
        message: 'Sem permissão para alterar esta senha.',
        expected: 'Sem permissão para alterar esta senha.',
        fields: [['Senha (deixe em branco para não alterar)', 'fake-new-password']],
      },
    ];

    for (const c of cases) {
      cleanup();
      vi.clearAllMocks();
      mockDefaultGets();
      const user = await loaded();
      vi.mocked(api[c.method]).mockRejectedValueOnce(refusal(c.message));

      const dialog = await c.open(user);
      await user.click(save(dialog));

      const alert = await within(dialog).findByRole('alert');
      expect(alert, c.name).toHaveTextContent(c.expected);
      expect(screen.getByRole('dialog'), c.name).toBeInTheDocument();
      for (const [label, value] of c.fields) expect(fieldFor(dialog, label), c.name).toHaveValue(value);
      expect(save(dialog), c.name).toBeEnabled();

      vi.mocked(api[c.method]).mockResolvedValueOnce({ data: {} });
      await user.click(save(dialog));
      await waitFor(() => expect(screen.queryByRole('dialog'), c.name).not.toBeInTheDocument());
      expect(vi.mocked(api[c.method]).mock.calls.at(-1), c.name).toEqual([c.url, c.payload]);
    }
  });

  it('clears the modal error when trying again and when the modal is reopened', async () => {
    const user = await loaded();
    const retry = deferred();
    vi.mocked(api.post).mockRejectedValueOnce(refusal('Nome inválido.')).mockReturnValueOnce(retry.promise as Promise<never>);

    const dialog = await openNewFolder(user);
    await user.click(save(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nome inválido.');

    await user.click(save(dialog));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    await act(async () => retry.reject(refusal('Nome inválido de novo.')));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nome inválido de novo.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova pasta' }));
    const reopened = screen.getByRole('dialog', { name: 'Nova pasta' });
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument();
    expect(fieldFor(reopened, 'Nome da pasta')).toHaveValue('');
  });

  it('shows the error on the page when the modal was closed before the API refused', async () => {
    const user = await loaded();
    const saving = deferred();
    vi.mocked(api.post).mockReturnValue(saving.promise as Promise<never>);

    const dialog = await openNewFolder(user);
    await user.click(save(dialog));
    await within(dialog).findByRole('button', { name: 'Salvando…' });
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await act(async () => saving.reject(refusal()));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar a pasta. Tente novamente.');
  });

  it('does not close a modal by a click on the backdrop, which would drop what was typed', async () => {
    const user = await loaded();
    const backdrop = () => document.body.querySelector('.bg-gray-900\\/60') as HTMLElement;

    const folderDialog = await openNewFolder(user);
    await user.click(backdrop());
    expect(screen.getByRole('dialog', { name: 'Nova pasta' })).toBeInTheDocument();
    expect(fieldFor(folderDialog, 'Nome da pasta')).toHaveValue('Rede');
    await user.click(within(folderDialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const credentialDialog = await openNewCredential(user);
    await user.click(backdrop());
    expect(screen.getByRole('dialog', { name: 'Nova senha' })).toBeInTheDocument();
    expect(fieldFor(credentialDialog, 'Senha')).toHaveValue('fake-password-123');
  });

  it('does not touch a newer modal when an older save answers after the modal was closed', async () => {
    const user = await loaded();
    const saving = deferred();
    vi.mocked(api.post).mockImplementation((url: string) =>
      REVEAL_URL.test(url) ? Promise.resolve({ data: { value: 'fake-password-123' } }) : (saving.promise as Promise<never>),
    );

    await user.click(screen.getByRole('button', { name: 'Revelar senha de Servidor FTP' }));
    expect(await screen.findByText('fake-password-123')).toBeInTheDocument();
    const folderDialog = await openNewFolder(user);
    await user.click(save(folderDialog));
    await within(folderDialog).findByRole('button', { name: 'Salvando…' });
    await user.click(within(folderDialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Nova senha' }));
    const newer = screen.getByRole('dialog', { name: 'Nova senha' });
    expect(save(newer)).toBeEnabled();

    await act(async () => saving.resolve({ data: {} }));

    expect(screen.getByRole('dialog', { name: 'Nova senha' })).toBeInTheDocument();
    expect(save(newer)).toBeEnabled();
    expect(within(newer).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('fake-password-123')).not.toBeInTheDocument();
  });

  it('offers a retry on the load error and refetches only the failed queries', async () => {
    let foldersFail = true;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/vault/folders') {
        if (foldersFail) throw new Error('boom');
        return { data: folders };
      }
      if (url === '/vault/credentials') {
        return { data: { data: credentials, meta: { total: 2, page: 1, limit: 10, totalPages: 1 } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Erro ao carregar o cofre de senhas.')).toBeInTheDocument();
    const credentialCalls = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === '/vault/credentials').length;
    const folderCalls = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === '/vault/folders').length;
    const [credentialsBefore, foldersBefore] = [credentialCalls(), folderCalls()];

    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Erro ao carregar o cofre de senhas.')).toBeInTheDocument();
    expect(folderCalls()).toBe(foldersBefore + 1);
    expect(credentialCalls()).toBe(credentialsBefore);

    foldersFail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Servidor FTP')).toBeInTheDocument();
    expect(screen.queryByText('Erro ao carregar o cofre de senhas.')).not.toBeInTheDocument();
    expect(credentialCalls()).toBe(credentialsBefore);
  });
});
