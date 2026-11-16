import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ContractApprovalTag,
  approvalLabel,
  contractStateTokenPairs,
  type ApprovalState,
} from './ContractStateTags';

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

const states: ApprovalState[] = ['Aprovado', 'Rascunho', 'Regularização pendente'];

describe('approvalLabel', () => {
  it('uses one vocabulary: legacy wins, then approved, else draft', () => {
    expect(approvalLabel({ legacy: true, approved: true })).toBe('Regularização pendente');
    expect(approvalLabel({ legacy: true, approved: false })).toBe('Regularização pendente');
    expect(approvalLabel({ legacy: false, approved: true })).toBe('Aprovado');
    expect(approvalLabel({ legacy: false, approved: false })).toBe('Rascunho');
  });
});

describe('contract state tags', () => {
  it('shows each approval state with its own text and icon, none of them red', () => {
    const looks = states.map((state) => look(<ContractApprovalTag state={state} />, state));
    for (const item of looks) {
      expect(item.glyph).not.toBeNull();
      expect(item.className).not.toMatch(/red-/);
    }
    expect(new Set(looks.map((item) => item.glyph)).size).toBe(states.length);
    expect(looks[0].className).not.toBe(looks[1].className);
  });

  it('keeps Rascunho and Regularização pendente in the same warning family but apart by text and icon', () => {
    const draft = look(<ContractApprovalTag state="Rascunho" />, 'Rascunho');
    const legacy = look(<ContractApprovalTag state="Regularização pendente" />, 'Regularização pendente');
    expect(draft.className).toBe(legacy.className);
    expect(draft.glyph).not.toBe(legacy.glyph);
  });

  it('lets icons inherit the text color (no own text-* class)', () => {
    for (const state of states) {
      expect(look(<ContractApprovalTag state={state} />, state).iconClass).not.toMatch(/text-/);
    }
  });
});

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8');
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

describe('contract state tag colors', () => {
  it('declares a token pair for every state', () => {
    expect(Object.keys(contractStateTokenPairs).sort()).toEqual(
      ['approved', 'draft', 'legacy'].sort(),
    );
  });

  it('declares the same tokens the rendered tags really use', () => {
    const rendered: Record<string, string> = {
      approved: look(<ContractApprovalTag state="Aprovado" />, 'Aprovado').className,
      draft: look(<ContractApprovalTag state="Rascunho" />, 'Rascunho').className,
      legacy: look(<ContractApprovalTag state="Regularização pendente" />, 'Regularização pendente').className,
    };
    for (const [name, [text, background]] of Object.entries(contractStateTokenPairs)) {
      expect(rendered[name], name).toContain(`text-${text}`);
      expect(rendered[name], name).toContain(`bg-${background}`);
    }
  });

  it('reaches 4.5:1 for every text/background pair (icons inherit the text color, so they reach it too)', () => {
    for (const [name, [text, background]] of Object.entries(contractStateTokenPairs)) {
      expect(contrast(text, background), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
