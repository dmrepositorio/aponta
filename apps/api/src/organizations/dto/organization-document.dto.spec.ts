import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateOrganizationDto } from './create-organization.dto';
import { UpdateOrganizationDto } from './update-organization.dto';

// DMTE-554: o formulário manda cnpj/cpf vazios; ''  é um valor e colide na coluna @unique.
describe('CNPJ/CPF em branco nos DTOs de cliente (DMTE-554)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = <T>(type: new () => T, value: object) =>
    pipe.transform(value, { type: 'body', metatype: type }) as Promise<Record<string, unknown>>;

  it('drops blank cnpj and cpf on create so that two clients without a document can coexist', async () => {
    const dto = await run(CreateOrganizationDto, { name: 'Sem documento', cnpj: '', cpf: '   ' });

    expect(dto.cnpj).toBeUndefined();
    expect(dto.cpf).toBeUndefined();
    expect(dto.name).toBe('Sem documento');
  });

  it('keeps a filled cnpj on create', async () => {
    const dto = await run(CreateOrganizationDto, { name: 'Com documento', cnpj: '19131243000197' });

    expect(dto.cnpj).toBe('19131243000197');
  });

  it('turns blank cnpj and cpf into null on update, which clears the document', async () => {
    const dto = await run(UpdateOrganizationDto, { cnpj: '', cpf: ' ' });

    expect(dto.cnpj).toBeNull();
    expect(dto.cpf).toBeNull();
  });
});
