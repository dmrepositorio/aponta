import { Role } from '@prisma/client';

/**
 * Lote 2a2 (#542), tracker #523: quem pode cada operação de apontamento.
 * Flag `rbac-permission-only` desligada: decide o perfil (`roles`), como hoje.
 * Ligada: decide a permissão (`key`). Com os grupos padrão, os dois modos concordam.
 */
export type WorklogCapability =
  | 'OPERATE'
  | 'ON_BEHALF'
  | 'GUARANTEE'
  | 'BONUS'
  | 'MANUAL_VALUE'
  | 'COMMERCIAL_ORGANIZATION'
  | 'REMOVE_ANY'
  | 'MANAGE_PRE'
  | 'CONTRACT_RATE';

interface Rule {
  key: string;
  /** Perfis que a operação aceita com a flag desligada. */
  roles: readonly Role[];
  /** Garantia já aceitava a chave para quem não é ADMIN; o perfil só acrescenta. */
  orHasKey?: boolean;
}

const TECHNICIANS = [Role.ADMIN, Role.AGENT, Role.AGENT_MASTER] as const;

export const WORKLOG_RULES: Record<WorklogCapability, Rule> = {
  OPERATE: { key: 'CREATE_EDIT_WORKLOGS', roles: TECHNICIANS },
  ON_BEHALF: { key: 'LAUNCH_WORKLOG_ON_BEHALF', roles: [Role.ADMIN] },
  GUARANTEE: { key: 'LAUNCH_WORKLOG_GUARANTEE', roles: [Role.ADMIN], orHasKey: true },
  BONUS: { key: 'AUTHORIZE_WORKLOG_BONUS', roles: [Role.ADMIN] },
  MANUAL_VALUE: { key: 'SET_WORKLOG_MANUAL_VALUE', roles: [Role.ADMIN] },
  COMMERCIAL_ORGANIZATION: { key: 'MANAGE_BILLING', roles: [Role.ADMIN] },
  // EDIT_ALL_WORKLOGS não serve: o Gerente de Atendimento a tem e hoje não remove apontamento alheio.
  REMOVE_ANY: { key: 'DELETE_ANY_WORKLOG', roles: [Role.ADMIN] },
  MANAGE_PRE: { key: 'MANAGE_PRE_WORKLOGS', roles: [Role.ADMIN] },
  CONTRACT_RATE: { key: 'VIEW_CONTRACT_FINANCIALS', roles: [Role.ADMIN] },
};

export interface WorklogAccessDeps {
  permissionOnly: boolean;
  hasPermission: (userId: string, key: string) => Promise<boolean>;
}

export async function mayWorklog(capability: WorklogCapability, user: { id: string; role: Role }, deps: WorklogAccessDeps): Promise<boolean> {
  const rule = WORKLOG_RULES[capability];
  if (deps.permissionOnly) return deps.hasPermission(user.id, rule.key);
  if (rule.roles.includes(user.role)) return true;
  return rule.orHasKey ? deps.hasPermission(user.id, rule.key) : false;
}
