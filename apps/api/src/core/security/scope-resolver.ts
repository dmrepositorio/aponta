import { AppointmentType, Prisma } from '@prisma/client';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';

/**
 * Fase 1c (#534, tracker #523): alcance de dados decidido so pelas permissoes
 * do usuario (todos / mesas em que atua / organizacao / so os proprios), sem
 * olhar o perfil (`User.role`). Ainda NAO e usado por nenhum caller; a troca
 * do `TenantHelper` por este resolver e a Fase 2e.
 *
 * As chaves ficam aqui ate o 1a/1b as registrarem em `permission-catalog.ts`
 * e nos grupos padrao. `VIEW_ALL_CLIENT_TICKETS` ja existe no catalogo.
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

const FAIL_CLOSED = '00000000-0000-0000-0000-000000000000';

/**
 * Candidatos do mais amplo ao mais estreito. O primeiro que o usuario tem e
 * aplicavel (retorna `where`, nao `null`) vence; se nenhum, fail-closed.
 */
type Candidate<W> = [ScopeKey, () => W | null];

function resolve<W>(
  permissions: PermissionSet,
  candidates: Candidate<W>[],
  denied: W,
): W {
  const held = new Set(permissions);
  for (const [key, build] of candidates) {
    if (!held.has(key)) continue;
    const where = build();
    if (where !== null) return where;
  }
  return denied;
}

const deskAccess = (userId: string): Prisma.ServiceDeskWhereInput[] => [
  { agents: { some: { id: userId } } },
  { agentGroups: { some: { members: { some: { id: userId } } } } },
  { allowCrossDeskInteraction: true },
];

export class ScopeResolver {
  static getTicketWhere(user: ScopeUser, permissions: PermissionSet): Prisma.TicketWhereInput {
    return resolve<Prisma.TicketWhereInput>(
      permissions,
      [
        [SCOPE_KEYS.TICKETS_ALL, () => ({})],
        [
          SCOPE_KEYS.TICKETS_ORGANIZATION,
          () => (user.organizationId ? { requester: { organizationId: user.organizationId } } : null),
        ],
        [SCOPE_KEYS.TICKETS_DESKS, () => ({ serviceDesk: { OR: deskAccess(user.id) } })],
        [SCOPE_KEYS.TICKETS_OWN, () => ({ requesterId: user.id })],
      ],
      { id: FAIL_CLOSED },
    );
  }

  static getServiceDeskWhere(user: ScopeUser, permissions: PermissionSet): Prisma.ServiceDeskWhereInput {
    return resolve<Prisma.ServiceDeskWhereInput>(
      permissions,
      [
        [SCOPE_KEYS.SERVICE_DESKS_ALL, () => ({})],
        [
          SCOPE_KEYS.SERVICE_DESKS_ASSIGNED,
          () => ({
            OR: [
              { agents: { some: { id: user.id } } },
              { agentGroups: { some: { members: { some: { id: user.id } } } } },
              { allowCrossDeskInteraction: true, active: true },
            ],
          }),
        ],
        [
          SCOPE_KEYS.SERVICE_DESKS_ORGANIZATION,
          () => ({
            active: true,
            acceptingNewTickets: true,
            internalUse: false,
            OR: user.organizationId
              ? [{ organizations: { none: {} } }, { organizations: { some: { id: user.organizationId } } }]
              : [{ organizations: { none: {} } }],
          }),
        ],
      ],
      { id: FAIL_CLOSED },
    );
  }

  static getCredentialWhere(_user: ScopeUser, permissions: PermissionSet): Prisma.CredentialWhereInput {
    return resolve<Prisma.CredentialWhereInput>(
      permissions,
      [[SCOPE_KEYS.CREDENTIALS_ALL, () => ({})]],
      { id: FAIL_CLOSED },
    );
  }

  static getContractWhere(user: ScopeUser, permissions: PermissionSet): Prisma.ContractWhereInput {
    return resolve<Prisma.ContractWhereInput>(
      permissions,
      [
        [SCOPE_KEYS.CONTRACTS_ALL, () => ({})],
        [
          SCOPE_KEYS.CONTRACTS_ORGANIZATION,
          () => (user.organizationId ? { organizationId: user.organizationId } : null),
        ],
        [
          SCOPE_KEYS.CONTRACTS_DESKS,
          () => ({ active: true, serviceDesks: { some: { OR: deskAccess(user.id) } } }),
        ],
      ],
      { id: FAIL_CLOSED },
    );
  }

  static getAppointmentWhere(user: ScopeUser, permissions: PermissionSet): Prisma.AppointmentWhereInput {
    return resolve<Prisma.AppointmentWhereInput>(
      permissions,
      [
        [SCOPE_KEYS.APPOINTMENTS_ALL, () => ({})],
        [
          SCOPE_KEYS.APPOINTMENTS_ORGANIZATION,
          () =>
            user.organizationId
              ? { organizationId: user.organizationId, type: { not: AppointmentType.ABSENCE } }
              : null,
        ],
        [SCOPE_KEYS.APPOINTMENTS_OWN, () => ({ userId: user.id })],
      ],
      { id: FAIL_CLOSED },
    );
  }
}
