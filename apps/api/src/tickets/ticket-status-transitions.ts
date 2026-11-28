import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import {
  assertDeskAllowsPauseResume,
  assertDeskAllowsReopen,
  assertListedAgentMayMutate,
} from '../service-desks/desk-policy';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

/**
 * Allowed forward transitions in the ticket lifecycle state machine:
 *   OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED
 * Backward transitions are rejected for everyone EXCEPT the single
 * "reopen" exception: CLOSED -> OPEN, and only for ADMIN. All other
 * backward/sideways/same-state jumps are rejected regardless of role.
 */
export const FORWARD_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: [TicketStatus.IN_PROGRESS, TicketStatus.ESCALATED],
  IN_PROGRESS: [
    TicketStatus.RESOLVED,
    TicketStatus.PENDING_CUSTOMER,
    TicketStatus.PENDING_APPROVAL,
    TicketStatus.ON_HOLD,
    TicketStatus.PENDING_SANKHYA,
    TicketStatus.ESCALATED,
  ],
  PENDING_CUSTOMER: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  PENDING_APPROVAL: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  ON_HOLD: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  PENDING_SANKHYA: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  ESCALATED: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  RESOLVED: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
  CLOSED: [],
};

/** Campos da mesa que a validação de status lê. */
export type StatusDeskPolicy = Parameters<
  typeof assertListedAgentMayMutate
>[0]['desk'] & {
  allowPauseResumeSla: boolean;
  allowReopenUnbilled: boolean;
  allowReopenBilled: boolean;
};

export function isReopenByAdmin(
  from: TicketStatus,
  to: TicketStatus,
  role: Role | string,
): boolean {
  return (
    from === TicketStatus.CLOSED && to === TicketStatus.OPEN && role === 'ADMIN'
  );
}

export interface StatusChangeCheck {
  desk: StatusDeskPolicy | null;
  user: CurrentUserPayload;
  from: TicketStatus;
  to: TicketStatus;
  /** Só lido quando é a reabertura do ADMIN numa mesa existente. */
  billed: boolean;
  /** Quem reabre chamado fechado, já resolvido (TicketTransitionAccess). */
  canReopen?: boolean;
}

/**
 * Regra única da mudança de status: o changeStatus (PATCH) a executa e o findOne a usa
 * para calcular allowedStatuses, então a lista e a validação não divergem.
 * Lança Forbidden (mesa, papel) ou BadRequest (transição).
 */
export function assertStatusChangeAllowed({
  desk,
  user,
  from,
  to,
  billed,
}: StatusChangeCheck): void {
  const reopen = isReopenByAdmin(from, to, user.role);
  if (desk) {
    assertListedAgentMayMutate({ desk, user });
    assertDeskAllowsPauseResume(desk, from, to);
    if (reopen) assertDeskAllowsReopen(desk, billed);
  }

  // RBAC: só ADMIN, CLIENT_MASTER ou AGENT_MASTER liberam um chamado de PENDING_APPROVAL.
  if (
    from === TicketStatus.PENDING_APPROVAL &&
    user.role !== 'ADMIN' &&
    user.role !== 'CLIENT_MASTER' &&
    user.role !== 'AGENT_MASTER'
  ) {
    throw new ForbiddenException(
      'Somente perfis administrativos ou responsáveis MASTER podem liberar um chamado comercial.',
    );
  }

  if (!FORWARD_TRANSITIONS[from]?.includes(to) && !reopen) {
    throw new BadRequestException(
      `Cannot transition ticket from ${from} to ${to}`,
    );
  }
}

/** Status que o leitor pode escolher a partir de `from`, pela mesma regra do changeStatus. */
export function allowedStatusesFor(
  params: Omit<StatusChangeCheck, 'to'>,
): TicketStatus[] {
  const candidates = [...(FORWARD_TRANSITIONS[params.from] ?? [])];
  if (params.user.role === 'ADMIN' && params.from === TicketStatus.CLOSED) {
    candidates.push(TicketStatus.OPEN);
  }
  return candidates.filter((to) => {
    try {
      assertStatusChangeAllowed({ ...params, to });
      return true;
    } catch {
      return false;
    }
  });
}
