import { compareResponseTimes } from './response-time-comparison';

describe('compareResponseTimes', () => {
  it('reports melhora when the current median drops beyond the threshold', () => {
    const result = compareResponseTimes([80], [100], 0.05);

    expect(result.currentMedianMinutes).toBe(80);
    expect(result.previousMedianMinutes).toBe(100);
    expect(result.absoluteChangeMinutes).toBe(-20);
    expect(result.percentChange).toBe(-20);
    expect(result.verdict).toBe('melhora');
  });

  it('reports piora when the current median rises beyond the threshold', () => {
    const result = compareResponseTimes([130], [100], 0.05);

    expect(result.absoluteChangeMinutes).toBe(30);
    expect(result.percentChange).toBe(30);
    expect(result.verdict).toBe('piora');
  });

  it('reports estavel when the variation sits exactly at the 5% threshold', () => {
    const result = compareResponseTimes([105], [100], 0.05);

    expect(result.percentChange).toBe(5);
    expect(result.verdict).toBe('estavel');
  });

  it('does not divide by zero and reports no verdict when the previous period is empty', () => {
    const result = compareResponseTimes([80], [], 0.05);

    expect(result.previousMedianMinutes).toBeNull();
    expect(result.absoluteChangeMinutes).toBeNull();
    expect(result.percentChange).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.previousCount).toBe(0);
  });

  it('flags a small sample when either period has fewer than the configured minimum', () => {
    const result = compareResponseTimes([80, 90, 70], [100, 95, 105], 0.05, 10);

    expect(result.smallSample).toBe(true);
  });

  it('does not flag a small sample once both periods reach the configured minimum', () => {
    const tenValues = Array.from({ length: 10 }, (_, i) => 50 + i);
    const result = compareResponseTimes(tenValues, tenValues, 0.05, 10);

    expect(result.smallSample).toBe(false);
  });
});
