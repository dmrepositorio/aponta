import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EzMoneyInput, type EzMoneyInputProps } from './EzMoneyInput';

/**
 * Aponta DS Money Input — campo de dinheiro pt-BR com máscara "R$ 1.234,56". O valor é um inteiro em
 * centavos (sem ponto flutuante): vazio é `null` e zero é um valor válido. É um campo de texto com teclado
 * decimal, sem setas nem roda do mouse, e recusa "e", sinal negativo e letras. A vírgula separa os centavos;
 * ao colar, formatos ambíguos como "1,234" são recusados. Ao apagar dígitos, o ponto é sempre o de milhar da máscara ("R$ 1.500" sem o último dígito é "R$ 150"); um ponto digitado no fim vira a vírgula decimal. Use no lugar de `type="number"` para preço, tarifa
 * e mensalidade.
 */
const meta: Meta<typeof EzMoneyInput> = {
  title: 'DS/EzMoneyInput',
  component: EzMoneyInput,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzMoneyInput>;

function Controlled(
  args: Partial<EzMoneyInputProps> & { start: number | null },
) {
  const { start, ...props } = args;
  const [value, setValue] = useState<number | null>(start);
  return (
    <div className="w-72 space-y-2">
      <EzMoneyInput {...props} value={value} onChange={setValue} />
      <p className="text-xs text-gray-500">
        Centavos: {value === null ? 'vazio (null)' : value}
      </p>
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <Controlled id="money-default" label="Valor mensal (R$)" start={null} />
  ),
};

export const ComValor: Story = {
  render: () => (
    <Controlled id="money-value" label="Hora excedente (R$)" start={123456} />
  ),
};

export const ZeroEValido: Story = {
  render: () => (
    <Controlled
      id="money-zero"
      label="Hora excedente (R$)"
      message="Zero é uma tarifa válida; campo vazio quer dizer não informado."
      start={0}
    />
  ),
};

export const ComErro: Story = {
  render: () => (
    <Controlled
      id="money-error"
      label="Preço fechado (R$)"
      hasError
      message="Informe o preço fechado para aprovar."
      start={null}
    />
  ),
};

export const ComLimite: Story = {
  render: () => (
    <Controlled
      id="money-max"
      label="Preço fechado (R$)"
      max={2147483647}
      message="Acima de R$ 21.474.836,47 a digitação é recusada."
      start={null}
    />
  ),
};

export const Desabilitado: Story = {
  render: () => (
    <Controlled
      id="money-disabled"
      label="Valor mensal (R$)"
      disabled
      start={850000}
    />
  ),
};
