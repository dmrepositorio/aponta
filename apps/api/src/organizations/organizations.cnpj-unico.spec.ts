import { ConflictException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

// DMTE-559: o índice único do banco só barra o texto idêntico; a API confere o CNPJ em dígitos e pontuado.
describe('OrganizationsService: CNPJ já usado por outro cliente (DMTE-559)', () => {
  const MESSAGE = 'Já existe um cliente com este CNPJ.';
  const DIGITS = '19131243000197';
  const FORMATTED = '19.131.243/0001-97';

  // Banco simulado: só devolve a linha quando o filtro da API a alcança (cnpj e, na edição, id diferente).
  const fakeDb = (rows: Array<{ id: string; cnpj: string }>) => {
    const prisma: any = {
      organization: {
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn().mockResolvedValue({ id: 'org-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', users: [] }),
        findFirst: jest.fn(async ({ where }: any) =>
          rows.find((r) => where.cnpj.in.includes(r.cnpj) && r.id !== where.id?.not) ?? null,
        ),
      },
      article: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new OrganizationsService(prisma) };
  };

  it.each([
    ['dígitos', DIGITS],
    ['pontuado', FORMATTED],
  ])('AC-05: recusa o cadastro com 409 quando o CNPJ de outro cliente está gravado em %s', async (_label, stored) => {
    const { prisma, service } = fakeDb([{ id: 'org-2', cnpj: stored }]);

    const error = await service.create({ name: 'Dup', cnpj: DIGITS } as any).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(MESSAGE);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('AC-05: cadastra quando nenhum cliente tem o CNPJ', async () => {
    const { prisma, service } = fakeDb([{ id: 'org-2', cnpj: '07671166000189' }]);

    await service.create({ name: 'Novo', cnpj: DIGITS } as any);

    expect(prisma.organization.create).toHaveBeenCalledWith({ data: { name: 'Novo', cnpj: DIGITS } });
  });

  it('AC-06: recusa a edição com 409 quando o CNPJ é de outro cliente', async () => {
    const { prisma, service } = fakeDb([{ id: 'org-2', cnpj: FORMATTED }]);

    const error = await service.update('org-1', { cnpj: DIGITS } as any).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(MESSAGE);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('AC-06: o próprio cliente salva o CNPJ que já tem, e a edição sem cnpj não consulta duplicidade', async () => {
    const { prisma, service } = fakeDb([{ id: 'org-1', cnpj: FORMATTED }]);

    await service.update('org-1', { cnpj: DIGITS } as any);
    await service.update('org-1', { name: 'Só o nome' } as any);

    expect(prisma.organization.update).toHaveBeenCalledTimes(2);
    expect(prisma.organization.findFirst).toHaveBeenCalledTimes(1);
  });
});
