import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActiveTag, activeTagTokenPairs } from './ActiveTag';

/** Aparência = classes da pílula + forma do ícone, sem o texto. */
function look(ui: ReactElement, text: string) {
  const { container, unmount } = render(ui);
  const root = within(container).getByText(text).closest('div') as HTMLElement;
  const icon = root.querySelector('[data-glyph]');
  const result = {
    className: root.className,
    glyph: icon?.getAttribute('data-glyph') ?? null,
    iconClass: icon?.getAttribute('class') ?? '',
  };
  unmount();
  return result;
}

describe('ActiveTag (DMTE-541 AC-03, DMTE-550 AC-29)', () => {
  it('shows Ativo and Inativo with text and an icon, differing in icon and classes, without red or raw emerald', () => {
    const on = look(<ActiveTag active />, 'Ativo');
    const off = look(<ActiveTag active={false} />, 'Inativo');
    expect(on.glyph).not.toBeNull();
    expect(off.glyph).not.toBeNull();
    expect(on.glyph).not.toBe(off.glyph);
    expect(on.className).not.toBe(off.className);
    expect(`${on.className} ${off.className}`).not.toMatch(/red-|emerald-/);
  });

  it('lets the icon inherit the text color', () => {
    expect(look(<ActiveTag active />, 'Ativo').iconClass).not.toMatch(/text-/);
    expect(look(<ActiveTag active={false} />, 'Inativo').iconClass).not.toMatch(/text-/);
  });

  it('declares the same tokens the rendered tag uses, and each pair reaches 4.5:1 in styles.css', () => {
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

    // DMTE-550 AC-29: a variante Convite pendente entra no mesmo mapa e no mesmo teste de contraste.
    expect(Object.keys(activeTagTokenPairs).sort()).toEqual(['active', 'inactive', 'pending']);
    const rendered = {
      active: look(<ActiveTag active />, 'Ativo').className,
      inactive: look(<ActiveTag active={false} />, 'Inativo').className,
      pending: look(<ActiveTag active pending />, 'Convite pendente').className,
    };
    for (const [name, [text, background]] of Object.entries(activeTagTokenPairs)) {
      expect(rendered[name as keyof typeof rendered], name).toContain(`text-${text}`);
      expect(rendered[name as keyof typeof rendered], name).toContain(`bg-${background}`);
      expect(contrast(text, background), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('AC-29: Convite pendente shows its text and an icon, apart from Ativo and Inativo, without red or raw emerald', () => {
    const on = look(<ActiveTag active />, 'Ativo');
    const off = look(<ActiveTag active={false} />, 'Inativo');
    const pending = look(<ActiveTag active pending />, 'Convite pendente');
    expect(pending.glyph).not.toBeNull();
    expect(pending.glyph).not.toBe(on.glyph);
    expect(pending.glyph).not.toBe(off.glyph);
    expect(pending.className).not.toBe(on.className);
    expect(pending.className).not.toBe(off.className);
    expect(pending.className).not.toMatch(/red-|emerald-/);
    expect(pending.iconClass).not.toMatch(/text-/);
  });

  it('AC-29: an inactive user stays Inativo even with the invite pending', () => {
    const { container } = render(<ActiveTag active={false} pending />);
    expect(within(container).getByText('Inativo')).toBeInTheDocument();
    expect(within(container).queryByText('Convite pendente')).not.toBeInTheDocument();
  });

  it('AC-29: pending false or missing keeps Ativo', () => {
    const { container } = render(<ActiveTag active pending={false} />);
    expect(within(container).getByText('Ativo')).toBeInTheDocument();
    expect(within(container).queryByText('Convite pendente')).not.toBeInTheDocument();
  });
});
