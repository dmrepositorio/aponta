import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EzLineChart, pickAxisLabelIndexes } from './EzLineChart';

const labels = ['01/11', '02/11', '03/11', '04/11'];
const series = [{ name: 'Horas apontadas', color: 'brand-600', values: [0, 4, 8, 2] }];
const threeSeries = [
  { name: 'Criados', color: 'brand-600', values: [1, 4, 8, 2] },
  { name: 'Fechados', color: 'green-600', values: [0, 3, 5, 1] },
  { name: 'Cancelados', color: 'gray-500', values: [0, 1, 2, 0] },
];

function renderChart(props: Partial<React.ComponentProps<typeof EzLineChart>> = {}) {
  return render(<EzLineChart series={series} xLabels={labels} ariaLabel="Horas por dia" {...props} />);
}

/** The single focusable element of the plot (the only tab stop of the chart). */
function plotOf(container: HTMLElement) {
  return container.querySelector('svg [tabindex="0"]') as SVGElement;
}

/** jsdom has no PointerEvent: build a pointer event with the fields React reads. */
function firePointer(
  element: Element,
  type: 'pointermove' | 'pointerdown' | 'pointerout',
  { clientX = 0, pointerType = 'mouse' }: { clientX?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(element, event);
}

/** With the default 320px width the plot is 250px wide from x=40, four points 83.3px apart. */
const pointX = (index: number) => 40 + (index * 250) / 3;

describe('EzLineChart axis', () => {
  it('names the chart and draws the Y axis with 0, the middle value and the maximum', () => {
    renderChart();

    expect(screen.getByRole('group', { name: 'Horas por dia' })).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('draws at least 5 Y axis labels', () => {
    renderChart();

    for (const label of ['0', '2', '4', '6', '8']) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('formats the Y axis ticks with formatValue', () => {
    renderChart({ formatValue: (value) => `${value}h` });

    expect(screen.getByText('0h')).toBeInTheDocument();
    expect(screen.getByText('4h')).toBeInTheDocument();
    expect(screen.getByText('8h')).toBeInTheDocument();
  });
});

describe('EzLineChart keyboard', () => {
  it('has a single tab stop and no per-point buttons', () => {
    const { container } = renderChart({ series: threeSeries });

    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('focuses the chart with one Tab and moves the active point with the arrows', async () => {
    const user = userEvent.setup();
    const { container } = renderChart();

    await user.tab();
    expect(plotOf(container)).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('01/11');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('02/11');
    await user.keyboard('{ArrowRight}{ArrowLeft}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('02/11');
  });

  it('stops at the edges with the arrows', async () => {
    const user = userEvent.setup();
    renderChart();

    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('01/11');
    await user.keyboard('{End}{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('04/11');
  });

  it('jumps to the first and last point with Home and End', async () => {
    const user = userEvent.setup();
    renderChart();

    await user.tab();
    await user.keyboard('{End}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('04/11');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('01/11');
  });

  it('exposes the active point to assistive technology', async () => {
    const user = userEvent.setup();
    const { container } = renderChart();

    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(plotOf(container)).toHaveAttribute('aria-valuetext', expect.stringMatching(/03\/11.*Horas apontadas 8/));
  });

  it('closes on Escape and keeps focus on the chart', async () => {
    const user = userEvent.setup();
    const { container } = renderChart();

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(plotOf(container)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes when the chart loses focus', async () => {
    const user = userEvent.setup();
    renderChart();

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('EzLineChart tooltip', () => {
  it('opens on hover over the plot and closes when the pointer leaves', () => {
    const { container } = renderChart();

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    firePointer(plotOf(container), 'pointermove', { clientX: pointX(2), pointerType: 'mouse' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('03/11');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Horas apontadas');
    expect(screen.getByRole('tooltip')).toHaveTextContent('8');

    firePointer(container.querySelector('svg') as SVGSVGElement, 'pointerout', { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on touch and closes on a touch outside the chart', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <EzLineChart series={series} xLabels={labels} ariaLabel="Horas por dia" />
        <p>fora</p>
      </div>,
    );

    firePointer(plotOf(container), 'pointerdown', { clientX: pointX(1), pointerType: 'touch' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('02/11');

    await user.pointer([{ keys: '[TouchA>]', target: screen.getByText('fora') }, { keys: '[/TouchA]' }]);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('EzLineChart series patterns', () => {
  it('gives each series a distinct dash pattern and marker shape in the legend, besides color', () => {
    const { container } = renderChart({ series: threeSeries });

    const samples = Array.from(container.querySelectorAll('[data-legend-sample]'));
    expect(samples).toHaveLength(3);
    const patterns = samples.map(
      (sample) =>
        `${sample.querySelector('line')?.getAttribute('stroke-dasharray') ?? ''}|${sample.querySelector('[data-shape]')?.getAttribute('data-shape') ?? ''}`,
    );
    expect(new Set(patterns).size).toBe(3);
    for (const pattern of patterns) expect(pattern.split('|')[1]).not.toBe('');
  });

  it('draws the plotted lines with the same dash pattern as the legend', () => {
    const { container } = renderChart({ series: threeSeries });

    const legend = Array.from(container.querySelectorAll('[data-legend-sample] line')).map(
      (line) => line.getAttribute('stroke-dasharray') ?? '',
    );
    const plotted = Array.from(container.querySelectorAll('polyline')).map(
      (line) => line.getAttribute('stroke-dasharray') ?? '',
    );
    expect(legend).toHaveLength(3);
    expect(plotted).toEqual(legend);
    expect(new Set(plotted).size).toBe(3);
  });

  it('keeps a single series solid and without legend', () => {
    const { container } = renderChart();

    expect(container.querySelectorAll('[data-legend-sample]')).toHaveLength(0);
    expect(container.querySelector('polyline')?.getAttribute('stroke-dasharray') ?? '').toBe('');
  });
});

describe('EzLineChart partial last point', () => {
  it('draws every point as a line when the last one is complete', () => {
    const { container } = renderChart();

    expect(container.querySelector('polyline')?.getAttribute('points')?.trim().split(' ')).toHaveLength(4);
    expect(container.querySelector('[data-partial="true"]')).toBeNull();
  });

  it('marks the last point as partial (hollow) and draws no segment into it', () => {
    const { container } = renderChart({ partialLast: true });

    expect(container.querySelector('polyline')?.getAttribute('points')?.trim().split(' ')).toHaveLength(3);
    const marker = container.querySelector('[data-partial="true"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('fill')).toBe('white');

    firePointer(plotOf(container), 'pointermove', { clientX: pointX(3), pointerType: 'mouse' });
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
