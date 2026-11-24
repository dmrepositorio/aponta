import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzTextArea } from './EzTextArea';

describe('EzTextArea', () => {
  it('renders without label or message', () => {
    render(<EzTextArea placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
  });

  it('renders label and required indicator', () => {
    render(<EzTextArea label="Notes" required />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('renders error state and message', () => {
    render(<EzTextArea label="Bio" hasError message="Too short" />);
    expect(screen.getByText('Too short')).toBeInTheDocument();
    // Label should get red class
    expect(screen.getByText('Bio')).toHaveClass('text-red-700');
  });

  it('allows user input', async () => {
    const user = userEvent.setup();
    const mockOnChange = vi.fn();
    render(<EzTextArea placeholder="Type here" onChange={mockOnChange} />);
    
    const textarea = screen.getByPlaceholderText('Type here');
    await user.type(textarea, 'Hello world');
    expect(textarea).toHaveValue('Hello world');
    expect(mockOnChange).toHaveBeenCalled();
  });

  it('is disabled and prevents typing', async () => {
    const user = userEvent.setup();
    const mockOnChange = vi.fn();
    render(<EzTextArea disabled placeholder="Locked" onChange={mockOnChange} />);
    
    const textarea = screen.getByPlaceholderText('Locked');
    expect(textarea).toBeDisabled();
    
    await user.type(textarea, 'try to edit');
    expect(textarea).not.toHaveValue('try to edit');
    expect(mockOnChange).not.toHaveBeenCalled();
  });
});

describe('EzTextArea aria de erro (DS-08)', () => {
  it('com hasError marca aria-invalid e associa a mensagem como descrição acessível', () => {
    render(<EzTextArea id="campo" label="Campo" hasError message="Valor inválido" />);
    const control = screen.getByLabelText('Campo');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription('Valor inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });

  it('sem erro não marca aria-invalid nem anuncia a mensagem como alerta', () => {
    render(<EzTextArea id="campo" label="Campo" message="Dica" />);
    const control = screen.getByLabelText('Campo');
    expect(control).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserva o aria-describedby do consumidor junto ao da mensagem de erro', () => {
    render(
      <>
        <p id="ajuda-externa">Ajuda externa</p>
        <EzTextArea id="campo" label="Campo" hasError message="Valor inválido" aria-describedby="ajuda-externa" />
      </>,
    );
    expect(screen.getByLabelText('Campo')).toHaveAccessibleDescription('Ajuda externa Valor inválido');
  });
});

describe('EzTextArea rótulo e obrigatório (DS-09)', () => {
  it('associa o rótulo ao campo mesmo sem a prop id', () => {
    render(<EzTextArea label="Nome" />);
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('esconde o asterisco de obrigatório dos leitores de tela e marca aria-required', () => {
    render(<EzTextArea id="nome" label="Nome" required />);
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-required', 'true');
  });

  it('mantém o id informado pelo consumidor', () => {
    render(<EzTextArea label="Nome" id="nome-fixo" />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute('id', 'nome-fixo');
  });
});

describe('EzTextArea foco do campo (DS-10)', () => {
  it('usa o contorno único de 2px do DS no wrapper e não o ring-1 brand-600', () => {
    render(<EzTextArea id="campo" label="Campo" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('ez-focus-within');
    expect(wrapper).not.toHaveClass('focus-within:ring-1');
    expect(wrapper).not.toHaveClass('focus-within:ring-brand-600');
  });

  it('em erro mantém a cor de erro no contorno de foco', () => {
    render(<EzTextArea id="campo" label="Campo" hasError message="Valor inválido" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('border-red-600');
    expect(wrapper).toHaveClass('[--color-focus:var(--color-red-600)]');
    expect(wrapper).not.toHaveClass('focus-within:border-brand-600');
  });
});
