import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EzSegmented } from './EzSegmented';

/**
 * Aponta DS Segmented control: alterna entre visões do mesmo conteúdo, como
 * Lista/Kanban no cabeçalho de Tickets. Botões com `aria-pressed` num grupo nomeado.
 */
const meta: Meta<typeof EzSegmented> = {
  title: 'DS/EzSegmented',
  component: EzSegmented,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzSegmented>;

export const ListaKanban: Story = {
  render: () => {
    function Demo() {
      const [value, setValue] = useState<'list' | 'kanban'>('kanban');
      return (
        <EzSegmented
          aria-label="Visualização"
          value={value}
          onChange={setValue}
          options={[
            { value: 'list', label: 'Lista' },
            { value: 'kanban', label: 'Kanban' },
          ]}
        />
      );
    }
    return <Demo />;
  },
};

const listaKanban = [
  { value: 'list', label: 'Lista' },
  { value: 'kanban', label: 'Kanban' },
];

/** `default` (42 px) e `toolbar` (36 px a partir de `sm`, 44 px abaixo), lado a lado. */
export const Tamanhos: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <EzSegmented aria-label="Visualização padrão" size="default" value="list" onChange={() => undefined} options={listaKanban} />
      <EzSegmented aria-label="Visualização da barra" size="toolbar" value="list" onChange={() => undefined} options={listaKanban} />
    </div>
  ),
};

export const ComOpcaoDesabilitada: Story = {
  args: {
    'aria-label': 'Visualização',
    value: 'list',
    onChange: () => undefined,
    options: [
      { value: 'list', label: 'Lista' },
      { value: 'kanban', label: 'Kanban', disabled: true },
    ],
  },
};

export const TresOpcoes: Story = {
  args: {
    'aria-label': 'Período',
    value: 'week',
    onChange: () => undefined,
    options: [
      { value: 'day', label: 'Dia' },
      { value: 'week', label: 'Semana' },
      { value: 'month', label: 'Mês' },
    ],
  },
};
