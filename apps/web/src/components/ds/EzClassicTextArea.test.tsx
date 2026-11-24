import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzClassicTextArea } from './EzClassicTextArea';

describe('EzClassicTextArea', () => {
  it('renders the label correctly', () => {
    render(<EzClassicTextArea label="Observações" />);
    expect(screen.getByText('Observações')).toBeInTheDocument();
  });

  it('accepts text input and fires onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EzClassicTextArea label="Observações" onChange={onChange} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Conteúdo de teste');

    expect(onChange).toHaveBeenCalled();
    expect(textarea).toHaveValue('Conteúdo de teste');
  });

  it('applies square (classic) corners to the wrapper', () => {
    render(<EzClassicTextArea label="Observações" />);
    const wrapper = screen.getByRole('textbox').parentElement;
    expect(wrapper).toHaveClass('rounded-none');
  });

  it('shows error message styling when hasError is true', () => {
    render(<EzClassicTextArea message="Campo obrigatório" hasError />);
    const msgContainer = screen.getByText('Campo obrigatório').closest('div');
    expect(msgContainer).toHaveClass('text-red-700');
  });

  it('renders disabled state correctly', () => {
    render(<EzClassicTextArea label="Observações" disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

describe('EzClassicTextArea aria de erro (DS-08)', () => {
  it('com hasError marca aria-invalid e associa a mensagem como descrição acessível', () => {
    render(<EzClassicTextArea id="campo" label="Campo" hasError message="Valor inválido" />);
    const control = screen.getByLabelText('Campo');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription('Valor inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });

  it('sem erro não marca aria-invalid nem anuncia a mensagem como alerta', () => {
    render(<EzClassicTextArea id="campo" label="Campo" message="Dica" />);
    const control = screen.getByLabelText('Campo');
    expect(control).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserva o aria-describedby do consumidor junto ao da mensagem de erro', () => {
    render(
      <>
        <p id="ajuda-externa">Ajuda externa</p>
        <EzClassicTextArea id="campo" label="Campo" hasError message="Valor inválido" aria-describedby="ajuda-externa" />
      </>,
    );
    expect(screen.getByLabelText('Campo')).toHaveAccessibleDescription('Ajuda externa Valor inválido');
  });
});

describe('EzClassicTextArea foco do campo (DS-10)', () => {
  it('usa o contorno único de 2px do DS no wrapper e não o ring-1 brand-600', () => {
    render(<EzClassicTextArea id="campo" label="Campo" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('ez-focus-within');
    expect(wrapper).not.toHaveClass('focus-within:ring-1');
    expect(wrapper).not.toHaveClass('focus-within:ring-brand-600');
  });

  it('em erro mantém a cor de erro no contorno de foco', () => {
    render(<EzClassicTextArea id="campo" label="Campo" hasError message="Valor inválido" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('border-red-600');
    expect(wrapper).toHaveClass('[--color-focus:var(--color-red-600)]');
    expect(wrapper).not.toHaveClass('focus-within:border-brand-600');
  });
});
