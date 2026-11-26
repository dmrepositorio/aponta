import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { KnowledgeFoldersGrid } from './KnowledgeFoldersGrid';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const folders = [
  { id: 'folder-1', name: 'Financeiro', description: 'Notas fiscais', icon: '💰', _count: { articles: 3 } },
  { id: 'folder-2', name: 'TI', description: null, icon: '💻', _count: { articles: 0 } },
];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith('/knowledge-folders')) {
      return Promise.resolve({ data: folders });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function renderGrid(props: Partial<React.ComponentProps<typeof KnowledgeFoldersGrid>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeFoldersGrid onOpenFolder={vi.fn()} canAuthor={false} {...props} />
    </QueryClientProvider>,
  );
}

describe('KnowledgeFoldersGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet();
    window.confirm = vi.fn(() => true);
  });

  it('renders folders fetched from the API with their article count', async () => {
    renderGrid();

    await waitFor(() => {
      expect(screen.getByText('Financeiro')).toBeInTheDocument();
    });

    expect(screen.getByText('TI')).toBeInTheDocument();
    expect(screen.getByText('3 artigos')).toBeInTheDocument();
    expect(screen.getByText('0 artigos')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/knowledge-folders');
  });

  it('calls onOpenFolder when a folder card is clicked', async () => {
    const onOpenFolder = vi.fn();
    const user = userEvent.setup();
    renderGrid({ onOpenFolder });

    await waitFor(() => {
      expect(screen.getByText('Financeiro')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Financeiro'));

    expect(onOpenFolder).toHaveBeenCalledWith('folder-1');
  });

  it('does not show the "+ Nova pasta" button when the user cannot author', async () => {
    renderGrid({ canAuthor: false });

    await waitFor(() => {
      expect(screen.getByText('Financeiro')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /\+ nova pasta/i })).not.toBeInTheDocument();
  });

  it('allows a canAuthor user to create a new folder', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'folder-3' } });
    const user = userEvent.setup();
    renderGrid({ canAuthor: true });

    await waitFor(() => {
      expect(screen.getByText('Financeiro')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /\+ nova pasta/i }));
    await user.type(screen.getByLabelText(/nome/i), 'RH');
    await user.type(screen.getByLabelText(/descrição/i), 'Assuntos de RH');
    await user.type(screen.getByLabelText(/ícone/i), '🧑');

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/knowledge-folders', {
        name: 'RH',
        description: 'Assuntos de RH',
        icon: '🧑',
      });
    });
  });

  it('allows a canAuthor user to delete a folder after confirming', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderGrid({ canAuthor: true });

    await waitFor(() => {
      expect(screen.getByText('Financeiro')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /excluir/i });
    await user.click(deleteButtons[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Excluir pasta')).toBeInTheDocument();
    expect(within(dialog).getByText('Excluir a pasta "Financeiro"?')).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/knowledge-folders/folder-1');
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('keeps the folder when the delete dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderGrid({ canAuthor: true });
    await waitFor(() => expect(screen.getByText('Financeiro')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: /excluir/i })[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('uses the control height, the legible primary and aligned text actions', async () => {
    const user = userEvent.setup();
    renderGrid({ canAuthor: true });
    await waitFor(() => expect(screen.getByText('Financeiro')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: '+ Nova pasta' })).toHaveClass('h-[42px]', 'bg-brand-600', 'border-brand-600');
    for (const name of ['Editar', 'Excluir']) {
      for (const button of screen.getAllByRole('button', { name })) expect(button).toHaveClass('px-0');
    }

    await user.click(screen.getByRole('button', { name: '+ Nova pasta' }));
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveClass('bg-brand-600', 'border-brand-600');
  });

  it('shows the article count in a text color with enough contrast', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('3 artigos')).toBeInTheDocument());

    expect(screen.getByText('3 artigos')).toHaveClass('text-gray-500');
    expect(screen.getByText('3 artigos').className).not.toMatch(/text-gray-400/);
  });

  it('shows an empty state when there are no folders', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    renderGrid();

    await waitFor(() => {
      expect(screen.getByText(/nenhuma pasta/i)).toBeInTheDocument();
    });
  });

  describe('exclusão de pasta (F3-29, KNW-01)', () => {
    async function askToDelete() {
      const user = userEvent.setup();
      renderGrid({ canAuthor: true });
      await waitFor(() => expect(screen.getByText('Financeiro')).toBeInTheDocument());
      await user.click(screen.getAllByRole('button', { name: /excluir/i })[0]);
      const dialog = await screen.findByRole('dialog');
      return { user, dialog };
    }

    it('keeps the dialog open with the API message and the folder listed when the API refuses', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce({
        response: { status: 409, data: { message: 'A pasta ainda tem artigos.' } },
      });
      const { user, dialog } = await askToDelete();

      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => {
        expect(within(screen.getByRole('dialog')).getByText('A pasta ainda tem artigos.')).toBeInTheDocument();
      });
      expect(screen.getByText('Financeiro')).toBeInTheDocument();
    });

    it('shows a generic message when the refusal carries none', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Network Error'));
      const { user, dialog } = await askToDelete();

      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await within(await screen.findByRole('dialog')).findByText('Não foi possível excluir a pasta.')).toBeInTheDocument();
    });

    it('keeps the dialog open with the confirm button busy while pending, and closes on success', async () => {
      let finish: (value: unknown) => void = () => undefined;
      vi.mocked(api.delete).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const { user, dialog } = await askToDelete();

      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Confirmar/ })).toHaveAttribute('aria-busy', 'true');

      finish({ data: {} });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.delete).toHaveBeenCalledWith('/knowledge-folders/folder-1');
    });

    it('clears the previous error when the dialog is opened again', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce({ response: { status: 403, data: { message: 'Sem permissão.' } } });
      const { user, dialog } = await askToDelete();
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
      await screen.findByText('Sem permissão.');
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

      await user.click(screen.getAllByRole('button', { name: /excluir/i })[0]);

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByText('Sem permissão.')).not.toBeInTheDocument();
    });

    it('offers no Excluir to a reader', async () => {
      renderGrid({ canAuthor: false });
      await waitFor(() => expect(screen.getByText('Financeiro')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument();
    });
  });
});
