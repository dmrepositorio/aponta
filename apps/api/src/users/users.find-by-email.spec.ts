import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

/** Rodada 2 da DMTE-550 (achado 2 do QA): a busca por e-mail usa o índice único antes de qualquer varredura. */
describe('DMTE-550 r2: UsersService.findByEmail usa a chave única primeiro', () => {
  let service: UsersService;
  const prisma = { user: { findUnique: jest.fn(), findFirst: jest.fn() } };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({ providers: [UsersService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = moduleRef.get(UsersService);
  });

  it('r2: acha pelo e-mail em minúsculas por chave única, sem busca insensível', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@aponta.test' });

    await expect(service.findByEmail(' Ana@Aponta.Test ')).resolves.toEqual({ id: 'u1', email: 'ana@aponta.test' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ana@aponta.test' } });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('r2: só varre (insensível à caixa) quando a chave única não acha, para o dado legado de caixa mista', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', email: 'Legado@Aponta.Test' });

    await expect(service.findByEmail('legado@aponta.test')).resolves.toEqual({ id: 'u2', email: 'Legado@Aponta.Test' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: { equals: 'legado@aponta.test', mode: 'insensitive' } } });
  });
});
