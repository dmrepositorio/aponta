import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

/**
 * Prisma em memória só para os testes de HTTP e de token da DMTE-550.
 * Avalia `where` de verdade (igualdade, in/notIn, not, contains/equals
 * insensitive, gt/lt, OR/AND/NOT, some), impõe e-mail/tokenHash únicos e
 * chaves estrangeiras, e desfaz o `$transaction` que lançar. Assim o teste
 * confere o resultado e não o formato das chamadas ao Prisma.
 * Operador fora desta lista lança: estenda aqui em vez de afrouxar o teste.
 */
type Row = Record<string, any>;
type Model = 'user' | 'passwordToken' | 'permissionGroup' | 'permissionGroupUser' | 'technicalGroup' | 'organization' | 'serviceDesk';
export type Tables = Record<Model, Row[]>;

const UNIQUE: Partial<Record<Model, string[]>> = { user: ['email'], passwordToken: ['tokenHash'] };
const FOREIGN: Partial<Record<Model, Record<string, Model>>> = {
  user: { organizationId: 'organization', technicalGroupId: 'technicalGroup' },
  permissionGroupUser: { permissionGroupId: 'permissionGroup', userId: 'user' },
  passwordToken: { userId: 'user' },
};
const DEFAULTS: Record<Model, () => Row> = {
  user: () => ({ id: randomUUID(), phone: null, extension: null, role: 'AGENT', active: true, organizationId: null, technicalGroupId: null, createdAt: new Date(), updatedAt: new Date() }),
  passwordToken: () => ({ id: randomUUID(), usedAt: null, createdById: null, createdAt: new Date() }),
  permissionGroup: () => ({ id: randomUUID(), description: null, permissions: [] }),
  permissionGroupUser: () => ({ createdAt: new Date() }),
  technicalGroup: () => ({ id: randomUUID(), description: null }),
  organization: () => ({ id: randomUUID() }),
  serviceDesk: () => ({ id: randomUUID(), agents: [], agentGroups: [] }),
};
const RELATIONS = ['technicalGroup', 'organization', 'permissionGroupLinks', 'permissionGroup'];
const OPERATORS = ['equals', 'not', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'has', 'some', 'every', 'none', 'is', 'mode'];

const same = (a: any, b: any) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : a === b);
const lower = (v: any, insensitive: boolean) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v);

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, filter]) => {
    if (filter === undefined) return true;
    if (key === 'AND') return [].concat(filter as any).every((w) => matches(row, w));
    if (key === 'OR') return (filter as Row[]).some((w) => matches(row, w));
    if (key === 'NOT') return ![].concat(filter as any).some((w) => matches(row, w));
    return field(row[key], filter);
  });
}

function field(value: any, filter: any): boolean {
  if (filter === null) return value == null;
  if (typeof filter !== 'object' || filter instanceof Date) return same(value, filter);
  const keys = Object.keys(filter);
  if (!keys.some((k) => OPERATORS.includes(k))) return value != null && matches(value, filter);
  const insensitive = filter.mode === 'insensitive';
  return keys.every((op) => {
    const arg = filter[op];
    switch (op) {
      case 'mode': return true;
      case 'equals': return arg === null ? value == null : lower(value, insensitive) === lower(arg, insensitive);
      case 'not': return !field(value, arg);
      case 'in': return (arg as any[]).some((a) => same(value, a));
      case 'notIn': return !(arg as any[]).some((a) => same(value, a));
      case 'contains': return typeof value === 'string' && typeof arg === 'string' && lower(value, insensitive).includes(lower(arg, insensitive));
      case 'startsWith': return typeof value === 'string' && lower(value, insensitive).startsWith(lower(arg, insensitive));
      case 'endsWith': return typeof value === 'string' && lower(value, insensitive).endsWith(lower(arg, insensitive));
      case 'gt': return value != null && value > arg;
      case 'gte': return value != null && value >= arg;
      case 'lt': return value != null && value < arg;
      case 'lte': return value != null && value <= arg;
      case 'has': return Array.isArray(value) && value.includes(arg);
      case 'some': return Array.isArray(value) ? value.some((x) => matches(x, arg)) : true;
      case 'every': return Array.isArray(value) ? value.every((x) => matches(x, arg)) : true;
      case 'none': return Array.isArray(value) ? !value.some((x) => matches(x, arg)) : true;
      case 'is': return value != null && matches(value, arg);
      default: throw new Error(`fake-prisma: operador não suportado: ${op}`);
    }
  });
}

const stripRelations = (v: Row) => Object.fromEntries(Object.entries(v).filter(([k]) => !RELATIONS.includes(k)));

function shape(value: any, spec: any): any {
  if (value == null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => shape(v, spec));
  if (spec?.select) {
    return Object.fromEntries(
      Object.entries(spec.select).filter(([, s]) => s).map(([k, s]) => [k, shape(value[k], s === true ? undefined : s)]),
    );
  }
  const out = stripRelations(value);
  for (const [k, s] of Object.entries(spec?.include ?? {})) if (s) out[k] = shape(value[k], s === true ? undefined : s);
  return out;
}

function notFound(): Error {
  return new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' });
}

export interface FakePrisma {
  tables: Tables;
  /** Toda chamada a um modelo: `{ model, op, args }`. Vazio = o banco não foi tocado. */
  calls: { model: string; op: string; args: any }[];
  [key: string]: any;
}

export function createFakePrisma(seed: Partial<Tables> = {}): FakePrisma {
  const tables: Tables = {
    user: [], passwordToken: [], permissionGroup: [], permissionGroupUser: [], technicalGroup: [], organization: [], serviceDesk: [],
    ...Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, rows!.map((r) => ({ ...r }))])),
  };
  const calls: FakePrisma['calls'] = [];

  const withRelations = (model: Model, row: Row): Row => {
    if (model !== 'user') return { ...row };
    const technicalGroup = tables.technicalGroup.find((g) => g.id === row.technicalGroupId);
    // Grupo de atendentes não carrega grupos de permissões neste fake: `some` sobre ele dá falso (não enumerável, não vaza em respostas).
    if (technicalGroup) Object.defineProperty(technicalGroup, 'permissionGroupLinks', { value: [], enumerable: false, configurable: true });
    return {
      ...row,
      technicalGroup: technicalGroup ?? null,
      organization: tables.organization.find((o) => o.id === row.organizationId) ?? null,
      permissionGroupLinks: tables.permissionGroupUser
        .filter((l) => l.userId === row.id)
        .map((l) => ({ ...l, permissionGroup: tables.permissionGroup.find((g) => g.id === l.permissionGroupId) })),
    };
  };
  const select = (model: Model, where: Row | undefined) => tables[model].filter((row) => matches(withRelations(model, row), where));
  const out = (model: Model, row: Row | undefined, args: Row = {}) => (row ? shape(withRelations(model, row), args) : null);

  const check = (model: Model, row: Row, ignore?: Row) => {
    for (const col of UNIQUE[model] ?? []) {
      if (tables[model].some((o) => o !== ignore && o[col] === row[col])) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: [col] } });
      }
    }
    for (const [col, target] of Object.entries(FOREIGN[model] ?? {})) {
      if (row[col] != null && !tables[target].some((o) => o.id === row[col])) {
        throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: 'test' });
      }
    }
  };

  const nested = (userId: string, ops: Row) => {
    if (ops.deleteMany !== undefined) {
      tables.permissionGroupUser = tables.permissionGroupUser.filter((l) => !(l.userId === userId && matches(l, ops.deleteMany)));
    }
    const rows = [...[].concat(ops.create ?? []), ...(ops.createMany?.data ?? [])] as Row[];
    for (const r of rows) insert('permissionGroupUser', { ...r, userId });
  };

  const insert = (model: Model, data: Row): Row => {
    const { permissionGroupLinks, ...scalars } = data;
    const row = { ...DEFAULTS[model](), ...scalars };
    check(model, row);
    tables[model].push(row);
    if (permissionGroupLinks) nested(row.id, permissionGroupLinks);
    return row;
  };

  const ordered = (rows: Row[], orderBy: any) => {
    const entry = Object.entries(([] as Row[]).concat(orderBy ?? [])[0] ?? {})[0];
    if (!entry) return rows;
    const [col, dir] = entry;
    return [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
  };

  const delegate = (model: Model) => {
    const record = <T>(op: string, args: any, fn: () => T) => {
      calls.push({ model, op, args });
      return Promise.resolve().then(fn);
    };
    return {
      findUnique: (args: Row) => record('findUnique', args, () => out(model, select(model, args.where)[0], args)),
      findFirst: (args: Row = {}) => record('findFirst', args, () => out(model, ordered(select(model, args.where), args.orderBy)[0], args)),
      findMany: (args: Row = {}) =>
        record('findMany', args, () => {
          let rows = ordered(select(model, args.where), args.orderBy);
          rows = rows.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take);
          return rows.map((r) => out(model, r, args));
        }),
      count: (args: Row = {}) => record('count', args, () => select(model, args.where).length),
      create: (args: Row) => record('create', args, () => out(model, insert(model, args.data), args)),
      createMany: (args: Row) =>
        record('createMany', args, () => {
          let count = 0;
          for (const data of args.data) {
            try { insert(model, data); count += 1; } catch (e) { if (!args.skipDuplicates) throw e; }
          }
          return { count };
        }),
      update: (args: Row) =>
        record('update', args, () => {
          const row = select(model, args.where)[0];
          if (!row) throw notFound();
          const { permissionGroupLinks, ...scalars } = args.data;
          const next = { ...row, ...scalars };
          check(model, next, row);
          Object.assign(row, next);
          if (permissionGroupLinks) nested(row.id, permissionGroupLinks);
          return out(model, row, args);
        }),
      updateMany: (args: Row) =>
        record('updateMany', args, () => {
          const rows = select(model, args.where);
          rows.forEach((r) => Object.assign(r, args.data));
          return { count: rows.length };
        }),
      delete: (args: Row) =>
        record('delete', args, () => {
          const row = select(model, args.where)[0];
          if (!row) throw notFound();
          tables[model] = tables[model].filter((r) => r !== row);
          return out(model, row, args);
        }),
      deleteMany: (args: Row = {}) =>
        record('deleteMany', args, () => {
          const rows = select(model, args.where);
          tables[model] = tables[model].filter((r) => !rows.includes(r));
          return { count: rows.length };
        }),
    };
  };

  const prisma: FakePrisma = { tables, calls };
  for (const model of Object.keys(tables) as Model[]) prisma[model] = delegate(model);
  prisma.$transaction = async (arg: any) => {
    const snapshot = structuredClone(tables);
    try {
      return typeof arg === 'function' ? await arg(prisma) : await Promise.all(arg);
    } catch (error) {
      for (const model of Object.keys(snapshot) as Model[]) tables[model] = snapshot[model];
      throw error;
    }
  };
  return prisma;
}
