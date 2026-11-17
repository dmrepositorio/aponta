import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { createFakePrisma, FakePrisma } from '../testing/fake-prisma';
import { PasswordTokensService } from './password-tokens.service';

const HOUR = 3_600_000;
const T0 = new Date('2026-11-17T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

describe('PasswordTokensService (relógio injetado, Prisma em memória só para passwordToken)', () => {
  let prisma: FakePrisma;
  let service: PasswordTokensService;

  beforeEach(async () => {
    prisma = createFakePrisma({
      user: [
        { id: USER_A, email: 'a@aponta.test', name: 'A', password: null },
        { id: USER_B, email: 'b@aponta.test', name: 'B', password: null },
      ],
    });
    const moduleRef = await Test.createTestingModule({
      providers: [PasswordTokensService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(PasswordTokensService);
  });

  describe('AC-15: emitir', () => {
    it('AC-15: devolve 32 bytes aleatórios em hexadecimal (64 caracteres) e dois tokens nunca se repetem', async () => {
      const first = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);
      const second = await service.issue(USER_B, 'INVITE', 72 * HOUR, T0);

      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).toMatch(/^[0-9a-f]{64}$/);
      expect(first).not.toBe(second);
    });

    it('AC-15: só o hash SHA-256 vai ao banco; o token cru não aparece em nenhum campo', async () => {
      const raw = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0, USER_B);

      const rows = prisma.tables.passwordToken;
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(sha256(raw));
      expect(JSON.stringify(rows)).not.toContain(raw);
      expect(rows[0]).toMatchObject({ userId: USER_A, purpose: 'INVITE', createdById: USER_B });
    });

    it('AC-15: a validade vem do ttl e do relógio injetado (convite 72 h, redefinição 24 h, esqueci 1 h)', async () => {
      await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);
      await service.issue(USER_B, 'RESET', 24 * HOUR, T0);
      await service.issue(USER_A, 'RESET', 1 * HOUR, T0);

      const byKey = Object.fromEntries(
        prisma.tables.passwordToken.map((t) => [`${t.userId}:${t.purpose}`, new Date(t.expiresAt).toISOString()]),
      );
      expect(byKey[`${USER_A}:INVITE`]).toBe('2026-11-20T12:00:00.000Z');
      expect(byKey[`${USER_B}:RESET`]).toBe('2026-11-18T12:00:00.000Z');
      expect(byKey[`${USER_A}:RESET`]).toBe('2026-11-17T13:00:00.000Z');
    });
  });

  describe('AC-15: consumir', () => {
    it('AC-15: dentro da validade devolve o dono e o propósito', async () => {
      const raw = await service.issue(USER_A, 'RESET', 24 * HOUR, T0);

      await expect(service.consume(raw, at(HOUR))).resolves.toEqual({ userId: USER_A, purpose: 'RESET' });
    });

    it('AC-15: no último milissegundo ainda vale; no instante da expiração já não vale', async () => {
      const raw = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);

      await expect(service.consume(raw, at(72 * HOUR - 1))).resolves.toEqual({ userId: USER_A, purpose: 'INVITE' });
      const other = await service.issue(USER_B, 'INVITE', 72 * HOUR, T0);
      await expect(service.consume(other, at(72 * HOUR))).resolves.toBeNull();
    });

    it('AC-15: token expirado é recusado (esqueci, 1 h)', async () => {
      const raw = await service.issue(USER_A, 'RESET', 1 * HOUR, T0);
      const sibling = await service.issue(USER_B, 'RESET', 1 * HOUR, T0);

      await expect(service.consume(sibling, at(HOUR - 1))).resolves.toEqual({ userId: USER_B, purpose: 'RESET' });
      await expect(service.consume(raw, at(HOUR + 1))).resolves.toBeNull();
    });

    it('AC-15: uso único: a segunda tentativa com o mesmo token é recusada', async () => {
      const raw = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);

      await expect(service.consume(raw, at(1))).resolves.toEqual({ userId: USER_A, purpose: 'INVITE' });
      await expect(service.consume(raw, at(2))).resolves.toBeNull();
    });

    it('AC-15: uso concorrente: duas tentativas simultâneas, uma passa e a outra é recusada', async () => {
      const raw = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);

      const results = await Promise.all([service.consume(raw, at(1)), service.consume(raw, at(1))]);

      expect(results.filter((r) => r !== null)).toEqual([{ userId: USER_A, purpose: 'INVITE' }]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
    });

    it('AC-15: dez tentativas simultâneas, exatamente uma passa', async () => {
      const raw = await service.issue(USER_A, 'RESET', 24 * HOUR, T0);

      const results = await Promise.all(Array.from({ length: 10 }, () => service.consume(raw, at(1))));

      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('AC-15: token inexistente ou mal formado devolve nulo, sem lançar erro', async () => {
      const valid = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);
      const bad = ['f'.repeat(64), '', 'abc', 'z'.repeat(64), "'; DROP TABLE \"User\"; --", '<script>alert(1)</script>', 'a'.repeat(100_000)];

      for (const raw of bad) {
        await expect(service.consume(raw, at(1))).resolves.toBeNull();
      }
      await expect(service.consume(valid, at(2))).resolves.toEqual({ userId: USER_A, purpose: 'INVITE' });
    });
  });

  describe('AC-15: substituição', () => {
    it('AC-15: emitir um novo invalida o anterior do mesmo usuário e propósito', async () => {
      const first = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);
      const second = await service.issue(USER_A, 'INVITE', 72 * HOUR, at(HOUR));

      await expect(service.consume(first, at(2 * HOUR))).resolves.toBeNull();
      await expect(service.consume(second, at(2 * HOUR))).resolves.toEqual({ userId: USER_A, purpose: 'INVITE' });
    });

    it('AC-15: não invalida o token de outro propósito nem o de outro usuário', async () => {
      const invite = await service.issue(USER_A, 'INVITE', 72 * HOUR, T0);
      const reset = await service.issue(USER_A, 'RESET', 24 * HOUR, T0);
      const otherUser = await service.issue(USER_B, 'INVITE', 72 * HOUR, T0);
      await service.issue(USER_A, 'RESET', 24 * HOUR, at(HOUR));

      await expect(service.consume(invite, at(2 * HOUR))).resolves.toEqual({ userId: USER_A, purpose: 'INVITE' });
      await expect(service.consume(otherUser, at(2 * HOUR))).resolves.toEqual({ userId: USER_B, purpose: 'INVITE' });
      await expect(service.consume(reset, at(2 * HOUR))).resolves.toBeNull();
    });
  });

  describe('AC-22: usar o link de redefinição invalida os demais tokens de redefinição do usuário', () => {
    it('AC-22: outro token de redefinição ainda válido do mesmo usuário deixa de valer depois do uso', async () => {
      const raw = await service.issue(USER_A, 'RESET', 24 * HOUR, T0);
      // Token paralelo (corrida entre duas emissões): inserido direto, sem passar pela substituição de issue().
      const parallel = 'c'.repeat(64);
      prisma.tables.passwordToken.push({
        id: '00000000-0000-4000-8000-0000000000f1', userId: USER_A, purpose: 'RESET', tokenHash: sha256(parallel),
        expiresAt: at(24 * HOUR), usedAt: null, createdById: null, createdAt: T0,
      });

      await expect(service.consume(raw, at(HOUR))).resolves.toEqual({ userId: USER_A, purpose: 'RESET' });
      await expect(service.consume(parallel, at(HOUR + 1))).resolves.toBeNull();
    });
  });
});
