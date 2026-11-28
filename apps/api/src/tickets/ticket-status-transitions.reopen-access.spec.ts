import { BadRequestException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { allowedStatusesFor, assertStatusChangeAllowed } from './ticket-status-transitions';

/**
 * Lote 2f (#550): a regra pura de status recebe `canReopen` ja resolvido
 * (TicketTransitionAccess) e nao olha mais o perfil para a reabertura. Sem o campo,
 * vale a decisao de hoje (so ADMIN), que a caracterizacao da Fase 0 continua travando.
 */
const S = TicketStatus;
const user = (role: Role) => ({ id: `${role}-1`, role });
const check = (role: Role, from: TicketStatus, to: TicketStatus, canReopen?: boolean) =>
  assertStatusChangeAllowed({ desk: null, user: user(role), from, to, billed: false, canReopen });
const list = (role: Role, from: TicketStatus, canReopen?: boolean) =>
  allowedStatusesFor({ desk: null, user: user(role), from, billed: false, canReopen });

describe('assertStatusChangeAllowed com canReopen explicito', () => {
  it.each([Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT])('%s com canReopen reabre CLOSED -> OPEN', (role) => {
    expect(() => check(role, S.CLOSED, S.OPEN, true)).not.toThrow();
  });

  it('ADMIN com canReopen falso nao reabre: BadRequest', () => {
    expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN, false)).toThrow(BadRequestException);
  });

  it('canReopen so vale para CLOSED -> OPEN: CLOSED -> IN_PROGRESS segue recusado', () => {
    expect(() => check(Role.AGENT, S.CLOSED, S.IN_PROGRESS, true)).toThrow(BadRequestException);
    expect(() => check(Role.AGENT, S.RESOLVED, S.OPEN, true)).toThrow(BadRequestException);
  });

  it('sem canReopen vale a decisao de hoje: so ADMIN', () => {
    expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN)).not.toThrow();
    expect(() => check(Role.AGENT, S.CLOSED, S.OPEN)).toThrow(BadRequestException);
  });
});

describe('allowedStatusesFor com canReopen explicito', () => {
  it('CLOSED: quem pode reabrir recebe OPEN, o resto nada', () => {
    expect(list(Role.AGENT, S.CLOSED, true)).toEqual([S.OPEN]);
    expect(list(Role.ADMIN, S.CLOSED, false)).toEqual([]);
  });

  it('sem canReopen vale a decisao de hoje: so ADMIN recebe OPEN', () => {
    expect(list(Role.ADMIN, S.CLOSED)).toEqual([S.OPEN]);
    expect(list(Role.AGENT, S.CLOSED)).toEqual([]);
  });

  it('canReopen nao muda as listas dos outros status', () => {
    expect(list(Role.AGENT, S.RESOLVED, true)).toEqual(list(Role.AGENT, S.RESOLVED, false));
  });
});
