import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// DMTE-540 AC-01: o anel brand-200 (1,81:1 sobre branco) não volta; o foco vem do token ez-focus.

const root = resolve(__dirname, '../..');

const productionFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe('focus ring token (DMTE-540)', () => {
  it('no production source keeps the brand-200 focus ring', () => {
    const offenders = productionFiles(root).filter((file) =>
      /focus(-visible)?:ring-brand-200/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
  });
});
