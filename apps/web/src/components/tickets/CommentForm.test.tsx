import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { CommentForm } from './CommentForm';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function setRole(role: 'CLIENT' | 'AGENT') {
  useAuthStore.setState({
    token: 'fake.jwt.token',
    user: { sub: 'u-1', email: 'user@example.com', role },
  });
}

function renderForm(ticketId = 't-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommentForm ticketId={ticketId} />
    </QueryClientProvider>,
  );
}

describe('CommentForm (GH-448 DET-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    setRole('AGENT');
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'c-9' } });
  });

  it('Ctrl+Enter publica o comentário', async () => {
    const user = userEvent.setup();
    renderForm();

    const textarea = screen.getByLabelText(/adicionar um comentário/i);
    await user.type(textarea, 'Resposta rápida');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/tickets/t-1/comments', {
        content: 'Resposta rápida',
        isInternal: false,
      });
    });
  });

  it('Enter sozinho não publica (só quebra linha)', async () => {
    const user = userEvent.setup();
    renderForm();

    const textarea = screen.getByLabelText(/adicionar um comentário/i);
    await user.type(textarea, 'linha 1{Enter}linha 2');

    expect(api.post).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('linha 1\nlinha 2');
  });

  it('com Nota interna marcada o campo indica que o cliente não vê e muda de aparência', async () => {
    const user = userEvent.setup();
    renderForm();

    const textarea = screen.getByLabelText(/adicionar um comentário/i);
    expect(screen.queryByText(/cliente não vê/i)).not.toBeInTheDocument();
    expect(textarea.closest('form')).not.toHaveAttribute('data-internal');

    await user.click(screen.getByRole('checkbox', { name: /nota interna/i }));

    expect(screen.queryByText(/cliente não vê/i)).toBeInTheDocument();
    expect(textarea.closest('form')).toHaveAttribute('data-internal', 'true');
    expect(textarea).toHaveAccessibleDescription(/cliente não vê/i);
  });

  it('preserva o rascunho por ticket em sessionStorage ao remontar o formulário', async () => {
    const user = userEvent.setup();
    const first = renderForm('t-1');
    await user.type(screen.getByLabelText(/adicionar um comentário/i), 'rascunho em andamento');
    first.unmount();

    renderForm('t-1');
    expect(screen.getByLabelText(/adicionar um comentário/i)).toHaveValue('rascunho em andamento');
  });

  it('o rascunho de um ticket não aparece em outro ticket', async () => {
    const user = userEvent.setup();
    const first = renderForm('t-1');
    await user.type(screen.getByLabelText(/adicionar um comentário/i), 'só do t-1');
    first.unmount();

    renderForm('t-2');
    expect(screen.getByLabelText(/adicionar um comentário/i)).toHaveValue('');
  });

  it('descarta o rascunho depois de publicar com sucesso', async () => {
    const user = userEvent.setup();
    const first = renderForm('t-1');
    await user.type(screen.getByLabelText(/adicionar um comentário/i), 'vai ser publicado');
    await user.click(screen.getByRole('button', { name: /publicar comentário/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/adicionar um comentário/i)).toHaveValue(''));
    first.unmount();

    renderForm('t-1');
    expect(screen.getByLabelText(/adicionar um comentário/i)).toHaveValue('');
  });
});
