import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import {
  FORWARD_TRANSITIONS,
  StatusDeskPolicy,
  allowedStatusesFor,
  assertStatusChangeAllowed,
  isReopenByAdmin,
} from './ticket-status-transitions';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

/**
 * Fase 0b-2 (#526), tracker #523: caracterização por perfil da regra única de
 * mudança de status. Trava o comportamento ATUAL.
 */
const S = TicketStatus;
const ALL_ROLES: Role[] = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const user = (role: Role, extra: Partial<CurrentUserPayload> = {}): CurrentUserPayload => ({
  id: `${role.toLowerCase()}-1`,
  role,
  ...extra,
});
const desk = (extra: Partial<StatusDeskPolicy> = {}): StatusDeskPolicy => ({
  listedGroupsOnly: false,
  agents: [],
  agentGroups: [],
  allowPauseResumeSla: true,
  allowReopenUnbilled: true,
  allowReopenBilled: true,
  ...extra,
});
const check = (
  role: Role,
  from: TicketStatus,
  to: TicketStatus,
  over: { desk?: StatusDeskPolicy | null; billed?: boolean; user?: CurrentUserPayload } = {},
) =>
  assertStatusChangeAllowed({
    desk: over.desk === undefined ? null : over.desk,
    user: over.user ?? user(role),
    from,
    to,
    billed: over.billed ?? false,
  });

describe('ticket-status-transitions: reabertura de chamado fechado', () => {
  it('isReopenByAdmin só é verdadeiro para ADMIN, CLOSED -> OPEN', () => {
    for (const role of ALL_ROLES) {
      expect(isReopenByAdmin(S.CLOSED, S.OPEN, role)).toBe(role === Role.ADMIN);
    }
    expect(isReopenByAdmin(S.CLOSED, S.IN_PROGRESS, Role.ADMIN)).toBe(false);
    expect(isReopenByAdmin(S.RESOLVED, S.OPEN, Role.ADMIN)).toBe(false);
  });

  it('ADMIN reabre CLOSED -> OPEN (sem mesa)', () => {
    expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN)).not.toThrow();
  });

  it.each([Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT])(
    '%s não reabre CLOSED -> OPEN: BadRequest (a máquina de estados não tem saída de CLOSED)',
    (role) => {
      expect(() => check(role, S.CLOSED, S.OPEN)).toThrow(BadRequestException);
    },
  );

  it.each(ALL_ROLES)('%s: CLOSED não tem outra saída além da reabertura do ADMIN', (role) => {
    for (const to of Object.values(S).filter((s) => s !== S.OPEN)) {
      expect(() => check(role, S.CLOSED, to)).toThrow(BadRequestException);
    }
  });

  it('FORWARD_TRANSITIONS.CLOSED é vazio (a reabertura não vive na tabela)', () => {
    expect(FORWARD_TRANSITIONS[S.CLOSED]).toEqual([]);
  });

  describe('com mesa', () => {
    it('ADMIN reabre fechado não faturado só se a mesa permite não faturado', () => {
      expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN, { desk: desk(), billed: false })).not.toThrow();
      expect(() =>
        check(Role.ADMIN, S.CLOSED, S.OPEN, { desk: desk({ allowReopenUnbilled: false }), billed: false }),
      ).toThrow(ForbiddenException);
    });

    it('ADMIN reabre fechado faturado só se a mesa permite faturado', () => {
      expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN, { desk: desk(), billed: true })).not.toThrow();
      expect(() =>
        check(Role.ADMIN, S.CLOSED, S.OPEN, { desk: desk({ allowReopenBilled: false }), billed: true }),
      ).toThrow(ForbiddenException);
    });

    it('as duas travas são independentes: faturado liberado não libera não faturado e vice-versa', () => {
      const onlyBilled = desk({ allowReopenUnbilled: false, allowReopenBilled: true });
      expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN, { desk: onlyBilled, billed: true })).not.toThrow();
      const onlyUnbilled = desk({ allowReopenUnbilled: true, allowReopenBilled: false });
      expect(() => check(Role.ADMIN, S.CLOSED, S.OPEN, { desk: onlyUnbilled, billed: false })).not.toThrow();
    });

    it('a trava de reabertura da mesa não vale para outras transições do ADMIN', () => {
      const locked = desk({ allowReopenUnbilled: false, allowReopenBilled: false });
      expect(() => check(Role.ADMIN, S.OPEN, S.IN_PROGRESS, { desk: locked })).not.toThrow();
    });

    it.each([Role.AGENT_MASTER, Role.AGENT])(
      '%s listado na mesa continua sem reabrir (BadRequest, não depende da mesa)',
      (role) => {
        const d = desk({ listedGroupsOnly: true, agents: [{ id: user(role).id }] });
        expect(() => check(role, S.CLOSED, S.OPEN, { desk: d })).toThrow(BadRequestException);
      },
    );
  });
});

describe('ticket-status-transitions: saída de PENDING_APPROVAL', () => {
  it.each([Role.ADMIN, Role.AGENT_MASTER, Role.CLIENT_MASTER])(
    '%s libera PENDING_APPROVAL para IN_PROGRESS e RESOLVED',
    (role) => {
      expect(() => check(role, S.PENDING_APPROVAL, S.IN_PROGRESS)).not.toThrow();
      expect(() => check(role, S.PENDING_APPROVAL, S.RESOLVED)).not.toThrow();
    },
  );

  it.each([Role.AGENT, Role.CLIENT])('%s é barrado com Forbidden na saída de PENDING_APPROVAL', (role) => {
    expect(() => check(role, S.PENDING_APPROVAL, S.IN_PROGRESS)).toThrow(ForbiddenException);
    expect(() => check(role, S.PENDING_APPROVAL, S.RESOLVED)).toThrow(ForbiddenException);
  });

  it('a barreira de papel vem antes da máquina de estados: AGENT recebe Forbidden mesmo para destino inválido', () => {
    expect(() => check(Role.AGENT, S.PENDING_APPROVAL, S.CLOSED)).toThrow(ForbiddenException);
  });

  it.each([Role.ADMIN, Role.AGENT_MASTER, Role.CLIENT_MASTER])(
    '%s liberado ainda respeita a máquina de estados (PENDING_APPROVAL -> CLOSED é BadRequest)',
    (role) => {
      expect(() => check(role, S.PENDING_APPROVAL, S.CLOSED)).toThrow(BadRequestException);
    },
  );

  it('só PENDING_APPROVAL é protegido: AGENT segue livre nas demais pendências', () => {
    for (const from of [S.PENDING_CUSTOMER, S.ON_HOLD, S.PENDING_SANKHYA, S.ESCALATED]) {
      expect(() => check(Role.AGENT, from, S.IN_PROGRESS)).not.toThrow();
    }
  });

  it('o AGENT entra em PENDING_APPROVAL (IN_PROGRESS -> PENDING_APPROVAL); só a saída é protegida', () => {
    expect(() => check(Role.AGENT, S.IN_PROGRESS, S.PENDING_APPROVAL)).not.toThrow();
  });

  // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
  it('qualquer AGENT_MASTER libera PENDING_APPROVAL sem checar organização do chamado ou do usuário', () => {
    const outsider = user(Role.AGENT_MASTER, { id: 'am-other', organizationId: 'org-zzz' });
    expect(() => check(Role.AGENT_MASTER, S.PENDING_APPROVAL, S.IN_PROGRESS, { user: outsider })).not.toThrow();
    const noOrg = user(Role.AGENT_MASTER, { organizationId: null });
    expect(() => check(Role.AGENT_MASTER, S.PENDING_APPROVAL, S.RESOLVED, { user: noOrg })).not.toThrow();
  });

  // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
  it('CLIENT_MASTER também libera PENDING_APPROVAL, e a regra não olha a organização dele', () => {
    const otherOrg = user(Role.CLIENT_MASTER, { organizationId: 'org-zzz' });
    expect(() => check(Role.CLIENT_MASTER, S.PENDING_APPROVAL, S.IN_PROGRESS, { user: otherOrg })).not.toThrow();
  });
});

describe('ticket-status-transitions: máquina de estados por perfil e a mesa', () => {
  it.each(ALL_ROLES)('%s: transição válida OPEN -> IN_PROGRESS passa; salto inválido OPEN -> CLOSED é BadRequest', (role) => {
    expect(() => check(role, S.OPEN, S.IN_PROGRESS)).not.toThrow();
    expect(() => check(role, S.OPEN, S.CLOSED)).toThrow(BadRequestException);
  });

  it.each(ALL_ROLES)('%s: mesmo estado e retrocesso são recusados', (role) => {
    expect(() => check(role, S.OPEN, S.OPEN)).toThrow(BadRequestException);
    expect(() => check(role, S.RESOLVED, S.OPEN)).toThrow(BadRequestException);
    expect(() => check(role, S.IN_PROGRESS, S.OPEN)).toThrow(BadRequestException);
  });

  it('RESOLVED volta a IN_PROGRESS para todos os perfis (a máquina não separa por papel)', () => {
    for (const role of ALL_ROLES) {
      expect(() => check(role, S.RESOLVED, S.IN_PROGRESS)).not.toThrow();
    }
  });

  it.each([Role.AGENT_MASTER, Role.AGENT])('%s fora da lista de mesa listada recebe Forbidden', (role) => {
    const d = desk({ listedGroupsOnly: true });
    expect(() => check(role, S.OPEN, S.IN_PROGRESS, { desk: d })).toThrow(ForbiddenException);
  });

  it.each([Role.AGENT_MASTER, Role.AGENT])('%s listado (direto ou por grupo) passa na mesa listada', (role) => {
    const direct = desk({ listedGroupsOnly: true, agents: [{ id: user(role).id }] });
    const viaGroup = desk({ listedGroupsOnly: true, agentGroups: [{ members: [{ id: user(role).id }] }] });
    expect(() => check(role, S.OPEN, S.IN_PROGRESS, { desk: direct })).not.toThrow();
    expect(() => check(role, S.OPEN, S.IN_PROGRESS, { desk: viaGroup })).not.toThrow();
  });

  it.each([Role.ADMIN, Role.CLIENT_MASTER, Role.CLIENT])('%s ignora a lista da mesa (a trava só vale para AGENT e AGENT_MASTER)', (role) => {
    const d = desk({ listedGroupsOnly: true });
    expect(() => check(role, S.OPEN, S.IN_PROGRESS, { desk: d })).not.toThrow();
  });

  it.each(ALL_ROLES)('%s: mesa sem pausa/retomada de SLA recusa entrar e sair de pausa', (role) => {
    const d = desk({ allowPauseResumeSla: false });
    expect(() => check(role, S.IN_PROGRESS, S.ON_HOLD, { desk: d })).toThrow(ForbiddenException);
    expect(() => check(role, S.ON_HOLD, S.IN_PROGRESS, { desk: d })).toThrow(ForbiddenException);
    expect(() => check(role, S.IN_PROGRESS, S.PENDING_CUSTOMER, { desk: d })).toThrow(ForbiddenException);
    expect(() => check(role, S.IN_PROGRESS, S.PENDING_SANKHYA, { desk: d })).toThrow(ForbiddenException);
  });

  it('a trava de pausa não atinge transições fora da pausa', () => {
    const d = desk({ allowPauseResumeSla: false });
    expect(() => check(Role.AGENT, S.OPEN, S.IN_PROGRESS, { desk: d })).not.toThrow();
    expect(() => check(Role.AGENT, S.IN_PROGRESS, S.RESOLVED, { desk: d })).not.toThrow();
  });

  it('sem mesa (null), nenhuma regra de mesa se aplica nem a de lista', () => {
    expect(() => check(Role.AGENT, S.IN_PROGRESS, S.ON_HOLD, { desk: null })).not.toThrow();
  });
});

describe('allowedStatusesFor: lista por perfil (mesma regra do PATCH)', () => {
  const list = (role: Role, from: TicketStatus, over: { desk?: StatusDeskPolicy | null; billed?: boolean } = {}) =>
    allowedStatusesFor({
      desk: over.desk === undefined ? null : over.desk,
      user: user(role),
      from,
      billed: over.billed ?? false,
    });

  it('CLOSED: só ADMIN recebe OPEN', () => {
    expect(list(Role.ADMIN, S.CLOSED)).toEqual([S.OPEN]);
    for (const role of [Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT]) {
      expect(list(role, S.CLOSED)).toEqual([]);
    }
  });

  it('CLOSED com mesa que barra a reabertura: ADMIN recebe lista vazia', () => {
    expect(list(Role.ADMIN, S.CLOSED, { desk: desk({ allowReopenUnbilled: false }) })).toEqual([]);
    expect(list(Role.ADMIN, S.CLOSED, { desk: desk({ allowReopenBilled: false }), billed: true })).toEqual([]);
    expect(list(Role.ADMIN, S.CLOSED, { desk: desk({ allowReopenBilled: false }), billed: false })).toEqual([S.OPEN]);
  });

  it('PENDING_APPROVAL: perfis liberadores recebem IN_PROGRESS e RESOLVED; AGENT e CLIENT, nada', () => {
    for (const role of [Role.ADMIN, Role.AGENT_MASTER, Role.CLIENT_MASTER]) {
      expect(list(role, S.PENDING_APPROVAL)).toEqual([S.IN_PROGRESS, S.RESOLVED]);
    }
    for (const role of [Role.AGENT, Role.CLIENT]) {
      expect(list(role, S.PENDING_APPROVAL)).toEqual([]);
    }
  });

  it('IN_PROGRESS: o AGENT recebe a lista completa da tabela (a máquina não separa por papel)', () => {
    expect(list(Role.AGENT, S.IN_PROGRESS)).toEqual(FORWARD_TRANSITIONS[S.IN_PROGRESS]);
    expect(list(Role.CLIENT_MASTER, S.IN_PROGRESS)).toEqual(FORWARD_TRANSITIONS[S.IN_PROGRESS]);
  });

  it('mesa sem pausa de SLA tira os destinos de pausa da lista', () => {
    const got = list(Role.AGENT, S.IN_PROGRESS, { desk: desk({ allowPauseResumeSla: false }) });
    expect(got).not.toContain(S.ON_HOLD);
    expect(got).not.toContain(S.PENDING_CUSTOMER);
    expect(got).not.toContain(S.PENDING_SANKHYA);
    expect(got).toEqual(expect.arrayContaining([S.RESOLVED, S.PENDING_APPROVAL, S.ESCALATED]));
  });

  it('agente fora da lista da mesa listada recebe lista vazia', () => {
    expect(list(Role.AGENT, S.OPEN, { desk: desk({ listedGroupsOnly: true }) })).toEqual([]);
  });
});
