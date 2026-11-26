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

/**
 * DS-26: quando a lista excede a largura (390px) as bordas com abas escondidas mostram
 * um gradiente e a aba ativa rola para a vista. Aba desabilitada usa `text-gray-400`
 * (contraste acima de 3:1) em vez de `opacity-50`. O gradiente é visual: confira no
 * viewport estreito do Storybook (mobile).
 */
export const OverflowEmTelaEstreita: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => {
    const tabs = [
      { id: 'geral', label: 'Visão geral' },
      { id: 'apontamentos', label: 'Apontamentos' },
      { id: 'anexos', label: 'Anexos' },
      { id: 'historico', label: 'Histórico' },
      { id: 'sla', label: 'SLA e prazos' },
      { id: 'cofre', label: 'Cofre', disabled: true },
      { id: 'auditoria', label: 'Auditoria' },
    ];
    function Demo() {
      const [active, setActive] = useState<string | number>('geral');
      return (
        <div style={{ width: 390 }}>
          <EzTabs tabs={tabs} activeTab={active} onChange={setActive} />
        </div>
      );
    }
    return <Demo />;
  },
};

