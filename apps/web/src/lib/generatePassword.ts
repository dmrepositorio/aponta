// Password generator for the Vault (VLT-11). The value only ever lives in the caller's form state:
// nothing here logs, stores or sends it. Look-alike characters (I, l, 1, O, 0) are left out so it can
// be read and typed by hand.
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?-_+=';
const CLASSES = [LOWER, UPPER, DIGITS, SYMBOLS];
const ALL = CLASSES.join('');

const UINT32_RANGE = 0x1_0000_0000;

// Uniform integer in [0, max): draws that would fold unevenly onto the range are discarded.
function randomInt(max: number): number {
  const limit = UINT32_RANGE - (UINT32_RANGE % max);
  const draw = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(draw);
    if (draw[0] < limit) return draw[0] % max;
  }
}

const pick = (chars: string) => chars[randomInt(chars.length)];

export function generatePassword(length = 20): string {
  if (length < CLASSES.length)
    throw new RangeError(
      'A senha precisa de ao menos um caractere de cada grupo.',
    );

  const chars = CLASSES.map(pick);
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
