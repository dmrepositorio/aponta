import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { TicketComments } from './TicketComments';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

function renderComments() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketComments ticketId="t-1" />
    </QueryClientProvider>,
  );
}

describe('TicketComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders html evidence from a worklog reply without showing raw markup', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        {
          id: 'c-1',
          content: '<p>Atualização do atendimento:</p><img src="/uploads/evidencia.png" alt="Print da correção">',
          isInternal: false,
          ticketId: 't-1',
          authorId: 'agent-1',
          createdAt: '2026-10-14T11:00:00.000Z',
        },
      ],
    });

    renderComments();

    await waitFor(() => {
      expect(screen.getByText('Atualização do atendimento:')).toBeInTheDocument();
    });
    expect(screen.getByAltText('Print da correção')).toBeInTheDocument();
    expect(screen.queryByText(/<img/i)).not.toBeInTheDocument();
  });

  it('GH-446 DET-02: mostra a data do comentário em dd/mm/aaaa HH:mm no fuso de Brasília, sem UTC', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        {
          id: 'c-2',
          content: 'Comentário simples',
          isInternal: false,
          ticketId: 't-1',
          authorId: 'agent-1',
          createdAt: '2026-10-14T11:00:00.000Z',
        },
      ],
    });

    renderComments();

    expect(await screen.findByText('14/10/2026 08:00')).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });

  describe('GH-490 DET-01: autor do comentário', () => {
    const base = {
      content: 'Texto',
      isInternal: false,
      ticketId: 't-1',
      createdAt: '2026-10-14T11:00:00.000Z',
    };

    it('mostra o nome do autor com a etiqueta Equipe para papéis da equipe', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: [
          { ...base, id: 'c-a', authorId: 'u-1', author: { id: 'u-1', name: 'Maria', role: 'AGENT' } },
          { ...base, id: 'c-b', authorId: 'u-2', author: { id: 'u-2', name: 'Admin Teste', role: 'ADMIN' } },
          { ...base, id: 'c-c', authorId: 'u-3', author: { id: 'u-3', name: 'Chefe Teste', role: 'AGENT_MASTER' } },
        ],
      });

      renderComments();

      expect(await screen.findByText('Maria')).toBeInTheDocument();
      expect(screen.getByText('Admin Teste')).toBeInTheDocument();
      expect(screen.getByText('Chefe Teste')).toBeInTheDocument();
      expect(screen.getAllByText('Equipe')).toHaveLength(3);
      expect(screen.queryByText('Cliente')).not.toBeInTheDocument();
    });

    it('mostra a etiqueta Cliente para CLIENT e CLIENT_MASTER', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: [
          { ...base, id: 'c-a', authorId: 'u-1', author: { id: 'u-1', name: 'Carla', role: 'CLIENT' } },
          { ...base, id: 'c-b', authorId: 'u-2', author: { id: 'u-2', name: 'Cleo', role: 'CLIENT_MASTER' } },
        ],
      });

      renderComments();

      expect(await screen.findByText('Carla')).toBeInTheDocument();
      expect(screen.getByText('Cleo')).toBeInTheDocument();
      expect(screen.getAllByText('Cliente')).toHaveLength(2);
      expect(screen.queryByText('Equipe')).not.toBeInTheDocument();
    });

    it('com nome oculto (null) mostra só a etiqueta do papel', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: [
          { ...base, id: 'c-a', authorId: 'u-1', author: { id: 'u-1', name: null, role: 'AGENT' } },
        ],
      });

      renderComments();

      expect(await screen.findByText('Equipe')).toBeInTheDocument();
      expect(screen.queryByText('Sistema')).not.toBeInTheDocument();
    });

    it('autor ausente (null ou campo não enviado) vira Sistema sem quebrar a tela', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: [
          { ...base, id: 'c-a', authorId: 'u-9', author: null },
          { ...base, id: 'c-b', authorId: 'u-9' },
        ],
      });

      renderComments();

      expect(await screen.findAllByText('Sistema')).toHaveLength(2);
    });
  });
});
