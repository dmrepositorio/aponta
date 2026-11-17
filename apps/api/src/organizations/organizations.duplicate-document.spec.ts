import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrganizationsService } from './organizations.service';

// DMTE-554: o projeto usa @prisma/adapter-pg (Prisma 7); nesse modo o P2002 não traz `meta.target`,
// e sim `meta.driverAdapterError.cause.constraint` (`index` ou `fields`).
const adapterError = (constraint: object) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: {
      driverAdapterError: { cause: { kind: 'UniqueConstraintViolation', constraint } },
      table: 'Organization',
    },
  });

describe('OrganizationsService: documento repetido no formato do adapter-pg (DMTE-554)', () => {
  const prisma: any = {
    organization: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    article: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new OrganizationsService(prisma);

  it.each([
    ['index Organization_cnpj_key', { index: 'Organization_cnpj_key' }, 'Já existe um cliente com este CNPJ.'],
    ['fields [cpf]', { fields: ['cpf'] }, 'Já existe um cliente com este CPF.'],
  ])('answers 409 with a readable message for %s', async (_label, constraint, message) => {
    prisma.organization.create.mockRejectedValue(adapterError(constraint));

    const error = await service.create({ name: 'Dup' } as any).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(message);
  });

  it('keeps a unique violation on another column as it is', async () => {
    const other = adapterError({ index: 'Organization_name_key' });
    prisma.organization.create.mockRejectedValue(other);

    await expect(service.create({ name: 'Dup' } as any)).rejects.toBe(other);
  });
});
