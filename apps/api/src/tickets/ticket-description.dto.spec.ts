import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

const LIMIT = 100000;
const DESK = '123e4567-e89b-12d3-a456-426614174001';

async function descriptionErrors(
  cls: new () => object,
  description: string,
) {
  const dto = plainToInstance(cls, {
    title: 't',
    description,
    serviceDeskId: DESK,
  });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'description');
}

describe('AC-11: teto de tamanho da descrição', () => {
  const classes: Array<[string, new () => object]> = [
    ['criar', CreateTicketDto],
    ['atualizar', UpdateTicketDto],
  ];

  it.each(classes)('%s: aceita exatamente o teto de caracteres', async (_nome, cls) => {
    expect(await descriptionErrors(cls, 'a'.repeat(LIMIT))).toHaveLength(0);
  });

  it.each(classes)('%s: recusa acima do teto, sem ecoar o conteúdo', async (_nome, cls) => {
    const errors = await descriptionErrors(cls, 'x'.repeat(LIMIT + 1));
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
    expect(JSON.stringify(errors[0].constraints)).not.toContain('xxxxx');
  });
});
