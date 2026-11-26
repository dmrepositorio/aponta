import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Trash2 } from 'lucide-react';
import { EzButton } from './EzButton';

/**
 * Aponta DS Button — inspirado no @sankhyalabs/ezui, reimplementado em
 * React + Tailwind (sem dependência do pacote original).
 */
const meta: Meta<typeof EzButton> = {
  title: 'DS/EzButton',
  component: EzButton,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'tertiary'] },
    size: { control: 'select', options: ['x-small', 'small', 'medium', 'large'] },
    loading: { control: 'boolean' },
    disabledReason: { control: 'text' },
    type: {
      control: 'select',
      options: ['button', 'submit', 'reset'],
      description: 'Padrão "button": só envia formulário com type="submit" explícito.',
    },
  },
};
export default meta;

type Story = StoryObj<typeof EzButton>;

export const Primary: Story = {
  args: { label: 'Cadastrar', variant: 'primary' },
};

export const Secondary: Story = {
  args: { label: 'Buscar CNPJ', variant: 'secondary', leftIcon: Plus },
};

export const Tertiary: Story = {
  args: { label: 'Remover', variant: 'tertiary', leftIcon: Trash2 },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <EzButton label="x-small" size="x-small" />
      <EzButton label="small" size="small" />
      <EzButton label="medium" size="medium" />
      <EzButton label="large" size="large" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { label: 'Indisponível', disabled: true },
};

export const Loading: Story = {
  args: { label: 'Salvar', loading: true },
  parameters: {
    docs: {
      description: {
        story:
          'Ação assíncrona em andamento: aria-busy, spinner e clique bloqueado (onClick não dispara).',
      },
    },
  },
};

export const LoadingVariants: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <EzButton label="Primário" loading />
      <EzButton label="Secundário" variant="secondary" loading />
      <EzButton label="Terciário" variant="tertiary" loading />
    </div>
  ),
};

export const DisabledWithReason: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <EzButton label="Aprovar" disabled disabledReason="Preencha o cliente para aprovar" />
      <EzButton
        label="Buscar CNPJ"
        variant="secondary"
        disabled
        disabledReason="Informe o CNPJ antes de buscar"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'O motivo fica em aria-describedby (texto oculto) e title; funciona mesmo onde title não aparece em botão desabilitado.',
      },
    },
  },
};

export const IconOnly: Story = {
  args: { leftIcon: Trash2, variant: 'tertiary', 'aria-label': 'Remover item' },
};
