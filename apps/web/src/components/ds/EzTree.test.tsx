import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { EzTree } from './EzTree';

const nodes = [
  {
    id: 'root',
    label: 'Departamentos',
    children: [
      { id: 'ti', label: 'TI' },
      { id: 'rh', label: 'RH' },
    ],
  },
];

describe('EzTree', () => {
  it('renders the root node and hides children until expanded', () => {
    render(<EzTree nodes={nodes} />);
    expect(screen.getByText('Departamentos')).toBeInTheDocument();
    expect(screen.queryByText('TI')).not.toBeInTheDocument();
  });

  it('expands children when the chevron is clicked', async () => {
    render(<EzTree nodes={nodes} />);
    await userEvent.click(screen.getByLabelText('Expandir'));
    expect(screen.getByText('TI')).toBeInTheDocument();
    expect(screen.getByText('RH')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked node', async () => {
    const handleSelect = vi.fn();
    render(<EzTree nodes={nodes} onSelect={handleSelect} />);
    await userEvent.click(screen.getByText('Departamentos'));
    expect(handleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
  });

  it('applies the brand selected classes when selectedId matches a node', () => {
    render(<EzTree nodes={nodes} selectedId="root" />);
    expect(screen.getByTestId('tree-node-root')).toHaveClass('bg-brand-50');
  });

  describe('teclado (WAI-ARIA TreeView)', () => {
    const tree = [
      {
        id: 'a',
        label: 'Alfa',
        children: [
          { id: 'a1', label: 'Alfa um' },
          { id: 'a2', label: 'Alfa dois' },
        ],
      },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gama' },
    ];

    it('mantém tabIndex=0 só no item ativo (roving tabindex)', () => {
      render(<EzTree nodes={tree} />);
      expect(screen.getByTestId('tree-node-a')).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId('tree-node-b')).toHaveAttribute('tabindex', '-1');
      expect(screen.getByTestId('tree-node-c')).toHaveAttribute('tabindex', '-1');
    });

    it('começa o foco no item selecionado', () => {
      render(<EzTree nodes={tree} selectedId="b" />);
      expect(screen.getByTestId('tree-node-b')).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId('tree-node-a')).toHaveAttribute('tabindex', '-1');
    });

    it('ArrowDown move o foco e Enter seleciona o nó seguinte', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(<EzTree nodes={tree} onSelect={onSelect} />);
      screen.getByTestId('tree-node-a').focus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByTestId('tree-node-b')).toHaveFocus();
      expect(screen.getByTestId('tree-node-b')).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId('tree-node-a')).toHaveAttribute('tabindex', '-1');
      await user.keyboard('{Enter}');
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    });

    it('Espaço seleciona o item focado', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(<EzTree nodes={tree} onSelect={onSelect} />);
      screen.getByTestId('tree-node-a').focus();
      await user.keyboard(' ');
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    });

    it('ArrowUp volta ao item anterior', async () => {
      const user = userEvent.setup();
      render(<EzTree nodes={tree} selectedId="c" />);
      screen.getByTestId('tree-node-c').focus();
      await user.keyboard('{ArrowUp}');
      expect(screen.getByTestId('tree-node-b')).toHaveFocus();
    });

    it('Home e End vão ao primeiro e ao último item visível', async () => {
      const user = userEvent.setup();
      render(<EzTree nodes={tree} selectedId="b" />);
      screen.getByTestId('tree-node-b').focus();
      await user.keyboard('{End}');
      expect(screen.getByTestId('tree-node-c')).toHaveFocus();
      await user.keyboard('{Home}');
      expect(screen.getByTestId('tree-node-a')).toHaveFocus();
    });

    it('ArrowRight expande, depois entra no primeiro filho; ArrowLeft volta ao pai e recolhe', async () => {
      const user = userEvent.setup();
      render(<EzTree nodes={tree} />);
      const alfa = screen.getByTestId('tree-node-a');
      alfa.focus();
      await user.keyboard('{ArrowRight}');
      expect(alfa).toHaveAttribute('aria-expanded', 'true');
      expect(alfa).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByTestId('tree-node-a1')).toHaveFocus();
      await user.keyboard('{ArrowLeft}');
      expect(alfa).toHaveFocus();
      await user.keyboard('{ArrowLeft}');
      expect(alfa).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('tree-node-a1')).not.toBeInTheDocument();
    });

    it('expõe aria-level, aria-posinset e aria-setsize', () => {
      render(<EzTree nodes={tree} defaultExpandedIds={['a']} />);
      const filho = screen.getByTestId('tree-node-a2');
      expect(filho).toHaveAttribute('aria-level', '2');
      expect(filho).toHaveAttribute('aria-posinset', '2');
      expect(filho).toHaveAttribute('aria-setsize', '2');
      const beta = screen.getByTestId('tree-node-b');
      expect(beta).toHaveAttribute('aria-level', '1');
      expect(beta).toHaveAttribute('aria-posinset', '2');
      expect(beta).toHaveAttribute('aria-setsize', '3');
    });

    it('o chevron não entra na ordem de Tab e o item usa o foco do DS', () => {
      render(<EzTree nodes={tree} />);
      expect(screen.getAllByLabelText('Expandir')[0]).toHaveAttribute('tabindex', '-1');
      expect(screen.getByTestId('tree-node-a')).toHaveClass('ez-focus-inset');
    });
  });
});
