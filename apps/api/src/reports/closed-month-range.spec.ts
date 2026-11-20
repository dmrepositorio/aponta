import { getClosedMonthRanges } from './closed-month-range';

describe('getClosedMonthRanges', () => {
  it('uses the last fully completed UTC month as "current" and the one before as "previous"', () => {
    const reference = new Date('2026-11-20T15:00:00.000Z');

    const { current, previous } = getClosedMonthRanges(reference);

    expect(current.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(previous.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(previous.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls over the year correctly when the reference date is in January', () => {
    const reference = new Date('2026-01-15T00:00:00.000Z');

    const { current, previous } = getClosedMonthRanges(reference);

    expect(current.start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(previous.start.toISOString()).toBe('2025-11-01T00:00:00.000Z');
    expect(previous.end.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });
});
