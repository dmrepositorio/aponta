import { describe, expect, it } from 'vitest';
import { formatCnpj, formatCpf } from './documents';

describe('formatCpf', () => {
  it('masks 11 digits as 000.000.000-00, with or without punctuation already there', () => {
    expect(formatCpf('12345678901')).toBe('123.456.789-01');
    expect(formatCpf('123.456.789-01')).toBe('123.456.789-01');
  });

  it('returns the original value for any other length and empty for null', () => {
    expect(formatCpf('1234')).toBe('1234');
    expect(formatCpf('123456789012')).toBe('123456789012');
    expect(formatCpf(null)).toBe('');
    expect(formatCpf(undefined)).toBe('');
  });
});

describe('formatCnpj', () => {
  it('keeps masking 14 digits as 00.000.000/0000-00', () => {
    expect(formatCnpj('19131243000197')).toBe('19.131.243/0001-97');
    expect(formatCnpj('123')).toBe('123');
    expect(formatCnpj(null)).toBe('');
  });
});
