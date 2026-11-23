/**
 * GH-370 AC-12: `Ticket.descriptionText` é coluna interna. O PrismaService a
 * omite de toda leitura (findMany/findUnique/create/update devolvem a linha
 * inteira, e a resposta HTTP serializa essa linha); `where` e `data` continuam
 * podendo usá-la. O mock captura as opções repassadas ao PrismaClient real.
 */
const ctorOptions: unknown[] = [];

jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      ctorOptions.push(options);
    }
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { PrismaService } from './prisma.service';

describe('PrismaService omit (GH-370 AC-12)', () => {
  it('omite Ticket.descriptionText globalmente e mantém o adapter', () => {
    new PrismaService();

    expect(ctorOptions).toHaveLength(1);
    expect(ctorOptions[0]).toEqual({
      adapter: expect.anything(),
      omit: { ticket: { descriptionText: true } },
    });
  });
});
