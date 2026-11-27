import { describe, expect, it } from 'vitest';
import { billingMonthStartIso, brasiliaDayEndIso, brasiliaDayStartIso, brasiliaWallClockIso } from './billingTime';

describe('contract civil dates', () => {
  it('honors historical Sao Paulo daylight saving for billing cycles', () => {
    expect(billingMonthStartIso('2018-02')).toBe('2018-02-01T02:00:00.000Z');
    expect(billingMonthStartIso('2018-07')).toBe('2018-07-01T03:00:00.000Z');
    expect(billingMonthStartIso('2026-10')).toBe('2026-10-01T03:00:00.000Z');
  });
  it('uses the same timezone for contract validity dates', () => {
    expect(brasiliaDayStartIso('2018-02-15')).toBe('2018-02-15T02:00:00.000Z');
    expect(() => brasiliaDayStartIso('invalid')).toThrow('Data inválida');
  });
  it('converts the actual worklog wall clock independently of browser timezone', () => {
    expect(brasiliaWallClockIso('2026-10-15', '09:00')).toBe('2026-10-15T12:00:00.000Z');
    expect(brasiliaWallClockIso('2018-02-15', '09:00')).toBe('2018-02-15T11:00:00.000Z');
    expect(brasiliaWallClockIso('2026-10-15', '23:30')).toBe('2026-10-16T02:30:00.000Z');
  });
});

describe('brasiliaDayEndIso', () => {
  it('returns the last millisecond of the civil day in Brasilia', () => {
    expect(brasiliaDayEndIso('2025-03-10')).toBe('2025-03-11T02:59:59.999Z');
    expect(brasiliaDayEndIso('2025-12-31')).toBe('2026-01-01T02:59:59.999Z');
  });
  it('honors the daylight saving offset of the day being closed', () => {
    // In DST (-02:00) the next day starts at 02:00Z; in standard time (-03:00), at 03:00Z.
    expect(brasiliaDayEndIso('2018-02-15')).toBe('2018-02-16T01:59:59.999Z');
    expect(brasiliaDayEndIso('2018-07-01')).toBe('2018-07-02T02:59:59.999Z');
  });
  it('rejects invalid days', () => {
    expect(() => brasiliaDayEndIso('invalid')).toThrow('Data inválida');
  });
});
