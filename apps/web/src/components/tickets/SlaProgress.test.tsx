import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketStatus } from '../../hooks/useTickets';
import { SlaProgress } from './SlaProgress';

const NOW = new Date('2026-01-10T12:00:00.000Z');
const H = 3600000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const baseTicket: Ticket = {
  id: 't1',
  protocol: 'AP-2026-0001',
  title: 'Chamado',
  description: 'desc',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  requesterId: 'r1',
  agentId: 'agent-1',
  serviceDeskId: 'desk-1',
  responseDeadline: null,
  createdAt: at(-10 * H),
  updatedAt: at(-10 * H),
  resolveDeadline: at(5 * H),
  resolveSlaStatus: 'ON_TRACK',
};

// Prazo gravado no passado (1h atrás) com 60 min de pausas acumuladas e pausa
// em curso desde 5h atrás: prazo efetivo = prazo + 60 min = agora, e o tempo
// congelado no instante da pausa = prazo efetivo - slaPausedAt = 5h.
const pausedTicket: Ticket = {
  ...baseTicket,
  status: 'PENDING_SANKHYA',
  resolveDeadline: at(-1 * H),
  resolveSlaStatus: 'ON_TRACK',
  slaAccumulatedPauseTime: 60,
  slaPausedAt: at(-5 * H),
};

const PAUSE_STATUSES: [TicketStatus, string][] = [
  ['PENDING_SANKHYA', 'Aguardando Sankhya'],
  ['ON_HOLD', 'Aguardando Terceiros'],
  ['PENDING_CUSTOMER', 'Aguardando Cliente'],
];

function renderBar(ticket: Ticket) {
  return render(<SlaProgress ticket={ticket} />);
}

function fill() {
  return screen.getByRole('progressbar').querySelector('[style]') as HTMLElement;
}

describe('SlaProgress', () => {
  afterEach(() => vi.useRealTimers());

  describe('em pausa (slaPausedAt definido)', () => {
    it.each(PAUSE_STATUSES)(
      'AC-01/AC-09: %s mostra "Pausado · %s" com o tempo congelado em texto neutro',
      (status, label) => {
        vi.useFakeTimers({ toFake: ['Date'], now: NOW });
        const { container } = renderBar({ ...pausedTicket, status });

        expect(screen.getByText(`Pausado · ${label}`)).toBeInTheDocument();
        const frozen = screen.getByText('restam 5h 0m');
        expect(frozen).toHaveClass('text-gray-500');
        expect(frozen).not.toHaveClass('text-red-600');
        expect(container).not.toHaveTextContent(/vencido há/i);
        expect(container).not.toHaveTextContent(/Restam/);
      },
    );

    it.each(PAUSE_STATUSES)(
      'AC-02: %s usa barra neutra e nenhum texto vermelho, mesmo com selo BREACHED',
      (status) => {
        vi.useFakeTimers({ toFake: ['Date'], now: NOW });
        const { container } = renderBar({
          ...pausedTicket,
          status,
          resolveSlaStatus: 'BREACHED',
        });

        expect(fill()).toHaveClass('bg-gray-400');
        expect(fill()).not.toHaveClass('bg-red-500');
        expect(container.querySelector('.text-red-600')).toBeNull();
      },
    );

    it('AC-02 (D4): ticket já vencido ao entrar em pausa fica neutro e mostra o vencimento congelado', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      const { container } = renderBar({
        ...pausedTicket,
        createdAt: at(-20 * H),
        resolveDeadline: at(-10 * H),
        slaAccumulatedPauseTime: 0,
        slaPausedAt: at(-8 * H),
        resolveSlaStatus: 'BREACHED',
      });

      expect(screen.getByText('Pausado · Aguardando Sankhya')).toBeInTheDocument();
      expect(screen.getByText('vencido há 2h 0m')).toHaveClass('text-gray-500');
      expect(fill()).toHaveClass('bg-gray-400');
      expect(container.querySelector('.text-red-600')).toBeNull();
      expect(container).not.toHaveTextContent(/Vencido há/);
    });

    it('AC-03: o valor da barra fica congelado entre dois relógios durante a pausa', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      const { unmount } = renderBar(pausedTicket);
      const first = screen.getByRole('progressbar').getAttribute('aria-valuenow');
      unmount();

      vi.setSystemTime(new Date(NOW.getTime() + 3 * H));
      renderBar(pausedTicket);
      const second = screen.getByRole('progressbar').getAttribute('aria-valuenow');

      expect(first).toBe('44');
      expect(second).toBe(first);
    });

    it('AC-08: a barra tem nome acessível e aria-valuetext com o texto exibido', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      renderBar(pausedTicket);

      const bar = screen.getByRole('progressbar', {
        name: 'Progresso do SLA (Resolução)',
      });
      expect(bar).toHaveAttribute('aria-valuetext', 'Pausado · Aguardando Sankhya');
    });
  });

  describe('sem pausa (slaPausedAt nulo)', () => {
    it('AC-09: status sem pausa não mostra "Pausado"', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      const { container } = renderBar({ ...baseTicket, slaPausedAt: null });

      expect(container).not.toHaveTextContent(/pausado/i);
    });

    it('AC-05: prazo ativo mostra "Restam" e a cor da barra segue o selo', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      renderBar({ ...baseTicket, resolveSlaStatus: 'ON_TRACK' });

      expect(screen.getByText('Restam 5h 0m')).toBeInTheDocument();
      expect(fill()).toHaveClass('bg-green-500');
    });

    it('AC-05: prazo vencido mostra "Vencido há" em vermelho e barra vermelha', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      renderBar({
        ...baseTicket,
        resolveDeadline: at(-2 * H),
        resolveSlaStatus: 'BREACHED',
      });

      expect(screen.getByText('Vencido há 2h 0m')).toHaveClass('text-red-600');
      expect(fill()).toHaveClass('bg-red-500');
    });

    it('AC-05: selo AT_RISK deixa a barra amarela', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      renderBar({ ...baseTicket, resolveSlaStatus: 'AT_RISK' });

      expect(fill()).toHaveClass('bg-yellow-500');
    });
  });

  describe('AC-06: ticket terminal', () => {
    it.each<TicketStatus>(['RESOLVED', 'CLOSED'])(
      '%s mantém barra cinza e nunca mostra "Vencido" nem "Pausado"',
      (status) => {
        vi.useFakeTimers({ toFake: ['Date'], now: NOW });
        const { container } = renderBar({
          ...baseTicket,
          status,
          resolveDeadline: at(-2 * H),
          resolveSlaStatus: null,
        });

        expect(fill()).toHaveClass('bg-gray-400');
        expect(container).not.toHaveTextContent(/vencido/i);
        expect(container).not.toHaveTextContent(/pausado/i);
      },
    );

    it.each<TicketStatus>(['RESOLVED', 'CLOSED'])(
      '%s com slaPausedAt residual não vira "Pausado"',
      (status) => {
        vi.useFakeTimers({ toFake: ['Date'], now: NOW });
        const { container } = renderBar({ ...pausedTicket, status });

        expect(fill()).toHaveClass('bg-gray-400');
        expect(container).not.toHaveTextContent(/pausado/i);
        expect(container).not.toHaveTextContent(/vencido/i);
      },
    );
  });
});
