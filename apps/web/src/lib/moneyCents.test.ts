import { describe, expect, it } from 'vitest';
import { formatCents, parseMoney } from './moneyCents';

const typing = (raw: string) => parseMoney(raw, 'typing');
const paste = (raw: string) => parseMoney(raw, 'paste');

describe('formatCents', () => {
  it('formats integer cents as pt-BR currency without floating point', () => {
    expect(formatCents(0)).toBe('R$ 0,00');
    expect(formatCents(5)).toBe('R$ 0,05');
    expect(formatCents(100)).toBe('R$ 1,00');
    expect(formatCents(123456)).toBe('R$ 1.234,56');
    expect(formatCents(100000000)).toBe('R$ 1.000.000,00');
    expect(formatCents(2147483647)).toBe('R$ 21.474.836,47');
  });
  it('shows nothing for a missing value and for values that are not whole non-negative cents', () => {
    expect(formatCents(null)).toBe('');
    expect(formatCents(Number.NaN)).toBe('');
    expect(formatCents(-1)).toBe('');
    expect(formatCents(1.5)).toBe('');
  });
});

describe('parseMoney while typing', () => {
  it('treats an empty field as no value, not as zero', () => {
    expect(typing('')).toEqual({ cents: null, text: '' });
    expect(typing('R$ ')).toEqual({ cents: null, text: '' });
  });
  it('keeps zero as a real value', () => {
    expect(typing('0')).toEqual({ cents: 0, text: 'R$ 0' });
    expect(typing('0,00')).toEqual({ cents: 0, text: 'R$ 0,00' });
  });
  it('reads whole reais and groups thousands', () => {
    expect(typing('1234')).toEqual({ cents: 123400, text: 'R$ 1.234' });
    expect(typing('1.2345')).toEqual({ cents: 1234500, text: 'R$ 12.345' });
    expect(typing('1.234')).toEqual({ cents: 123400, text: 'R$ 1.234' });
  });
  it('reads the decimal comma with up to two places and keeps a trailing comma', () => {
    expect(typing('1234,')).toEqual({ cents: 123400, text: 'R$ 1.234,' });
    expect(typing('1234,5')).toEqual({ cents: 123450, text: 'R$ 1.234,5' });
    expect(typing('1234,56')).toEqual({ cents: 123456, text: 'R$ 1.234,56' });
    expect(typing(',5')).toEqual({ cents: 50, text: 'R$ 0,5' });
    expect(typing('0,05')).toEqual({ cents: 5, text: 'R$ 0,05' });
  });
  it('drops a third decimal place instead of rounding it', () => {
    expect(typing('1234,567')).toEqual({ cents: 123456, text: 'R$ 1.234,56' });
    expect(typing('0,999')).toEqual({ cents: 99, text: 'R$ 0,99' });
  });
  it('reads a decimal point with one or two digits as the decimal separator', () => {
    expect(typing('1500.50')).toEqual({ cents: 150050, text: 'R$ 1.500,50' });
    expect(typing('1.5')).toEqual({ cents: 150, text: 'R$ 1,5' });
  });
  it('accepts the currency symbol and non-breaking spaces', () => {
    expect(typing('R$ 1.234,56')).toEqual({
      cents: 123456,
      text: 'R$ 1.234,56',
    });
    expect(typing('R$ 1.234,56')).toEqual({
      cents: 123456,
      text: 'R$ 1.234,56',
    });
  });
  it('drops leading zeros', () => {
    expect(typing('007')).toEqual({ cents: 700, text: 'R$ 7' });
  });
  it('rejects negatives, exponents, letters and a second comma', () => {
    expect(typing('-1')).toBeNull();
    expect(typing('1e3')).toBeNull();
    expect(typing('abc')).toBeNull();
    expect(typing('1,2,3')).toBeNull();
  });
  it('holds large values as exact integers and refuses digits beyond the safe range', () => {
    expect(typing('9999999999999')).toEqual({
      cents: 999999999999900,
      text: 'R$ 9.999.999.999.999',
    });
    expect(typing('99999999999999')).toBeNull();
    expect(typing('21474836,47')?.cents).toBe(2147483647);
  });
});

describe('parseMoney when pasting', () => {
  it('reads pt-BR and plain formats', () => {
    expect(paste('1.234,56')?.cents).toBe(123456);
    expect(paste('R$ 1.234,56')?.cents).toBe(123456);
    expect(paste('1.234.567,89')?.cents).toBe(123456789);
    expect(paste('1234,56')?.cents).toBe(123456);
    expect(paste(' R$ 10 ')?.cents).toBe(1000);
  });
  it('reads a decimal point only when it cannot be a thousands separator', () => {
    expect(paste('1234.56')?.cents).toBe(123456);
    expect(paste('1.50')?.cents).toBe(150);
    expect(paste('1.5')?.cents).toBe(150);
    expect(paste('1.234')?.cents).toBe(123400);
    expect(paste('1.500')?.cents).toBe(150000);
  });
  it('rejects ambiguous or malformed text instead of guessing a value', () => {
    expect(paste('1,234')).toBeNull();
    expect(paste('1.23.456')).toBeNull();
    expect(paste('12.3456')).toBeNull();
    expect(paste('-5')).toBeNull();
    expect(paste('12e3')).toBeNull();
    expect(paste('1,2,3')).toBeNull();
  });
  it('treats an empty paste as no value', () => {
    expect(paste('')).toEqual({ cents: null, text: '' });
  });
  it('returns the formatted text of the whole amount', () => {
    expect(paste('1234.5')?.text).toBe('R$ 1.234,50');
    expect(paste('0')?.text).toBe('R$ 0,00');
  });
});

describe('parseMoney deleting a digit from the masked text (QA CTR-07)', () => {
  const del = (raw: string) => parseMoney(raw, 'typing', { deleting: true });
  it('reads the mask thousands dot as a thousands separator, never as decimal', () => {
    expect(del('R$ 1.50')).toEqual({ cents: 15000, text: 'R$ 150' });
    expect(del('R$ 1.00')).toEqual({ cents: 10000, text: 'R$ 100' });
    expect(del('R$ 10.00')).toEqual({ cents: 100000, text: 'R$ 1.000' });
    expect(del('R$ 12.34')).toEqual({ cents: 123400, text: 'R$ 1.234' });
  });
  it('still reads a comma as the decimal separator while deleting', () => {
    expect(del('R$ 1.500,5')).toEqual({ cents: 150050, text: 'R$ 1.500,5' });
    expect(del('R$ 1.500,')).toEqual({ cents: 150000, text: 'R$ 1.500,' });
  });
  it('ignores stray R and $ characters, so deleting inside the prefix never corrupts the value', () => {
    expect(del('$ 1.500')).toEqual({ cents: 150000, text: 'R$ 1.500' });
    expect(del(' 1.500')).toEqual({ cents: 150000, text: 'R$ 1.500' });
  });
});

describe('formatCents and parseMoney round trip', () => {
  const values = [0, 1, 9, 10, 99, 100, 101, 999, 1000, 12345, 99999, 100000, 150000, 150050, 123456, 1000000, 100000000, 2147483647, 900719925474099];
  it.each(values)('keeps %i cents through format, typing and paste', (cents) => {
    const text = formatCents(cents);
    expect(parseMoney(text, 'typing')?.cents).toBe(cents);
    expect(parseMoney(text, 'paste')?.cents).toBe(cents);
    expect(parseMoney(text, 'typing', { deleting: true })?.cents).toBe(cents);
  });
  it.each(values)('keeps the typed text of %i reais stable when re-read', (cents) => {
    const typed = parseMoney(String(Math.floor(cents / 100)), 'typing');
    expect(typed).not.toBeNull();
    expect(parseMoney(typed!.text, 'typing')).toEqual(typed);
  });
});
