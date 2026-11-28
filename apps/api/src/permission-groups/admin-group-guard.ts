import { ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DEFAULT_GROUP_KEY, GROUP_ONLY_KEYS } from './default-permission-groups';
import { PERMISSION_KEYS } from './permission-catalog';

/**
 * Lote 2i do tracker #523 (#583): o grupo Administrador (achado pela `defaultKey`, nunca pelo nome)
 * e o ultimo recurso para recuperar o sistema pela API. Quando o bypass por `role === ADMIN` sair
 * (Fase 3b), quem zerasse as permissoes dele trancaria todos fora. A protecao e seguranca: vale com
 * a flag `rbac-permission-only` ligada e desligada.
 */

/** Chaves sem as quais ninguem recupera grupos e usuarios pela API (controllers de grupos e de usuarios). */
export const ESSENTIAL_ADMIN_KEYS = ['MANAGE_PERMISSION_GROUPS', 'MANAGE_USERS', 'CREATE_USERS', 'ACTIVATE_DEACTIVATE_USERS', 'SEND_USER_INVITES_AND_RESETS', 'DISABLE_USER_TWO_FACTOR'];

/** O padrao do grupo Administrador: todo o catalogo, menos as chaves exclusivas de grupo. */
export const ADMIN_REQUIRED_KEYS = PERMISSION_KEYS.filter((key) => !GROUP_ONLY_KEYS.includes(key));

export const isAdminGroup = (group: { defaultKey: string | null }): boolean => group.defaultKey === DEFAULT_GROUP_KEY[Role.ADMIN];

/** Barra (409) a substituicao das permissoes do Administrador que remova uma chave do padrao. Acrescentar chaves passa. */
export function assertAdminPermissions(next: string[]): void {
  const have = new Set(next);
  const essential = ESSENTIAL_ADMIN_KEYS.filter((key) => !have.has(key));
  if (essential.length) throw new ConflictException(`O grupo Administrador não pode perder as permissões essenciais: ${essential.join(', ')}.`);
  const missing = ADMIN_REQUIRED_KEYS.filter((key) => !have.has(key));
  if (missing.length) throw new ConflictException(`O grupo Administrador deve conter todas as permissões do catálogo (exceto as exclusivas de grupo). Faltam: ${missing.join(', ')}.`);
}

/** Barra (409) alterar o `defaultKey` ou deixar o nome em branco no Administrador. */
export function assertAdminUpdate(dto: { name?: string }): void {
  if ('defaultKey' in dto) throw new ConflictException('O grupo Administrador não pode perder nem trocar o defaultKey.');
  if (dto.name !== undefined && dto.name.trim() === '') throw new ConflictException('O grupo Administrador não pode ficar sem nome.');
}
