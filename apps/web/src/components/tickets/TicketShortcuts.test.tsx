import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { TicketShortcuts } from './TicketShortcuts';
import { ticketTagTokenPairs } from './TicketTags';
import { heightContractProblems } from '../../test-utils/controlHeight';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));

describe('TicketShortcuts (DMTE-525)', () => {
  it('authorization counter is not red and reaches 4.5:1', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { meta: { total: 3 } } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TicketShortcuts role="ADMIN" onSelect={() => undefined} />
      </QueryClientProvider>,
    );
    const counter = await screen.findByText('3');
    expect(counter.className).not.toMatch(/red-/);
    const [text, background] = ticketTagTokenPairs['authorizationCounter'];
    expect(counter).toHaveClass(`text-${text}`, `bg-${background}`);
  });
});

describe('TicketShortcuts: altura por faixa (DMTE-527 AC-01)', () => {
  it('AC-01: os atalhos usam 32 px a partir de sm e no mínimo 44 px abaixo', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { meta: { total: 0 } } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TicketShortcuts role="ADMIN" onSelect={() => undefined} />
      </QueryClientProvider>,
    );
    const buttons = [
      screen.getByRole('button', { name: /Autorizações/ }),
      screen.getByRole('button', { name: /Tickets fechados/ }),
    ];
    for (const button of buttons) {
      expect(heightContractProblems(button.className, 'compact')).toEqual([]);
    }
  });
});
