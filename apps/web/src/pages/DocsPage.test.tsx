import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocsPage } from './DocsPage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="hash">{location.hash}</div>;
}

function renderPage(entry = '/docs') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** scrollIntoView sem implementação no jsdom: registra em qual seção e com quais opções. */
function spyScroll() {
  const calls: { id: string; options: unknown }[] = [];
  window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, options?: unknown) {
    calls.push({ id: this.id, options });
  };
  return calls;
}

function indexNav() {
  const nav = screen.queryByRole('navigation', { name: 'Índice da documentação' });
  expect(nav).toBeInTheDocument();
  return nav as HTMLElement;
}

function indexLink(name: string) {
  const link = within(indexNav()).queryByRole('link', { name });
  expect(link).toBeInTheDocument();
  return link as HTMLElement;
}

function searchBox() {
  const box = screen.queryByRole('searchbox', { name: 'Buscar na documentação' });
  expect(box).toBeInTheDocument();
  return box as HTMLElement;
}

function copyButton() {
  const button = screen.queryByRole('button', { name: 'Copiar configuração' });
  expect(button).toBeInTheDocument();
  return button as HTMLElement;
}

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

function stubIntersectionObserver() {
  const state = { callback: null as ObserverCallback | null, observed: [] as Element[], disconnected: 0 };
  class FakeObserver {
    constructor(callback: ObserverCallback) {
      state.callback = callback;
    }
    observe(element: Element) {
      state.observed.push(element);
    }
    unobserve() {}
    disconnect() {
      state.disconnected += 1;
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  const intersect = (id: string) =>
    state.callback?.([{ target: document.getElementById(id) as Element, isIntersecting: true }]);
  return { state, intersect };
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('DocsPage', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the header and the "Visão geral" section by default', () => {
    renderPage();

    expect(screen.getByText('Central de Documentação')).toBeInTheDocument();
    expect(screen.getAllByText('Visão geral do Aponta').length).toBeGreaterThan(0);
    expect(screen.getByText(/plataforma de Service Desk/i)).toBeInTheDocument();
  });

  it('renders every documented module section (tickets, relatórios, cofre, contratos, conhecimento)', () => {
    renderPage();

    expect(screen.getAllByText('Tickets & Kanban').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Relatórios').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cofre de Senhas').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Contratos').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Base de Conhecimento').length).toBeGreaterThan(0);
    expect(screen.getByText('MCP — Conectando Assistentes de IA')).toBeInTheDocument();
  });

  it('highlights the clicked index link and scrolls to the matching section', async () => {
    const user = userEvent.setup();
    const scrolls = spyScroll();
    renderPage();

    const contractsLink = indexLink('Contratos');
    await user.click(contractsLink);

    expect(scrolls).toEqual([{ id: 'contratos', options: { behavior: 'smooth', block: 'start' } }]);
    expect(contractsLink.className).toContain('bg-brand-100');
  });

  it('jumps to the API section when the in-text FAQ link is clicked', async () => {
    const user = userEvent.setup();
    const scrolls = spyScroll();
    renderPage();

    const faq = document.getElementById('faq') as HTMLElement;
    await user.click(within(faq).getByRole('link', { name: 'API & Tokens de Acesso' }));

    expect(scrolls).toEqual([{ id: 'api', options: { behavior: 'smooth', block: 'start' } }]);
  });

  it('links to the token generation flow in Minha Conta', () => {
    renderPage();

    const link = screen.getByRole('link', { name: /configurações > minha conta/i });
    expect(link).toHaveAttribute('href', '/my-account');
  });

  describe('DOC-01 índice em viewport estreita', () => {
    it('offers a section select that scrolls to the chosen section and hides on lg+', async () => {
      const user = userEvent.setup();
      const scrolls = spyScroll();
      renderPage();

      const control = screen.queryByRole('combobox', { name: 'Seção da documentação' });
      expect(control).toBeInTheDocument();
      expect(control?.closest('.lg\\:hidden')).not.toBeNull();
      expect(indexNav().className).toContain('hidden');
      expect(indexNav().className).toContain('lg:block');

      await user.selectOptions(
        screen.getByLabelText('Seção da documentação', { selector: 'select' }),
        'Cofre de Senhas',
      );

      expect(scrolls.map((call) => call.id)).toEqual(['cofre']);
      expect(screen.getByTestId('hash')).toHaveTextContent('#cofre');
    });
  });

  describe('DOC-03 índice acessível com links e hash', () => {
    it('names the navigation and renders items as anchors with href="#id"', () => {
      renderPage();

      expect(indexLink('Cofre de Senhas')).toHaveAttribute('href', '#cofre');
      expect(indexLink('Dúvidas Frequentes')).toHaveAttribute('href', '#faq');
      expect(within(indexNav()).queryAllByRole('button')).toHaveLength(0);
    });

    it('marks only the active item with aria-current="location" and reflects it in the URL hash', async () => {
      const user = userEvent.setup();
      spyScroll();
      renderPage();

      expect(indexLink('Visão geral do Aponta')).toHaveAttribute('aria-current', 'location');
      expect(indexLink('Cofre de Senhas')).not.toHaveAttribute('aria-current');

      await user.click(indexLink('Cofre de Senhas'));

      expect(indexLink('Cofre de Senhas')).toHaveAttribute('aria-current', 'location');
      expect(indexLink('Visão geral do Aponta')).not.toHaveAttribute('aria-current');
      expect(screen.getByTestId('hash')).toHaveTextContent('#cofre');
    });

    it('opens on the section named by the URL hash', () => {
      const scrolls = spyScroll();
      renderPage('/docs#faq');

      expect(indexLink('Dúvidas Frequentes')).toHaveAttribute('aria-current', 'location');
      expect(scrolls.map((call) => call.id)).toEqual(['faq']);
    });
  });

  describe('DOC-02 item ativo acompanha a rolagem', () => {
    it('follows the section reported by the IntersectionObserver and cleans up on unmount', () => {
      const { state, intersect } = stubIntersectionObserver();
      const { unmount } = renderPage();

      expect(state.observed.map((el) => el.id)).toContain('faq');
      expect(state.observed).toHaveLength(9);

      intersect('faq');

      expect(indexLink('Dúvidas Frequentes')).toHaveAttribute('aria-current', 'location');
      expect(indexLink('Visão geral do Aponta')).not.toHaveAttribute('aria-current');

      unmount();
      expect(state.disconnected).toBeGreaterThan(0);
    });

    it('keeps the clicked item active while the programmatic scroll passes other sections', async () => {
      const user = userEvent.setup();
      spyScroll();
      const { intersect } = stubIntersectionObserver();
      renderPage();

      await user.click(indexLink('Contratos'));
      intersect('faq');

      expect(indexLink('Contratos')).toHaveAttribute('aria-current', 'location');
      expect(indexLink('Dúvidas Frequentes')).not.toHaveAttribute('aria-current');
    });

    it('scrolls with behavior "auto" when the user prefers reduced motion', async () => {
      const user = userEvent.setup();
      const scrolls = spyScroll();
      stubReducedMotion(true);
      renderPage();

      await user.click(indexLink('Contratos'));

      expect(scrolls).toEqual([{ id: 'contratos', options: { behavior: 'auto', block: 'start' } }]);
    });

    it('keeps the smooth scroll when reduced motion is not requested', async () => {
      const user = userEvent.setup();
      const scrolls = spyScroll();
      stubReducedMotion(false);
      renderPage();

      await user.click(indexLink('Contratos'));

      expect(scrolls).toEqual([{ id: 'contratos', options: { behavior: 'smooth', block: 'start' } }]);
    });
  });

  describe('DOC-04 links internos navegam uma única vez', () => {
    it('prevents the native jump and scrolls once for the FAQ and MCP "#api" links', () => {
      const scrolls = spyScroll();
      renderPage();

      const faqLink = within(document.getElementById('faq') as HTMLElement).getByRole('link', {
        name: 'API & Tokens de Acesso',
      });
      const mcpLink = within(document.getElementById('mcp') as HTMLElement).getByRole('link', {
        name: 'API & Tokens de Acesso',
      });
      expect(faqLink).toHaveAttribute('href', '#api');

      expect(fireEvent.click(faqLink)).toBe(false);
      expect(scrolls.map((call) => call.id)).toEqual(['api']);

      expect(fireEvent.click(mcpLink)).toBe(false);
      expect(scrolls.map((call) => call.id)).toEqual(['api', 'api']);
    });
  });

  describe('DOC-05 cabeçalho padrão e busca', () => {
    function sectionTitles() {
      return screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    }

    it('uses the standard page header as the only level 1 heading', () => {
      renderPage();

      const heading = screen.getByRole('heading', { level: 1, name: 'Central de Documentação' });
      expect(heading.className).toContain('text-[20px]');
    });

    it('filters sections by title or text, ignoring case and accents, and the index follows', async () => {
      const user = userEvent.setup();
      renderPage();
      expect(sectionTitles()).toHaveLength(9);

      await user.type(searchBox(), 'TOKEN');

      expect(sectionTitles()).toEqual([
        'Dúvidas Frequentes',
        'API & Tokens de Acesso',
        'MCP — Conectando Assistentes de IA',
      ]);
      expect(within(indexNav()).getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Dúvidas Frequentes',
        'API & Tokens de Acesso',
        'MCP (Assistentes de IA)',
      ]);

      await user.clear(searchBox());
      await user.type(searchBox(), 'visao geral');
      expect(sectionTitles()).toEqual(['Visão geral do Aponta']);
    });

    it('matches the section title even when the body does not repeat it', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(searchBox(), 'kanban');

      expect(sectionTitles()).toEqual(['Tickets & Kanban']);
    });

    it('shows an empty state without sections when nothing matches and restores on clear', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(searchBox(), 'zzzxyz');

      expect(screen.getByText('Nenhuma seção encontrada')).toBeInTheDocument();
      expect(sectionTitles()).toHaveLength(0);

      await user.clear(searchBox());

      expect(screen.queryByText('Nenhuma seção encontrada')).not.toBeInTheDocument();
      expect(sectionTitles()).toHaveLength(9);
    });

    it('clears the search and scrolls when an in-text link points to a hidden section', async () => {
      const user = userEvent.setup();
      const scrolls = spyScroll();
      renderPage();

      await user.type(searchBox(), 'como gero');
      expect(sectionTitles()).toEqual(['Dúvidas Frequentes']);

      await user.click(
        within(document.getElementById('faq') as HTMLElement).getByRole('link', { name: 'API & Tokens de Acesso' }),
      );

      await waitFor(() => expect(scrolls.map((call) => call.id)).toEqual(['api']));
      expect(sectionTitles()).toHaveLength(9);
      expect(searchBox()).toHaveValue('');
    });
  });

  describe('DOC-06 copiar a configuração do MCP', () => {
    function configBlock() {
      return within(document.getElementById('mcp') as HTMLElement).getByText(/"mcpServers"/);
    }

    it('copies the full JSON, announces "Copiado" in a live region and uses 14px text', async () => {
      const user = userEvent.setup();
      renderPage();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      expect(configBlock().className).toContain('text-sm');

      await user.click(copyButton());

      expect(writeText).toHaveBeenCalledTimes(1);
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied).toBe(configBlock().textContent);
      expect(JSON.parse(copied).mcpServers.aponta.env.APONTA_API_TOKEN).toBe('apta_xxxxxxxxxxxxxxxxxxxxxxxx');
      expect(await screen.findByRole('status')).toHaveTextContent('Copiado');
    });

    it('reports a failure when the clipboard is unavailable', async () => {
      const user = userEvent.setup();
      renderPage();
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      await user.click(copyButton());

      expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível copiar');
      expect(screen.queryByText('Copiado')).not.toBeInTheDocument();
    });
  });
});
