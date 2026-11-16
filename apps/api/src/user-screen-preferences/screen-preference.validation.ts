import { BadRequestException } from '@nestjs/common';

type Obj = Record<string, unknown>;

const fail = (message: string): never => {
  throw new BadRequestException(`Preferência de tela inválida: ${message}`);
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown, path: string, keys: string[]): Obj => {
  if (!isObj(v)) return fail(`${path} deve ser um objeto`);
  const unknown = Object.keys(v).find((k) => !keys.includes(k));
  return unknown === undefined ? v : fail(`campo desconhecido ${path}.${unknown}`);
};
const str = (v: unknown, path: string, max = Infinity) =>
  typeof v === 'string' && v.length <= max ? v : fail(`${path} deve ser texto${max < Infinity ? ` de até ${max} caracteres` : ''}`);
const oneOf = (v: unknown, path: string, options: string[]) =>
  options.includes(v as string) ? v : fail(`${path} deve ser um de ${options.join(', ')}`);
const list = (v: unknown, path: string, max: number): unknown[] =>
  Array.isArray(v) && v.length <= max ? v : fail(`${path} deve ser uma lista de até ${max} itens`);
const boolMap = (v: unknown, path: string, max: number, keyMax?: number) => {
  if (!isObj(v) || Object.keys(v).length > max) fail(`${path} deve ser um mapa de até ${max} entradas`);
  for (const [k, value] of Object.entries(v as Obj)) {
    if (typeof value !== 'boolean') fail(`${path}.${k} deve ser verdadeiro ou falso`);
    if (keyMax !== undefined) str(k, `id em ${path}`, keyMax);
  }
};

/** Formato da preferência (SPEC DMTE-527, item 11): lança 400 para campo desconhecido, tipo errado ou limite excedido. */
export function validateScreenPreference(data: unknown): void {
  const root = obj(data, 'corpo', ['grid', 'form', 'viewMode', 'savedFilters', 'groupBy', 'collapsed']);
  if ('grid' in root) {
    const grid = obj(root.grid, 'grid', ['columnVisibility', 'density', 'columnOrder']);
    if ('columnVisibility' in grid) boolMap(grid.columnVisibility, 'grid.columnVisibility', 200);
    if ('density' in grid) oneOf(grid.density, 'grid.density', ['compact', 'comfortable']);
    if ('columnOrder' in grid) list(grid.columnOrder, 'grid.columnOrder', 200).forEach((id) => str(id, 'grid.columnOrder[]'));
  }
  if ('form' in root) {
    const form = obj(root.form, 'form', ['layout']);
    if ('layout' in form) oneOf(form.layout, 'form.layout', ['CASCADE', 'SIDE_BY_SIDE']);
  }
  if ('viewMode' in root) oneOf(root.viewMode, 'viewMode', ['GRID', 'FORM']);
  if ('savedFilters' in root) {
    list(root.savedFilters, 'savedFilters', 50).forEach((f) => {
      const filter = obj(f, 'savedFilters[]', ['id', 'name', 'criteria']);
      str(filter.id, 'savedFilters[].id');
      str(filter.name, 'savedFilters[].name', 120);
      if (!isObj(filter.criteria)) fail('savedFilters[].criteria deve ser um objeto');
    });
  }
  if ('groupBy' in root) str(root.groupBy, 'groupBy', 64);
  if ('collapsed' in root) boolMap(root.collapsed, 'collapsed', 100, 64);
}
