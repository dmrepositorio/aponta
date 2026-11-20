export type ResponseTimeVerdict = 'melhora' | 'piora' | 'estavel';

export interface PeriodComparisonResult {
  currentMedianMinutes: number | null;
  previousMedianMinutes: number | null;
  currentCount: number;
  previousCount: number;
  absoluteChangeMinutes: number | null;
  percentChange: number | null;
  verdict: ResponseTimeVerdict | null;
  threshold: number;
  smallSample: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure comparison of two periods' durations (in minutes). Lower duration is
 * "melhora" (improvement); the threshold is a fraction (0.05 = 5%) around
 * zero change that counts as "estavel" (stable) rather than noise.
 */
export function compareResponseTimes(
  currentPeriodMinutes: number[],
  previousPeriodMinutes: number[],
  threshold = 0.05,
  smallSampleThreshold = 10,
): PeriodComparisonResult {
  const currentMedianMinutes = median(currentPeriodMinutes);
  const previousMedianMinutes = median(previousPeriodMinutes);

  let absoluteChangeMinutes: number | null = null;
  let percentChange: number | null = null;
  let verdict: ResponseTimeVerdict | null = null;

  if (currentMedianMinutes !== null && previousMedianMinutes !== null) {
    absoluteChangeMinutes = currentMedianMinutes - previousMedianMinutes;
    percentChange =
      previousMedianMinutes === 0
        ? currentMedianMinutes === 0 ? 0 : null
        : (absoluteChangeMinutes / previousMedianMinutes) * 100;

    if (percentChange !== null) {
      if (Math.abs(percentChange) <= threshold * 100) {
        verdict = 'estavel';
      } else {
        verdict = absoluteChangeMinutes < 0 ? 'melhora' : 'piora';
      }
    }
  }

  return {
    currentMedianMinutes,
    previousMedianMinutes,
    currentCount: currentPeriodMinutes.length,
    previousCount: previousPeriodMinutes.length,
    absoluteChangeMinutes,
    percentChange,
    verdict,
    threshold,
    smallSample:
      currentPeriodMinutes.length < smallSampleThreshold ||
      previousPeriodMinutes.length < smallSampleThreshold,
  };
}
