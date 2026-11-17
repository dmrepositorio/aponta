import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { PrismaService } from '../prisma/prisma.service';

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const mail = { to: 'Pendente@Aponta.test', subject: 'Assunto', text: 'Corpo' };
const build = (pending: boolean) => {
  const config = { get: (key: string) => ({ SMTP_HOST: 'smtp.aponta.test', SMTP_PORT: 587, SMTP_USER: 'bot', SMTP_PASS: 'segredo' } as Record<string, unknown>)[key] };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(pending ? { id: 'u1', password: null } : { id: 'u2', password: 'hash' }), findFirst: jest.fn() } };
  return { service: new MailService(config as unknown as ConfigService, prisma as unknown as PrismaService), prisma };
};

describe('DMTE-550 D17: o sistema não escreve para quem tem convite pendente', () => {
  beforeEach(() => mockSendMail.mockReset().mockResolvedValue({}));

  it('não envia e devolve false quando o destinatário é um usuário sem senha', async () => {
    await expect(build(true).service.sendEmail(mail)).resolves.toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('envia o próprio convite ao usuário pendente (toPendingUser)', async () => {
    await expect(build(true).service.sendEmail(mail, { toPendingUser: true })).resolves.toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('envia normalmente quando o destinatário não é pendente', async () => {
    await expect(build(false).service.sendEmail(mail)).resolves.toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('r2: consulta pela chave única do e-mail em minúsculas, sem busca insensível (sem varredura da tabela)', async () => {
    const { service, prisma } = build(false);

    await service.sendEmail(mail);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'pendente@aponta.test' } }));
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
