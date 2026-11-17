import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PasswordTokenPurpose = 'INVITE' | 'RESET';

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Ciclo de vida do token de convite e de redefinição (DMTE-550): só o hash SHA-256 vai ao banco. */
@Injectable()
export class PasswordTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** Emite um token novo e invalida os anteriores ainda não usados do mesmo usuário e propósito. */
  async issue(
    userId: string,
    purpose: PasswordTokenPurpose,
    ttlMs: number,
    now: Date = new Date(),
    createdById?: string,
  ): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.revoke(userId, purpose, now);
    await this.prisma.passwordToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256(raw),
        expiresAt: new Date(now.getTime() + ttlMs),
        createdById: createdById ?? null,
        createdAt: now,
      },
    });
    return raw;
  }

  /** Invalida (marca como usado) os tokens ainda abertos do usuário e propósito. */
  async revoke(userId: string, purpose: PasswordTokenPurpose, now: Date = new Date()): Promise<void> {
    await this.prisma.passwordToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
  }

  /** Dono do token se ele ainda vale, sem consumi-lo: a regra de senha precisa do nome e do e-mail antes de queimar o link. */
  async peek(rawToken: string, now: Date = new Date()): Promise<string | null> {
    if (!/^[0-9a-f]{64}$/.test(rawToken)) return null;
    const token = await this.prisma.passwordToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    return token && token.usedAt == null && token.expiresAt > now ? token.userId : null;
  }

  /**
   * Uso único e atômico: a marca de uso só grava se o token ainda não foi usado e não expirou
   * (um UPDATE condicional; duas tentativas simultâneas, só uma muda uma linha).
   * Qualquer falha devolve `null`, sem dizer o motivo.
   */
  async consume(rawToken: string, now: Date = new Date()): Promise<{ userId: string; purpose: PasswordTokenPurpose } | null> {
    if (!/^[0-9a-f]{64}$/.test(rawToken)) return null;
    const tokenHash = sha256(rawToken);
    const claimed = await this.prisma.passwordToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const token = await this.prisma.passwordToken.findUnique({ where: { tokenHash } });
    if (!token) return null;
    // Os demais links abertos do mesmo usuário e propósito deixam de valer (AC-22).
    await this.revoke(token.userId, token.purpose, now);
    return { userId: token.userId, purpose: token.purpose };
  }
}
