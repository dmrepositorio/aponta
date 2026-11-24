import { Role } from '@prisma/client';
import { VaultService } from './vault.service';

// #393: os curingas do LIKE (%, _ e \) da busca viram literais.
const bs = String.fromCharCode(92);
const cases: Array<[string, string]> = [
  ['%', bs + '%'],
  ['_', bs + '_'],
  [bs, bs + bs],
  ['100%_ok' + bs + 'x', '100' + bs + '%' + bs + '_ok' + bs + bs + 'x'],
];
const admin = { id: 'admin-1', role: Role.ADMIN };

function makeService() {
  const prisma: any = {
    credential: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    credentialAuditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-admin' }) },
  };
  return { prisma, service: new VaultService(prisma) };
}

describe('VaultService busca: curingas do LIKE literais', () => {
  it.each(cases)('search %s casa literalmente no nome da credencial', async (term, escaped) => {
    const { prisma, service } = makeService();
    await service.findCredentials({ search: term }, admin);
    expect(prisma.credential.findMany.mock.calls[0][0].where.name).toEqual({ contains: escaped, mode: 'insensitive' });
  });

  it.each(cases)('query %s casa literalmente no alvo da auditoria', async (term, escaped) => {
    const { prisma, service } = makeService();
    await service.findAudit({ query: term }, admin);
    expect(prisma.credentialAuditLog.findMany.mock.calls[0][0].where.targetName).toEqual({ contains: escaped, mode: 'insensitive' });
  });
});
