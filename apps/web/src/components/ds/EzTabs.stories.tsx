import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EzTabs, ezTabId, ezTabPanelId } from './EzTabs';

/**
 * Aponta DS Tabs — usada nas abas do painel de detalhe das organizações
 * (Usuários / Recursos / Relacionamentos / Faturamento, issue #57).
 */
const meta: Meta<typeof EzTabs> = {
  title: 'DS/EzTabs',
  component: EzTabs,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzTabs>;

const organizationDetailTabs = [
  { id: 'users', label: 'Usuários' },
  { id: 'resources', label: 'Recursos' },
  { id: 'relationships', label: 'Relacionamentos' },
  { id: 'billing', label: 'Faturamento' },
];

export const OrganizationDetailTabs: Story = {
  render: () => {
    function Demo() {
      const [active, setActive] = useState<string | number>('users');
      return <EzTabs tabs={organizationDetailTabs} activeTab={active} onChange={setActive} />;
    }
    return <Demo />;
  },
};

export const PillsVariant: Story = {
  render: () => {
    function Demo() {
      const [active, setActive] = useState<string | number>('resources');
      return (
        <EzTabs
          tabs={organizationDetailTabs}
          activeTab={active}
          onChange={setActive}
          variant="pills"
        />
      );
    }
    return <Demo />;
  },
};

/**
 * Com `idPrefix` cada aba ganha `id` e `aria-controls`; o consumidor monta o painel
 * com `ezTabId` e `ezTabPanelId`. Teclado: Tab entra na aba ativa; setas, Home e End
 * movem o foco e ativam a aba vizinha habilitada.
 */
export const WithPanelAndKeyboard: Story = {
  render: () => {
    function Demo() {
      const [active, setActive] = useState<string | number>('resources');
      return (
        <div className="space-y-3">
          <EzTabs
            tabs={[...organizationDetailTabs, { id: 'archived', label: 'Arquivados', disabled: true }]}
            activeTab={active}
            onChange={setActive}
            variant="pills"
            idPrefix="demo-tabs"
          />
          <div
            role="tabpanel"
            id={ezTabPanelId('demo-tabs', active)}
            aria-labelledby={ezTabId('demo-tabs', active)}
            className="rounded-card border border-gray-200 p-4 text-[14px] text-gray-700"
          >
            Painel da aba “{organizationDetailTabs.find((tab) => tab.id === active)?.label}”.
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};
