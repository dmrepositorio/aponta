import { base32Decode, base32Encode, generateSecret, totpAt, verifyTotp } from './totp';

// Vetores de teste do RFC 6238 (SHA-1, segredo ASCII "12345678901234567890", 8 dígitos).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (DMTE-551)', () => {
  it.each(RFC_VECTORS)('AC-08: o código no instante %i bate com o vetor do RFC 6238', (seconds, expected) => {
    expect(totpAt(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
  });

  it('AC-08: com 6 dígitos o código é o final do vetor de 8 dígitos', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
  });

  it('AC-08: base32 vai e volta sem perder bytes e o segredo gerado tem 160 bits', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateSecret()).not.toBe(secret);
  });

  it('AC-08: aceita o código do passo atual e dos vizinhos (± 30 s) e recusa os de fora', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90_000), now)).toBeNull();
  });

  it('AC-11: o mesmo passo não vale duas vezes (só passo mais novo que o último aceito)', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
  });

  it('AC-08: recusa texto que não é um código de 6 dígitos', () => {
    const now = 1_700_000_000_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', "' OR '1'='1"]) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBeNull();
    }
  });
});
