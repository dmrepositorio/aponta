import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EzEntityToolbar } from './EzEntityToolbar';

/**
 * Aponta DS Entity Toolbar. Abaixo de 640 px a linha de botões rola e o contador de
 * registros fica numa linha própria, fora da área que rola (DMTE-531). O Storybook não
 * tem addon de viewport: para ver o caso estreito, reduza a janela do navegador abaixo de 640 px.
 */
const meta: Meta<typeof EzEntityToolbar> = {
  title: 'DS/EzEntityToolbar',
  component: EzEntityToolbar,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzEntityToolbar>;

function Demo() {
  const [mode, setMode] = useState<'GRID' | 'FORM'>('GRID');
  return (
    <EzEntityToolbar
      viewMode={mode}
      onToggleViewMode={setMode}
      onToggleFilter={() => undefined}
      onInsert={() => undefined}
      onPrevious={() => undefined}
      onNext={() => undefined}
      onDelete={() => undefined}
      onClone={() => undefined}
      onRefresh={() => undefined}
      onOpenAttachments={() => undefined}
      onOpenScreenConfig={() => undefined}
      actions={[{ label: 'Exportar', onClick: () => undefined }]}
      recordCountText="1 - 4 de 4"
    />
  );
}

export const Default: Story = { render: () => <Demo /> };

/** MSA-09: `cloneTooltip` avisa o que o Duplicar copia (aqui, só o nome). Selecione uma linha para o tooltip aparecer. */
export const CloneTooltip: Story = {
  render: () => (
    <EzEntityToolbar
      viewMode="GRID"
      onClone={() => undefined}
      selectedCount={1}
      cloneTooltip="Duplicar (copia só o nome)"
    />
  ),
};
