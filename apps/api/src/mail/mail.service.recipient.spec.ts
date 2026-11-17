import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { PrismaService } from '../prisma/prisma.service';

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

/** Code-review da rodada 2 (DMTE-550): destinatário ausente não pode estourar fora do try do envio. */
describe('DMTE-550 r2 review: MailService.sendEmail sem destinatário', () => {
  const config = { get: (key: string) => ({ SMTP_HOST: 'smtp.aponta.test', SMTP_PORT: 587, SMTP_USER: 'bot', SMTP_PASS: 'segredo' } as Record<string, unknown>)[key] };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
  const service = new MailService(config as unknown as ConfigService, prisma as unknown as PrismaService);
  jest.spyOn(service.logger, 'error').mockImplementation(() => undefined);

  it.each([undefined, null, 42])('devolve false e não tenta enviar quando o destinatário é %p', async (to) => {
    mockSendMail.mockReset();

    await expect(service.sendEmail({ to: to as unknown as string, subject: 'Assunto', text: 'Corpo' })).resolves.toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
