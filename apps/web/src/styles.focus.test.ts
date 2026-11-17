import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// DMTE-532 AC-01: o foco do DS vem de um token único em styles.css, com contraste mínimo.

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');

const color = (name: string) => {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --color-${name} not found`);
  return match[1];
};

// WCAG 2.x relative luminance and contrast ratio
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('focus token (DMTE-532)', () => {
  it('defines the focus token and the two focus utilities', () => {
    expect(css).toMatch(/--color-focus:\s*var\(--color-brand-600\)/);
    expect(css).toMatch(/--focus-ring-width:\s*2px/);
    expect(css).toMatch(/--focus-ring-offset:\s*2px/);

    const utility = (name: string) => css.match(new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    const outer = utility('ez-focus');
    const inset = utility('ez-focus-inset');
    expect(outer).toContain(':focus-visible');
    expect(outer).toContain('outline: var(--focus-ring-width) solid var(--color-focus)');
    expect(outer).toContain('outline-offset: var(--focus-ring-offset)');
    expect(inset).toContain(':focus-visible');
    expect(inset).toContain('outline: var(--focus-ring-width) solid var(--color-focus)');
    expect(inset).toContain('outline-offset: calc(var(--focus-ring-offset) * -1)');
  });

  it('keeps the focus color at 3:1 or more on every tab surface', () => {
    const focus = color('brand-600');
    expect(contrast(focus, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(focus, color('gray-90'))).toBeGreaterThanOrEqual(3);
    expect(contrast(focus, color('brand-100'))).toBeGreaterThanOrEqual(3);
    // o anel antigo não passava no mínimo de 3:1 sobre branco
    expect(contrast(color('brand-200'), '#ffffff')).toBeLessThan(3);
  });
});
