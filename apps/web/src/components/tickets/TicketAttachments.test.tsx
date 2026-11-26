import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { TicketAttachments } from './TicketAttachments';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const attachments = [
  {
    id: 'att-1',
    filename: 'f1.pdf',
    originalName: 'relatorio.pdf',
    mimeType: 'application/pdf',
    fileUrl: 'https://files/relatorio.pdf',
    createdAt: '2026-01-01T00:00:00.000Z',
    uploaderId: 'u-1',
  },
  {
    id: 'att-2',
    filename: 'f2.png',
    originalName: 'print.png',
    mimeType: 'image/png',
    fileUrl: 'https://files/print.png',
    createdAt: '2026-01-02T00:00:00.000Z',
    uploaderId: 'other-user',
  },
];

function renderComponent(ticketId = 't1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketAttachments ticketId={ticketId} />
    </QueryClientProvider>,
  );
}

function loginAs(role: 'ADMIN' | 'AGENT' | 'CLIENT', sub = 'u-1') {
  useAuthStore.setState({
    token: 'fake-token',
    user: { sub, email: 'user@aponta.com', role },
  });
}

describe('TicketAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
  });

  it('shows a loading state while fetching attachments', () => {
    vi.mocked(api.get).mockReturnValue(
      new Promise(() => {
        // Never resolves, keeping the query in its loading state.
      }),
    );
    loginAs('ADMIN');
    renderComponent();

    expect(screen.getByRole('status')).toHaveTextContent(/carregando anexos/i);
  });

  it('shows the empty state when there are no attachments', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    loginAs('ADMIN');
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/nenhum anexo neste chamado ainda/i)).toBeInTheDocument();
    });
  });

  it('lists attachments and shows "Remover" for an ADMIN on any attachment', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: attachments });
    loginAs('ADMIN');
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('relatorio.pdf')).toBeInTheDocument();
    });

    expect(screen.getByText('print.png')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /remover/i })).toHaveLength(2);
  });

  it('only shows "Remover" on the own upload for a CLIENT (not uploaded by others)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: attachments });
    loginAs('CLIENT', 'u-1');
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('relatorio.pdf')).toBeInTheDocument();
    });

    // u-1 uploaded att-1, so only one "Remover" button shows
    expect(screen.getAllByRole('button', { name: /remover/i })).toHaveLength(1);
  });

  it('uploads the selected file via POST and resets the input', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: attachments[0] });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/nenhum anexo neste chamado ainda/i)).toBeInTheDocument();
    });

    const file = new File(['conteudo'], 'teste.txt', { type: 'text/plain' });
    const input = document.getElementById('attachment-file') as HTMLInputElement;
    await user.upload(input, file);

    expect(screen.getByText('teste.txt')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /anexar arquivo/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/tickets/t1/attachments',
        expect.anything(),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
    });
  });

  it('shows an error message when the upload fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockRejectedValue(new Error('too big'));
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/nenhum anexo neste chamado ainda/i)).toBeInTheDocument();
    });

    const file = new File(['x'], 'big.bin', { type: 'application/octet-stream' });
    const input = document.getElementById('attachment-file') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /anexar arquivo/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/falha ao enviar o anexo/i);
    });
  });

  it('GH-446 DET-12: Remover abre confirmação com o nome do arquivo e só exclui ao confirmar', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: attachments });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('relatorio.pdf')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('button', { name: /remover/i })[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.delete).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/relatorio\.pdf/)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/tickets/t1/attachments/att-1');
    });
  });

  it('GH-446 DET-12: Cancelar na confirmação fecha o diálogo sem excluir', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: attachments });
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('relatorio.pdf');
    await user.click(screen.getAllByRole('button', { name: /remover/i })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('GH-446 DET-12: falha na exclusão mostra alerta de erro', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: attachments });
    vi.mocked(api.delete).mockRejectedValue(new Error('boom'));
    loginAs('ADMIN');
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('relatorio.pdf');
    await user.click(screen.getAllByRole('button', { name: /remover/i })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/falha ao remover o anexo/i);
  });

  it('GH-446 DET-12: o botão Remover usa a variante danger do DS, sem override de cor', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: attachments });
    loginAs('ADMIN');
    renderComponent();

    const [button] = await screen.findAllByRole('button', { name: /remover/i });
    expect(button.className).not.toMatch(/!text-red/);
    expect(button.className).toMatch(/bg-red-600/);
  });

  it('GH-446 DET-13: cada anexo mostra o autor e a data (Brasília), sem emojis', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        {
          ...attachments[0],
          createdAt: '2026-01-02T15:30:00.000Z',
          uploader: { id: 'u-1', name: 'Maria Souza', email: 'maria@aponta.com' },
        },
      ],
    });
    loginAs('ADMIN');
    const { container } = renderComponent();

    await screen.findByText('relatorio.pdf');
    expect(screen.getByText(/Maria Souza/)).toBeInTheDocument();
    expect(screen.getByText(/02\/01\/2026 12:30/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('GH-446 DET-13: sem uploader carregado mostra só a data', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [attachments[1]] });
    loginAs('ADMIN');
    renderComponent();

    await screen.findByText('print.png');
    expect(screen.getByText(/01\/01\/2026 21:00/)).toBeInTheDocument();
  });
});
