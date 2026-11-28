import { Prisma } from '@prisma/client';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';

/**
 * Fase 1c (#534, tracker #523). Chaves de alcance de dados, definidas aqui
 * (e nao em `permission-catalog.ts`) ate o 1a/1b registra-las no catalogo.
 */
export const SCOPE_KEYS = {
  TICKETS_ALL: 'VIEW_ALL_TICKETS',
  TICKETS_ORGANIZATION: 'VIEW_ALL_CLIENT_TICKETS',
  TICKETS_DESKS: 'VIEW_DESK_TICKETS',
  TICKETS_OWN: 'VIEW_OWN_TICKETS',
  SERVICE_DESKS_ALL: 'VIEW_ALL_SERVICE_DESKS',
  SERVICE_DESKS_ORGANIZATION: 'VIEW_ORGANIZATION_SERVICE_DESKS',
  SERVICE_DESKS_ASSIGNED: 'VIEW_ASSIGNED_SERVICE_DESKS',
  CREDENTIALS_ALL: 'VIEW_ALL_CREDENTIALS',
  CONTRACTS_ALL: 'VIEW_ALL_CONTRACTS',
  CONTRACTS_ORGANIZATION: 'VIEW_ORGANIZATION_CONTRACTS',
  CONTRACTS_DESKS: 'VIEW_ASSIGNED_DESK_CONTRACTS',
  APPOINTMENTS_ALL: 'VIEW_ALL_APPOINTMENTS',
  APPOINTMENTS_ORGANIZATION: 'VIEW_ORGANIZATION_APPOINTMENTS',
  APPOINTMENTS_OWN: 'VIEW_OWN_APPOINTMENTS',
} as const;

export type ScopeKey = (typeof SCOPE_KEYS)[keyof typeof SCOPE_KEYS];
export type ScopeUser = Pick<CurrentUserPayload, 'id' | 'organizationId'>;
export type PermissionSet = Iterable<string>;

const DENY = '00000000-0000-0000-0000-000000000000';

// STUB neutro (commit RED): tudo fail-closed.
export class ScopeResolver {
  static getTicketWhere(_user: ScopeUser, _permissions: PermissionSet): Prisma.TicketWhereInput {
    return { id: DENY };
  }
  static getServiceDeskWhere(_user: ScopeUser, _permissions: PermissionSet): Prisma.ServiceDeskWhereInput {
    return { id: DENY };
  }
  static getCredentialWhere(_user: ScopeUser, _permissions: PermissionSet): Prisma.CredentialWhereInput {
    return { id: DENY };
  }
  static getContractWhere(_user: ScopeUser, _permissions: PermissionSet): Prisma.ContractWhereInput {
    return { id: DENY };
  }
  static getAppointmentWhere(_user: ScopeUser, _permissions: PermissionSet): Prisma.AppointmentWhereInput {
    return { id: DENY };
  }
}
