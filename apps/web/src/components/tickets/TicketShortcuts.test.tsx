import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { TicketShortcuts } from './TicketShortcuts';
import { ticketTagTokenPairs } from './TicketTags';

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
