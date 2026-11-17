import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { KnowledgePage } from './KnowledgePage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const folders = [
  { id: 'folder-1', name: 'Suporte', description: 'Artigos de suporte', icon: '🛟', _count: { articles: 2 } },
];

const articles = [
  {
    id: 'article-1',
    title: 'Como abrir um chamado',
    content: 'Clique em Novo Chamado...',
    visibility: 'PUBLIC',
    tags: ['senha', 'ajuda'],
    author: { id: 'u-1', name: 'Fulano' },
    updatedAt: '2026-01-10T10:00:00.000Z',
    attachments: [
      {
        id: 'att-1',
        originalName: 'manual.pdf',
        mimeType: 'application/pdf',
        fileUrl: '/uploads/manual.pdf',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    id: 'article-2',
    title: 'Artigo interno',
    content: 'Segredo de suporte',
    visibility: 'PRIVATE',
    tags: ['interno'],
    author: { id: 'u-2', name: 'Ciclana' },
    updatedAt: '2026-02-20T10:00:00.000Z',
    attachments: [],
  }
];

// DMTE-88 (Stage 2): fonte do diálogo "Compartilhar" (grupos de atendentes
// por cliente) e do multi-select "Catálogo de serviços".
const organizations = [
  {
    id: 'org-1',
    name: 'Cliente A',
    agentGroups: [{ id: 'group-1', name: 'Suporte N1', active: true }],
  },
  {
    id: 'org-2',
    name: 'Cliente B',
    agentGroups: [],
  },
];

const catalogItems = [{ id: 'cat-1', name: 'Treinamento', description: null }];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith('/knowledge-folders')) {
      return Promise.resolve({ data: folders });
    }
    if (url.startsWith('/articles')) {
      return Promise.resolve({ data: articles });
    }
    if (url.startsWith('/organizations')) {
      return Promise.resolve({ data: organizations });
    }
    if (url.startsWith('/service-catalog-items')) {
      return Promise.resolve({ data: catalogItems });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/knowledge']}>
        <Routes>
          <Route path="/knowledge" element={<KnowledgePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginAs(role: 'ADMIN' | 'AGENT' | 'CLIENT' | 'anonymous') {
  if (role === 'anonymous') {
    useAuthStore.setState({ token: null, user: null });
    return;
  }
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub: 'u-1', email: 'user@aponta.com', role },
  });
}

/** Navigates past the folders grid into the article list of "Suporte". */
async function openSupportFolder(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByText('Suporte')).toBeInTheDocument();
  });
  await user.click(screen.getByText('Suporte'));
  await waitFor(() => {
    expect(screen.getByText('Como abrir um chamado')).toBeInTheDocument();
  });
}

describe('KnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet();
    useAuthStore.setState({ token: null, user: null });
    window.scrollTo = vi.fn();
    window.confirm = vi.fn(() => true);
  });

  it('shows the folders grid first, not the article list', async () => {
    loginAs('anonymous');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Suporte')).toBeInTheDocument();
    });

    expect(screen.queryByText('Como abrir um chamado')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/knowledge-folders');
  });

  it('opens a folder and lists only its articles, filtered by folderId', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(api.get).toHaveBeenCalledWith('/articles?folderId=folder-1');
  });

  it('shows a breadcrumb back to the folders grid once inside a folder', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.getByText('Pastas')).toBeInTheDocument();
    expect(screen.getByText('Suporte')).toBeInTheDocument();

    await user.click(screen.getByText('Pastas'));

    await waitFor(() => {
      expect(screen.queryByText('Como abrir um chamado')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Suporte')).toBeInTheDocument();
  });

  it('does not show the new-article form or edit/delete buttons to a CLIENT', async () => {
    loginAs('CLIENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.queryByRole('button', { name: /\+ novo artigo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument();
  });

  it('shows the Interno badge only for a PRIVATE article (visibility-based, not the old isPublic)', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.getAllByText('Interno')).toHaveLength(1);
  });

  it('defaults a new article to "Público" and hides the Compartilhar button', async () => {
    loginAs('AGENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    await user.click(screen.getByRole('button', { name: /\+ novo artigo/i }));

    expect(screen.getByLabelText(/tipo de acesso/i, { selector: 'select' })).toHaveValue('PUBLIC');
    expect(screen.queryByRole('button', { name: /compartilhar/i })).not.toBeInTheDocument();
  });

  it('shows the Compartilhar button once "Privado" is selected, and opens the sharing dialog', async () => {
    loginAs('AGENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    await user.click(screen.getByRole('button', { name: /\+ novo artigo/i }));
    fireEvent.change(screen.getByLabelText(/tipo de acesso/i, { selector: 'select' }), { target: { value: 'PRIVATE' } });

    await user.click(screen.getByRole('button', { name: /compartilhar/i }));

    await waitFor(() => {
      expect(screen.getByText('Compartilhar artigo')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/grupos de atendentes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^clientes$/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /adicionar novos clientes automaticamente/i }),
    ).toBeInTheDocument();
  });

  it('shows the new-article form to an AGENT and creates a PUBLIC article inside the open folder', async () => {
    loginAs('AGENT');
    vi.mocked(api.post).mockResolvedValue({
      data: { id: 'article-3', title: 'Novo artigo' },
    });
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    await user.click(screen.getByRole('button', { name: /\+ novo artigo/i }));
    await user.type(screen.getByLabelText(/título/i), 'Novo artigo interno');

    // EzRichText renders a Tiptap contenteditable surface, not a labelled
    // native textarea — jsdom also can't simulate real keystrokes inside it
    // (see EzRichText.test.tsx's file-level note), so we set its HTML
    // directly and dispatch the input event Tiptap listens for, same
    // pattern as TicketForm.test.tsx.
    const editable = screen
      .getByTestId('article-content-editor')
      .querySelector('[contenteditable="true"]') as HTMLElement;
    editable.innerHTML = '<p>Conteúdo do artigo</p>';
    editable.dispatchEvent(new Event('input', { bubbles: true }));

    await user.type(screen.getByLabelText(/tags/i), 'tag1, tag2');

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/articles', {
        title: 'Novo artigo interno',
        content: '<p>Conteúdo do artigo</p>',
        visibility: 'PUBLIC',
        tags: ['tag1', 'tag2'],
        agentGroupIds: [],
        organizationIds: [],
        autoShareWithNewOrganizations: false,
        serviceCatalogItemIds: [],
        folderId: 'folder-1',
      });
    });
  }, 20000);

  it('selects an agent group and a client in the share dialog, and sends them (plus auto-share) in the create payload', async () => {
    loginAs('AGENT');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'article-3' } });
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    await user.click(screen.getByRole('button', { name: /\+ novo artigo/i }));
    await user.type(screen.getByLabelText(/título/i), 'Artigo privado');

    // EzRichText renders a Tiptap contenteditable surface, not a labelled
    // native textarea — see the "creates a PUBLIC article" test above for
    // why this sets innerHTML directly instead of using user.type().
    const editable = screen
      .getByTestId('article-content-editor')
      .querySelector('[contenteditable="true"]') as HTMLElement;
    editable.innerHTML = '<p>Conteúdo restrito</p>';
    editable.dispatchEvent(new Event('input', { bubbles: true }));

    fireEvent.change(screen.getByLabelText(/tipo de acesso/i, { selector: 'select' }), { target: { value: 'PRIVATE' } });
    await user.click(screen.getByRole('button', { name: /compartilhar/i }));

    await waitFor(() => {
      expect(screen.getByText('Compartilhar artigo')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/grupos de atendentes/i));
    await waitFor(() => {
      expect(screen.getByText('Cliente A / Suporte N1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Cliente A / Suporte N1'));

    await user.click(screen.getByLabelText(/^clientes$/i));
    await waitFor(() => {
      expect(screen.getByText('Cliente B')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Cliente B'));

    await user.click(
      screen.getByRole('checkbox', { name: /adicionar novos clientes automaticamente/i }),
    );

    await user.click(screen.getByRole('button', { name: /concluído/i }));
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/articles', {
        title: 'Artigo privado',
        content: '<p>Conteúdo restrito</p>',
        visibility: 'PRIVATE',
        tags: [],
        agentGroupIds: ['group-1'],
        organizationIds: ['org-2'],
        autoShareWithNewOrganizations: true,
        serviceCatalogItemIds: [],
        folderId: 'folder-1',
      });
    });
  }, 20000);

  it('allows an AGENT to update an existing article, pre-populating the access type and sharing lists', async () => {
    loginAs('AGENT');
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    // click raw Edit, since there are two we target the first one
    const editBtns = screen.getAllByRole('button', { name: /editar/i });
    await user.click(editBtns[0]);

    // form must be prepopulated
    expect(screen.getByLabelText(/título/i)).toHaveValue('Como abrir um chamado');
    expect(screen.getByLabelText(/tags/i)).toHaveValue('senha, ajuda');
    expect(screen.getByLabelText(/tipo de acesso/i, { selector: 'select' })).toHaveValue('PUBLIC');

    // edit title
    await user.clear(screen.getByLabelText(/título/i));
    await user.type(screen.getByLabelText(/título/i), 'Título modificado');

    await user.click(screen.getByRole('button', { name: /atualizar/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/articles/article-1', {
        title: 'Título modificado',
        content: 'Clique em Novo Chamado...',
        visibility: 'PUBLIC',
        tags: ['senha', 'ajuda'],
        agentGroupIds: [],
        organizationIds: [],
        autoShareWithNewOrganizations: false,
        serviceCatalogItemIds: [],
      });
    });
  });

  it('allows filtering by search keyword and tag inside a folder', async () => {
    loginAs('CLIENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    // type in search bar
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'senha' } });

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls;
      expect(calls.some(call => call[0] === '/articles?search=senha&folderId=folder-1')).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTitle('Filtrar por senha')).toBeInTheDocument();
    });

    const tagButton = screen.getByTitle('Filtrar por senha');
    await user.click(tagButton);

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls;
      expect(calls.some(call => call[0] === '/articles?search=senha&tags=senha&folderId=folder-1')).toBe(true);
    });
  });

  it('allows selecting more than one tag at once (OR filter)', async () => {
    loginAs('CLIENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    await user.click(screen.getByTitle('Filtrar por senha'));
    await user.click(screen.getByTitle('Filtrar por ajuda'));

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls;
      expect(calls.some(call => call[0] === '/articles?tags=senha%2Cajuda&folderId=folder-1')).toBe(true);
    });

    // removing one of the active tag chips drops it from the filter
    await user.click(screen.getByLabelText('Remover filtro de tag senha'));

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls;
      expect(calls.some(call => call[0] === '/articles?tags=ajuda&folderId=folder-1')).toBe(true);
    });
  });

  it('shows the author and last-updated date on each article', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.getByText(/Por Fulano/)).toBeInTheDocument();
    expect(screen.getByText(/Por Ciclana/)).toBeInTheDocument();
  });

  it('sends the chosen sort order to the API', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    fireEvent.change(screen.getByLabelText('Ordenar por', { selector: 'select' }), { target: { value: 'title_asc' } });

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls;
      expect(calls.some(call => call[0] === '/articles?sort=title_asc&folderId=folder-1')).toBe(true);
    });
  });

  it('toggles between list and grid view modes', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.getByTestId('knowledge-articles')).toHaveAttribute('data-view-mode', 'list');

    await user.click(screen.getByLabelText('Exibir em grade'));
    expect(screen.getByTestId('knowledge-articles')).toHaveAttribute('data-view-mode', 'grid');

    await user.click(screen.getByLabelText('Exibir em lista'));
    expect(screen.getByTestId('knowledge-articles')).toHaveAttribute('data-view-mode', 'list');
  });

  it('paginates articles beyond the first page', async () => {
    const manyArticles = Array.from({ length: 12 }, (_, i) => ({
      id: `extra-${i}`,
      title: `Artigo ${i}`,
      content: 'Conteúdo',
      visibility: 'PUBLIC',
      tags: [],
      author: { id: 'u-1', name: 'Fulano' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge-folders')) {
        return Promise.resolve({ data: folders });
      }
      if (url.startsWith('/articles')) {
        return Promise.resolve({ data: manyArticles });
      }
      if (url.startsWith('/organizations')) {
        return Promise.resolve({ data: organizations });
      }
      if (url.startsWith('/service-catalog-items')) {
        return Promise.resolve({ data: catalogItems });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Suporte')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Suporte'));

    await waitFor(() => {
      expect(screen.getByText('Artigo 0')).toBeInTheDocument();
    });

    expect(screen.queryByText('Artigo 11')).not.toBeInTheDocument();
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /próxima/i }));

    expect(screen.getByText('Artigo 11')).toBeInTheDocument();
    expect(screen.queryByText('Artigo 0')).not.toBeInTheDocument();
  });

  it('allows deleting an article', async () => {
    loginAs('ADMIN');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    const deleteBtns = screen.getAllByRole('button', { name: /excluir/i });
    await user.click(deleteBtns[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Excluir artigo')).toBeInTheDocument();
    expect(within(dialog).getByText('Excluir o artigo "Como abrir um chamado"?')).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/articles/article-1');
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders article content as real HTML, not escaped text', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/knowledge-folders')) return Promise.resolve({ data: folders });
      if (url.startsWith('/articles')) {
        return Promise.resolve({
          data: [
            {
              id: 'article-html',
              title: 'Artigo com HTML',
              content: '<p>Veja o <strong>passo a passo</strong> abaixo.</p>',
              visibility: 'PUBLIC',
              tags: [],
              attachments: [],
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Suporte')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Suporte'));
    await waitFor(() => {
      expect(screen.getByText('Artigo com HTML')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /ler artigo completo/i }));

    const strong = screen.getByText('passo a passo');
    expect(strong.tagName).toBe('STRONG');
    // The sanitized markup renders as actual DOM nodes, not literal text.
    expect(screen.queryByText(/<strong>/)).not.toBeInTheDocument();
  });

  it('shows the attachment count only for articles that have attachments, and the links once expanded', async () => {
    loginAs('anonymous');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.getByText('1 anexo')).toBeInTheDocument();
    expect(screen.queryByText(/Anexos \(/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manual\.pdf/i })).not.toBeInTheDocument();

    const card = screen.getByRole('heading', { name: 'Como abrir um chamado' }).closest('article')!;
    await user.click(within(card).getByRole('button', { name: /ler artigo completo/i }));

    expect(within(card).getByRole('link', { name: /manual\.pdf/i })).toHaveAttribute(
      'href',
      '/uploads/manual.pdf',
    );
  });

  it('never shows attachment upload controls to a CLIENT, not even when the card is expanded', async () => {
    loginAs('CLIENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);
    for (const toggle of screen.getAllByRole('button', { name: /ler artigo completo/i })) {
      await user.click(toggle);
    }

    expect(screen.queryAllByText('Selecionar arquivo')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /remover/i })).not.toBeInTheDocument();
  });

  it('keeps upload and remove out of the cards and manages attachments inside the edit form', async () => {
    loginAs('AGENT');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    expect(screen.queryAllByText('Selecionar arquivo')).toHaveLength(0);
    for (const toggle of screen.getAllByRole('button', { name: /ler artigo completo/i })) {
      await user.click(toggle);
    }
    expect(screen.queryAllByText('Selecionar arquivo')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /remover/i })).not.toBeInTheDocument();

    const card = screen.getByRole('heading', { name: 'Como abrir um chamado' }).closest('article')!;
    await user.click(within(card).getByRole('button', { name: /editar/i }));

    expect(screen.getAllByText('Selecionar arquivo')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /remover/i }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/articles/article-1/attachments/att-1');
    });
  });

  it('shows no attachment manager in the new-article form', async () => {
    loginAs('AGENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);
    await user.click(screen.getByRole('button', { name: '+ Novo artigo' }));

    expect(screen.getByLabelText(/título/i)).toBeInTheDocument();
    expect(screen.queryByText('Selecionar arquivo')).not.toBeInTheDocument();
  });

  it('loads the edit form with EzRichText pre-filled with the existing article content', async () => {
    loginAs('AGENT');
    const user = userEvent.setup();
    renderPage();

    await openSupportFolder(user);

    const editBtns = screen.getAllByRole('button', { name: /editar/i });
    await user.click(editBtns[0]);

    const editable = screen
      .getByTestId('article-content-editor')
      .querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable).toBeTruthy();
    await waitFor(() => {
      expect(editable).toHaveTextContent('Clique em Novo Chamado...');
    });
  });

  // DMTE-537: o `return` antecipado por `isLoading` trocava a página inteira
  // pelo spinner a cada nova queryKey, desmontando o campo de busca no meio da
  // digitação. Estes casos usam uma API lenta (o mock imediato dos demais
  // testes esconde o defeito).
  describe('with a slow articles API', () => {
    function mockSlowArticles() {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.startsWith('/articles')) {
          return new Promise((resolve) => setTimeout(() => resolve({ data: articles }), 150));
        }
        if (url.startsWith('/knowledge-folders')) {
          return Promise.resolve({ data: folders });
        }
        return Promise.resolve({ data: [] });
      });
    }

    it('keeps the search field mounted, with its text and focus, while typing against a slow API', async () => {
      loginAs('CLIENT');
      const user = userEvent.setup({ delay: 20 });
      renderPage();
      await openSupportFolder(user);
      mockSlowArticles();

      const searchBox = screen.getByRole('searchbox');
      await user.click(searchBox);
      await user.type(searchBox, 'senha');

      expect(screen.queryByRole('searchbox')).toBe(searchBox);
      expect(searchBox).toHaveValue('senha');
      expect(searchBox).toHaveFocus();
    });

    it('keeps the header and shows the loading state only in the list area while a folder opens', async () => {
      loginAs('CLIENT');
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Suporte')).toBeInTheDocument();
      });
      mockSlowArticles();
      await user.click(screen.getByText('Suporte'));

      expect(await screen.findByText('Carregando artigos...')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Base de Conhecimento (FAQ)' })).toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).toBeInTheDocument();
      expect(screen.queryByLabelText('Ordenar por', { selector: 'select' })).toBeInTheDocument();
      expect(screen.queryByText('Como abrir um chamado')).not.toBeInTheDocument();
      expect(screen.queryByText('Nenhum artigo encontrado para a busca atual.')).not.toBeInTheDocument();

      expect(await screen.findByText('Como abrir um chamado')).toBeInTheDocument();
      expect(screen.queryByText('Carregando artigos...')).not.toBeInTheDocument();
    });

    it('sends the full typed search to the API and lists the result of that query', async () => {
      loginAs('CLIENT');
      const user = userEvent.setup({ delay: 20 });
      renderPage();
      await openSupportFolder(user);
      mockSlowArticles();

      await user.type(screen.getByRole('searchbox'), 'senha');

      await waitFor(() => {
        const urls = vi.mocked(api.get).mock.calls.map((call) => call[0]);
        expect(urls).toContain('/articles?search=senha&folderId=folder-1');
      });
      expect(await screen.findByText('Como abrir um chamado')).toBeInTheDocument();
      expect(screen.getByRole('searchbox')).toHaveValue('senha');
    });
  });

  // DMTE-534: card resumido, expansão, cabeçalho e estados vazios.
  describe('article card, header and empty states', () => {
    function mockArticles(list: unknown[] | ((url: string) => unknown[] | Promise<never>)) {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.startsWith('/knowledge-folders')) return Promise.resolve({ data: folders });
        if (url.startsWith('/articles')) {
          const result = typeof list === 'function' ? list(url) : list;
          return result instanceof Promise ? result : Promise.resolve({ data: result });
        }
        if (url.startsWith('/organizations') || url.startsWith('/service-catalog-items')) {
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });
    }

    const richArticle = {
      id: 'article-rich',
      title: 'Artigo rico',
      content: '<h2>Passo a passo</h2><p>Primeiro passo</p><ol><li>um</li><li>dois</li></ol>',
      visibility: 'PUBLIC',
      tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'],
      author: { id: 'u-1', name: 'Fulano' },
      updatedAt: '2026-01-10T10:00:00.000Z',
      attachments: [],
    };

    function cardOf(title: string) {
      return screen.getByRole('heading', { name: title }).closest('article')!;
    }

    it('collapses the card to title, meta, a plain-text excerpt, five tags and the attachment count', async () => {
      mockArticles([richArticle, articles[0]]);
      loginAs('AGENT');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder(user);

      const card = cardOf('Artigo rico');
      expect(within(card).getByText('Passo a passo Primeiro passo um dois')).toBeInTheDocument();
      expect(card.querySelector('.article-content')).toBeNull();
      expect(within(card).queryByRole('listitem')).not.toBeInTheDocument();
      for (const tag of ['#t1', '#t2', '#t3', '#t4', '#t5']) {
        expect(within(card).getByText(tag)).toBeInTheDocument();
      }
      expect(within(card).queryByText('#t6')).not.toBeInTheDocument();
      expect(within(card).getByText('+2')).toBeInTheDocument();
      expect(within(card).queryByText(/anexo/i)).not.toBeInTheDocument();
      expect(within(card).queryByText(/Anexos \(/)).not.toBeInTheDocument();

      expect(within(cardOf('Como abrir um chamado')).getByText('1 anexo')).toBeInTheDocument();
    });

    it('expands and collapses the card, revealing the full body, every tag and the attachments', async () => {
      mockArticles([
        { ...richArticle, attachments: articles[0].attachments },
      ]);
      loginAs('anonymous');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder_(user, 'Artigo rico');

      const card = cardOf('Artigo rico');
      const toggle = within(card).getByRole('button', { name: /ler artigo completo/i });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);

      const expanded = within(card).getByRole('button', { name: /recolher/i });
      expect(expanded).toHaveAttribute('aria-expanded', 'true');
      const body = card.querySelector(`#${expanded.getAttribute('aria-controls')}`)!;
      expect(body).toHaveClass('article-content');
      expect(within(body as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
      expect(within(card).getByText('#t6')).toBeInTheDocument();
      expect(within(card).getByText('#t7')).toBeInTheDocument();
      expect(within(card).getByRole('link', { name: /manual\.pdf/i })).toBeInTheDocument();

      await user.click(expanded);

      expect(within(card).getByRole('button', { name: /ler artigo completo/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(card.querySelector('.article-content')).toBeNull();
      expect(within(card).queryByText('#t6')).not.toBeInTheDocument();
    });

    it('offers no expand button when nothing is hidden', async () => {
      mockArticles([
        { id: 'a-empty', title: 'Só título', content: '', visibility: 'PUBLIC', tags: ['x'], attachments: [] },
      ]);
      loginAs('anonymous');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder_(user, 'Só título');

      expect(screen.queryByRole('button', { name: /ler artigo completo/i })).not.toBeInTheDocument();
    });

    it('offers no expand button when the body is only empty markup', async () => {
      mockArticles([
        { id: 'a-markup', title: 'Corpo vazio', content: '<p></p>', visibility: 'PUBLIC', tags: ['x'], attachments: [] },
        {
          id: 'a-image',
          title: 'Só imagem',
          content: '<p><img src="/uploads/a.png" alt="Captura"></p>',
          visibility: 'PUBLIC',
          tags: [],
          attachments: [],
        },
      ]);
      loginAs('anonymous');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder_(user, 'Corpo vazio');

      expect(within(cardOf('Corpo vazio')).queryByRole('button', { name: /ler artigo completo/i })).not.toBeInTheDocument();
      expect(within(cardOf('Só imagem')).getByRole('button', { name: /ler artigo completo/i })).toBeInTheDocument();
    });

    it('keeps the title on its own line, with the tag, meta and actions outside its row', async () => {
      loginAs('ADMIN');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder(user);

      const heading = screen.getByRole('heading', { name: 'Artigo interno' });
      const card = cardOf('Artigo interno');
      expect(heading.parentElement).not.toContainElement(within(card).getByText('Interno'));
      expect(heading.parentElement).not.toContainElement(within(card).getByRole('button', { name: /editar/i }));
      expect(heading.parentElement).not.toContainElement(within(card).getByRole('button', { name: /excluir/i }));
      expect(within(card).getByRole('button', { name: /editar/i }).parentElement).toHaveClass('flex-wrap');
    });

    it('puts the active tag filters in their own row, apart from the search and the new-article button', async () => {
      loginAs('AGENT');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder(user);

      await user.click(within(cardOf('Como abrir um chamado')).getByText('#senha'));

      const chip = await screen.findByText('Tag: senha');
      const filters = screen.getByTestId('knowledge-active-filters');
      expect(filters).toContainElement(chip);
      expect(filters).toHaveClass('flex-wrap');
      expect(chip.closest('div')).toHaveClass('whitespace-nowrap');
      expect(filters).not.toContainElement(screen.getByRole('searchbox'));
      expect(filters).not.toContainElement(screen.getByRole('button', { name: '+ Novo artigo' }));
    });

    it('tells an empty folder apart from a search, offering to create the first article to authors', async () => {
      mockArticles([]);
      loginAs('AGENT');
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('Suporte')).toBeInTheDocument());
      await user.click(screen.getByText('Suporte'));

      expect(await screen.findByText('Esta pasta ainda não tem artigos.')).toBeInTheDocument();
      expect(screen.queryByText('Nenhum artigo encontrado para a busca atual.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Limpar busca e filtros' })).not.toBeInTheDocument();

      const buttons = screen.getAllByRole('button', { name: '+ Novo artigo' });
      expect(buttons).toHaveLength(2);
      await user.click(buttons[1]);
      expect(screen.getByLabelText(/título/i)).toBeInTheDocument();
      // O botão do cabeçalho fica na tela, desabilitado; o do estado vazio sai.
      const remaining = screen.getAllByRole('button', { name: '+ Novo artigo' });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBeDisabled();
    });

    it('shows readers an empty folder without a create action', async () => {
      mockArticles([]);
      loginAs('CLIENT');
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('Suporte')).toBeInTheDocument());
      await user.click(screen.getByText('Suporte'));

      expect(await screen.findByText('Esta pasta ainda não tem artigos.')).toBeInTheDocument();
      expect(screen.getByText('Quando houver artigos, eles aparecem aqui.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Novo artigo' })).not.toBeInTheDocument();
    });

    it('offers "Limpar busca e filtros" when a search finds nothing, and clearing resets search and tags but keeps the sort', async () => {
      mockArticles((url) => (url.includes('search=') || url.includes('tags=') ? [] : articles));
      loginAs('CLIENT');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder(user);

      await user.selectOptions(screen.getByLabelText('Ordenar por', { selector: 'select' }), 'title_asc');
      await user.type(screen.getByRole('searchbox'), 'zzz');

      expect(await screen.findByText('Nenhum artigo encontrado para a busca atual.')).toBeInTheDocument();
      expect(screen.queryByText('Esta pasta ainda não tem artigos.')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Limpar busca e filtros' }));

      expect(screen.getByRole('searchbox')).toHaveValue('');
      expect(screen.getByRole('searchbox')).toHaveFocus();
      expect(await screen.findByText('Como abrir um chamado')).toBeInTheDocument();
      const urls = vi.mocked(api.get).mock.calls.map((call) => call[0] as string);
      const last = urls.filter((u) => u.startsWith('/articles')).at(-1)!;
      expect(last).not.toContain('search=');
      expect(last).not.toContain('tags=');
      expect(last).toContain('sort=title_asc');
    });

    it('also offers to clear when only a tag filter finds nothing', async () => {
      mockArticles((url) => (url.includes('tags=') ? [] : articles));
      loginAs('CLIENT');
      const user = userEvent.setup();
      renderPage();
      await openSupportFolder(user);

      await user.click(within(cardOf('Como abrir um chamado')).getByText('#senha'));

      expect(await screen.findByText('Nenhum artigo encontrado para a busca atual.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Limpar busca e filtros' }));
      expect(screen.queryByText('Tag: senha')).not.toBeInTheDocument();
      expect(await screen.findByText('Como abrir um chamado')).toBeInTheDocument();
    });

    it('shows a retryable error, not the empty message, when the query fails', async () => {
      let fail = true;
      mockArticles(() => (fail ? Promise.reject(new Error('boom')) : articles));
      loginAs('CLIENT');
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('Suporte')).toBeInTheDocument());
      await user.click(screen.getByText('Suporte'));

      expect(await screen.findByText('Não foi possível carregar os artigos.')).toBeInTheDocument();
      expect(screen.queryByText(/Nenhum artigo encontrado/)).not.toBeInTheDocument();
      expect(screen.queryByText('Esta pasta ainda não tem artigos.')).not.toBeInTheDocument();

      fail = false;
      await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByText('Como abrir um chamado')).toBeInTheDocument();
      expect(screen.queryByText('Não foi possível carregar os artigos.')).not.toBeInTheDocument();
    });

    describe('when the refresh fails with a cached list (DMTE-548)', () => {
      const STALE = /Não foi possível atualizar os artigos/;

      async function openFolderThenFailRefresh() {
        let fail = false;
        mockArticles(() => (fail ? Promise.reject(new Error('boom')) : articles));
        loginAs('CLIENT');
        const user = userEvent.setup();
        renderPage();
        await waitFor(() => expect(screen.getByText('Suporte')).toBeInTheDocument());
        await user.click(screen.getByText('Suporte'));
        expect(await screen.findByText('Como abrir um chamado')).toBeInTheDocument();

        fail = true;
        // Volta de foco da janela: o refetch real do React Query, com a mesma chave.
        fireEvent(window, new Event('visibilitychange'));
        const alert = await screen.findByRole('alert');
        return { user, alert, restore: () => (fail = false) };
      }

      it('keeps the cached list under a stale-list warning when a refetch fails', async () => {
        const { alert } = await openFolderThenFailRefresh();

        expect(alert).toHaveTextContent(STALE);
        expect(alert).toHaveTextContent(/pode estar desatualizada/);
        expect(within(alert).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
        expect(screen.getByText('Como abrir um chamado')).toBeInTheDocument();
        expect(screen.queryByText('Não foi possível carregar os artigos.')).not.toBeInTheDocument();
        const list = screen.getByTestId('knowledge-articles');
        expect(
          alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      it('replaces the list and drops the warning when "Tentar novamente" succeeds', async () => {
        const { user, alert, restore } = await openFolderThenFailRefresh();
        restore();

        await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));

        await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText('Como abrir um chamado')).toBeInTheDocument();
      });
    });

    describe('proportion, focus and color semantics (DMTE-535)', () => {
      const tagged = {
        id: 'article-tagged',
        title: 'Artigo com tags',
        content: '<p>Corpo do artigo</p>',
        visibility: 'PRIVATE',
        tags: ['senha', 'ajuda'],
        author: { id: 'u-1', name: 'Fulano' },
        updatedAt: '2026-01-10T10:00:00.000Z',
        attachments: [],
      };

      async function openAs(role: 'ADMIN' | 'CLIENT', list: unknown[] = [tagged]) {
        mockArticles(list);
        loginAs(role);
        const user = userEvent.setup();
        renderPage();
        await waitFor(() => expect(screen.getByText('Suporte')).toBeInTheDocument());
        await user.click(screen.getByText('Suporte'));
        await waitFor(() => expect(screen.getByText(String((list[0] as { title: string }).title))).toBeInTheDocument());
        return user;
      }

      it('keeps the header and sort rows on the control height token, with no loose radius', async () => {
        await openAs('ADMIN');

        expect(screen.getByRole('button', { name: '+ Novo artigo' })).toHaveClass('h-[42px]');
        const toggle = screen.getByRole('button', { name: 'Exibir em lista' }).parentElement!;
        expect(toggle).toHaveClass('h-[var(--control-height-md)]', 'rounded-control');
        expect(toggle.className).not.toMatch(/rounded-\[/);
        for (const name of ['Exibir em lista', 'Exibir em grade']) {
          expect(screen.getByRole('button', { name }).className).not.toMatch(/rounded-\[/);
        }
      });

      it('keeps the Compartilhar button at the height of the access combo', async () => {
        const user = await openAs('ADMIN');
        await user.click(screen.getByRole('button', { name: '+ Novo artigo' }));
        fireEvent.change(screen.getByLabelText(/tipo de acesso/i, { selector: 'select' }), { target: { value: 'PRIVATE' } });

        expect(screen.getByRole('button', { name: 'Compartilhar' })).toHaveClass('h-[42px]');
      });

      it('aligns the card text actions with the card content, without the DS side padding', async () => {
        await openAs('ADMIN');
        const card = cardOf('Artigo com tags');

        for (const name of ['Ler artigo completo', 'Editar', 'Excluir']) {
          expect(within(card).getByRole('button', { name })).toHaveClass('px-0');
        }
      });

      it('uses the legible primary on the primary actions of the screen', async () => {
        const user = await openAs('ADMIN');
        const primary = ['bg-brand-600', 'border-brand-600'];
        expect(screen.getByRole('button', { name: '+ Novo artigo' })).toHaveClass(...primary);

        await user.click(screen.getByRole('button', { name: '+ Novo artigo' }));
        expect(screen.getByRole('button', { name: 'Salvar' })).toHaveClass(...primary);
        await user.click(screen.getByRole('button', { name: '+ Novo item de catálogo' }));
        expect(screen.getByRole('button', { name: 'Adicionar' })).toHaveClass(...primary);
      });

      it('gives the clickable tag, the filter remove button and the view toggles the DS focus ring', async () => {
        const user = await openAs('ADMIN');
        const ring = ['focus-visible:ring-4', 'focus-visible:ring-brand-200', 'focus-visible:ring-offset-2'];
        const card = cardOf('Artigo com tags');

        const tag = within(card).getByRole('button', { name: /#senha/ });
        expect(tag).toHaveClass('rounded-full', ...ring);
        for (const name of ['Exibir em lista', 'Exibir em grade']) {
          expect(screen.getByRole('button', { name })).toHaveClass(...ring);
        }

        await user.click(tag);
        expect(screen.getByLabelText('Remover filtro de tag senha')).toHaveClass('rounded-full', ...ring);
      });

      it('marks the active tag filter with aria-pressed and a decorative check, not only a color', async () => {
        const user = await openAs('ADMIN');
        // A lista remonta quando o filtro muda: busca o card de novo a cada leitura.
        const tag = (name: RegExp) => within(cardOf('Artigo com tags')).getByRole('button', { name });

        expect(tag(/#senha/)).toHaveAttribute('aria-pressed', 'false');
        expect(tag(/#senha/).querySelector('svg')).toBeNull();

        await user.click(tag(/#senha/));
        await waitFor(() => expect(tag(/#senha/)).toHaveAttribute('aria-pressed', 'true'));
        expect(tag(/#senha/).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(tag(/#ajuda/)).toHaveAttribute('aria-pressed', 'false');
      });

      it('shows Interno as a classification (petroleum with a lock), not as a yellow alert', async () => {
        await openAs('ADMIN');
        const tag = within(cardOf('Artigo com tags')).getByText('Interno').closest('div')!;

        expect(tag).toHaveClass('bg-petroleum-100');
        expect(tag.className).not.toMatch(/yellow/);
        expect(tag.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      });

      it('keeps "+ Novo artigo" on screen, disabled, while the form is open, and focuses the title', async () => {
        const user = await openAs('ADMIN');

        await user.click(screen.getByRole('button', { name: '+ Novo artigo' }));
        const button = screen.getByRole('button', { name: '+ Novo artigo' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'O formulário de artigo já está aberto.');
        expect(screen.getByLabelText(/título/i)).toHaveFocus();

        await user.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(screen.getByRole('button', { name: '+ Novo artigo' })).toBeEnabled();
      });

      it('focuses the title when the edit form opens from a card', async () => {
        const user = await openAs('ADMIN');

        await user.click(within(cardOf('Artigo com tags')).getByRole('button', { name: 'Editar' }));

        expect(screen.getByLabelText(/título/i)).toHaveFocus();
      });

      it('aligns "+ Novo item de catálogo" to the start of the form as a DS tertiary button', async () => {
        const user = await openAs('ADMIN');
        await user.click(screen.getByRole('button', { name: '+ Novo artigo' }));

        expect(screen.getByRole('button', { name: '+ Novo item de catálogo' })).toHaveClass('self-start', 'px-0');
      });

      it('asks for confirmation in a dialog before deleting, and cancel or Escape keep the article', async () => {
        vi.mocked(api.delete).mockResolvedValue({ data: {} });
        const user = await openAs('ADMIN');

        await user.click(within(cardOf('Artigo com tags')).getByRole('button', { name: 'Excluir' }));
        let dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await user.click(within(cardOf('Artigo com tags')).getByRole('button', { name: 'Excluir' }));
        dialog = await screen.findByRole('dialog');
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        expect(api.delete).not.toHaveBeenCalled();
        expect(window.confirm).not.toHaveBeenCalled();
      });
    });

    async function openSupportFolder_(user: ReturnType<typeof userEvent.setup>, title: string) {
      await waitFor(() => expect(screen.getByText('Suporte')).toBeInTheDocument());
      await user.click(screen.getByText('Suporte'));
      await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
    }
  });
});
