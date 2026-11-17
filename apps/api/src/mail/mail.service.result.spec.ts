import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const mail = { to: 'cliente@aponta.test', subject: 'Assunto', text: 'Corpo' };
const build = (smtp: boolean) => {
  const config = { get: (key: string) => (smtp ? ({ SMTP_HOST: 'smtp.aponta.test', SMTP_PORT: 587, SMTP_USER: 'bot', SMTP_PASS: 'segredo' } as Record<string, unknown>)[key] : undefined) };
  const service = new MailService(config as unknown as ConfigService);
  jest.spyOn(service.logger, 'error').mockImplementation(() => undefined);
  jest.spyOn(service.logger, 'warn').mockImplementation(() => undefined);
  return service;
};

describe('AC-16: MailService.sendEmail informa se o envio foi aceito', () => {
  beforeEach(() => mockSendMail.mockReset());

  it('AC-16: devolve true quando o SMTP aceita a mensagem', async () => {
    mockSendMail.mockResolvedValue({ accepted: ['cliente@aponta.test'] });

    await expect(build(true).sendEmail(mail)).resolves.toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('AC-16: devolve false, sem lançar erro, quando o SMTP recusa', async () => {
    mockSendMail.mockRejectedValue(new Error('554 recusado'));

    await expect(build(true).sendEmail(mail)).resolves.toBe(false);
  });

  it('AC-16: devolve false quando o SMTP não está configurado, sem tentar enviar', async () => {
    await expect(build(false).sendEmail(mail)).resolves.toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
