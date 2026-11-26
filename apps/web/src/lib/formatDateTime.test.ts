import { describe, expect, it } from 'vitest';
import { formatDateTime } from './formatDateTime';

describe('formatDateTime (GH-446 DET-02)', () => {
  it('formata o instante em dd/mm/aaaa HH:mm no fuso de Brasília, sem sufixo UTC', () => {
    expect(formatDateTime('2026-09-30T14:00:00.000Z')).toBe('30/09/2026 11:00');
  });

  it('muda o dia civil quando o UTC já virou o dia', () => {
    expect(formatDateTime('2026-10-01T01:30:00.000Z')).toBe('30/09/2026 22:30');
  });

  it('mantém meia-noite como 00:00 e não 24:00', () => {
    expect(formatDateTime('2026-10-01T03:00:00.000Z')).toBe('01/10/2026 00:00');
  });

  it('aceita Date', () => {
    expect(formatDateTime(new Date('2026-01-15T15:05:00.000Z'))).toBe('15/01/2026 12:05');
  });

  it('devolve o texto original quando a data é inválida em vez de lançar', () => {
    expect(formatDateTime('não é data')).toBe('não é data');
  });
});
