import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../hooks/useTickets';
import { TicketKanbanCard } from './TicketKanbanCard';

const baseTicket: Ticket = {
  id: 't1',
  protocol: 'AP-2026-0001',
  title:
    'Impressora do segundo andar não liga e o processo de devolução está travado desde ontem',
  description: 'desc',
  status: 'OPEN',
  priority: 'HIGH',
  requesterId: 'r1',
  requester: {
    id: 'r1',
    name: 'Maria Souza',
    email: 'maria@acme.com',
    organizationId: 'org-1',
    organization: { id: 'org-1', name: 'Acme Corporation' },
  },
  agentId: 'agent-1',
  agent: { id: 'agent-1', name: 'João Pereira' },
  serviceDeskId: 'desk-1',
  responseDeadline: '2026-01-01T10:00:00.000Z',
  resolveDeadline: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderCard(ticket: Ticket = baseTicket) {
  return render(
    <MemoryRouter>
      <TicketKanbanCard ticket={ticket} />
    </MemoryRouter>,
  );
}

describe('TicketKanbanCard (D7)', () => {
  it('is a single link for the whole card, with the protocol highlighted and an accessible label', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /AP-2026-0001/ });
    expect(link).toHaveAttribute('href', '/tickets/t1');
    expect(link).not.toHaveAttribute('target');
    expect(screen.getByText('#AP-2026-0001')).toBeInTheDocument();
  });

  it('truncates a long title with line-clamp-2 and keeps the full text in the title attribute', () => {
    renderCard();
    const title = screen.getByText(baseTicket.title);
    expect(title).toHaveClass('line-clamp-2');
    expect(title).toHaveAttribute('title', baseTicket.title);
  });

  it('shows the requester\'s organization (truncated) and the Status tag', () => {
    renderCard();
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByText('Aberto')).toBeInTheDocument();
  });

  it.each(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)(
    'keeps the card white and shows the priority glyph (%s)',
    (priority) => {
      renderCard({ ...baseTicket, priority });
      const link = screen.getByRole('link', { name: /AP-2026-0001/ });
      const card = link.closest('li')!;
      expect(card).toHaveClass('bg-white');
      expect(card.className).not.toMatch(/bg-(red|yellow|green|petroleum)-\d+/);
      const names = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' };
      expect(within(link).getByRole('img', { name: `Prioridade ${names[priority]}` })).toBeInTheDocument();
    },
  );

  it('shows Prioridade as the tag instead of Status when tagField="priority"', () => {
    render(
      <MemoryRouter>
        <TicketKanbanCard ticket={baseTicket} tagField="priority" />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Aberto')).not.toBeInTheDocument();
    expect(screen.getByText('Alta')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Prioridade Alta' })).not.toBeInTheDocument();
  });

  it("shows a small avatar for the assigned agent, initials-based (no photo in the schema)", () => {
    renderCard();
    expect(screen.getByText('JP')).toBeInTheDocument();
  });

  it('AC-06: shows compact SLA chips (icon + time) named by the full text, not the long pills', () => {
    renderCard({ ...baseTicket, responseSlaStatus: 'AT_RISK', resolveSlaStatus: 'BREACHED' });
    expect(screen.getByLabelText(/^Resposta: em risco/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Resolução: vencido há/)).toBeInTheDocument();
    expect(screen.queryByText(/em risco/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/resposta:/i)).not.toBeInTheDocument();
  });

  describe('AC-06: tempo do chip segue a regra de pausa do backend (getSlaStatus)', () => {
    const NOW = new Date('2026-01-10T12:00:00.000Z');
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    const H = 3600000;

    afterEach(() => vi.useRealTimers());

    it('soma as pausas acumuladas aos dois prazos', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      renderCard({
        ...baseTicket,
        responseSlaStatus: 'ON_TRACK',
        resolveSlaStatus: 'ON_TRACK',
        responseDeadline: at(H),
        resolveDeadline: at(5 * H),
        slaAccumulatedPauseTime: 90,
      });
      expect(screen.queryByLabelText('Resposta: dentro do prazo, vence em 2h30')).toBeInTheDocument();
      expect(screen.queryByLabelText('Resolução: dentro do prazo, vence em 6h30')).toBeInTheDocument();
    });

    it('congela o tempo enquanto o ticket está pausado (soma a pausa em curso)', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      renderCard({
        ...baseTicket,
        status: 'PENDING_CUSTOMER',
        responseSlaStatus: null,
        resolveSlaStatus: 'ON_TRACK',
        resolveDeadline: at(5 * H),
        slaPausedAt: at(-2 * H),
      });
      expect(screen.queryByLabelText('Resolução: dentro do prazo, vence em 7h00')).toBeInTheDocument();
    });
  });

  it('AC-05: puts the SLA chips and the agent avatar in the same footer row', () => {
    renderCard({ ...baseTicket, responseSlaStatus: 'ON_TRACK', resolveSlaStatus: 'ON_TRACK' });
    const footer = screen.getByTestId('kanban-card-footer');
    expect(footer).toContainElement(screen.getByLabelText(/^Resposta: dentro do prazo/));
    expect(footer).toContainElement(screen.getByText('JP'));
  });

  it('AC-05: leaves no empty avatar strip when there is no agent and no SLA', () => {
    renderCard({ ...baseTicket, agent: null, agentId: null });
    expect(screen.queryByTestId('kanban-card-footer')).not.toBeInTheDocument();
  });

  it('AC-05: keeps the footer when only the agent exists, with the avatar pushed to the right', () => {
    renderCard();
    const footer = screen.getByTestId('kanban-card-footer');
    expect(footer).toContainElement(screen.getByText('JP'));
    expect(footer.className).toMatch(/justify-between/);
  });

  it('has a menu with only "Abrir ticket" and "Abrir em nova aba interna" (no apontamento/play)', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /mais ações/i }));

    expect(screen.getByRole('menuitem', { name: 'Abrir ticket' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Abrir em nova aba interna' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /apontamento/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('play-apontamento')).not.toBeInTheDocument();
  });

  it('clicking the menu trigger does not also trigger the card link navigation', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /mais ações/i }));
    // If propagation leaked to the Link, this would throw jsdom's
    // "not implemented: navigation" error; reaching this line proves it didn't.
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('RODADA 2 ("Exibir campos", D6c): hides Cliente, Responsável and SLA when their field is turned off', () => {
    render(
      <MemoryRouter>
        <TicketKanbanCard
          ticket={{ ...baseTicket, responseSlaStatus: 'AT_RISK', resolveSlaStatus: 'BREACHED' }}
          visibleFields={{ agent: false, client: false, sla: false }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Acme Corporation')).not.toBeInTheDocument();
    expect(screen.queryByText('JP')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Resposta:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Resolução:/)).not.toBeInTheDocument();
  });

  it('RODADA 2 ("Exibir campos", D6c): shows "Data de criação"/"Data de última atualização" only when explicitly turned on', () => {
    // Noon UTC, not midnight: keeps the formatted calendar day stable
    // regardless of the test runner's local timezone offset.
    const ticket = {
      ...baseTicket,
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
    };
    render(
      <MemoryRouter>
        <TicketKanbanCard ticket={ticket} visibleFields={{ createdAt: true, updatedAt: true }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/criado em 01\/01\/2026/i)).toBeInTheDocument();
    expect(screen.getByText(/atualizado em 01\/01\/2026/i)).toBeInTheDocument();
  });

  it('RODADA 2 ("Exibir campos", D6c): omits the date fields by default (back-compat with existing callers)', () => {
    renderCard();
    expect(screen.queryByText(/criado em/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/atualizado em/i)).not.toBeInTheDocument();
  });
});

describe('TicketKanbanCard por agrupamento (DMTE-527 ticket 1)', () => {
  const withSla = { ...baseTicket, responseSlaStatus: 'ON_TRACK', resolveSlaStatus: 'AT_RISK' } as Ticket;
  type GroupBy = NonNullable<Parameters<typeof TicketKanbanCard>[0]['groupBy']>;
  const renderGrouped = (ticket: Ticket, groupBy?: GroupBy, tagField?: 'status' | 'priority') =>
    render(
      <MemoryRouter>
        <TicketKanbanCard ticket={ticket} groupBy={groupBy} tagField={tagField} />
      </MemoryRouter>,
    );
  /** A linha da tag é a que traz o nome do cliente. */
  const tagRow = () => screen.getByText('Acme Corporation').parentElement as HTMLElement;
  const slaChips = () => screen.getAllByLabelText(/^(Resposta|Resolução):/);

  it('AC-05: agrupado por Status, o cartão não renderiza a tag de status', () => {
    const { container } = renderGrouped(withSla, 'status');
    expect(container.querySelector('[data-ticket-tag="status"]')).toBeNull();
    expect(screen.queryByText('Aberto')).not.toBeInTheDocument();
  });

  it('AC-05: agrupado por Status, o chip de SLA fica na linha do cliente, à direita dele', () => {
    renderGrouped(withSla, 'status');
    const row = tagRow();
    const client = screen.getByText('Acme Corporation');
    for (const chip of slaChips()) {
      expect(row).toContainElement(chip);
      expect(client.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('AC-05: agrupado por Status, o rodapé só traz o responsável', () => {
    renderGrouped(withSla, 'status');
    const footer = screen.getByTestId('kanban-card-footer');
    expect(footer).toContainElement(screen.getByText('JP'));
    expect(footer.querySelector('[aria-label^="Resposta"], [aria-label^="Resolução"]')).toBeNull();
  });

  it('AC-05: agrupado por Status e sem SLA, a linha tem só o cliente', () => {
    renderGrouped(baseTicket, 'status');
    const row = tagRow();
    expect(row.textContent).toBe('Acme Corporation');
    expect(row.querySelector('[aria-label], [data-ticket-tag]')).toBeNull();
  });

  it('AC-05: agrupado por Status, sem SLA e sem responsável, não sobra rodapé vazio', () => {
    renderGrouped({ ...baseTicket, agent: null, agentId: null }, 'status');
    expect(screen.queryByTestId('kanban-card-footer')).not.toBeInTheDocument();
  });

  it.each(['stage', 'agent', 'priority'] as const)(
    'AC-05: agrupado por %s, o cartão mantém a tag de status e o SLA no rodapé',
    (groupBy) => {
      const { container } = renderGrouped(withSla, groupBy);
      expect(container.querySelector('[data-ticket-tag="status"]')).toHaveTextContent('Aberto');
      const footer = screen.getByTestId('kanban-card-footer');
      for (const chip of slaChips()) expect(footer).toContainElement(chip);
      expect(tagRow()).toContainElement(container.querySelector('[data-ticket-tag="status"]') as HTMLElement);
    },
  );

  it('AC-05: sem agrupamento informado, o cartão mantém a tag de status (padrão de quem não passa groupBy)', () => {
    const { container } = renderGrouped(baseTicket);
    expect(container.querySelector('[data-ticket-tag="status"]')).toHaveTextContent('Aberto');
  });

  it('AC-06: as tags de status e de prioridade do cartão não quebram em duas linhas (whitespace-nowrap)', () => {
    const { container, unmount } = renderGrouped(baseTicket, 'stage');
    expect(container.querySelector('[data-ticket-tag="status"]')).toHaveClass('whitespace-nowrap');
    unmount();
    const priority = renderGrouped(baseTicket, 'stage', 'priority');
    expect(priority.container.querySelector('[data-ticket-tag="priority"]')).toHaveClass('whitespace-nowrap');
  });

  it('AC-06: nenhum status é renomeado no cartão (Aguardando Aprovação por extenso)', () => {
    renderGrouped({ ...baseTicket, status: 'PENDING_APPROVAL' }, 'stage');
    expect(screen.getByText('Aguardando Aprovação')).toBeInTheDocument();
  });
});
