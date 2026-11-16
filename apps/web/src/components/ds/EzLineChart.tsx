export interface EzLineSeries {
  /** Accessible name of the series, shown in the tooltip. */
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

/** Indexes of the X labels that fit in `width` px, always including the last point. */
export function pickAxisLabelIndexes(_count: number, _width: number): number[] {
  return [];
}

export function EzLineChart(_props: EzLineChartProps) {
  return null;
}
