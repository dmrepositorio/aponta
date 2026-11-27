import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzDoubleList } from './EzDoubleList';

const available = [
  { id: 1, label: 'Item A', description: 'Description A' },
  { id: 2, label: 'Item B' },
];

const selected = [{ id: 3, label: 'Item C' }];

describe('EzDoubleList', () => {
  it('renders available and selected items with default labels', () => {
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText('Disponíveis')).toBeInTheDocument();
    expect(screen.getByText('Selecionados')).toBeInTheDocument();
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
    expect(screen.getByText('Item C')).toBeInTheDocument();
  });

  it('renders custom labels when provided', () => {
    render(
      <EzDoubleList
        available={available}
        selected={selected}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        availableLabel="Custom Available"
        selectedLabel="Custom Selected"
      />
    );
    expect(screen.getByText('Custom Available')).toBeInTheDocument();
    expect(screen.getByText('Custom Selected')).toBeInTheDocument();
  });

  it('shows the count of each list in parentheses', () => {
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('shows an empty state message when available list is empty', () => {
    render(<EzDoubleList available={[]} selected={selected} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Nenhum item disponível')).toBeInTheDocument();
  });

  it('shows an empty state message when selected list is empty', () => {
    render(<EzDoubleList available={available} selected={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Nenhum item selecionado')).toBeInTheDocument();
  });

  it('calls onAdd with the correct item when the add button is clicked', async () => {
    const onAddMock = vi.fn();
    render(
      <EzDoubleList available={available} selected={selected} onAdd={onAddMock} onRemove={vi.fn()} />
    );
    const addButtons = screen.getAllByTitle('Adicionar');
    await userEvent.click(addButtons[0]);
    expect(onAddMock).toHaveBeenCalledTimes(1);
    expect(onAddMock).toHaveBeenCalledWith(available[0]);
  });

  it('calls onRemove with the correct item when the remove button is clicked', async () => {
    const onRemoveMock = vi.fn();
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={onRemoveMock} />
    );
    const removeButton = screen.getByTitle('Remover');
    await userEvent.click(removeButton);
    expect(onRemoveMock).toHaveBeenCalledTimes(1);
    expect(onRemoveMock).toHaveBeenCalledWith(selected[0]);
  });

  it('renders item description when provided', () => {
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    expect(screen.getByText('Description A')).toBeInTheDocument();
  });
  it('gives the add button an accessible name with the item label', async () => {
    const onAddMock = vi.fn();
    render(
      <EzDoubleList available={available} selected={selected} onAdd={onAddMock} onRemove={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar Item B' }));
    expect(onAddMock).toHaveBeenCalledWith(available[1]);
  });

  it('gives the remove button an accessible name with the item label', async () => {
    const onRemoveMock = vi.fn();
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={onRemoveMock} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remover Item C' }));
    expect(onRemoveMock).toHaveBeenCalledWith(selected[0]);
  });

  it('uses accessibleLabel for the button name when the label is not text', () => {
    render(
      <EzDoubleList
        available={[{ id: 9, label: <strong>Rico</strong>, accessibleLabel: 'Item Rico' }]}
        selected={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Adicionar Item Rico' })).toBeInTheDocument();
  });

  it('filters the available list by the search box, matching label or description', async () => {
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar em Disponíveis' }), 'item b');
    expect(screen.queryByText('Item A')).not.toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
    expect(screen.getByText('Item C')).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar em Disponíveis' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar em Disponíveis' }), 'description a');
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.queryByText('Item B')).not.toBeInTheDocument();
  });

  it('filters the selected list independently and keeps the total count', async () => {
    render(
      <EzDoubleList available={available} selected={selected} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar em Selecionados' }), 'zzz');
    expect(screen.queryByText('Item C')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum resultado para a busca')).toBeInTheDocument();
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('omits the search boxes when searchable is false', () => {
    render(
      <EzDoubleList
        available={available}
        selected={selected}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        searchable={false}
      />
    );
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('applies a configurable max height to both lists', () => {
    const { container } = render(
      <EzDoubleList
        available={available}
        selected={selected}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        listMaxHeight="30rem"
      />
    );
    const scrollers = container.querySelectorAll('[data-testid="ez-double-list-scroll"]');
    expect(scrollers).toHaveLength(2);
    scrollers.forEach((el) => expect((el as HTMLElement).style.maxHeight).toBe('30rem'));
  });

  describe('busca remota da lista disponível', () => {
    it('avisa o texto digitado e não filtra a lista localmente', async () => {
      const onAvailableSearch = vi.fn();
      render(
        <EzDoubleList
          available={available}
          selected={selected}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          availableLabel="Usuários"
          onAvailableSearch={onAvailableSearch}
        />
      );
      await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar em Usuários' }), 'zzz');

      expect(onAvailableSearch).toHaveBeenLastCalledWith('zzz');
      expect(screen.getByText('Item A')).toBeInTheDocument();
      expect(screen.getByText('Item B')).toBeInTheDocument();
    });

    it('a busca da lista de selecionados continua local', async () => {
      const onAvailableSearch = vi.fn();
      render(
        <EzDoubleList
          available={available}
          selected={selected}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          selectedLabel="Vinculados"
          onAvailableSearch={onAvailableSearch}
        />
      );
      await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar em Vinculados' }), 'zzz');

      expect(onAvailableSearch).not.toHaveBeenCalled();
      expect(screen.queryByText('Item C')).not.toBeInTheDocument();
    });

    it('sem resultado para um termo digitado mostra o aviso de busca', async () => {
      render(
        <EzDoubleList
          available={[]}
          selected={selected}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          availableLabel="Usuários"
          onAvailableSearch={vi.fn()}
        />
      );
      await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar em Usuários' }), 'zzz');

      expect(screen.getByText('Nenhum resultado para a busca')).toBeInTheDocument();
    });

    it('mostra o estado de carregando e o de erro no lugar da lista disponível', () => {
      const { rerender } = render(
        <EzDoubleList
          available={available}
          selected={selected}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onAvailableSearch={vi.fn()}
          availableStatus="loading"
        />
      );
      expect(screen.getByText('Carregando…')).toBeInTheDocument();

      rerender(
        <EzDoubleList
          available={available}
          selected={selected}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onAvailableSearch={vi.fn()}
          availableStatus="error"
        />
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a lista');
      expect(screen.queryByText('Item A')).not.toBeInTheDocument();
    });
  });
});
