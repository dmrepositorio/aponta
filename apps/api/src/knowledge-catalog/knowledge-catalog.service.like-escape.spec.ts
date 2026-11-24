import { KnowledgeCatalogService } from './knowledge-catalog.service';

// #393: no ILIKE cru os curingas (%, _ e \) viram literais; o escape é a barra
// invertida, padrão do Postgres. A similaridade (pg_trgm) segue com o termo bruto.
const bs = String.fromCharCode(92);
const cases: Array<[string, string]> = [
  ['%', bs + '%'],
  ['_', bs + '_'],
  [bs, bs + bs],
  ['100%_ok' + bs + 'x', '100' + bs + '%' + bs + '_ok' + bs + bs + 'x'],
];

describe('KnowledgeCatalogService busca: curingas do ILIKE literais', () => {
  it.each(cases)('search %s casa literalmente em nome e descrição', async (term, escaped) => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const service = new KnowledgeCatalogService({ $queryRaw } as any);
    await service.findAll({ search: term });
    const [fragments, ...values] = $queryRaw.mock.calls[0];
    const sql = fragments.join('?');
    // Os dois ILIKE usam o termo escapado; as quatro similaridades, o bruto.
    expect(sql.match(/ILIKE '%' \|\| \? \|\| '%'/g)).toHaveLength(2);
    expect(values.slice(0, 2)).toEqual([escaped, escaped]);
    expect(values.slice(2)).toEqual([term, term, term, term]);
  });
});
