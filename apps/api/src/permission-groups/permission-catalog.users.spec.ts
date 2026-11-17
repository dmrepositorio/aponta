import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Role } from '@prisma/client';
import { DEFAULT_PERMISSION_GROUPS } from './default-permission-groups';
import { PERMISSION_CATALOG, PermissionCategory } from './permission-catalog';

const NEW_KEYS = {
  CREATE_USERS: 'Criar usuários',
  CHANGE_USER_ROLE: 'Alterar o tipo do usuário',
  ACTIVATE_DEACTIVATE_USERS: 'Ativar e inativar usuários',
  SEND_USER_INVITES_AND_RESETS: 'Enviar convite e solicitar redefinição de senha',
};

describe('AC-05: permissões do cadastro de usuário (DMTE-550)', () => {
  it.each(Object.entries(NEW_KEYS))('AC-05: o catálogo tem %s na categoria gestão, com o rótulo "%s" (uma vez só)', (key, label) => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === key);
    expect(entries).toEqual([{ key, category: PermissionCategory.MANAGEMENT, label }]);
  });

  it('AC-05: os grupos padrão incluem as quatro chaves onde MANAGE_USERS já está', () => {
    const withManageUsers = Object.entries(DEFAULT_PERMISSION_GROUPS).filter(([, g]) => g.permissions.includes('MANAGE_USERS'));
    expect(withManageUsers.map(([role]) => role)).toContain(Role.ADMIN);
    for (const [, group] of withManageUsers) {
      expect(group.permissions).toEqual(expect.arrayContaining(Object.keys(NEW_KEYS)));
    }
  });

  it('AC-05: os grupos padrão sem MANAGE_USERS não ganham as chaves novas', () => {
    for (const group of Object.values(DEFAULT_PERMISSION_GROUPS).filter((g) => !g.permissions.includes('MANAGE_USERS'))) {
      for (const key of Object.keys(NEW_KEYS)) expect(group.permissions).not.toContain(key);
    }
  });

  describe('migration 20261117120000_user_password_tokens (texto do SQL; não roda contra um banco)', () => {
    const file = join(__dirname, '../../prisma/migrations/20261117120000_user_password_tokens/migration.sql');
    const sql = () => (existsSync(file) ? readFileSync(file, 'utf8') : '');

    it('AC-05: existe e acrescenta as quatro chaves aos grupos que têm MANAGE_USERS', () => {
      expect(existsSync(file)).toBe(true);
      expect(sql()).toMatch(/UPDATE\s+"PermissionGroup"/);
      expect(sql()).toContain('MANAGE_USERS');
      for (const key of Object.keys(NEW_KEYS)) expect(sql()).toContain(key);
    });

    it('AC-05: é idempotente: rodar duas vezes não duplica (guarda por DISTINCT, ANY ou @>)', () => {
      expect(sql()).toMatch(/DISTINCT|=\s*ANY\s*\(|@>/i);
    });

    it('AC-08: torna a senha anulável e cria a tabela de tokens com hash único', () => {
      expect(sql()).toMatch(/ALTER TABLE "User"\s+ALTER COLUMN "password" DROP NOT NULL/i);
      expect(sql()).toMatch(/CREATE TABLE "PasswordToken"/);
      expect(sql()).toMatch(/"tokenHash"/);
      expect(sql()).toMatch(/CREATE UNIQUE INDEX[^;]*"tokenHash"/);
    });
  });
});
