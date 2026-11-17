import { createHmac, randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

/** Base32 (RFC 4648), sem preenchimento: o formato que os aplicativos autenticadores esperam. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Caractere inválido em base32.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits aleatórios, como recomenda o RFC 4226. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', secret).update(message).digest();
  const offset = hash[hash.length - 1] & 15;
  const binary = hash.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Código TOTP (RFC 6238, SHA-1, passos de 30 s) para o instante dado. */
export function totpAt(secret: string, timeMs: number, digits = 6): string {
  return hotp(base32Decode(secret), Math.floor(timeMs / STEP_MS), digits);
}

/** Passo (de 30 s) do código, se ele vale agora (± 1 passo) e é mais novo que `lastStep`; `null` caso contrário. */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / STEP_MS);
  const key = base32Decode(secret);
  for (const step of [current, current - 1, current + 1]) {
    if (step > lastStep && hotp(key, step, 6) === code) return step;
  }
  return null;
}
