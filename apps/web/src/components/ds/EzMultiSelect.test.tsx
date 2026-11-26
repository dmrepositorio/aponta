import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzMultiSelect } from './EzMultiSelect';

describe('EzMultiSelect', () => {
  const defaultOptions = [
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
    { label: 'Cherry', value: 'cherry' },
  ];

  it('renders properly with placeholder when empty', () => {
    render(<EzMultiSelect placeholder="Choose fruits" options={defaultOptions} />);
    expect(screen.getByPlaceholderText('Choose fruits')).toBeInTheDocument();
  });

  it('shows options when clicked/focused', async () => {
    const user = userEvent.setup();
    render(<EzMultiSelect options={defaultOptions} />);
    
    const input = screen.getByRole('combobox');
    await user.click(input);
    
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });

  it('calls onChange when an option is selected', async () => {
    const mockChange = vi.fn();
    const user = userEvent.setup();
    render(<EzMultiSelect options={defaultOptions} value={[]} onChange={mockChange} />);
    
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Banana'));
    
    expect(mockChange).toHaveBeenCalledWith(['banana']);
  });

  it('renders selected values as tags', () => {
    render(<EzMultiSelect options={defaultOptions} value={['apple', 'cherry']} />);
    // EzTag renders the label text
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Cherry')).toBeInTheDocument();
  });

  it('removes an option from tags via X button', async () => {
    const mockChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<EzMultiSelect options={defaultOptions} value={['apple']} onChange={mockChange} />);
    
    // In EzMultiSelect, the tag remove is an X icon rendered by lucide-react inside EzTag
    // Since EzTag isn't fully expanded here, we can find the svg with cursor-pointer
    const removeIcon = container.querySelector('.cursor-pointer');
    expect(removeIcon).not.toBeNull();
    
    if (removeIcon) {
      await user.click(removeIcon);
      expect(mockChange).toHaveBeenCalledWith([]);
    }
  });

  it('filters options based on search input locally', async () => {
    const user = userEvent.setup();
    render(<EzMultiSelect options={defaultOptions} />);
    
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'app');
    
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('Banana')).not.toBeInTheDocument();
  });

  it('disables properly', () => {
    render(<EzMultiSelect options={defaultOptions} disabled />);
    
    const input = screen.queryByRole('combobox');
    expect(input).toBeDisabled();
  });

  it('clears all options when clear All button is clicked', async () => {
    const mockChange = vi.fn();
    const user = userEvent.setup();
    render(<EzMultiSelect options={defaultOptions} value={['apple', 'banana']} onChange={mockChange} />);
    
    const clearBtn = screen.getByTitle('Limpar todos');
    await user.click(clearBtn);
    expect(mockChange).toHaveBeenCalledWith([]);
  });

  it('displays validation errors', () => {
    render(<EzMultiSelect options={defaultOptions} label="Fruits" hasError message="Error msg" />);
    expect(screen.getByText('Error msg').parentElement).toHaveClass('text-red-700');
    expect(screen.getByText('Fruits')).toHaveClass('text-red-700');
  });
});

describe('EzMultiSelect rótulo e obrigatório (DS-09)', () => {
  it('associa o rótulo ao campo mesmo sem a prop id', () => {
    render(<EzMultiSelect label="Nome" options={[]} />);
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('esconde o asterisco de obrigatório dos leitores de tela e marca aria-required', () => {
    render(<EzMultiSelect id="nome" label="Nome" required options={[]} />);
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-required', 'true');
  });

  it('mantém o id informado pelo consumidor', () => {
    render(<EzMultiSelect label="Nome" id="nome-fixo" options={[]} />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute('id', 'nome-fixo');
  });
});

describe('EzMultiSelect combobox, listbox e teclado (DS-14)', () => {
  const opcoes = [
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
    { label: 'Cherry', value: 'cherry' },
  ];

  it('expõe o input como combobox com aria-expanded e aria-controls', async () => {
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} />);
    const combo = screen.getByRole('combobox', { name: 'Frutas' });
    expect(combo).toHaveAttribute('aria-expanded', 'false');
    await user.click(combo);
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    const lista = screen.getByRole('listbox');
    expect(combo).toHaveAttribute('aria-controls', lista.id);
    expect(lista).toHaveAttribute('aria-multiselectable', 'true');
  });

  it('lista as opções como option com aria-selected', async () => {
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} value={['banana']} />);
    await user.click(screen.getByRole('combobox'));
    const itens = screen.getAllByRole('option');
    expect(itens).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Banana' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'false');
  });

  it('ArrowDown move o ativo e Enter alterna a opção', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} value={[]} onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(['apple']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['banana']);
  });

  it('aria-activedescendant aponta para a opção ativa', async () => {
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} />);
    const combo = screen.getByRole('combobox');
    await user.click(combo);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(combo.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Banana' }).id);
  });

  it('Enter em opção já selecionada remove o valor', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} value={['apple']} onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('Escape fecha a lista', async () => {
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} />);
    const combo = screen.getByRole('combobox');
    await user.click(combo);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo).toHaveAttribute('aria-expanded', 'false');
  });

  it('o botão de remover a etiqueta tem aria-label e remove o valor', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EzMultiSelect label="Frutas" options={opcoes} value={['apple', 'cherry']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remover Apple' }));
    expect(onChange).toHaveBeenCalledWith(['cherry']);
  });

  it('erro: aria-invalid e mensagem associada por aria-describedby', () => {
    render(<EzMultiSelect label="Frutas" options={opcoes} hasError message="Escolha uma fruta" />);
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveAttribute('aria-invalid', 'true');
    expect(combo).toHaveAccessibleDescription('Escolha uma fruta');
  });
});
