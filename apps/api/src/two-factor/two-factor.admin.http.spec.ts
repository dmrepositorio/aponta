import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Role } from '@prisma/client';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import { PERMISSION_CATALOG, PermissionCategory } from '../permission-groups/permission-catalog';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';
import { totpAt } from './totp';

/**
 * Seam 1 (HTTP): um administrador desativa o segundo fator de quem perdeu o aplicativo (DMTE-551, T6).
 * UsersController real com PermissionsGuard; o Prisma é em memória.
 */
const KEY = 'DISABLE_USER_TWO_FACTOR';
const NOW = 1_800_000_000_000;

describe('Desativar o segundo fator de outro usuário (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => NOW);
    h = await buildHarness();
    // A Ana ativa o segundo fator pelo próprio fluxo.
    const { body } = await h.as('post', '/auth/2fa/setup', ID.ana);
    await h.as('post', '/auth/2fa/confirm', ID.ana).send({ code: totpAt(body.secret, NOW) });
  });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const disable = (id: string, userId = ID.admin) => h.as('post', `/users/${id}/two-factor/disable`, userId);
  const has2fa = (id: string) => h.prisma.tables.userTwoFactor.some((r) => r.userId === id);

  it('AC-13: o ADMIN desativa o segundo fator da Ana, apaga os códigos e grava quem, quem foi afetado e quando', async () => {
    const res = await disable(ID.ana);

    expect([200, 201]).toContain(res.status);
    expect(res.body).toEqual({ ok: true });
    expect(has2fa(ID.ana)).toBe(false);
    expect(h.prisma.tables.twoFactorRecoveryCode.filter((r) => r.userId === ID.ana)).toHaveLength(0);
    expect(h.prisma.tables.securityEvent).toEqual([
      expect.objectContaining({ type: 'TWO_FACTOR_DISABLED_BY_ADMIN', actorId: ID.admin, subjectId: ID.ana, createdAt: expect.any(Date) }),
    ]);
  });

  it('AC-13: depois disso a Ana entra só com a senha, sem desafio', async () => {
    await disable(ID.ana);

    const login = await h.as('post', '/auth/login', ID.ana).send({ email: 'ana@aponta.test', password: OLD_PASSWORD });

    expect(login.body.access_token).toBeDefined();
    expect(login.body.twoFactorRequired).toBeUndefined();
  });

  it('AC-13: quem só tem MANAGE_USERS recebe 403, nada muda e nada é gravado', async () => {
    const res = await disable(ID.ana, ID.gestor);

    expect(res.status).toBe(403);
    expect(has2fa(ID.ana)).toBe(true);
    expect(h.prisma.tables.securityEvent).toHaveLength(0);
  });

  it('AC-13: quem não gerencia usuários também recebe 403', async () => {
    expect((await disable(ID.ana, ID.bruno)).status).toBe(403);
    expect(has2fa(ID.ana)).toBe(true);
  });

  it('AC-13: a permissão pode ser dada a um grupo e então o gestor consegue (delegação)', async () => {
    h.grant(ID.gestor, KEY);

    expect([200, 201]).toContain((await disable(ID.ana, ID.gestor)).status);
    expect(has2fa(ID.ana)).toBe(false);
    expect(h.prisma.tables.securityEvent[0]).toMatchObject({ actorId: ID.gestor, subjectId: ID.ana });
  });

  it('AC-13: usuário sem segundo fator responde 409, usuário que não existe 404 e id inválido 400, sem gravar evento', async () => {
    expect((await disable(ID.bruno)).status).toBe(409);
    expect((await disable(ID.missing)).status).toBe(404);
    expect((await disable('nao-e-um-uuid')).status).toBe(400);
    expect(h.prisma.tables.securityEvent).toHaveLength(0);
  });

  it('AC-13: o administrador não desativa o próprio segundo fator por esta rota (isso exige senha e código em Minha Conta)', async () => {
    const { body } = await h.as('post', '/auth/2fa/setup', ID.fabio);
    await h.as('post', '/auth/2fa/confirm', ID.fabio).send({ code: totpAt(body.secret, NOW) });

    const res = await disable(ID.fabio, ID.fabio);

    expect(res.status).toBe(400);
    expect(has2fa(ID.fabio)).toBe(true);
    expect(h.prisma.tables.securityEvent).toHaveLength(0);
  });
});

describe('Permissão DISABLE_USER_TWO_FACTOR no catálogo (DMTE-551)', () => {
  it('AC-13: está no catálogo, na categoria gestão, uma vez só', () => {
    expect(PERMISSION_CATALOG.filter((p) => p.key === KEY)).toEqual([
      { key: KEY, category: PermissionCategory.MANAGEMENT, label: 'Desativar o segundo fator de outro usuário' },
    ]);
  });

  it('AC-13: nenhum grupo padrão a recebe além do de ADMIN', () => {
    for (const [role, group] of Object.entries(DEFAULT_PERMISSION_GROUPS)) {
      if (role === Role.ADMIN) continue;
      expect(group.permissions).not.toContain(KEY);
    }
  });

  it('AC-13: nenhuma migration a acrescenta a grupos existentes', () => {
    const dir = join(__dirname, '../../prisma/migrations');
    const offenders = existsSync(dir)
      ? readdirSync(dir).filter((name: string) => existsSync(join(dir, name, 'migration.sql')) && readFileSync(join(dir, name, 'migration.sql'), 'utf8').includes(KEY))
      : [];
    expect(offenders).toEqual([]);
  });
});
