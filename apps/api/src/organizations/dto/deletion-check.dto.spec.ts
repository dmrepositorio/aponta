import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeletionCheckDto } from './deletion-check.dto';

const errorsFor = (body: unknown) => validate(plainToInstance(DeletionCheckDto, body));

describe('DeletionCheckDto (DMTE-560 AC-08)', () => {
  it('AC-08: aceita de 1 a 50 ids de texto', async () => {
    expect(await errorsFor({ ids: ['org-1'] })).toHaveLength(0);
    expect(await errorsFor({ ids: Array.from({ length: 50 }, (_, i) => `org-${i}`) })).toHaveLength(0);
  });

  it.each([
    ['sem ids', {}],
    ['lista vazia', { ids: [] }],
    ['mais de 50 ids', { ids: Array.from({ length: 51 }, (_, i) => `org-${i}`) }],
    ['ids que não são texto', { ids: [1, 2] }],
    ['id vazio', { ids: [''] }],
    ['ids que não é lista', { ids: 'org-1' }],
  ])('AC-08: recusa %s', async (_label, body) => {
    expect((await errorsFor(body)).length).toBeGreaterThan(0);
  });
});
