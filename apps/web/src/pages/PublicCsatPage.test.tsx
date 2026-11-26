import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicCsatPage } from './PublicCsatPage';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

function renderPage(token = 'tok-abc-123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/avaliar/${token}`]}>
        <Routes>
          <Route path="/avaliar/:token" element={<PublicCsatPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PublicCsatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the ticket summary and 5 stars pre-selected', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        protocol: '2026-0001',
        title: 'Impressora não funciona',
        score: null,
        comment: null,
      },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/2026-0001/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Impressora não funciona/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirmar avaliação/i }),
    ).toBeInTheDocument();
  });

  it('shows an invalid-link message when the token does not resolve (404)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });

    renderPage('bad-token');

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /link inválido/i }),
      ).toBeInTheDocument(),
    );
  });

  it('does NOT submit the rating automatically on page load — only after clicking Confirmar', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        protocol: '2026-0001',
        title: 'Impressora não funciona',
        score: null,
        comment: null,
      },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/2026-0001/)).toBeInTheDocument(),
    );

    expect(api.patch).not.toHaveBeenCalled();
  });

  it('submits the chosen score+comment only when Confirmar is clicked', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        protocol: '2026-0001',
        title: 'Impressora não funciona',
        score: null,
        comment: null,
      },
    });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 'ticket-1', csatScore: 4, csatComment: 'Bom atendimento' },
    });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/2026-0001/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('radio', { name: '4 estrelas' }));
    await user.type(
      screen.getByLabelText(/comentário/i),
      'Bom atendimento',
    );
    await user.click(
      screen.getByRole('button', { name: /confirmar avaliação/i }),
    );

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/public/csat/tok-abc-123', {
        score: 4,
        comment: 'Bom atendimento',
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/obrigado/i)).toBeInTheDocument(),
    );
  });

  it('shows the already-rated confirmation when the ticket was already rated', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        protocol: '2026-0001',
        title: 'Impressora não funciona',
        score: 5,
        comment: 'Excelente',
      },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/já foi avaliado/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /confirmar avaliação/i }),
    ).not.toBeInTheDocument();
  });
  const pending = {
    data: {
      protocol: '2026-0001',
      title: 'Impressora não funciona',
      score: null,
      comment: null,
    },
  };
  const httpError = (status: number) => ({
    isAxiosError: true,
    response: { status },
  });

  it('exposes the stars as a radiogroup with the current score checked (CSA-01)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    const user = userEvent.setup();
    renderPage();

    const group = await screen.findByRole('radiogroup', {
      name: /nota de 1 a 5/i,
    });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '5 estrelas' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: '3 estrelas' }));
    expect(screen.getByRole('radio', { name: '3 estrelas' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5 estrelas' })).not.toBeChecked();
  });

  it('moves the selection with the arrow keys and keeps one tab stop (CSA-01)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    const user = userEvent.setup();
    renderPage();

    const star3 = await screen.findByRole('radio', { name: '3 estrelas' });
    await user.click(star3);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '4 estrelas' })).toBeChecked();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '2 estrelas' })).toBeChecked();

    const tabStops = screen
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toBe(screen.getByRole('radio', { name: '2 estrelas' }));
  });

  it('gives each star a 44x44 touch target with spacing (CSA-07)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    renderPage();
    const stars = await screen.findAllByRole('radio');
    for (const star of stars) {
      expect(star.className).toContain('min-h-11');
      expect(star.className).toContain('min-w-11');
    }
  });

  it('shows a retryable load error, not "link inválido", on a 500 (CSA-03)', async () => {
    (api.get as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue(pending);
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole('heading', {
        name: /não foi possível carregar a avaliação/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /link inválido/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tentar de novo/i }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/2026-0001/)).toBeInTheDocument();
  });

  it('announces the invalid-link block as an alert on 404 (CSA-03)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(404));
    renderPage('bad-token');
    expect(await screen.findByRole('alert')).toHaveTextContent(/link inválido/i);
  });

  it('announces a submit failure with role=alert, distinct for network/5xx (CSA-05)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(500));
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /confirmar avaliação/i }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/falha ao enviar/i);
  });

  it('treats a 404 on submit as an invalid link (CSA-05)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(404));
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /confirmar avaliação/i }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /link.*inválido/i,
    );
  });

  it('uses the DS textarea with label, maxLength and a full-width DS button (CSA-06)', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    renderPage();
    const textarea = await screen.findByLabelText(/comentário/i);
    expect(textarea).toHaveAttribute('maxlength', '1000');
    expect(textarea.parentElement?.className).toContain('ez-focus-within');
    const button = screen.getByRole('button', { name: /confirmar avaliação/i });
    expect(button.className).toContain('w-full');
    expect(button.className).not.toContain('bg-blue-600');
  });
});
