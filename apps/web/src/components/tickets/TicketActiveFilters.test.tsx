import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TicketActiveFilters } from './TicketActiveFilters';

describe('TicketActiveFilters (AC-10)', () => {
  it('renders nothing when only paging and sorting are set', () => {
    const { container } = render(
      <TicketActiveFilters
        filters={{ page: 3, sortBy: 'title', sortDir: 'asc', agentIds: ['a1'] }}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each active filter in a named group', () => {
    render(
      <TicketActiveFilters
        filters={{ status: 'OPEN', priority: 'HIGH', search: 'impressora', mine: true }}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: /filtros ativos/i });
    for (const text of ['Status: Aberto', 'Prioridade: Alta', 'Busca: impressora', 'Meus']) {
      expect(group).toHaveTextContent(text);
    }
  });

  it('names filters that hold an id without inventing a label for the value', () => {
    render(
      <TicketActiveFilters
        filters={{ serviceDeskId: 'sd-1', organizationId: 'org-1', dateFrom: '2026-01-01' }}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: /filtros ativos/i });
    for (const text of ['Mesa de serviço', 'Cliente', 'Período']) {
      expect(group).toHaveTextContent(text);
    }
    expect(group).not.toHaveTextContent('sd-1');
  });

  it('calls onReset when "Redefinir filtros" is clicked', async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();
    render(<TicketActiveFilters filters={{ status: 'OPEN' }} onReset={onReset} onRemove={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Redefinir filtros' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
  it('TKT-08: cada filtro vira uma tag com botão "Remover filtro X" que chama onRemove com a chave', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <TicketActiveFilters
        filters={{ organizationId: 'org-1', status: 'OPEN', dateFrom: '2026-01-01' }}
        onReset={vi.fn()}
        onRemove={onRemove}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remover filtro Cliente' }));
    expect(onRemove).toHaveBeenLastCalledWith('organizationId');
    await user.click(screen.getByRole('button', { name: 'Remover filtro Status: Aberto' }));
    expect(onRemove).toHaveBeenLastCalledWith('status');
    await user.click(screen.getByRole('button', { name: 'Remover filtro Período' }));
    expect(onRemove).toHaveBeenLastCalledWith('period');
  });

  it('TKT-08: mostra o nome resolvido de mesa, cliente, atendente e estágio e cai para o rótulo genérico sem nome', () => {
    render(
      <TicketActiveFilters
        filters={{ serviceDeskId: 'sd-1', organizationId: 'org-1', agentId: 'ag-1', stageId: 'st-1' }}
        names={{ organizationId: 'Acme', serviceDeskId: 'Suporte N1', agentId: 'Ana' }}
        onReset={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: /filtros ativos/i });
    for (const text of ['Mesa de serviço: Suporte N1', 'Cliente: Acme', 'Atendente: Ana']) {
      expect(group).toHaveTextContent(text);
    }
    expect(screen.getByRole('button', { name: 'Remover filtro Estágio' })).toBeInTheDocument();
    expect(group).not.toHaveTextContent('st-1');
  });
});
