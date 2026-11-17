import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CnpjLookupService } from './cnpj-lookup.service';

const PRIMARY = 'https://brasilapi.com.br/api/cnpj/v1/19131243000197';
const RECEITAWS = 'https://receitaws.com.br/v1/cnpj/19131243000197';
const MINHA_RECEITA = 'https://minhareceita.org/19131243000197';

const company = {
  razao_social: 'Empresa Teste LTDA',
  nome_fantasia: 'Teste',
  cep: '01310100',
  logradouro: 'Av Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  municipio: 'Sao Paulo',
  uf: 'SP',
  complemento: 'Sala 1',
};

const expected = {
  cnpj: '19131243000197',
  legalName: 'Empresa Teste LTDA',
  tradeName: 'Teste',
  address: {
    zipCode: '01310100',
    street: 'Av Paulista, 1000',
    neighborhood: 'Bela Vista',
    city: 'Sao Paulo',
    state: 'SP',
    complement: 'Sala 1',
  },
};

const ok = { status: 200, ok: true, json: async () => company };
const receitaWsOk = {
  status: 200,
  ok: true,
  json: async () => ({
    status: 'OK',
    nome: 'Empresa Teste LTDA',
    fantasia: 'Teste',
    cep: '01.310-100',
    logradouro: 'Av Paulista',
    numero: '1000',
    bairro: 'Bela Vista',
    municipio: 'Sao Paulo',
    uf: 'SP',
    complemento: 'Sala 1',
  }),
};
const receitaWsError = { status: 200, ok: true, json: async () => ({ status: 'ERROR', message: 'CNPJ rejeitado' }) };
const status = (code: number) => ({ status: code, ok: false });

/** Responde por URL; URL não listada falha na rede. */
const answers = (byUrl: Record<string, unknown>) => (url: string) =>
  url in byUrl ? Promise.resolve(byUrl[url]) : Promise.reject(new Error('network'));

describe('CnpjLookupService', () => {
  let service: CnpjLookupService;
  let fetchMock: jest.Mock;
  let backupEnabled: boolean;

  beforeEach(() => {
    backupEnabled = true;
    service = new CnpjLookupService({ isEnabled: () => backupEnabled } as unknown as FeatureFlagsService);
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws NotFoundException when the API returns 404', async () => {
    fetchMock.mockResolvedValue({ status: 404, ok: false });

    await expect(service.lookup('19131243000197')).rejects.toThrow(NotFoundException);
  });

  it('throws BadGatewayException when the API fails', async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false });

    await expect(service.lookup('19131243000197')).rejects.toThrow(BadGatewayException);
  });

  it('maps a successful response to CnpjLookupResult', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        razao_social: 'Empresa Teste LTDA',
        nome_fantasia: 'Teste',
        cep: '01310100',
        logradouro: 'Av Paulista',
        numero: '1000',
        bairro: 'Bela Vista',
        municipio: 'Sao Paulo',
        uf: 'SP',
        complemento: 'Sala 1',
      }),
    });

    const result = await service.lookup('19.131.243/0001-97');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://brasilapi.com.br/api/cnpj/v1/19131243000197',
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    );
    expect(result).toEqual({
      cnpj: '19131243000197',
      legalName: 'Empresa Teste LTDA',
      tradeName: 'Teste',
      address: {
        zipCode: '01310100',
        street: 'Av Paulista, 1000',
        neighborhood: 'Bela Vista',
        city: 'Sao Paulo',
        state: 'SP',
        complement: 'Sala 1',
      },
    });
  });
  describe('provedores reserva (DMTE-556)', () => {
    it('falls back to ReceitaWS when the primary does not know the CNPJ', async () => {
      fetchMock.mockImplementation(answers({ [PRIMARY]: status(404), [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19.131.243/0001-97')).resolves.toEqual(expected);
    });

    it('falls back to ReceitaWS when the primary answers 5xx', async () => {
      fetchMock.mockImplementation(answers({ [PRIMARY]: status(503), [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19131243000197')).resolves.toEqual(expected);
    });

    it('falls back to ReceitaWS when the primary is unreachable', async () => {
      fetchMock.mockImplementation(answers({ [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19131243000197')).resolves.toEqual(expected);
    });

    it('falls back to minhareceita.org when ReceitaWS is rate limited', async () => {
      fetchMock.mockImplementation(
        answers({ [PRIMARY]: status(503), [RECEITAWS]: status(429), [MINHA_RECEITA]: ok }),
      );

      await expect(service.lookup('19131243000197')).resolves.toEqual(expected);
    });

    it('falls back to minhareceita.org when ReceitaWS and the primary are unreachable', async () => {
      fetchMock.mockImplementation(answers({ [MINHA_RECEITA]: ok }));

      await expect(service.lookup('19131243000197')).resolves.toEqual(expected);
    });

    it('throws NotFoundException when every provider answers 404', async () => {
      fetchMock.mockImplementation(
        answers({ [PRIMARY]: status(404), [RECEITAWS]: status(404), [MINHA_RECEITA]: status(404) }),
      );

      await expect(service.lookup('19131243000197')).rejects.toThrow(NotFoundException);
    });

    it('counts a ReceitaWS 200 with status ERROR as not found', async () => {
      fetchMock.mockImplementation(
        answers({ [PRIMARY]: status(404), [RECEITAWS]: receitaWsError, [MINHA_RECEITA]: status(404) }),
      );

      await expect(service.lookup('19131243000197')).rejects.toThrow(NotFoundException);
    });

    it('throws BadGatewayException when nobody found the CNPJ and one provider failed', async () => {
      fetchMock.mockImplementation(
        answers({ [PRIMARY]: status(404), [RECEITAWS]: status(404), [MINHA_RECEITA]: status(500) }),
      );

      await expect(service.lookup('19131243000197')).rejects.toThrow(BadGatewayException);
    });

    it('throws BadGatewayException when every provider is unreachable', async () => {
      fetchMock.mockImplementation(answers({}));

      await expect(service.lookup('19131243000197')).rejects.toThrow(BadGatewayException);
    });

    it('moves on when a provider answers 200 with a body that has no company name', async () => {
      const noName = { status: 200, ok: true, json: async () => ({ cep: '01310100' }) };
      fetchMock.mockImplementation(answers({ [PRIMARY]: noName, [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19131243000197')).resolves.toEqual(expected);
    });

    it('moves on when a provider answers 200 with a null body', async () => {
      const nullBody = { status: 200, ok: true, json: async () => null };
      fetchMock.mockImplementation(answers({ [PRIMARY]: nullBody, [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19131243000197')).resolves.toEqual(expected);
    });

    it('throws BadGatewayException when ReceitaWS is rate limited and nobody else found the CNPJ', async () => {
      fetchMock.mockImplementation(
        answers({ [PRIMARY]: status(404), [RECEITAWS]: status(429), [MINHA_RECEITA]: status(404) }),
      );

      await expect(service.lookup('19131243000197')).rejects.toThrow(BadGatewayException);
    });

    it('throws BadRequestException when a reserve provider says the number is invalid', async () => {
      fetchMock.mockImplementation(
        answers({ [PRIMARY]: status(404), [RECEITAWS]: status(400), [MINHA_RECEITA]: ok }),
      );

      await expect(service.lookup('19131243000197')).rejects.toThrow(BadRequestException);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('sends an abort signal so a slow provider cannot hang the lookup', async () => {
      fetchMock.mockImplementation(answers({ [PRIMARY]: ok }));

      await service.lookup('19131243000197');

      expect(fetchMock).toHaveBeenCalledWith(
        PRIMARY,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('does not call another provider when the primary answers 200', async () => {
      fetchMock.mockImplementation(answers({ [PRIMARY]: ok }));

      await service.lookup('19131243000197');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException without calling another provider when the primary says the number is invalid', async () => {
      fetchMock.mockImplementation(answers({ [PRIMARY]: status(400), [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19131243000197')).rejects.toThrow(BadRequestException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the old behavior when the flag consulta-cnpj-alternativa is off', async () => {
      backupEnabled = false;
      fetchMock.mockImplementation(answers({ [PRIMARY]: status(404), [RECEITAWS]: receitaWsOk }));

      await expect(service.lookup('19131243000197')).rejects.toThrow(NotFoundException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
