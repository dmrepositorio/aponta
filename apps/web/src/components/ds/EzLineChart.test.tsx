import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EzLineChart, pickAxisLabelIndexes } from './EzLineChart';

const labels = ['01/11', '02/11', '03/11', '04/11'];
const series = [{ name: 'Horas apontadas', color: 'brand-600', values: [0, 4, 8, 2] }];

function renderChart(props: Partial<React.ComponentProps<typeof EzLineChart>> = {}) {
  return render(<EzLineChart series={series} xLabels={labels} ariaLabel="Horas por dia" {...props} />);
}

describe('EzLineChart axis', () => {
  it('names the chart and draws the Y axis with 0, the middle value and the maximum', () => {
    renderChart();

    expect(screen.getByRole('group', { name: 'Horas por dia' })).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('formats the Y axis ticks with formatValue', () => {
    renderChart({ formatValue: (value) => `${value}h` });

    expect(screen.getByText('0h')).toBeInTheDocument();
    expect(screen.getByText('4h')).toBeInTheDocument();
    expect(screen.getByText('8h')).toBeInTheDocument();
  });
});

describe('EzLineChart tooltip', () => {
  it('opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    renderChart();

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    const point = screen.getByRole('button', { name: /03\/11/ });
    await user.hover(point);
    expect(screen.getByRole('tooltip')).toHaveTextContent('03/11');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Horas apontadas');
    expect(screen.getByRole('tooltip')).toHaveTextContent('8');

    await user.unhover(point);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on keyboard focus', async () => {
    const user = userEvent.setup();
    renderChart();

    await user.tab();
    expect(screen.getByRole('button', { name: /01\/11/ })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('01/11');
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('02/11');
  });

  it('opens on touch and closes on a touch outside the chart', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <EzLineChart series={series} xLabels={labels} ariaLabel="Horas por dia" />
        <p>fora</p>
      </div>,
    );

    await user.pointer([
      { keys: '[TouchA>]', target: screen.getByRole('button', { name: /02\/11/ }) },
      { keys: '[/TouchA]' },
    ]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('02/11');

    await user.pointer([{ keys: '[TouchA>]', target: screen.getByText('fora') }, { keys: '[/TouchA]' }]);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderChart();

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('EzLineChart partial last point', () => {
  it('draws every point as a line when the last one is complete', () => {
    const { container } = renderChart();

    expect(container.querySelector('polyline')?.getAttribute('points')?.trim().split(' ')).toHaveLength(4);
    expect(container.querySelector('[data-partial="true"]')).toBeNull();
  });

  it('marks the last point as partial (hollow) and draws no segment into it', async () => {
    const user = userEvent.setup();
    const { container } = renderChart({ partialLast: true });

    expect(container.querySelector('polyline')?.getAttribute('points')?.trim().split(' ')).toHaveLength(3);
    const marker = container.querySelector('[data-partial="true"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('fill')).toBe('white');

    await user.hover(screen.getByRole('button', { name: /04\/11/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/parcial/i);
  });
});

describe('pickAxisLabelIndexes', () => {
  const small = [320, 390, 639];
  const large = [640, 800, 1200];

  it('returns at most 4 indexes below sm and 7 from sm', () => {
    for (const count of [2, 7, 8, 30, 31]) {
      for (const width of small) expect(pickAxisLabelIndexes(count, width).length).toBeLessThanOrEqual(4);
      for (const width of large) expect(pickAxisLabelIndexes(count, width).length).toBeLessThanOrEqual(7);
    }
    expect(pickAxisLabelIndexes(30, 800)).toHaveLength(7);
    expect(pickAxisLabelIndexes(30, 390)).toHaveLength(4);
  });

  it('always includes the last point, in increasing order without repeats', () => {
    for (const count of [1, 2, 3, 7, 30]) {
      for (const width of [320, 390, 800]) {
        const indexes = pickAxisLabelIndexes(count, width);
        expect(indexes[indexes.length - 1]).toBe(count - 1);
        expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
        expect(new Set(indexes).size).toBe(indexes.length);
      }
    }
  });

  it('never returns two labels closer than a label width (64px) on the plot', () => {
    for (const count of [3, 7, 30]) {
      for (const width of [320, 390, 800]) {
        const indexes = pickAxisLabelIndexes(count, width);
        for (let i = 1; i < indexes.length; i += 1) {
          const gapPx = ((indexes[i] - indexes[i - 1]) * width) / (count - 1);
          expect(gapPx, `${count} points in ${width}px`).toBeGreaterThanOrEqual(64);
        }
      }
    }
  });
});
