import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { decryptText, encryptText } from '../common/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { base32Encode, generateSecret, verifyTotp } from './totp';

export const TWO_FACTOR_FLAG = 'autenticacao-dois-fatores';
const RECOVERY_CODE_COUNT = 10;
const INVALID = 'Senha ou código inválido.';
const CHALLENGE_TTL_MS = 5 * 60_000;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 60_000;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Código de recuperação sem traço e em maiúsculas, para comparar com o hash guardado. */
const normalizeRecovery = (code: string) => code.replace(/-/g, '').toUpperCase();

/** Segundo fator (TOTP) do usuário: ativação, desativação e conferência de código (DMTE-551). */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.prisma.userTwoFactor.findUnique({ where: { userId } }))?.enabled === true;
  }

  /** Gera o segredo pendente. O segundo fator só vale depois de `confirm`. */
  async begin(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    this.assertFlag();
    const key = this.key();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const existing = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (existing?.enabled) throw new ConflictException('O segundo fator já está ativo.');

    const secret = generateSecret();
    const data = { secretEnc: encryptText(secret, key), lastStep: 0 };
    if (existing) await this.prisma.userTwoFactor.update({ where: { userId }, data });
    else await this.prisma.userTwoFactor.create({ data: { userId, ...data } });
    return { secret, otpauthUri: `otpauth://totp/Aponta:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Aponta` };
  }

  /** Ativa com um código válido e devolve os códigos de recuperação, que nunca mais são mostrados. */
  async confirm(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    this.assertFlag();
    const key = this.key();
    const record = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (!record) throw new BadRequestException('Peça a ativação do segundo fator antes de confirmar.');
    if (record.enabled) throw new ConflictException('O segundo fator já está ativo.');
    const step = verifyTotp(decryptText(record.secretEnc, key), code, Date.now(), record.lastStep);
    if (step === null) throw new BadRequestException('Código inválido.');

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => base32Encode(randomBytes(7)).slice(0, 10));
    await this.prisma.$transaction(async (tx) => {
      await tx.userTwoFactor.update({ where: { userId }, data: { enabled: true, lastStep: step, confirmedAt: new Date() } });
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.twoFactorRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(c) })) });
    });
    return { recoveryCodes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) };
  }

  /** Desativa com a senha atual e um código do aplicativo ou de recuperação. A resposta não diz qual dos dois falhou. */
  async disable(userId: string, password: string, code: string): Promise<void> {
    const record = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (!record?.enabled) throw new ConflictException('O segundo fator não está ativo.');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.password || !(await bcrypt.compare(password, user.password))) throw new BadRequestException(INVALID);
    if (!(await this.consumeCode(record, code))) throw new BadRequestException(INVALID);
    await this.remove(userId);
  }

  /** Quem tem segundo fator ativo não recebe o JWT: recebe um desafio de curta duração, que só serve para `completeChallenge`. */
  async challengeFor(user: { id: string; passwordVersion: number }): Promise<{ twoFactorRequired: true; challengeToken: string } | null> {
    if (!(await this.isEnabled(user.id))) return null;
    const payload = Buffer.from(JSON.stringify({ u: user.id, pv: user.passwordVersion ?? 0, exp: Date.now() + CHALLENGE_TTL_MS })).toString('base64url');
    return { twoFactorRequired: true, challengeToken: `${payload}.${this.sign(payload)}` };
  }

  /** Confere o desafio e o código; devolve o id do usuário quando os dois valem. Qualquer falha é 401 sem dizer o motivo. */
  async completeChallenge(challengeToken: string, code: string): Promise<string> {
    const claims = this.readChallenge(challengeToken);
    if (!claims) throw new UnauthorizedException('Sessão de login expirada. Entre de novo.');
    this.countAttempt(claims.u);
    const user = await this.prisma.user.findUnique({ where: { id: claims.u } });
    const record = await this.prisma.userTwoFactor.findUnique({ where: { userId: claims.u } });
    // Senha trocada depois do desafio (versão diferente) ou conta inativada: o desafio não vale mais.
    if (!user || !user.active || (user.passwordVersion ?? 0) !== claims.pv || !record?.enabled || !(await this.consumeCode(record, code))) {
      throw new UnauthorizedException('Código inválido.');
    }
    return user.id;
  }

  /** Um administrador desativa o segundo fator de outro usuário que perdeu o aplicativo e os códigos; fica registrado. */
  async disableByAdmin(actorId: string, userId: string): Promise<void> {
    // O próprio segundo fator só sai com senha e código (`disable`); esta rota não é atalho para isso.
    if (actorId === userId) throw new BadRequestException('Para desativar o seu segundo fator, use Minha Conta.');
    if (!(await this.prisma.user.findUnique({ where: { id: userId } }))) throw new NotFoundException('Usuário não encontrado.');
    if (!(await this.isEnabled(userId))) throw new ConflictException('O segundo fator não está ativo.');
    // Remoção e registro juntos: não fica desativação sem trilha.
    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.userTwoFactor.delete({ where: { userId } });
      await tx.securityEvent.create({ data: { type: 'TWO_FACTOR_DISABLED_BY_ADMIN', actorId, subjectId: userId } });
    });
  }

  /** Apaga o segundo fator e os códigos de recuperação do usuário. */
  async remove(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.userTwoFactor.delete({ where: { userId } });
    });
  }

  /** Aceita um código TOTP (mais novo que o último usado) ou um código de recuperação ainda não usado, e o consome. */
  private async consumeCode(record: { userId: string; secretEnc: string; lastStep: number }, code: string): Promise<boolean> {
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(decryptText(record.secretEnc, this.key()), code, Date.now(), record.lastStep);
      if (step === null) return false;
      await this.prisma.userTwoFactor.update({ where: { userId: record.userId }, data: { lastStep: step } });
      return true;
    }
    const claimed = await this.prisma.twoFactorRecoveryCode.updateMany({
      where: { userId: record.userId, codeHash: sha256(normalizeRecovery(code)), usedAt: null },
      data: { usedAt: new Date() },
    });
    return claimed.count === 1;
  }

  private sign(payload: string): string {
    const secret = `${this.config.get<string>('JWT_SECRET') ?? ''}:2fa-challenge`;
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private readChallenge(token: string): { u: string; pv: number } | null {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof claims.u === 'string' && typeof claims.pv === 'number' && claims.exp > Date.now() ? claims : null;
    } catch {
      return null;
    }
  }

  // shortcut: contador em memória, por processo (como o do "esqueci minha senha"); com mais de uma instância, mover para Redis.
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  private countAttempt(userId: string): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.resetAt <= now) this.attempts.delete(key);
    const entry = this.attempts.get(userId) ?? { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    entry.count += 1;
    this.attempts.set(userId, entry);
    if (entry.count > ATTEMPT_LIMIT) throw new ThrottlerException();
  }

  private assertFlag(): void {
    if (!this.flags.isEnabled(TWO_FACTOR_FLAG)) throw new NotFoundException();
  }

  /** Chave de 256 bits derivada da variável de ambiente; sem ela o recurso fica indisponível. */
  private key(): Buffer {
    const raw = this.config.get<string>('TWO_FACTOR_ENCRYPTION_KEY');
    if (!raw) throw new ServiceUnavailableException('Segundo fator indisponível neste ambiente.');
    return createHash('sha256').update(raw).digest();
  }
}
