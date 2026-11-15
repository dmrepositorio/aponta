import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TicketPriority, TicketStatus } from '../../hooks/useTickets';
import {
  TicketPriorityTag,
  TicketStatusTag,
  ticketGlyphTokens,
  ticketTagTokenPairs,
} from './TicketTags';

const statuses: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'PENDING_CUSTOMER',
  'ON_HOLD',
  'PENDING_SANKHYA',
  'PENDING_APPROVAL',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
];
const priorities: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Famílias de status (decisão da SPEC DMTE-525): os quatro "aguardando" dividem o visual.
const statusFamilies: TicketStatus[][] = [
  ['OPEN'],
  ['IN_PROGRESS'],
  ['PENDING_CUSTOMER', 'ON_HOLD', 'PENDING_SANKHYA', 'PENDING_APPROVAL'],
  ['ESCALATED'],
  ['RESOLVED'],
  ['CLOSED'],
];

/** Aparência = classes da pílula + glifo (classes e forma), sem o rótulo. */
function look(tag: HTMLElement): string {
  const glyph = tag.querySelector('[data-glyph]');
  return `${tag.className}|${glyph?.getAttribute('data-glyph')}|${glyph?.outerHTML.replace(/aria-label="[^"]*"/, '')}`;
}
const statusLook = (status: TicketStatus) => {
  const { container } = render(<TicketStatusTag status={status} />);
  return container.firstElementChild as HTMLElement;
};
const priorityLook = (priority: TicketPriority) => {
  const { container } = render(<TicketPriorityTag priority={priority} />);
  return container.firstElementChild as HTMLElement;
};

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

describe('TicketStatusTag / TicketPriorityTag (DMTE-525)', () => {
  it('shows the same labels as before', () => {
    expect(statusLook('IN_PROGRESS')).toHaveTextContent('Em Andamento');
    expect(statusLook('PENDING_APPROVAL')).toHaveTextContent('Aguardando Aprovação');
    expect(priorityLook('CRITICAL')).toHaveTextContent('Crítica');
  });

  it('no status tag shares its look with any priority tag', () => {
    const priorityLooks = priorities.map((p) => look(priorityLook(p)));
    for (const status of statuses) {
      expect(priorityLooks).not.toContain(look(statusLook(status)));
    }
  });

  it('gives each status family its own look and the four "aguardando" the same one', () => {
    const familyLooks = statusFamilies.map((family) => {
      const looks = new Set(family.map((s) => look(statusLook(s))));
      expect(looks.size).toBe(1);
      return [...looks][0];
    });
    expect(new Set(familyLooks).size).toBe(statusFamilies.length);
  });

  it('keeps the pairs that used to coincide apart and only Escalonado is red', () => {
    const pairs: [TicketPriority, TicketStatus][] = [
      ['MEDIUM', 'OPEN'],
      ['HIGH', 'IN_PROGRESS'],
      ['CRITICAL', 'ESCALATED'],
      ['LOW', 'CLOSED'],
    ];
    for (const [priority, status] of pairs) {
      expect(look(priorityLook(priority))).not.toBe(look(statusLook(status)));
    }
    const redStatuses = statuses.filter((s) => /red-/.test(statusLook(s).outerHTML));
    expect(redStatuses).toEqual(['ESCALATED']);
    const redPriorities = priorities.filter((p) => /red-/.test(priorityLook(p).outerHTML));
    expect(redPriorities).toEqual(['CRITICAL']);
  });

  it('draws priority as 1 to 4 bars and colors only Alta and Crítica', () => {
    const strong = priorities.filter((p) => /yellow-|red-/.test(priorityLook(p).outerHTML));
    expect(strong).toEqual(['HIGH', 'CRITICAL']);
    priorities.forEach((p, index) => {
      expect(priorityLook(p).querySelector('[data-glyph]')).toHaveAttribute('data-glyph', `bars-${index + 1}`);
    });
  });

  it('Resolvido uses the DS green, not the brand', () => {
    const resolved = statusLook('RESOLVED').outerHTML;
    expect(resolved).toMatch(/green-/);
    expect(resolved).not.toMatch(/brand-/);
    const inProgress = statusLook('IN_PROGRESS').outerHTML;
    expect(inProgress).toMatch(/brand-/);
    expect(inProgress).not.toMatch(/green-/);
  });

  it('token pairs of the tags reach 4.5:1 over the real background', () => {
    const entries = Object.entries(ticketTagTokenPairs);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const [, [text, background]] of entries) {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    }
    // os pares declarados são os que a tag renderiza de fato
    expect(statusLook('OPEN').className).toContain(`text-${ticketTagTokenPairs['status'][0]}`);
    expect(statusLook('ESCALATED').className).toContain(`text-${ticketTagTokenPairs['status:ESCALATED'][0]}`);
    expect(priorityLook('HIGH').className).toContain(`text-${ticketTagTokenPairs['priority:HIGH'][0]}`);
    expect(priorityLook('HIGH').className).toContain(`bg-${ticketTagTokenPairs['priority:HIGH'][1]}`);
    expect(priorityLook('CRITICAL').className).toContain(`text-${ticketTagTokenPairs['priority:CRITICAL'][0]}`);
    expect(priorityLook('CRITICAL').className).toContain(`bg-${ticketTagTokenPairs['priority:CRITICAL'][1]}`);
  });

  it('glyph colors reach 3:1 against the white card', () => {
    expect(ticketGlyphTokens.length).toBeGreaterThan(0);
    for (const token of ticketGlyphTokens) {
      expect(contrast(token, 'gray-70')).toBeGreaterThanOrEqual(3);
    }
    const rendered = [...statuses.map(statusLook), ...priorities.map(priorityLook)]
      .map((el) => el.querySelector('[data-glyph]')!.outerHTML)
      .join(' ');
    for (const token of ticketGlyphTokens) expect(rendered).toContain(token);
  });
});
