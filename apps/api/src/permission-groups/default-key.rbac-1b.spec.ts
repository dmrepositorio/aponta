import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Role } from '@prisma/client';
import {
  DEFAULT_GROUP_KEY,
  DEFAULT_PERMISSION_GROUPS,
  ROLE_GROUP_NAME,
  findOrCreateDefaultGroup,
} from './default-permission-groups';

/**
 * Fase 1b do tracker #523 (#533): grupos padrão ligados por chave estável
 * (`defaultKey`), não por nome. Aditivo: nenhuma decisão de acesso muda.
 */

const API_ROOT = resolve(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(API_ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = join('prisma', 'migrations', '20261127130000_rbac_1b_default_group_key', 'migration.sql');
const ROLES = Object.values(Role);

type Row = { id: string; name: string; defaultKey: string | null; description?: string | null; permissions?: string[] };
function fakeDb(rows: Row[]) {
  return {
    rows,
    permissionGroup: {
      findUnique: jest.fn(async ({ where }: { where: { defaultKey: string } }) => rows.find((r) => r.defaultKey === where.defaultKey) ?? null),
      findFirst: jest.fn(async ({ where }: { where: { name: string } }) => rows.find((r) => r.name === where.name) ?? null),
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
        const row = { id: `g${rows.length + 1}`, defaultKey: null, ...data } as Row;
        rows.push(row);
        return row;
      }),
    },
  };
}

describe('DEFAULT_GROUP_KEY (#533)', () => {
  it('tem uma chave não vazia e distinta por papel', () => {
    const keys = ROLES.map((r) => DEFAULT_GROUP_KEY[r]);
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(ROLES.length);
  });
});

describe('findOrCreateDefaultGroup (#533)', () => {
  it('renomear o grupo padrão não quebra o vínculo: acha pela chave e não cria outro', async () => {
    const db = fakeDb([{ id: 'g-renomeado', name: 'Atendimento Nível 1', defaultKey: DEFAULT_GROUP_KEY[Role.AGENT] }]);
    const id = await findOrCreateDefaultGroup(db as never, Role.AGENT);
    expect(id).toBe('g-renomeado');
    expect(db.permissionGroup.create).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(1);
  });

  it('não liga um grupo personalizado só porque o nome coincide com o padrão (sem chave)', async () => {
    const db = fakeDb([{ id: 'g-custom', name: ROLE_GROUP_NAME[Role.AGENT], defaultKey: null }]);
    const id = await findOrCreateDefaultGroup(db as never, Role.AGENT);
    expect(id).not.toBe('g-custom');
  });

  it('cria o grupo padrão com a chave, descrição e permissões do papel quando não existe', async () => {
    const db = fakeDb([]);
    await findOrCreateDefaultGroup(db as never, Role.CLIENT_MASTER);
    expect(db.permissionGroup.create).toHaveBeenCalledWith({
      data: {
        name: ROLE_GROUP_NAME[Role.CLIENT_MASTER],
        defaultKey: DEFAULT_GROUP_KEY[Role.CLIENT_MASTER],
        description: DEFAULT_PERMISSION_GROUPS[Role.CLIENT_MASTER].description,
        permissions: DEFAULT_PERMISSION_GROUPS[Role.CLIENT_MASTER].permissions,
      },
    });
  });

  it('duas chamadas seguidas não duplicam o grupo', async () => {
    const db = fakeDb([]);
    const first = await findOrCreateDefaultGroup(db as never, Role.ADMIN);
    const second = await findOrCreateDefaultGroup(db as never, Role.ADMIN);
    expect(second).toBe(first);
    expect(db.rows).toHaveLength(1);
  });
});

describe('seed.ts liga o grupo padrão pela chave (#533)', () => {
  const seed = read('prisma', 'seed.ts');
  it('usa findOrCreateDefaultGroup e não procura grupo por nome', () => {
    expect(seed).toContain('findOrCreateDefaultGroup(');
    expect(seed).not.toMatch(/permissionGroup\.findFirst/);
    expect(seed).not.toMatch(/ROLE_GROUP_NAME/);
  });
});

describe('schema PermissionGroup.defaultKey (#533)', () => {
  const block = /model PermissionGroup \{[\s\S]*?\n\}/.exec(read('prisma', 'schema.prisma'))?.[0] ?? '';
  it('é String? única, sem default', () => {
    expect(block).toMatch(/^\s*defaultKey\s+String\?\s+@unique\s*$/m);
  });
});

describe('migração rbac_1b_default_group_key (#533)', () => {
  const sql = read(MIGRATION);
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const updates = code.split(';').map((s) => s.trim()).filter((s) => /^UPDATE\b/i.test(s));

  it('acrescenta a coluna anulável, de forma idempotente', () => {
    expect(code).toContain('ALTER TABLE "PermissionGroup" ADD COLUMN IF NOT EXISTS "defaultKey" TEXT;');
    expect(code).not.toMatch(/"defaultKey" TEXT\s+NOT NULL/i);
  });

  it('cria o índice único, de forma idempotente', () => {
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "PermissionGroup_defaultKey_key" ON "PermissionGroup"("defaultKey");');
  });

  it('é aditiva: sem DROP, DELETE, TRUNCATE, INSERT nem renomeação', () => {
    expect(code).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|RENAME)\b/i);
    expect(code).not.toMatch(/ALTER COLUMN/i);
  });

  it('tem exatamente um UPDATE por grupo padrão', () => {
    expect(updates).toHaveLength(ROLES.length);
    expect(code.match(/\bUPDATE\b/gi)).toHaveLength(ROLES.length);
  });

  it.each(ROLES)('UPDATE do papel %s: só grava defaultKey, só no grupo mais antigo do nome, só se livre', (role) => {
    const name = ROLE_GROUP_NAME[role];
    const key = DEFAULT_GROUP_KEY[role];
    const stmt = updates.find((u) => u.includes(`'${key}'`));
    expect(stmt).toBeDefined();
    const norm = stmt!.replace(/\s+/g, ' ');
    // forma do SET: só a chave, sem tocar permissions/name/updatedAt
    expect(norm).toMatch(new RegExp(`^UPDATE "PermissionGroup" SET "defaultKey" = '${key}' WHERE `));
    expect(norm.match(/ SET /g)).toHaveLength(1);
    expect(norm.split(' WHERE ')[0]).not.toMatch(/"permissions"|"name"|"updatedAt"|"description"/);
    // escopo do WHERE: o mais antigo entre os de mesmo nome, desempate por id
    expect(norm).toContain(`"id" = (SELECT "id" FROM "PermissionGroup" WHERE "name" = '${name}' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)`);
    // guarda de idempotência e de unicidade
    expect(norm).toContain('AND "defaultKey" IS NULL');
    expect(norm).toContain(`AND NOT EXISTS (SELECT 1 FROM "PermissionGroup" WHERE "defaultKey" = '${key}')`);
    // nenhum outro nome ou chave padrão vaza para este UPDATE
    for (const other of ROLES.filter((r) => r !== role)) {
      expect(norm).not.toContain(`'${ROLE_GROUP_NAME[other]}'`);
      expect(norm).not.toContain(`'${DEFAULT_GROUP_KEY[other]}'`);
    }
  });

  it('documenta o caso de nomes duplicados (marca só o mais antigo) e como reverter', () => {
    expect(sql).toMatch(/mais antigo/i);
    expect(sql).toMatch(/DROP INDEX IF EXISTS "PermissionGroup_defaultKey_key"/);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS "defaultKey"/);
  });
});
