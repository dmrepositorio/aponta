import type { Meta, StoryObj } from '@storybook/react-vite';
import { EzBadge } from './EzBadge';

/**
 * Aponta DS Badge
 * Indicador numérico ou de status, geralmente um círculo ou retângulo
 * arredondado. Suporta 4 tamanhos (`x-small` a `large`) e cores
 * customizadas via `colorClass`. Usado para contagem de chamados
 * pendentes, notificações e indicadores de prioridade/SLA.
 *
 * **Acessibilidade:** todo contador (conteúdo só numérico, como "3") deve
 * receber `aria-label` com a unidade, por exemplo `aria-label="3 chamados"`.
 * O tamanho `x-small` tem no mínimo 16px e fonte de 11px. A cor padrão tem
 * contraste AA; com `colorClass`, mantenha o contraste AA.
 */
const meta: Meta<typeof EzBadge> = {
  title: 'DS/EzBadge',
  component: EzBadge,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzBadge>;

export const Padrao: Story = {
  args: {
    'aria-label': '3 chamados',
    children: '3',
  },
};

export const ContadorDeChamados: Story = {
  args: {
    size: 'large',
    colorClass: 'bg-red-500 text-white',
    'aria-label': '12 chamados pendentes',
    children: '12',
  },
};

export const SlaEmDia: Story = {
  args: {
    size: 'small',
    colorClass: 'bg-green-500 text-white',
    children: 'OK',
  },
};

export const SlaVencendo: Story = {
  args: {
    size: 'medium',
    colorClass: 'bg-yellow-500 text-gray-900',
    children: '!',
  },
};

export const Minimo: Story = {
  args: {
    size: 'x-small',
    colorClass: 'bg-ocean-500 text-white',
    'aria-label': '2 notificações',
    children: '2',
  },
};
