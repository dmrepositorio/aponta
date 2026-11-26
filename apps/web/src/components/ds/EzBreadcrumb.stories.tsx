import type { Meta, StoryObj } from '@storybook/react-vite';
import { Home } from 'lucide-react';
import { EzBreadcrumb } from './EzBreadcrumb';

/**
 * Aponta DS Breadcrumb
 * Indica a localização atual da página dentro de uma hierarquia de
 * navegação. Cada item pode ser um link (`href`), um botão (`onClick`)
 * ou texto estático; o último item da lista recebe `aria-current="page"`
 * e não é clicável. Usado para navegação entre organizações, clientes
 * e chamados. O nav se chama "Trilha de navegação"; os chevrons são aria-hidden.
 * Em tela estreita (< 640px) trilhas com mais de 3 itens colapsam os intermediários
 * numa reticência em botão que os revela.
 */
const meta: Meta<typeof EzBreadcrumb> = {
  title: 'DS/EzBreadcrumb',
  component: EzBreadcrumb,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof EzBreadcrumb>;

export const Simples: Story = {
  args: {
    items: [{ label: 'Chamados', href: '/chamados' }, { label: 'Chamado #4821' }],
  },
};

export const ComLinksClicaveis: Story = {
  args: {
    items: [
      { label: 'Organizações', href: '/organizacoes' },
      { label: 'Social Tecnologia', href: '/organizacoes/social-tecnologia' },
      { label: 'Contratos' },
    ],
  },
};

export const ComAcaoViaOnClick: Story = {
  args: {
    items: [
      { label: 'Clientes', onClick: () => undefined },
      { label: 'Maria Silva', onClick: () => undefined },
      { label: 'Chamado #4790' },
    ],
  },
};

export const ComIcones: Story = {
  args: {
    items: [
      { label: 'Início', href: '/', icon: <Home className="w-4 h-4" /> },
      { label: 'Chamados', href: '/chamados' },
      { label: 'SLA em risco' },
    ],
  },
};

export const HierarquiaProfunda: Story = {
  args: {
    items: [
      { label: 'Organizações', href: '/organizacoes' },
      { label: 'Social Tecnologia', href: '/organizacoes/social-tecnologia' },
      { label: 'Contratos', href: '/organizacoes/social-tecnologia/contratos' },
      { label: 'Manutenção Mensal', href: '/organizacoes/social-tecnologia/contratos/manutencao' },
      { label: 'Chamado #4821' },
    ],
  },
};

/** Em viewport estreito os intermediários viram "…" (botão "Mostrar itens intermediários"). */
export const ColapsoEmTelaEstreita: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  args: HierarquiaProfunda.args,
};
