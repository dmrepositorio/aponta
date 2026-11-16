import { useEffect, useRef, useState } from 'react';
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
const PAD = { top: 12, right: 30, bottom: 28, left: 40 };

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
 * Aponta DS Line Chart: multi-series SVG line chart with a Y axis (0, middle, max),
 * X labels chosen from the measured width, and a tooltip on hover, keyboard focus and touch.
 * No chart library. shortcut: one tab stop per point (a 30-day chart takes 30 tabs); add
 * arrow-key roving if keyboard use of the long chart matters.
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
  const slot = count > 1 ? plotWidth / lastIndex : plotWidth;
  const isPartial = (index: number) => partialLast && index === lastIndex;

  const describe = (index: number) =>
    `${xLabels[index]}: ${series.map((s) => `${s.name} ${formatValue(s.values[index] ?? 0)}`).join(', ')}${
      isPartial(index) ? ' (parcial)' : ''
    }`;

  const ticks = [0, maxValue / 2, maxValue];
  const shownLabels = pickAxisLabelIndexes(count, plotWidth);

  return (
    <div role="group" aria-label={ariaLabel} className={cn('w-full', className)}>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-medium text-gray-500">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: `var(--color-${s.color})` }} />
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
        <svg width={width} height={height} className="block" onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}>
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

          {series.map((s) => {
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
                    style={stroke(s.color)}
                  />
                )}
                {partialLast && count > 0 && (
                  <circle data-partial="true" cx={x(lastIndex)} cy={y(s.values[lastIndex] ?? 0)} r={4} fill="white" strokeWidth={2} style={stroke(s.color)} />
                )}
                {active !== null && (
                  <circle cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} className="stroke-white" strokeWidth={2} style={{ fill: `var(--color-${s.color})` }} />
                )}
              </g>
            );
          })}

          {xLabels.map((label, index) => (
            <rect
              key={`${label}-${index}`}
              role="button"
              tabIndex={0}
              aria-label={describe(index)}
              x={x(index) - slot / 2}
              y={PAD.top}
              width={slot}
              height={plotHeight}
              fill="transparent"
              className="outline-none"
              onPointerEnter={(event) => event.pointerType === 'mouse' && setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setActive(null);
              }}
            />
          ))}
        </svg>

        {active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-gray-600 px-2.5 py-1.5 text-[12px] text-white shadow-lg"
            style={{ left: Math.min(Math.max(x(active), 70), width - 70) }}
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
