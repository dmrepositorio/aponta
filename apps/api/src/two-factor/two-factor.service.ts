import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { base32Encode, generateSecret, verifyTotp } from './totp';

export const TWO_FACTOR_FLAG = 'autenticacao-dois-fatores';
const RECOVERY_CODE_COUNT = 10;
const INVALID = 'Senha ou código inválido.';

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
    const data = { secretEnc: this.encrypt(secret, key), lastStep: 0 };
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
    const step = verifyTotp(this.decrypt(record.secretEnc, key), code, Date.now(), record.lastStep);
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
      const step = verifyTotp(this.decrypt(record.secretEnc, this.key()), code, Date.now(), record.lastStep);
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

  private assertFlag(): void {
    if (!this.flags.isEnabled(TWO_FACTOR_FLAG)) throw new NotFoundException();
  }

  /** Chave de 256 bits derivada da variável de ambiente; sem ela o recurso fica indisponível. */
  private key(): Buffer {
    const raw = this.config.get<string>('TWO_FACTOR_ENCRYPTION_KEY');
    if (!raw) throw new ServiceUnavailableException('Segundo fator indisponível neste ambiente.');
    return createHash('sha256').update(raw).digest();
  }

  // AES-256-GCM: iv (12) + etiqueta (16) + texto cifrado, em base64.
  private encrypt(plain: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  private decrypt(stored: string, key: Buffer): string {
    const raw = Buffer.from(stored, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
