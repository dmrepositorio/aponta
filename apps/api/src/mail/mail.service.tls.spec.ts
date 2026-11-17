import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn() })) }));

/** Seam: o transporte de e-mail que o MailService monta a partir do SMTP configurado (DMTE-551, T3). */
const build = (env: Record<string, unknown>) => {
  (nodemailer.createTransport as jest.Mock).mockClear();
  new MailService({ get: (key: string) => env[key] } as unknown as ConfigService);
  return (nodemailer.createTransport as jest.Mock).mock.calls[0]?.[0];
};
const smtp = { SMTP_HOST: 'mail.exemplo.test', SMTP_USER: 'bot@exemplo.test', SMTP_PASS: 'segredo-de-teste' };

describe('MailService: TLS no envio (DMTE-551)', () => {
  it.each([[587], ['587'], [25], ['2525']])('AC-05: na porta %s exige TLS (STARTTLS) e não manda a senha em claro', (port) => {
    const options = build({ ...smtp, SMTP_PORT: port });

    expect(options.requireTLS).toBe(true);
    expect(options.secure).toBe(false);
  });

  it.each([[465], ['465']])('AC-05: na porta %s a conexão já nasce segura, sem pedir STARTTLS', (port) => {
    const options = build({ ...smtp, SMTP_PORT: port });

    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBeFalsy();
  });

  it('AC-05: sem porta configurada vale a 587, com TLS exigido', () => {
    const options = build(smtp);

    expect(options.port).toBe(587);
    expect(options.requireTLS).toBe(true);
  });

  it('AC-05: sem SMTP configurado nenhum transporte é criado e o envio responde false', async () => {
    (nodemailer.createTransport as jest.Mock).mockClear();
    const service = new MailService({ get: () => undefined } as unknown as ConfigService);

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(await service.sendEmail({ to: 'a@b.test', subject: 's', text: 't' })).toBe(false);
  });
});
