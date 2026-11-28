import { Role } from '@prisma/client';
import { legacyContractAccess } from './contract-access.testing';
import { ContractsService } from './contracts.service';

// #393: os curingas do LIKE (%, _ e \) da busca viram literais.
const bs = String.fromCharCode(92);
const cases: Array<[string, string]> = [
  ['%', bs + '%'],
  ['_', bs + '_'],
  [bs, bs + bs],
  ['100%_ok' + bs + 'x', '100' + bs + '%' + bs + '_ok' + bs + bs + 'x'],
];

describe('ContractsService busca: curingas do LIKE literais', () => {
  it.each(cases)('search %s casa literalmente no nome do contrato e da organização', async (term, escaped) => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ContractsService({ contract: { findMany } } as any, legacyContractAccess());
    await service.findAll({ id: 'u1', role: Role.ADMIN }, ' ' + term + ' ');
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { name: { contains: escaped, mode: 'insensitive' } },
      { organization: { name: { contains: escaped, mode: 'insensitive' } } },
    ]);
  });
});
