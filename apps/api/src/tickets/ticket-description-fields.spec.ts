import { BadRequestException, Logger } from '@nestjs/common';
import * as sanitizer from './sanitize-ticket-description';
import { ticketDescriptionFields } from './ticket-description-fields';

describe('ticketDescriptionFields', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('devolve a descrição sanitizada, nunca undefined', () => {
    expect(ticketDescriptionFields('<p>ok</p><script>x</script>')).toEqual({
      description: '<p>ok</p>',
    });
    expect(ticketDescriptionFields('<script>x</script>')).toEqual({ description: '' });
  });

  it('devolve texto puro idêntico', () => {
    expect(ticketDescriptionFields('a < b & c\nlinha 2')).toEqual({
      description: 'a < b & c\nlinha 2',
    });
  });

  it('é idempotente: o valor devolvido já é o gravável', () => {
    const once = ticketDescriptionFields('<p onclick="x">ok</p><br>').description;
    expect(ticketDescriptionFields(once).description).toBe(once);
  });

  describe('AC-12: falha do sanitizador', () => {
    it('lança 400 genérico e nunca devolve o valor cru', () => {
      const secret = '<p>conteudo-sensivel-123</p>';
      jest.spyOn(sanitizer, 'sanitizeTicketDescription').mockImplementation(() => {
        throw new Error(`falha interna com ${secret}`);
      });

      let caught: unknown;
      try {
        ticketDescriptionFields(secret);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((caught as BadRequestException).getResponse())).not.toContain(
        'conteudo-sensivel-123',
      );
      expect((caught as BadRequestException).message).toBe('Descrição inválida');
    });
  });

  describe('AC-14: log de remoção só com contagens', () => {
    it('registra antes, depois e remoção por nome de tag quando algo foi removido', () => {
      const input = '<p>ok</p><script>alert(1)</script><iframe src="https://evil.test"></iframe>';
      const { description } = ticketDescriptionFields(input);

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toEqual({
        antes: input.length,
        depois: description.length,
        removido: { script: 1, iframe: 1 },
      });
    });

    it('não registra quando o resultado é igual à entrada', () => {
      ticketDescriptionFields('<p>ok</p>');
      ticketDescriptionFields('texto puro');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('não registra só por causa da serialização de tag vazia (br, hr, img)', () => {
      ticketDescriptionFields('<p>a<br>b</p><hr>');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('não leva conteúdo, ticketId nem atributos para nenhum argumento do log', () => {
      ticketDescriptionFields(
        '<p>texto-do-cliente-987</p><img src="/a.png" onerror="roubar-token-555"><script>segredo-321</script>',
      );
      expect(logSpy).toHaveBeenCalled();
      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logged).not.toContain('texto-do-cliente-987');
      expect(logged).not.toContain('roubar-token-555');
      expect(logged).not.toContain('segredo-321');
      expect(logged).not.toContain('ticketId');
    });
  });
});
