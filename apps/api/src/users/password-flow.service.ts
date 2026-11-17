import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordTokensService, PasswordTokenPurpose } from './password-tokens.service';
import { UsersService } from './users.service';

export const PASSWORD_FLOW_FLAG = 'convite-e-redefinicao-usuario';
const HOUR = 3_600_000;
const SALT_ROUNDS = 10;
const INVALID_LINK = 'Link inválido ou expirado.';
const FORGOT_LIMIT = 5;
const FORGOT_WINDOW_MS = 60_000;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Convite, redefinição pelo administrador, "esqueci minha senha" e definir senha (DMTE-550). */
@Injectable()
export class PasswordFlowService {
  private readonly logger = new Logger(PasswordFlowService.name);
  // shortcut: contador por e-mail em memória, por processo (como o storage padrão do throttler); com mais de uma instância, mover para Redis.
  private readonly forgotAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly users: UsersService,
    private readonly tokens: PasswordTokensService,
    private readonly mail: MailService,
    private readonly flags: FeatureFlagsService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Flag desligada: a rota se comporta como inexistente. */
  assertEnabled(): void {
    if (!this.flags.isEnabled(PASSWORD_FLOW_FLAG)) throw new NotFoundException();
  }

  async sendInvite(userId: string, actorId: string): Promise<void> {
    this.assertEnabled();
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.password) throw new ConflictException('Só usuário com convite pendente recebe convite.');
    await this.issueAndSend(user, 'INVITE', 72 * HOUR, actorId);
  }

  async sendReset(userId: string, actorId: string): Promise<void> {
    this.assertEnabled();
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (!user.active || !user.password) throw new ConflictException('Só usuário ativo e com senha pode redefinir a senha.');
    await this.issueAndSend(user, 'RESET', 24 * HOUR, actorId);
  }

  /**
   * "Esqueci minha senha": a resposta não depende de a conta existir nem do envio. O trabalho todo
   * roda depois de responder, para o tempo também não revelar a conta. Limite de 5/min por e-mail
   * (o limite por origem é do throttler da rota).
   */
  forgot(email: string): void {
    this.assertEnabled();
    this.countForgotAttempt(email);
    void this.sendForgot(email).catch((error) =>
      this.logger.error('Falha ao processar "esqueci minha senha"', error instanceof Error ? error.stack : String(error)),
    );
  }

  async setPassword(token: string, password: string): Promise<void> {
    this.assertEnabled();
    const claimed = await this.tokens.consume(token);
    if (!claimed) throw new BadRequestException(INVALID_LINK);
    await this.prisma.user.update({
      where: { id: claimed.userId },
      data: { password: await bcrypt.hash(password, SALT_ROUNDS) },
    });
  }

  private countForgotAttempt(email: string): void {
    const now = Date.now();
    for (const [key, entry] of this.forgotAttempts) if (entry.resetAt <= now) this.forgotAttempts.delete(key);
    const entry = this.forgotAttempts.get(email) ?? { count: 0, resetAt: now + FORGOT_WINDOW_MS };
    entry.count += 1;
    this.forgotAttempts.set(email, entry);
    if (entry.count > FORGOT_LIMIT) throw new ThrottlerException();
  }

  private async sendForgot(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.active || !user.password) return;
    try {
      await this.issueAndSend(user, 'RESET', HOUR);
    } catch {
      // Sem resposta diferente para o chamador; o envio recusado já limpou o token.
    }
  }

  private async issueAndSend(
    user: { id: string; name: string; email: string },
    purpose: PasswordTokenPurpose,
    ttlMs: number,
    actorId?: string,
  ): Promise<void> {
    const base = this.config.get<string>('PUBLIC_APP_URL')?.replace(/\/+$/, '');
    if (!base) {
      this.logger.error('PUBLIC_APP_URL não configurada: e-mail de senha não enviado.');
      throw new BadGatewayException('Não foi possível enviar o e-mail.');
    }
    const token = await this.tokens.issue(user.id, purpose, ttlMs, new Date(), actorId);
    const link = `${base}/definir-senha#t=${token}`;
    let sent = false;
    try {
      sent = await this.mail.sendEmail({ to: user.email, ...this.message(user.name, purpose, ttlMs, link) });
    } catch {
      // Falha de SMTP é tratada abaixo; a mensagem do erro pode trazer o link, então não é registrada.
    }
    if (!sent) {
      await this.tokens.revoke(user.id, purpose);
      throw new BadGatewayException('Não foi possível enviar o e-mail.');
    }
  }

  private message(name: string, purpose: PasswordTokenPurpose, ttlMs: number, link: string) {
    const hours = ttlMs / HOUR;
    const validity = hours === 1 ? '1 hora' : `${hours} horas`;
    const [subject, intro] =
      purpose === 'INVITE'
        ? ['[Aponta] Convite para acessar o Aponta', 'Você foi convidado para acessar o Aponta. Defina a sua senha pelo link abaixo.']
        : ['[Aponta] Redefinição de senha', 'Recebemos um pedido para redefinir a sua senha do Aponta. Crie uma nova senha pelo link abaixo.'];
    const footer = `O link vale por ${validity} e só pode ser usado uma vez. Se você não esperava este e-mail, ignore-o.`;
    return {
      subject,
      text: `Olá, ${name}!\n\n${intro}\n\n${link}\n\n${footer}`,
      html: `<p>Olá, ${escapeHtml(name)}!</p><p>${intro}</p><p><a href="${link}">${link}</a></p><p>${footer}</p>`,
    };
  }
}
