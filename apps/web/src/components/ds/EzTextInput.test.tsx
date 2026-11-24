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

describe('EzTextInput rótulo e obrigatório (DS-09)', () => {
  it('associa o rótulo ao campo mesmo sem a prop id', () => {
    render(<EzTextInput label="Nome" />);
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('esconde o asterisco de obrigatório dos leitores de tela e marca aria-required', () => {
    render(<EzTextInput id="nome" label="Nome" required />);
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-required', 'true');
  });

  it('mantém o id informado pelo consumidor', () => {
    render(<EzTextInput label="Nome" id="nome-fixo" />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute('id', 'nome-fixo');
  });
});

describe('EzTextInput foco do campo (DS-10)', () => {
  it('usa o contorno único de 2px do DS no wrapper e não o ring-1 brand-600', () => {
    render(<EzTextInput id="campo" label="Campo" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('ez-focus-within');
    expect(wrapper).not.toHaveClass('focus-within:ring-1');
    expect(wrapper).not.toHaveClass('focus-within:ring-brand-600');
  });

  it('em erro mantém a cor de erro no contorno de foco', () => {
    render(<EzTextInput id="campo" label="Campo" hasError message="Valor inválido" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('border-red-600');
    expect(wrapper).toHaveClass('[--color-focus:var(--color-red-600)]');
    expect(wrapper).not.toHaveClass('focus-within:border-brand-600');
  });
});
