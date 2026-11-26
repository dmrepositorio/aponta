import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from './utils';

export interface EzLineSeries {
  /** Accessible name of the series, shown in the legend and the tooltip. */
  name: string;
  /** DS color token without prefix, e.g. `brand-600`. */
  color: string;
  values: number[];
}

export interface EzLineChartProps {
  series: EzLineSeries[];
  /** One label per point, shared by all series (e.g. `10/11/2026`). */
  xLabels: string[];
  /** Accessible name of the whole chart. */
  ariaLabel: string;
  /** Formats Y axis ticks and tooltip values. */
  formatValue?: (value: number) => string;
  /** Marks the last point as partial (today still open): hollow marker, no segment into it. */
  partialLast?: boolean;
  className?: string;
}

/** Tailwind `sm`, applied to the measured width of the chart instead of the window. */
const SM = 640;
/** Width of one `dd/mm/yyyy` label at 11px plus the gap that keeps neighbors apart. */
const LABEL_SLOT = 72;
/** Half of the tooltip's `max-w-[220px]`, so it never spills out of the chart. */
const TOOLTIP_HALF_WIDTH = 110;
const PAD = { top: 12, right: 30, bottom: 28, left: 40 };
/** Number of Y axis marks: 0, three intermediate values and the maximum. */
const TICK_COUNT = 5;

type MarkerShape = 'circle' | 'square' | 'diamond';

/**
 * Non-color cue of each series: dash pattern and marker shape, by position. The first series
 * stays solid, so a single series (no legend) needs no pattern.
 */
const SERIES_PATTERNS: { dash?: string; shape: MarkerShape }[] = [
  { shape: 'circle' },
  { dash: '6 4', shape: 'square' },
  { dash: '2 4', shape: 'diamond' },
];
const patternOf = (index: number) => SERIES_PATTERNS[index % SERIES_PATTERNS.length];

interface MarkerProps {
  shape: MarkerShape;
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  'data-partial'?: string;
}

/** Marker with the shape of the series; `r` is the radius of the circle it fits in. */
function Marker({ shape, cx, cy, r, ...rest }: MarkerProps) {
  if (shape === 'square') {
    return <rect data-shape={shape} x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...rest} />;
  }
  if (shape === 'diamond') {
    const d = r * 1.3;
    return <polygon data-shape={shape} points={`${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`} {...rest} />;
  }
  return <circle data-shape={shape} cx={cx} cy={cy} r={r} {...rest} />;
}

/** Indexes of the X labels that fit in `width` px, always including the last point. */
export function pickAxisLabelIndexes(count: number, width: number): number[] {
  if (count <= 1) return count === 1 ? [0] : [];
  const max = width < SM ? 4 : 7;
  const fit = Math.max(2, Math.floor(width / LABEL_SLOT));
  const shown = Math.min(max, fit, count);
  const last = count - 1;
  return Array.from({ length: shown }, (_, i) => Math.round((i * last) / (shown - 1)));
}

function defaultFormat(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/**
 * Aponta DS Line Chart: multi-series SVG line chart with a Y axis (5 marks), X labels chosen
 * from the measured width, and a tooltip on hover, keyboard focus and touch. No chart library.
 * The plot is one tab stop (slider): arrows move the active point, Home/End go to the first and
 * last, Escape closes the tooltip. Series differ by dash pattern and marker shape, not only color.
 */
export function EzLineChart({
  series,
  xLabels,
  ariaLabel,
  formatValue = defaultFormat,
  partialLast = false,
  className,
}: EzLineChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return undefined;
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (active === null) return undefined;
    const closeOnOutsidePointer = (event: Event) => {
      if (!plotRef.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [active]);

  const count = xLabels.length;
  const height = width >= SM ? 192 : 160;
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const lastIndex = count - 1;

  const x = (index: number) => PAD.left + (count > 1 ? (index / lastIndex) * plotWidth : plotWidth / 2);
  const y = (value: number) => PAD.top + plotHeight - (value / maxValue) * plotHeight;
  const stroke = (color: string) => ({ stroke: `var(--color-${color})` });
  const indexAt = (clientX: number) => {
    if (count <= 1) return 0;
    const left = svgRef.current?.getBoundingClientRect().left ?? 0;
    const index = Math.round(((clientX - left - PAD.left) / plotWidth) * lastIndex);
    return Math.min(lastIndex, Math.max(0, index));
  };
  const moveWithKey = (event: KeyboardEvent<SVGRectElement>) => {
    const current = active ?? 0;
    const next: Record<string, number> = {
      ArrowRight: active === null ? 0 : Math.min(lastIndex, current + 1),
      ArrowLeft: active === null ? 0 : Math.max(0, current - 1),
      Home: 0,
      End: Math.max(0, lastIndex),
    };
    if (event.key === 'Escape') {
      setActive(null);
    } else if (event.key in next) {
      event.preventDefault();
      setActive(next[event.key]);
    }
  };
  const onPlotPointer = (event: PointerEvent<SVGRectElement>) => setActive(indexAt(event.clientX));
  const isPartial = (index: number) => partialLast && index === lastIndex;

  const describe = (index: number) =>
    `${xLabels[index]}: ${series.map((s) => `${s.name} ${formatValue(s.values[index] ?? 0)}`).join(', ')}${
      isPartial(index) ? ' (parcial)' : ''
    }`;

  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => (maxValue * i) / (TICK_COUNT - 1));
  const shownLabels = pickAxisLabelIndexes(count, plotWidth);

  return (
    <div role="group" aria-label={ariaLabel} className={cn('w-full', className)}>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-medium text-gray-500">
          {series.map((s, index) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <svg data-legend-sample width={24} height={10} aria-hidden="true" className="shrink-0">
                <line x1={1} x2={23} y1={5} y2={5} strokeWidth={2} strokeLinecap="round" strokeDasharray={patternOf(index).dash} style={stroke(s.color)} />
                <Marker shape={patternOf(index).shape} cx={12} cy={5} r={3} style={{ fill: `var(--color-${s.color})` }} />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
      <p className="sr-only">
        {series
          .map((s) => `${s.name}: de ${xLabels[0]} a ${xLabels[lastIndex]}, máximo ${formatValue(Math.max(0, ...s.values))}.`)
          .join(' ')}
      </p>

      <div ref={plotRef} className="relative">
        <svg ref={svgRef} width={width} height={height} className="block" onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-gray-90" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-gray-500 text-[11px] tabular-nums">
                {formatValue(tick)}
              </text>
            </g>
          ))}

          {shownLabels.map((index) => (
            <text key={index} x={x(index)} y={height - 8} textAnchor="middle" className="fill-gray-500 text-[11px] tabular-nums">
              {xLabels[index]}
            </text>
          ))}

          {active !== null && (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} className="stroke-gray-200" strokeWidth={1} />
          )}

          {series.map((s, seriesIndex) => {
            const { dash, shape } = patternOf(seriesIndex);
            const drawn = partialLast ? s.values.slice(0, -1) : s.values;
            return (
              <g key={s.name}>
                {drawn.length > 1 && (
                  <polyline
                    points={drawn.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={dash}
                    style={stroke(s.color)}
                  />
                )}
                {partialLast && count > 0 && (
                  <Marker data-partial="true" shape={shape} cx={x(lastIndex)} cy={y(s.values[lastIndex] ?? 0)} r={4} fill="white" strokeWidth={2} style={stroke(s.color)} />
                )}
                {active !== null && (
                  <Marker shape={shape} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} className="stroke-white" strokeWidth={2} style={{ fill: `var(--color-${s.color})` }} />
                )}
              </g>
            );
          })}

          <rect
            role="slider"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, lastIndex)}
            aria-valuenow={active ?? 0}
            aria-valuetext={describe(active ?? 0)}
            x={0}
            y={0}
            width={width}
            height={height - PAD.bottom}
            fill="transparent"
            className="outline-none focus-visible:stroke-brand-600"
            strokeWidth={2}
            onPointerMove={(event) => event.pointerType === 'mouse' && onPlotPointer(event)}
            onPointerDown={onPlotPointer}
            onFocus={() => setActive((previous) => previous ?? 0)}
            onBlur={() => setActive(null)}
            onKeyDown={moveWithKey}
          />
        </svg>

        {active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-gray-600 px-2.5 py-1.5 text-[12px] text-white shadow-lg"
            style={{ left: Math.min(Math.max(x(active), TOOLTIP_HALF_WIDTH), width - TOOLTIP_HALF_WIDTH) }}
          >
            <p className="font-bold tabular-nums">
              {xLabels[active]}
              {isPartial(active) && <span className="ml-1 font-normal">(parcial)</span>}
            </p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${s.color})` }} />
                <span>{s.name}</span>
                <span className="ml-auto pl-2 font-bold tabular-nums">{formatValue(s.values[active] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
