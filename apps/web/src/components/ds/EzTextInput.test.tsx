import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EzTextInput } from './EzTextInput';

describe('EzTextInput', () => {
  it('renders input with a label', () => {
    render(<EzTextInput label="Email Address" id="email" />);
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
  });

  it('renders required star if required is true', () => {
    render(<EzTextInput label="Name" id="name" required />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('renders error message and red borders when hasError is true', () => {
    render(<EzTextInput hasError message="Campo inválido" />);
    expect(screen.getByText('Campo inválido')).toBeInTheDocument();
    const msgContainer = screen.getByText('Campo inválido').closest('div');
    expect(msgContainer).toHaveClass('text-red-700');
  });

  it('toggles password visibility when type is password', () => {
    // Note: React testing library events could be used here. For now we just test it renders the toggle.
    const { container } = render(<EzTextInput type="password" />);
    const toggleBtn = container.querySelector('button');
    expect(toggleBtn).toBeInTheDocument();
  });

  it('disables input when disabled prop is passed', () => {
    render(<EzTextInput disabled placeholder="Locked" />);
    expect(screen.getByPlaceholderText('Locked')).toBeDisabled();
  });
});

describe('EzTextInput aria de erro (DS-08)', () => {
  it('com hasError marca aria-invalid e associa a mensagem como descrição acessível', () => {
    render(<EzTextInput id="campo" label="Campo" hasError message="Valor inválido" />);
    const control = screen.getByLabelText('Campo');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription('Valor inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });

  it('sem erro não marca aria-invalid nem anuncia a mensagem como alerta', () => {
    render(<EzTextInput id="campo" label="Campo" message="Dica" />);
    const control = screen.getByLabelText('Campo');
    expect(control).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserva o aria-describedby do consumidor junto ao da mensagem de erro', () => {
    render(
      <>
        <p id="ajuda-externa">Ajuda externa</p>
        <EzTextInput id="campo" label="Campo" hasError message="Valor inválido" aria-describedby="ajuda-externa" />
      </>,
    );
    expect(screen.getByLabelText('Campo')).toHaveAccessibleDescription('Ajuda externa Valor inválido');
  });
});
