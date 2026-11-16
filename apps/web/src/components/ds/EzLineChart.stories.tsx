import type { Meta, StoryObj } from '@storybook/react-vite';
import { EzLineChart } from './EzLineChart';

/**
 * Aponta DS Line Chart — gráfico de linhas em SVG próprio, sem biblioteca. Eixo Y com 0, valor
 * médio e máximo; rótulos do eixo X escolhidos pela largura do contêiner (no máximo 4 abaixo
 * de 640 px e 7 acima, sempre com o último ponto); tooltip por hover, foco de teclado e toque.
 * O último ponto pode ser parcial (dia de hoje ainda aberto).
 */
const meta: Meta<typeof EzLineChart> = {
  title: 'DS/EzLineChart',
  component: EzLineChart,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzLineChart>;

const week = ['09/11/2026', '10/11/2026', '11/11/2026', '12/11/2026', '13/11/2026', '14/11/2026', '15/11/2026'];

export const HorasPorDia: Story = {
  args: {
    ariaLabel: 'Horas apontadas por dia',
    xLabels: week,
    series: [{ name: 'Horas apontadas', color: 'brand-600', values: [6, 7.5, 8, 4, 8.5, 0, 3] }],
    formatValue: (value) => `${value.toFixed(1).replace('.', ',')} h`,
    partialLast: true,
  },
};

export const TresSeries: Story = {
  args: {
    ariaLabel: 'Tickets nos últimos dias',
    xLabels: Array.from({ length: 30 }, (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/10/2026`),
    series: [
      { name: 'Criados', color: 'brand-600', values: Array.from({ length: 30 }, (_, i) => 3 + (i % 7)) },
      { name: 'Fechados', color: 'green-600', values: Array.from({ length: 30 }, (_, i) => 2 + (i % 5)) },
      { name: 'Cancelados', color: 'gray-500', values: Array.from({ length: 30 }, (_, i) => i % 3) },
    ],
  },
};
