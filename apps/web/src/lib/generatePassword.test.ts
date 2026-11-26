import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePassword } from './generatePassword';

const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;
const SYMBOL = /[!@#$%&*?\-_+=]/;
const ALLOWED = /^[a-zA-Z0-9!@#$%&*?\-_+=]+$/;
const AMBIGUOUS = /[Il1O0]/;

describe('generatePassword (VLT-11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 20 characters by default and honours a custom length', () => {
    expect(generatePassword()).toHaveLength(20);
    expect(generatePassword(32)).toHaveLength(32);
  });

  it('uses only the allowed charset and never the look-alike characters I, l, 1, O and 0', () => {
    for (let run = 0; run < 200; run += 1) {
      const value = generatePassword();
      expect(value).toMatch(ALLOWED);
      expect(value).not.toMatch(AMBIGUOUS);
    }
  });

  it('always contains a lowercase, an uppercase, a digit and a symbol', () => {
    for (let run = 0; run < 200; run += 1) {
      const value = generatePassword(8);
      expect(value).toMatch(LOWER);
      expect(value).toMatch(UPPER);
      expect(value).toMatch(DIGIT);
      expect(value).toMatch(SYMBOL);
    }
  });

  it('draws its randomness from crypto.getRandomValues and not from Math.random', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const mathRandom = vi.spyOn(Math, 'random');

    generatePassword();

    expect(getRandomValues).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('gives a different password on each call', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });

  it('discards out-of-range draws instead of folding them (no modulo bias)', () => {
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    let rejectedLeft = 2;
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      if (rejectedLeft > 0) {
        rejectedLeft -= 1;
        array[0] = 0xffffffff;
        return array;
      }
      return real(array);
    }) as typeof globalThis.crypto.getRandomValues);

    const value = generatePassword(20);

    // 4 class picks + 16 fill picks + 19 shuffle swaps, plus the two draws that were thrown away.
    expect(getRandomValues).toHaveBeenCalledTimes(4 + 16 + 19 + 2);
    expect(value).toHaveLength(20);
    expect(value).toMatch(ALLOWED);
  });

  it('rejects a length too short to hold one character of each class', () => {
    expect(() => generatePassword(3)).toThrow();
  });
});
