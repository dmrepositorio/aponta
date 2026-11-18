import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
});
