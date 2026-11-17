import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../users/dto/transforms';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

@Injectable()
export class MailService {
  readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly defaultFrom: string;

  // @Optional: sem o banco (testes isolados) nenhum destinatário é tratado como convite pendente.
  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.defaultFrom =
      this.configService.get<string>('SMTP_FROM') || '"Aponta" <no-reply@aponta.com>';

    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: port || 587,
        secure: port === 465, // true para 465, false p/ outras
        auth: {
          user,
          pass,
        },
      });
    } else {
      this.logger.warn('SMTP credentials not fully configured. Emails will not be sent.');
    }
  }

  /** `true` só quando o SMTP aceitou a mensagem (DMTE-550); falha ou SMTP ausente dá `false`, sem lançar. */
  async sendEmail(options: SendEmailOptions, { toPendingUser = false }: { toPendingUser?: boolean } = {}): Promise<boolean> {
    // DMTE-550 D17: quem tem convite pendente (sem senha) só recebe o próprio convite; o resto do sistema não escreve para ele.
    // Sem destinatário não há o que enviar (dado vindo de fora pode faltar); não estoura fora do try do envio.
    if (typeof options.to !== 'string') return false;
    if (!toPendingUser && (await this.isPendingUser(options.to))) return false;
    if (!this.transporter) {
      this.logger.error(`Email to ${options.to} aborted: SMTP transporter not initialized.`);
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.defaultFrom,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}`, error instanceof Error ? error.stack : String(error));
      return false;
    }
  }

  // Pela chave única, sem varredura: usuário com convite pendente só nasce pelo cadastro novo, que guarda o e-mail em minúsculas.
  private async isPendingUser(email: string): Promise<boolean> {
    if (!this.prisma) return false;
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, password: true },
    });
    return user !== null && user.password === null;
  }
}
