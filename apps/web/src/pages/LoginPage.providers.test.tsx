import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { LoginPage } from './LoginPage';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// DMTE-551 T8: o GitHub usa o mesmo botão do Google, com o seu início de fluxo.
describe('LoginPage: botões de Google e GitHub', () => {
  it('AC-22: mostra um botão por provedor oferecido, na ordem recebida, com o nome certo', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/auth/social/providers' ? { providers: ['google', 'github'] } : {} }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);

    const links = await screen.findAllByRole('link', { name: /entrar com/i });

    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Entrar com Google', '/api/auth/social/google/start'],
      ['Entrar com GitHub', '/api/auth/social/github/start'],
    ]);
  });

  const renderWith = (providers: Promise<unknown>) => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/auth/social/providers' ? (providers as Promise<never>) : Promise.resolve({ data: {} }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);
  };

  it('LOG-08: ao clicar no botão do provedor mostra "Redirecionando…" com aria-busy e ignora o segundo clique', async () => {
    renderWith(Promise.resolve({ data: { providers: ['google'] } }));
    const link = await screen.findByRole('link', { name: 'Entrar com Google' });

    fireEvent.click(link);

    const busy = await screen.findByRole('link', { name: /redirecionando/i });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(fireEvent.click(busy)).toBe(false); // preventDefault: o segundo clique não navega
  });

  it('LOG-08: ctrl+clique (nova aba) não entra no estado de redirecionamento', async () => {
    renderWith(Promise.resolve({ data: { providers: ['google'] } }));
    const link = await screen.findByRole('link', { name: 'Entrar com Google' });

    fireEvent.click(link, { ctrlKey: true });

    expect(screen.getByRole('link', { name: 'Entrar com Google' })).not.toHaveAttribute('aria-busy');
  });

  it('LOG-09: enquanto a consulta de provedores está pendente existe um placeholder que some quando ela chega', async () => {
    let resolve!: (v: unknown) => void;
    renderWith(new Promise((r) => (resolve = r)));

    expect(screen.getByTestId('social-providers-placeholder')).toBeInTheDocument();

    resolve({ data: { providers: ['google'] } });
    await screen.findByRole('link', { name: 'Entrar com Google' }, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('social-providers-placeholder')).not.toBeInTheDocument(), { timeout: 5000 });
  });
});
