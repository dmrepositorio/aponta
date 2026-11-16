import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EzDesignTokens } from './EzDesignTokens';

describe('EzDesignTokens', () => {
  it('documents the D6 control height scale (DMTE-427 fatia 1)', () => {
    render(<EzDesignTokens />);
    expect(screen.getByText(/42px/)).toBeInTheDocument();
    expect(screen.getByText(/32px/)).toBeInTheDocument();
  });

  it('documents the D6 radius and shadow tokens', () => {
    render(<EzDesignTokens />);
    expect(screen.getByText(/radius-control/)).toBeInTheDocument();
    expect(screen.getByText(/radius-card/)).toBeInTheDocument();
    expect(screen.getByText(/shadow-card/)).toBeInTheDocument();
    expect(screen.getByText(/shadow-popover/)).toBeInTheDocument();
  });

  it('renders each control height preview from its CSS variable', () => {
    render(<EzDesignTokens />);
    const preview = screen.getByText('Altura compacta de controle');
    expect(preview).toHaveStyle({ height: 'var(--control-height-compact)' });
    expect(screen.getByText('Altura padrão de controle')).toHaveStyle({
      height: 'var(--control-height-md)',
    });
  });
});

describe('escala de altura da barra de Tickets (DMTE-527 AC-01)', () => {
  const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8');
  const declared = (token: string) => css.match(new RegExp(`${token}:\\s*([0-9]+px)\\s*;`))?.[1];

  it('AC-01: styles.css defines --control-height-toolbar as 36px', () => {
    expect(declared('--control-height-toolbar')).toBe('36px');
  });

  it('AC-01: --control-height-md stays 42px and --control-height-compact stays 32px', () => {
    expect(declared('--control-height-md')).toBe('42px');
    expect(declared('--control-height-compact')).toBe('32px');
  });

  it('AC-01: the scale comment registers the toolbar exception with this SPEC as source', () => {
    const at = css.indexOf('--control-height-toolbar:');
    expect(at).toBeGreaterThan(0);
    expect(css.slice(Math.max(0, at - 1500), at)).toMatch(/DMTE-527/);
  });
});
