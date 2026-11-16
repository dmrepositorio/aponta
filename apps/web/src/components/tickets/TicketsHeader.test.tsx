import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TicketsHeader } from './TicketsHeader';
import { classTokens, classesUpTo, heightContractProblems } from '../../test-utils/controlHeight';

function renderHeader(props: Partial<Parameters<typeof TicketsHeader>[0]> = {}) {
  const defaultProps: Parameters<typeof TicketsHeader>[0] = {
    isClient: false,
    viewMode: 'kanban',
    onViewModeChange: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    onOpenAdvancedSearch: vi.fn(),
  };
  return render(<TicketsHeader {...defaultProps} {...props} />);
}

describe('TicketsHeader (D3)', () => {
  it('shows "Tickets" as the title, in that position, with Lista/Kanban, Buscar and Busca avançada (AC2)', () => {
    renderHeader();

    expect(screen.getByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lista' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getByLabelText(/buscar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Busca avançada' })).toBeInTheDocument();
  });

  it('AC-03: exposes the view switch as a named group with the current view pressed', () => {
    renderHeader({ viewMode: 'kanban' });

    const group = screen.getByRole('group', { name: /visualização/i });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('hides the Lista/Kanban toggle for CLIENT (AC2)', () => {
    renderHeader({ isClient: true });

    expect(screen.queryByRole('button', { name: 'Lista' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kanban' })).not.toBeInTheDocument();
  });

  it('calls onViewModeChange when a toggle button is clicked', async () => {
    const onViewModeChange = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onViewModeChange, viewMode: 'kanban' });

    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('debounces typed search text before calling onSearchChange', async () => {
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onSearchChange });

    await user.type(screen.getByLabelText(/buscar/i), 'impressora');
    expect(onSearchChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onSearchChange).toHaveBeenCalledWith('impressora'));
  });

  it('calls onOpenAdvancedSearch when "Busca avançada" is clicked', async () => {
    const onOpenAdvancedSearch = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onOpenAdvancedSearch });

    await user.click(screen.getByRole('button', { name: 'Busca avançada' }));
    expect(onOpenAdvancedSearch).toHaveBeenCalled();
  });
});

describe('TicketsHeader: escala de altura e quebra em telas estreitas (DMTE-527 ticket 1)', () => {
  const search = () => screen.getByLabelText(/buscar/i);
  const advanced = () => screen.getByRole('button', { name: 'Busca avançada' });
  const commonAncestor = (a: Element, b: Element) => {
    let node: Element | null = a;
    while (node && !node.contains(b)) node = node.parentElement;
    return node as Element;
  };

  it('AC-01: busca, Busca avançada e Lista/Kanban usam o token de 36 px a partir de sm e 44 px abaixo', () => {
    const { container } = renderHeader();
    const root = container.parentElement;
    expect(heightContractProblems(classesUpTo(search(), root), 'toolbar')).toEqual([]);
    expect(heightContractProblems(classesUpTo(advanced(), root), 'toolbar')).toEqual([]);
    const group = screen.getByRole('group', { name: /visualização/i });
    expect(heightContractProblems(classesUpTo(group, root), 'toolbar')).toEqual([]);
  });

  it('AC-01: nenhum controle do cabeçalho segue no token de 42 px', () => {
    const { container } = renderHeader();
    for (const control of [search(), advanced(), screen.getByRole('group', { name: /visualização/i })]) {
      expect(control.className).not.toContain('--control-height-md');
    }
    expect(container.innerHTML).not.toContain('--control-height-md');
  });

  it('AC-01: o título "Tickets" usa o token de 36 px a partir de sm', () => {
    renderHeader();
    expect(
      heightContractProblems(screen.getByRole('heading', { name: 'Tickets' }).className, 'toolbar', { touchFloor: false }),
    ).toEqual([]);
  });

  it('AC-03: a busca ocupa a largura total abaixo de lg e de 640 a 1023 px (nenhum sm:w-* diferente de full)', () => {
    const { container } = renderHeader();
    const tokens = classTokens(classesUpTo(search(), container.parentElement));
    expect(tokens).toContain('w-full');
    expect(tokens.filter((token) => /^sm:w-/.test(token) && token !== 'sm:w-full')).toEqual([]);
  });

  it('AC-03: abaixo de 640 px "Busca avançada" ocupa a largura total e volta ao tamanho natural a partir de sm', () => {
    renderHeader();
    const tokens = classTokens(advanced().className);
    expect(tokens).toContain('w-full');
    expect(tokens).toContain('sm:w-auto');
  });

  it('AC-03: abaixo de 640 px busca e "Busca avançada" ficam uma por linha (o pai quebra ou empilha)', () => {
    renderHeader();
    const parent = commonAncestor(search(), advanced());
    expect(classTokens(parent.className).filter((token) => /^(flex-col|flex-wrap|grid)$/.test(token))).not.toEqual([]);
  });

  it('AC-03: título e Lista/Kanban continuam juntos na primeira linha', () => {
    renderHeader();
    const title = screen.getByRole('heading', { name: 'Tickets' });
    expect(commonAncestor(title, screen.getByRole('group', { name: /visualização/i })).contains(search())).toBe(false);
  });
});
