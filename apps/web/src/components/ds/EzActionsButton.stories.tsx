import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Eye, Pencil, Trash2 } from 'lucide-react';
import { EzActionsButton } from './EzActionsButton';

/**
 * Aponta DS Actions Button — botão que abre um dropdown com ações
 * secundárias (Editar/Duplicar/Excluir) nas listagens de chamados,
 * contratos e clientes.
 */
const meta: Meta<typeof EzActionsButton> = {
  title: 'DS/EzActionsButton',
  component: EzActionsButton,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzActionsButton>;

export const Default: Story = {
  args: {
    label: 'Ações',
    actions: [
      { label: 'Editar contrato', onClick: () => undefined },
      { label: 'Duplicar contrato', onClick: () => undefined },
      { label: 'Excluir contrato', danger: true, onClick: () => undefined },
    ],
  },
};

export const ComIcones: Story = {
  args: {
    label: 'Ações',
    actions: [
      { label: 'Ver chamado', icon: <Eye className="w-4 h-4" />, onClick: () => undefined },
      { label: 'Editar chamado', icon: <Pencil className="w-4 h-4" />, onClick: () => undefined },
      { label: 'Duplicar chamado', icon: <Copy className="w-4 h-4" />, onClick: () => undefined },
      { label: 'Excluir chamado', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => undefined },
    ],
  },
};

export const AlinhadoAEsquerda: Story = {
  args: {
    label: 'Ações',
    align: 'left',
    actions: [
      { label: 'Editar cliente', onClick: () => undefined },
      { label: 'Ver contratos', onClick: () => undefined },
      { label: 'Excluir cliente', danger: true, onClick: () => undefined },
    ],
  },
};

export const ComAcaoDesabilitada: Story = {
  args: {
    label: 'Ações',
    actions: [
      { label: 'Reabrir chamado', onClick: () => undefined },
      { label: 'Faturar contrato', disabled: true, onClick: () => undefined },
      { label: 'Excluir chamado', danger: true, onClick: () => undefined },
    ],
  },
};

export const Desabilitado: Story = {
  args: {
    label: 'Ações',
    disabled: true,
    actions: [
      { label: 'Editar chamado', onClick: () => undefined },
      { label: 'Excluir chamado', danger: true, onClick: () => undefined },
    ],
  },
};

/** Teclado: Enter/Espaço abre o menu; Esc fecha e devolve o foco ao gatilho (F3-18, SCH-06). */
export const FechaComEsc: Story = {
  args: {
    label: 'Ações',
    actions: [
      { label: 'Novas Férias', icon: <Eye className="w-4 h-4" />, onClick: () => undefined },
      { label: 'Nova Ausência', icon: <Pencil className="w-4 h-4" />, onClick: () => undefined },
    ],
  },
  parameters: {
    docs: { description: { story: 'Abra com Enter ou Espaço e feche com Esc: o foco volta ao botão Ações.' } },
  },
};
