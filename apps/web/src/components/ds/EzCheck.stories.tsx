import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EzCheck } from './EzCheck';

/**
 * Aponta DS Checkbox — usado como toggle liso (ex.: "Visível para
 * clientes", "Faturamento quarteirizado", "Cliente ativo" no painel de
 * Organizações, #57).
 */
const meta: Meta<typeof EzCheck> = {
  title: 'DS/EzCheck',
  component: EzCheck,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzCheck>;

export const Default: Story = {
  args: { id: 'check-default', label: 'Faturamento quarteirizado' },
};

export const Checked: Story = {
  args: { id: 'check-checked', label: 'Visível para clientes', defaultChecked: true },
};

export const Disabled: Story = {
  args: { id: 'check-disabled', label: 'Cliente ativo', disabled: true, defaultChecked: true },
};

export const Interactive: Story = {
  render: () => {
    function Demo() {
      const [checked, setChecked] = useState(true);
      return (
        <EzCheck
          id="check-interactive"
          label={checked ? 'Cliente ativo' : 'Cliente inativo'}
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
      );
    }
    return <Demo />;
  },
};

/**
 * Foco por teclado (Tab): contorno de 2 px em `--color-focus` (brand-600) com folga de 2 px,
 * o foco único do DS. Use Tab para ver o anel; clique do mouse não o mostra (`:focus-visible`).
 */
export const KeyboardFocus: Story = {
  args: { id: 'check-focus', label: 'Use Tab para focar' },
};

/**
 * Estado indeterminado ("selecionar todos" com seleção parcial): traço no lugar do check,
 * `input.indeterminate` e `aria-checked="mixed"`. O clique do usuário o resolve para marcado.
 */
export const Indeterminate: Story = {
  render: () => {
    function Demo() {
      const itens = ['Chamados abertos', 'Chamados em andamento', 'Chamados resolvidos'];
      const [marcados, setMarcados] = useState<string[]>([itens[0]]);
      const todos = marcados.length === itens.length;
      return (
        <div className="flex flex-col gap-2">
          <EzCheck
            id="check-todos"
            label="Selecionar todos"
            indeterminate={marcados.length > 0 && !todos}
            checked={todos}
            onChange={() => setMarcados(todos ? [] : itens)}
          />
          {itens.map((item) => (
            <EzCheck
              key={item}
              id={`check-${item}`}
              className="ml-6"
              label={item}
              checked={marcados.includes(item)}
              onChange={() =>
                setMarcados((atual) => (atual.includes(item) ? atual.filter((i) => i !== item) : [...atual, item]))
              }
            />
          ))}
        </div>
      );
    }
    return <Demo />;
  },
};

/**
 * Erro com mensagem: ícone e texto (não só a cor), `aria-invalid` e a mensagem associada
 * ao checkbox por `aria-describedby`.
 */
export const ComErro: Story = {
  args: {
    id: 'check-erro',
    label: 'Li e aceito os termos de uso',
    hasError: true,
    message: 'Aceite os termos para continuar.',
  },
};
