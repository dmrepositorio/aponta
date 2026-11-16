import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ServiceDeskActiveTag,
  ServiceDeskReceivingTag,
  serviceDeskStateTokenPairs,
} from './ServiceDeskStateTags';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
const hex = (token: string) => {
  const match = css.match(new RegExp(`--color-${token}:\\s*#([0-9a-f]{6})`, 'i'));
  if (!match) throw new Error('token not found: ' + token);
  return match[1];
};
const luminance = (value: string) =>
  [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const tag = (ui: React.ReactElement) => render(ui).container.firstElementChild as HTMLElement | null;
const glyph = (el: HTMLElement | null) => el?.querySelector('[data-glyph]')?.getAttribute('data-glyph');

describe('ServiceDesk state tags (DMTE-530)', () => {
  it('renders text and icon for active, inactive, receiving and not receiving', () => {
    const active = tag(<ServiceDeskActiveTag active />);
    const inactive = tag(<ServiceDeskActiveTag active={false} />);
    const receiving = tag(<ServiceDeskReceivingTag receiving />);
    const paused = tag(<ServiceDeskReceivingTag receiving={false} />);

    expect(active).toHaveTextContent('Ativa');
    expect(inactive).toHaveTextContent('Inativa');
    expect(receiving).toHaveTextContent('Recebendo');
    expect(paused).toHaveTextContent('Não recebe');
    expect([glyph(active), glyph(inactive), glyph(receiving), glyph(paused)]).toEqual([
      'check',
      'minus',
      'check',
      'minus',
    ]);
  });

  it('positive and negative states differ in text, icon and classes, with no red', () => {
    const pairs = [
      [tag(<ServiceDeskActiveTag active />), tag(<ServiceDeskActiveTag active={false} />)],
      [tag(<ServiceDeskReceivingTag receiving />), tag(<ServiceDeskReceivingTag receiving={false} />)],
    ];
    for (const [positive, negative] of pairs) {
      expect(positive?.textContent).not.toBe(negative?.textContent);
      expect(glyph(positive)).not.toBe(glyph(negative));
      expect(positive?.className).not.toBe(negative?.className);
      expect(positive?.className).toMatch(/green-/);
      expect(negative?.className).not.toMatch(/green-|red-/);
      expect(positive?.outerHTML).not.toMatch(/red-/);
      expect(negative?.outerHTML).not.toMatch(/red-/);
    }
  });

  it('token pairs of the state tags and the inactive row reach 4.5:1', () => {
    expect(Object.keys(serviceDeskStateTokenPairs).sort()).toEqual(['inactiveRow', 'negative', 'positive']);
    for (const [text, background] of Object.values(serviceDeskStateTokenPairs)) {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
