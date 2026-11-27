import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  assertDeskAllowsOpen,
  assertListedAgentMayMutate,
  deskServesOrganization,
  isClientRole,
  isDeskUsableBy,
  type DeskCatalogContext,
} from './desk-policy';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Fase 0b-1 (#525, tracker #523): caracterização da política de mesas por perfil
 * (isClientRole, mesa interna, mesa só para atendentes, mesa listada).
 */
const user = (id: string, role: Role, organizationId?: string | null): CurrentUserPayload => ({
  id,
  role,
  organizationId,
});
const admin = user('admin', Role.ADMIN);
const agent = user('agent', Role.AGENT);
const agentMaster = user('agent-master', Role.AGENT_MASTER);
const client = user('client', Role.CLIENT, 'org-a');
const clientMaster = user('client-master', Role.CLIENT_MASTER, 'org-a');
const spy = { id: 'spy', role: 'SPY' as Role };

const requester = { name: 'Ana', email: 'ana@exemplo.test', phone: '1', extension: '2' };
const openDesk = {
  active: true,
  acceptingNewTickets: true,
  internalUse: false,
  openByAgentsOnly: false,
  catalogRequiredOnOpen: false,
  requireRequesterName: false,
  requireRequesterEmail: false,
  requireRequesterPhone: false,
  requireRequesterExtension: false,
  requireResourceGroup: false,
  requireAttachments: false,
  listedGroupsOnly: false,
  unlistedCanCreateTicket: true,
  agents: [] as { id: string }[],
  agentGroups: [] as { members?: { id: string }[] }[],
};
const open = (desk: typeof openDesk, u: CurrentUserPayload) =>
  assertDeskAllowsOpen({ desk, user: u, requester, attachmentCount: 0 });

describe('isClientRole', () => {
  it.each([
    [Role.CLIENT, true],
    [Role.CLIENT_MASTER, true],
    [Role.AGENT, false],
    [Role.AGENT_MASTER, false],
    [Role.ADMIN, false],
  ])('%s -> %s', (role, expected) => {
    expect(isClientRole({ role })).toBe(expected);
  });

  it('papel desconhecido não é cliente', () => {
    expect(isClientRole(spy)).toBe(false);
  });
});

describe('assertDeskAllowsOpen: mesa por perfil', () => {
  it.each([admin, agent, agentMaster, client, clientMaster])('$role abre em mesa ativa e aberta', (u) => {
    expect(() => open(openDesk, u)).not.toThrow();
  });

  it.each([admin, agent, agentMaster, client, clientMaster])(
    '$role não abre em mesa inativa nem com acceptingNewTickets=false (nem o ADMIN)',
    (u) => {
      expect(() => open({ ...openDesk, active: false }, u)).toThrow(BadRequestException);
      expect(() => open({ ...openDesk, acceptingNewTickets: false }, u)).toThrow(BadRequestException);
    },
  );

  it.each([client, clientMaster])('$role é barrado em mesa de uso interno', (u) => {
    expect(() => open({ ...openDesk, internalUse: true }, u)).toThrow(ForbiddenException);
  });

  it.each([admin, agent, agentMaster])('$role abre em mesa de uso interno', (u) => {
    expect(() => open({ ...openDesk, internalUse: true }, u)).not.toThrow();
  });

  it.each([client, clientMaster])('$role é barrado em mesa só para atendentes', (u) => {
    expect(() => open({ ...openDesk, openByAgentsOnly: true }, u)).toThrow(ForbiddenException);
  });

  it.each([admin, agent, agentMaster])('$role abre em mesa só para atendentes', (u) => {
    expect(() => open({ ...openDesk, openByAgentsOnly: true }, u)).not.toThrow();
  });

  it('papel desconhecido passa pelas travas de mesa interna e só para atendentes', () => {
    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    expect(() => open({ ...openDesk, internalUse: true, openByAgentsOnly: true }, spy)).not.toThrow();
  });

  describe('mesa listada (listedGroupsOnly)', () => {
    const listed = {
      ...openDesk,
      listedGroupsOnly: true,
      unlistedCanCreateTicket: false,
      agents: [{ id: 'agent' }],
      agentGroups: [{ members: [{ id: 'agent-master' }] }],
    };

    it('AGENT listado direto abre', () => {
      expect(() => open(listed, agent)).not.toThrow();
    });

    it('AGENT_MASTER listado via grupo abre', () => {
      expect(() => open(listed, agentMaster)).not.toThrow();
    });

    it('AGENT sem vínculo é barrado quando unlistedCanCreateTicket=false', () => {
      expect(() => open(listed, user('other', Role.AGENT))).toThrow(ForbiddenException);
      expect(() => open(listed, user('other', Role.AGENT_MASTER))).toThrow(ForbiddenException);
    });

    it('AGENT sem vínculo abre quando unlistedCanCreateTicket=true', () => {
      expect(() => open({ ...listed, unlistedCanCreateTicket: true }, user('other', Role.AGENT))).not.toThrow();
    });

    it('ADMIN abre mesmo sem vínculo', () => {
      expect(() => open(listed, admin)).not.toThrow();
    });

    it('CLIENT e CLIENT_MASTER passam pela trava de mesa listada, que só vale para atendente', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(() => open(listed, client)).not.toThrow();
      expect(() => open(listed, clientMaster)).not.toThrow();
    });
  });
});

describe('assertListedAgentMayMutate: quem a trava alcança', () => {
  const listedDesk = {
    listedGroupsOnly: true,
    agents: [{ id: 'agent' }],
    agentGroups: [{ members: [{ id: 'agent-master' }] }],
  };
  const mutate = (desk: typeof listedDesk | { listedGroupsOnly: boolean; agents: { id: string }[]; agentGroups: [] }, u: CurrentUserPayload) =>
    assertListedAgentMayMutate({ desk, user: u });

  it('AGENT e AGENT_MASTER listados (direto ou por grupo) manipulam', () => {
    expect(() => mutate(listedDesk, agent)).not.toThrow();
    expect(() => mutate(listedDesk, agentMaster)).not.toThrow();
  });

  it('AGENT e AGENT_MASTER sem vínculo são barrados em mesa listada', () => {
    expect(() => mutate(listedDesk, user('other', Role.AGENT))).toThrow(ForbiddenException);
    expect(() => mutate(listedDesk, user('other', Role.AGENT_MASTER))).toThrow(ForbiddenException);
  });

  it('mesa sem listedGroupsOnly não barra atendente sem vínculo', () => {
    expect(() => mutate({ ...listedDesk, listedGroupsOnly: false }, user('other', Role.AGENT))).not.toThrow();
  });

  it('ADMIN manipula mesmo sem vínculo', () => {
    expect(() => mutate({ ...listedDesk, agents: [], agentGroups: [] }, admin)).not.toThrow();
  });

  it('CLIENT, CLIENT_MASTER e papel desconhecido passam pela trava de mesa listada, sem vínculo', () => {
    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    const empty = { listedGroupsOnly: true, agents: [], agentGroups: [] as [] };
    expect(() => mutate(empty, client)).not.toThrow();
    expect(() => mutate(empty, clientMaster)).not.toThrow();
    expect(() => mutate(empty, spy)).not.toThrow();
  });
});

describe('deskServesOrganization', () => {
  it('mesa sem Cliente vinculado serve qualquer organização, inclusive ausente', () => {
    expect(deskServesOrganization({ organizations: [] }, 'org-a')).toBe(true);
    expect(deskServesOrganization({}, 'org-a')).toBe(true);
    expect(deskServesOrganization({ organizations: [] }, undefined)).toBe(true);
  });

  it('mesa com Cliente vinculado serve só as organizações listadas', () => {
    const desk = { organizations: [{ id: 'org-a' }] };
    expect(deskServesOrganization(desk, 'org-a')).toBe(true);
    expect(deskServesOrganization(desk, 'org-b')).toBe(false);
  });

  it('mesa com Cliente vinculado não serve quem não tem organização', () => {
    const desk = { organizations: [{ id: 'org-a' }] };
    expect(deskServesOrganization(desk, undefined)).toBe(false);
    expect(deskServesOrganization(desk, null)).toBe(false);
  });
});

describe('isDeskUsableBy: matriz perfil x mesa', () => {
  const desk = (over: Partial<DeskCatalogContext> = {}): DeskCatalogContext => ({
    active: true,
    acceptingNewTickets: true,
    internalUse: false,
    openByAgentsOnly: false,
    listedGroupsOnly: false,
    unlistedCanCreateTicket: false,
    allowCrossDeskInteraction: false,
    agents: [],
    agentGroups: [],
    organizations: [],
    ...over,
  });

  it.each([admin, agent, agentMaster, client, clientMaster, spy])(
    '$role não usa mesa inativa nem com acceptingNewTickets=false',
    (u) => {
      const withLink = { agents: [{ id: u.id }], allowCrossDeskInteraction: true };
      expect(isDeskUsableBy(desk({ ...withLink, active: false }), u)).toBe(false);
      expect(isDeskUsableBy(desk({ ...withLink, acceptingNewTickets: false }), u)).toBe(false);
    },
  );

  it('ADMIN usa qualquer mesa ativa e aberta, interna, só de atendentes ou de outro Cliente', () => {
    expect(isDeskUsableBy(desk({ internalUse: true }), admin)).toBe(true);
    expect(isDeskUsableBy(desk({ openByAgentsOnly: true }), admin)).toBe(true);
    expect(isDeskUsableBy(desk({ organizations: [{ id: 'org-b' }] }), admin)).toBe(true);
    expect(isDeskUsableBy(desk({ listedGroupsOnly: true }), admin)).toBe(true);
  });

  it.each([client, clientMaster])('$role usa mesa global ou da própria organização', (u) => {
    expect(isDeskUsableBy(desk(), u)).toBe(true);
    expect(isDeskUsableBy(desk({ organizations: [{ id: 'org-a' }] }), u)).toBe(true);
  });

  it.each([client, clientMaster])('$role não usa mesa interna, só de atendentes nem de outro Cliente', (u) => {
    expect(isDeskUsableBy(desk({ internalUse: true }), u)).toBe(false);
    expect(isDeskUsableBy(desk({ openByAgentsOnly: true }), u)).toBe(false);
    expect(isDeskUsableBy(desk({ organizations: [{ id: 'org-b' }] }), u)).toBe(false);
  });

  it.each([client, clientMaster])('$role sem organização só usa mesa global', (u) => {
    const noOrg = { ...u, organizationId: undefined };
    expect(isDeskUsableBy(desk(), noOrg)).toBe(true);
    expect(isDeskUsableBy(desk({ organizations: [{ id: 'org-a' }] }), noOrg)).toBe(false);
  });

  it('cliente não ganha acesso por estar listado como agente nem por allowCrossDeskInteraction', () => {
    const blocked = desk({ internalUse: true, agents: [{ id: 'client' }], allowCrossDeskInteraction: true });
    expect(isDeskUsableBy(blocked, client)).toBe(false);
  });

  it.each([agent, agentMaster])('$role usa mesa em que está listado (direto ou por grupo)', (u) => {
    expect(isDeskUsableBy(desk({ agents: [{ id: u.id }] }), u)).toBe(true);
    expect(isDeskUsableBy(desk({ agentGroups: [{ members: [{ id: u.id }] }] }), u)).toBe(true);
  });

  it.each([agent, agentMaster])('$role sem vínculo só usa mesa com allowCrossDeskInteraction', (u) => {
    expect(isDeskUsableBy(desk(), u)).toBe(false);
    expect(isDeskUsableBy(desk({ allowCrossDeskInteraction: true }), u)).toBe(true);
  });

  it.each([agent, agentMaster])('$role usa mesa interna e só de atendentes quando tem acesso', (u) => {
    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    expect(isDeskUsableBy(desk({ internalUse: true, openByAgentsOnly: true, agents: [{ id: u.id }] }), u)).toBe(true);
  });

  it.each([agent, agentMaster])('$role não é filtrado por Cliente da mesa', (u) => {
    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    expect(isDeskUsableBy(desk({ organizations: [{ id: 'org-b' }], agents: [{ id: u.id }] }), u)).toBe(true);
  });

  it.each([agent, agentMaster])(
    '$role em mesa listada só usa se listado ou se não listados podem criar',
    (u) => {
      const listedOnly = { listedGroupsOnly: true, allowCrossDeskInteraction: true };
      expect(isDeskUsableBy(desk(listedOnly), u)).toBe(false);
      expect(isDeskUsableBy(desk({ ...listedOnly, unlistedCanCreateTicket: true }), u)).toBe(true);
      expect(isDeskUsableBy(desk({ ...listedOnly, agents: [{ id: u.id }] }), u)).toBe(true);
    },
  );

  it('papel desconhecido não usa mesa nenhuma', () => {
    expect(isDeskUsableBy(desk({ allowCrossDeskInteraction: true, agents: [{ id: 'spy' }] }), spy)).toBe(false);
  });
});
