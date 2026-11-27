import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('TicketShortcuts: visões de trabalho (TKT-15)', () => {
  const renderShortcuts = (props: Partial<React.ComponentProps<typeof TicketShortcuts>> = {}) => {
    vi.mocked(api.get).mockResolvedValue({ data: { meta: { total: 0 } } });
    const onSelect = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TicketShortcuts role="AGENT" onSelect={onSelect} {...props} />
      </QueryClientProvider>,
    );
    return onSelect;
  };

  it.each([
    ['Meus', { mine: true }],
    ['Não atendidos', { unassigned: true }],
    ['Vencidos', { overdue: true }],
    ['Pausados', { paused: true }],
  ])('TKT-15: clicar em %s chama onSelect com o filtro correspondente', async (name, expected) => {
    const user = userEvent.setup();
    const onSelect = renderShortcuts();

    await user.click(screen.getByRole('button', { name }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  it('TKT-15: o atalho ligado expõe aria-pressed e o segundo clique o desliga', async () => {
    const user = userEvent.setup();
    const onSelect = renderShortcuts({ overdue: true });

    const button = screen.getByRole('button', { name: 'Vencidos' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pausados' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);

    expect(onSelect).toHaveBeenCalledWith({ overdue: undefined });
  });

  it('TKT-15: CLIENT não vê Meus nem Não atendidos, mas vê Vencidos e Pausados', () => {
    renderShortcuts({ role: 'CLIENT' });

    expect(screen.queryByRole('button', { name: 'Meus' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Não atendidos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vencidos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pausados' })).toBeInTheDocument();
  });
});
