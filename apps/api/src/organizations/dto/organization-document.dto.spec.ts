import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateOrganizationDto } from './create-organization.dto';
import { UpdateOrganizationDto } from './update-organization.dto';

// DMTE-554: o formulário manda cnpj/cpf vazios; ''  é um valor e colide na coluna @unique.
// DMTE-559: o CNPJ passou a ser obrigatório, só com dígitos e sem limpar na edição.
describe('CNPJ/CPF nos DTOs de cliente (DMTE-554, DMTE-559)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = <T>(type: new () => T, value: object) =>
    pipe.transform(value, { type: 'body', metatype: type }) as Promise<Record<string, unknown>>;
  const CNPJ_MESSAGE = 'CNPJ é obrigatório e deve ter 14 dígitos.';
  const messageOf = async (promise: Promise<unknown>) => {
    const error: any = await promise.catch((e) => e);
    return error?.getResponse?.().message;
  };

  it.each([
    ['sem a chave cnpj', { name: 'Sem documento' }],
    ['com cnpj em branco', { name: 'Sem documento', cnpj: '  ' }],
    ['com documentType CNPJ e cnpj vazio', { name: 'Sem documento', documentType: 'CNPJ', cnpj: '' }],
  ])('AC-01: recusa o cadastro %s', async (_label, body) => {
    expect(await messageOf(run(CreateOrganizationDto, body))).toContain(CNPJ_MESSAGE);
  });

  it('AC-02: entrega só os 14 dígitos de um cnpj pontuado, na criação e na edição', async () => {
    const created = await run(CreateOrganizationDto, { name: 'Com documento', cnpj: '19.131.243/0001-97' });
    const updated = await run(UpdateOrganizationDto, { cnpj: '19.131.243/0001-97' });

    expect(created.cnpj).toBe('19131243000197');
    expect(updated.cnpj).toBe('19131243000197');
  });

  it.each(['1913124300019', '191312430001970', '12345678'])('AC-02: recusa o cnpj %s, que não tem 14 dígitos', async (cnpj) => {
    expect(await messageOf(run(CreateOrganizationDto, { name: 'X', cnpj }))).toContain(CNPJ_MESSAGE);
    expect(await messageOf(run(UpdateOrganizationDto, { cnpj }))).toContain(CNPJ_MESSAGE);
  });

  it('AC-03: recusa cnpj em branco na edição (não limpa) e aceita a edição sem a chave cnpj', async () => {
    expect(await messageOf(run(UpdateOrganizationDto, { cnpj: ' ' }))).toContain(CNPJ_MESSAGE);
    expect(await messageOf(run(UpdateOrganizationDto, { cnpj: null }))).toContain(CNPJ_MESSAGE);

    const dto = await run(UpdateOrganizationDto, { name: 'Novo nome' });
    expect(dto.cnpj).toBeUndefined();
    expect(dto.name).toBe('Novo nome');
  });

  it('AC-04: aceita cliente PF sem cnpj e mantém o cpf em branco como não informado', async () => {
    const dto = await run(CreateOrganizationDto, { name: 'Pessoa', documentType: 'CPF', cnpj: '', cpf: '   ' });

    expect(dto.cnpj).toBeUndefined();
    expect(dto.cpf).toBeUndefined();
    expect(dto.name).toBe('Pessoa');
  });

  it('turns blank cpf into null on update, which clears the document', async () => {
    const dto = await run(UpdateOrganizationDto, { cpf: ' ' });

    expect(dto.cpf).toBeNull();
  });
});
