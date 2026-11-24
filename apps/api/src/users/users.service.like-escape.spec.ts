import { UsersService } from './users.service';

// #393: os curingas do LIKE (%, _ e \) da busca viram literais.
const bs = String.fromCharCode(92);
const cases: Array<[string, string]> = [
  ['%', bs + '%'],
  ['_', bs + '_'],
  [bs, bs + bs],
  ['100%_ok' + bs + 'x', '100' + bs + '%' + bs + '_ok' + bs + bs + 'x'],
];

describe('UsersService busca: curingas do LIKE literais', () => {
  it.each(cases)('q %s casa literalmente no nome e no e-mail', async (term, escaped) => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = { user: { findMany, count: jest.fn().mockResolvedValue(0) } };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    const service = new UsersService(prisma);
    await service.findAll({ q: term });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: escaped, mode: 'insensitive' } },
      { email: { contains: escaped, mode: 'insensitive' } },
    ]);
  });
});
