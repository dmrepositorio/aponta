import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { LoginPage } from './LoginPage';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// DMTE-551 r4: pedido do usuário na validação em produção: logos do Google e do GitHub nos botões de entrada.
describe('LoginPage: logos nos botões de Google e GitHub', () => {
  it('AC-25: cada botão traz o seu logo, decorativo para leitor de tela, e o nome acessível continua "Entrar com <provedor>"', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/auth/social/providers' ? { providers: ['google', 'github'] } : {} }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);

    const google = await screen.findByRole('link', { name: 'Entrar com Google' });
    const github = await screen.findByRole('link', { name: 'Entrar com GitHub' });

    const logos = [google, github].map((link) => link.querySelectorAll('svg'));
    expect(logos.map((found) => found.length)).toEqual([1, 1]);
    const [googleLogo, githubLogo] = logos.map((found) => found[0]);
    expect(googleLogo).toHaveAttribute('aria-hidden', 'true');
    expect(githubLogo).toHaveAttribute('aria-hidden', 'true');
    expect(googleLogo.querySelector('path')).not.toBeNull();
    expect(githubLogo.querySelector('path')).not.toBeNull();
    expect(googleLogo.innerHTML).not.toEqual(githubLogo.innerHTML);
  });
});
