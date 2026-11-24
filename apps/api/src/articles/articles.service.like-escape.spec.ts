import { Role } from '@prisma/client';
import { ArticlesService } from './articles.service';

// #393: os curingas do LIKE (%, _ e \) da busca viram literais.
const bs = String.fromCharCode(92);
const cases: Array<[string, string]> = [
  ['%', bs + '%'],
  ['_', bs + '_'],
  [bs, bs + bs],
  ['100%_ok' + bs + 'x', '100' + bs + '%' + bs + '_ok' + bs + bs + 'x'],
];

describe('ArticlesService busca: curingas do LIKE literais', () => {
  it.each(cases)('search %s casa literalmente no título e no conteúdo', async (term, escaped) => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ArticlesService({ article: { findMany } } as any);
    await service.findAll({ id: 'a1', role: Role.ADMIN }, { search: term });
    const where = findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain(JSON.stringify({ title: { contains: escaped, mode: 'insensitive' } }));
    expect(JSON.stringify(where)).toContain(JSON.stringify({ content: { contains: escaped, mode: 'insensitive' } }));
  });
});
