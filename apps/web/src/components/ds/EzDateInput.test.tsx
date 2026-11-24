import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EzDateInput } from './EzDateInput';

describe('EzDateInput', () => {
  it('renders standard date input correctly', () => {
    render(<EzDateInput data-testid="date-in" />);
    const input = screen.getByTestId('date-in');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'date');
  });

  it('renders a label if provided', () => {
    render(<EzDateInput id="dt-my" label="Start Date" />);
    expect(screen.getByText('Start Date')).toBeInTheDocument();
  });

  it('renders required indicator if required is true', () => {
    render(<EzDateInput label="Required Date" required />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('calls onChange when user inputs a value', async () => {
    const onChangeMock = vi.fn();
    render(<EzDateInput data-testid="date-in" onChange={onChangeMock} />);
    const input = screen.getByTestId('date-in');
    
    await userEvent.type(input, '2023-10-31');
    expect(onChangeMock).toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('2023-10-31');
  });

  it('shows message text', () => {
    render(<EzDateInput message="Format: MM/DD/YYYY" />);
    expect(screen.getByText('Format: MM/DD/YYYY')).toBeInTheDocument();
  });

  it('applies error state styling', () => {
    render(
      <EzDateInput data-testid="date-in" hasError message="Invalid date" label="End Date" />
    );
    expect(screen.getByText('Invalid date')).toBeInTheDocument();
    
    const wrapper = screen.getByTestId('date-in').parentElement;
    expect(wrapper).toHaveClass('border-red-600');
  });

  it('applies disabled state', () => {
    render(<EzDateInput data-testid="date-in" disabled />);
    const input = screen.getByTestId('date-in');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('cursor-not-allowed');
  });

  it('calls showPicker when the wrapper is clicked', async () => {
    const showPickerMock = vi.fn();
    // HTMLInputElement.prototype.showPicker is not implemented in jsdom by default
    HTMLInputElement.prototype.showPicker = showPickerMock;
    
    render(<EzDateInput data-testid="date-in" />);
    const input = screen.getByTestId('date-in');
    const wrapper = input.parentElement;
    
    if (wrapper) {
      await userEvent.click(wrapper);
    }
    
    expect(showPickerMock).toHaveBeenCalledTimes(1);
    
    // Clean up
    delete (HTMLInputElement.prototype as any).showPicker;
  });
});
describe('EzDateInput aria de erro (DS-08)', () => {
  it('com hasError marca aria-invalid e associa a mensagem como descrição acessível', () => {
    render(<EzDateInput id="campo" label="Campo" hasError message="Valor inválido" />);
    const control = screen.getByLabelText('Campo');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription('Valor inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });

  it('sem erro não marca aria-invalid nem anuncia a mensagem como alerta', () => {
    render(<EzDateInput id="campo" label="Campo" message="Dica" />);
    const control = screen.getByLabelText('Campo');
    expect(control).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserva o aria-describedby do consumidor junto ao da mensagem de erro', () => {
    render(
      <>
        <p id="ajuda-externa">Ajuda externa</p>
        <EzDateInput id="campo" label="Campo" hasError message="Valor inválido" aria-describedby="ajuda-externa" />
      </>,
    );
    expect(screen.getByLabelText('Campo')).toHaveAccessibleDescription('Ajuda externa Valor inválido');
  });
});

describe('EzDateInput rótulo e obrigatório (DS-09)', () => {
  it('associa o rótulo ao campo mesmo sem a prop id', () => {
    render(<EzDateInput label="Nome" />);
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('esconde o asterisco de obrigatório dos leitores de tela e marca aria-required', () => {
    render(<EzDateInput id="nome" label="Nome" required />);
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-required', 'true');
  });

  it('mantém o id informado pelo consumidor', () => {
    render(<EzDateInput label="Nome" id="nome-fixo" />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute('id', 'nome-fixo');
  });
});

describe('EzDateInput foco do campo (DS-10)', () => {
  it('usa o contorno único de 2px do DS no wrapper e não o ring-1 brand-600', () => {
    render(<EzDateInput id="campo" label="Campo" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('ez-focus-within');
    expect(wrapper).not.toHaveClass('focus-within:ring-1');
    expect(wrapper).not.toHaveClass('focus-within:ring-brand-600');
  });

  it('em erro mantém a cor de erro no contorno de foco', () => {
    render(<EzDateInput id="campo" label="Campo" hasError message="Valor inválido" />);
    const wrapper = screen.getByLabelText('Campo').parentElement;
    expect(wrapper).toHaveClass('border-red-600');
    expect(wrapper).toHaveClass('[--color-focus:var(--color-red-600)]');
    expect(wrapper).not.toHaveClass('focus-within:border-brand-600');
  });
});

describe('EzDateInput ref e ícone de calendário (DS-12)', () => {
  const original = (HTMLInputElement.prototype as any).showPicker;
  afterEach(() => {
    if (original) (HTMLInputElement.prototype as any).showPicker = original;
    else delete (HTMLInputElement.prototype as any).showPicker;
  });

  it('com ref de função, entrega o input ao consumidor e o ícone abre o seletor', async () => {
    const showPicker = vi.fn();
    (HTMLInputElement.prototype as any).showPicker = showPicker;
    const refFn = vi.fn();
    render(<EzDateInput id="dt" label="Data" ref={refFn} />);
    expect(refFn).toHaveBeenCalledWith(screen.getByLabelText('Data'));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }));
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('com ref de função, clicar na caixa do campo abre o seletor (referência interna preservada)', async () => {
    const showPicker = vi.fn();
    (HTMLInputElement.prototype as any).showPicker = showPicker;
    render(<EzDateInput id="dt" label="Data" ref={() => undefined} />);
    await userEvent.click(screen.getByLabelText('Data').parentElement as HTMLElement);
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('com ref de objeto, preserva a referência e o ícone abre o seletor', async () => {
    const showPicker = vi.fn();
    (HTMLInputElement.prototype as any).showPicker = showPicker;
    const refObj = createRef<HTMLInputElement>();
    render(<EzDateInput id="dt" label="Data" ref={refObj} />);
    expect(refObj.current).toBe(screen.getByLabelText('Data'));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }));
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('o ícone é um botão focável por teclado que abre o seletor com Enter', async () => {
    const showPicker = vi.fn();
    (HTMLInputElement.prototype as any).showPicker = showPicker;
    const user = userEvent.setup();
    render(<EzDateInput id="dt" label="Data" />);
    const button = screen.getByRole('button', { name: 'Abrir calendário' });
    expect(button).not.toHaveAttribute('tabindex', '-1');
    button.focus();
    await user.keyboard('{Enter}');
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('desabilitado, o botão do ícone fica desabilitado e não abre o seletor', async () => {
    const showPicker = vi.fn();
    (HTMLInputElement.prototype as any).showPicker = showPicker;
    render(<EzDateInput id="dt" label="Data" disabled />);
    const button = screen.getByRole('button', { name: 'Abrir calendário' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(showPicker).not.toHaveBeenCalled();
  });
});
