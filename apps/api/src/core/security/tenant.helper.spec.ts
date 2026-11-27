import { AppointmentType, Role } from '@prisma/client';
import { TenantHelper } from './tenant.helper';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';

describe('TenantHelper', () => {
  it('should restrict CLIENT to their own tickets', () => {
    const user: CurrentUserPayload = { id: 'u1', role: Role.CLIENT };
    const where = TenantHelper.getTicketWhere(user);
    expect(where).toEqual({ requesterId: 'u1' });
  });

  it('should restrict CLIENT_MASTER to their organization tickets', () => {
    const user: CurrentUserPayload = { id: 'u2', role: Role.CLIENT_MASTER, organizationId: 'org1' };
    const where = TenantHelper.getTicketWhere(user);
    expect(where).toEqual({ requester: { organizationId: 'org1' } });
  });

  it('should restrict CLIENT_MASTER to their own tickets if no organization', () => {
    const user: CurrentUserPayload = { id: 'u2', role: Role.CLIENT_MASTER };
    const where = TenantHelper.getTicketWhere(user);
    expect(where).toEqual({ requesterId: 'u2' });
  });

  it('should restrict AGENT and AGENT_MASTER to their service desks', () => {
    const agent: CurrentUserPayload = { id: 'agent1', role: Role.AGENT };
    const agentMaster: CurrentUserPayload = { id: 'agent2', role: Role.AGENT_MASTER };
    expect(TenantHelper.getTicketWhere(agent)).toEqual({
      serviceDesk: {
        OR: [
          { agents: { some: { id: 'agent1' } } },
          { agentGroups: { some: { members: { some: { id: 'agent1' } } } } },
          { allowCrossDeskInteraction: true },
        ],
      },
    });
    expect(TenantHelper.getTicketWhere(agentMaster)).toEqual({
      serviceDesk: {
        OR: [
          { agents: { some: { id: 'agent2' } } },
          { agentGroups: { some: { members: { some: { id: 'agent2' } } } } },
          { allowCrossDeskInteraction: true },
        ],
      },
    });
  });

  it('should return empty where clause for ADMIN', () => {
    const user: CurrentUserPayload = { id: 'admin1', role: Role.ADMIN };
    const where = TenantHelper.getTicketWhere(user);
    expect(where).toEqual({});
  });

  it('should return a fail-closed clause for unknown roles', () => {
    const user = { id: 'unknown', role: 'SPY' as Role };
    const where = TenantHelper.getTicketWhere(user);
    expect(where).toHaveProperty('id', '00000000-0000-0000-0000-000000000000');
  });

  describe('getServiceDeskWhere', () => {
    it('returns empty where for ADMIN', () => {
      const user: CurrentUserPayload = { id: 'admin1', role: Role.ADMIN };
      expect(TenantHelper.getServiceDeskWhere(user)).toEqual({});
    });

    it('filters CLIENT to active non-internal desks of their org or global', () => {
      const user: CurrentUserPayload = {
        id: 'c1',
        role: Role.CLIENT,
        organizationId: 'org1',
      };
      expect(TenantHelper.getServiceDeskWhere(user)).toEqual({
        active: true,
        acceptingNewTickets: true,
        internalUse: false,
        OR: [
          { organizations: { none: {} } },
          { organizations: { some: { id: 'org1' } } },
        ],
      });
    });
  });

  describe('getContractWhere', () => {
    it('returns empty where for ADMIN', () => {
      const user: CurrentUserPayload = { id: 'admin1', role: Role.ADMIN };
      expect(TenantHelper.getContractWhere(user)).toEqual({});
    });

    it('scopes CLIENT_MASTER to their own organization', () => {
      const user: CurrentUserPayload = { id: 'cm1', role: Role.CLIENT_MASTER, organizationId: 'org1' };
      expect(TenantHelper.getContractWhere(user)).toEqual({ organizationId: 'org1' });
    });

    it('restricts AGENT and AGENT_MASTER to active contracts linked to desks they can access, not just any active contract', () => {
      const agent: CurrentUserPayload = { id: 'agent1', role: Role.AGENT };
      const agentMaster: CurrentUserPayload = { id: 'agent2', role: Role.AGENT_MASTER };
      expect(TenantHelper.getContractWhere(agent)).toEqual({
        active: true,
        serviceDesks: {
          some: {
            OR: [
              { agents: { some: { id: 'agent1' } } },
              { agentGroups: { some: { members: { some: { id: 'agent1' } } } } },
              { allowCrossDeskInteraction: true },
            ],
          },
        },
      });
      expect(TenantHelper.getContractWhere(agentMaster)).toEqual({
        active: true,
        serviceDesks: {
          some: {
            OR: [
              { agents: { some: { id: 'agent2' } } },
              { agentGroups: { some: { members: { some: { id: 'agent2' } } } } },
              { allowCrossDeskInteraction: true },
            ],
          },
        },
      });
    });

    it('fails closed for a plain CLIENT', () => {
      const user: CurrentUserPayload = { id: 'c1', role: Role.CLIENT };
      expect(TenantHelper.getContractWhere(user)).toEqual({ id: '00000000-0000-0000-0000-000000000000' });
    });
  });

  describe('getAppointmentWhere', () => {
    it('should return empty where clause for ADMIN', () => {
      const user: CurrentUserPayload = { id: 'admin1', role: Role.ADMIN };
      expect(TenantHelper.getAppointmentWhere(user)).toEqual({});
    });

    it('should restrict CLIENT_MASTER to their organization and hide ABSENCE', () => {
      const user: CurrentUserPayload = { id: 'cm1', role: Role.CLIENT_MASTER, organizationId: 'org123' };
      expect(TenantHelper.getAppointmentWhere(user)).toEqual({
        organizationId: 'org123',
        type: { not: AppointmentType.ABSENCE },
      });
    });

    it('should fail-closed for CLIENT_MASTER without organizationId', () => {
      const user: CurrentUserPayload = { id: 'cm1', role: Role.CLIENT_MASTER };
      expect(TenantHelper.getAppointmentWhere(user)).toEqual({
        id: '00000000-0000-0000-0000-000000000000',
      });
    });

    it('should restrict AGENT and AGENT_MASTER to their own userId', () => {
      const agent: CurrentUserPayload = { id: 'agent1', role: Role.AGENT };
      const agentMaster: CurrentUserPayload = { id: 'agent2', role: Role.AGENT_MASTER };
      expect(TenantHelper.getAppointmentWhere(agent)).toEqual({ userId: 'agent1' });
      expect(TenantHelper.getAppointmentWhere(agentMaster)).toEqual({ userId: 'agent2' });
    });

    it('should fail-closed for CLIENT', () => {
      const user: CurrentUserPayload = { id: 'c1', role: Role.CLIENT };
      expect(TenantHelper.getAppointmentWhere(user)).toEqual({
        id: '00000000-0000-0000-0000-000000000000',
      });
    });

    it('should fail-closed for unmapped roles', () => {
      const user = { id: 'unknown', role: 'UNKNOWN' as Role };
      expect(TenantHelper.getAppointmentWhere(user)).toEqual({
        id: '00000000-0000-0000-0000-000000000000',
      });
    });
  });
});

/**
 * Fase 0b-1 (#525, tracker #523): caracterização do escopo de dados por perfil.
 * Em vez de repetir o formato do `where`, estes testes avaliam o `where` contra
 * registros em memória e afirmam QUEM enxerga O QUÊ. Não corrige nada: onde o
 * comportamento atual parece defeito, o teste trava o que existe hoje.
 */
type Rec = Record<string, any>;

// Avaliador mínimo do subconjunto de Prisma where que o TenantHelper emite.
function matches(rec: Rec, where: Rec): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Rec[]).some((w) => matches(rec, w));
    const value = rec[key];
    if (cond !== null && typeof cond === 'object') {
      if ('some' in cond) return Array.isArray(value) && value.some((i: Rec) => matches(i, cond.some));
      if ('none' in cond) return Array.isArray(value) && !value.some((i: Rec) => matches(i, cond.none));
      if ('not' in cond) return value !== cond.not;
      return value !== undefined && value !== null && matches(value, cond);
    }
    return value === cond;
  });
}
const visible = (records: Rec[], where: Rec) => records.filter((r) => matches(r, where)).map((r) => r.id);

describe('TenantHelper: escopo por perfil (caracterização 0b-1)', () => {
  const user = (id: string, role: Role, organizationId?: string | null): CurrentUserPayload => ({
    id,
    role,
    organizationId,
  });
  const admin = user('admin', Role.ADMIN);
  const agentMaster = user('am', Role.AGENT_MASTER);
  const agentDirect = user('a-direct', Role.AGENT);
  const agentGroup = user('a-group', Role.AGENT);
  const agentNone = user('a-none', Role.AGENT);
  const agentMasterNone = user('am-none', Role.AGENT_MASTER);
  const clientA = user('c-a', Role.CLIENT, 'org-a');
  const clientNoOrg = user('c-none', Role.CLIENT);
  const masterA = user('cm-a', Role.CLIENT_MASTER, 'org-a');
  const masterB = user('cm-b', Role.CLIENT_MASTER, 'org-b');
  const masterNoOrg = user('cm-none', Role.CLIENT_MASTER);
  const spy = { id: 'spy', role: 'SPY' as Role };

  const desk = (over: Rec = {}): Rec => ({
    active: true,
    acceptingNewTickets: true,
    internalUse: false,
    allowCrossDeskInteraction: false,
    agents: [],
    agentGroups: [],
    organizations: [],
    ...over,
  });
  const deskDirect = desk({ id: 'd-direct', agents: [{ id: 'a-direct' }, { id: 'am' }] });
  const deskGroup = desk({ id: 'd-group', agentGroups: [{ members: [{ id: 'a-group' }] }] });
  const deskCross = desk({ id: 'd-cross', allowCrossDeskInteraction: true });
  const deskIsolated = desk({ id: 'd-isolated' });

  describe('getTicketWhere', () => {
    const ticket = (id: string, requesterId: string, orgId: string | null, d: Rec): Rec => ({
      id,
      requesterId,
      requester: { organizationId: orgId },
      serviceDesk: d,
    });
    const tickets = [
      ticket('t-ca', 'c-a', 'org-a', deskIsolated),
      ticket('t-cma', 'cm-a', 'org-a', deskIsolated),
      ticket('t-cb', 'c-b', 'org-b', deskIsolated),
      ticket('t-cmb', 'cm-b', 'org-b', deskIsolated),
      ticket('t-cm-none', 'cm-none', null, deskIsolated),
      ticket('t-direct', 'c-a', 'org-a', deskDirect),
      ticket('t-group', 'c-b', 'org-b', deskGroup),
      ticket('t-cross', 'c-b', 'org-b', deskCross),
    ];
    const ids = (u: CurrentUserPayload) => visible(tickets, TenantHelper.getTicketWhere(u));

    it('ADMIN enxerga todos os tickets', () => {
      expect(ids(admin)).toHaveLength(tickets.length);
    });

    it('CLIENT enxerga só os tickets que ele abriu, mesmo com colegas na mesma organização', () => {
      expect(ids(clientA)).toEqual(['t-ca', 't-direct']);
    });

    it('CLIENT sem organização continua restrito aos próprios tickets', () => {
      expect(ids(clientNoOrg)).toEqual([]);
    });

    it('CLIENT_MASTER da org A enxerga os tickets da org A e nunca os da org B (sem vazamento entre organizações)', () => {
      const seen = ids(masterA);
      expect(seen).toEqual(['t-ca', 't-cma', 't-direct']);
      for (const id of seen) {
        expect(tickets.find((t) => t.id === id)!.requester.organizationId).toBe('org-a');
      }
    });

    it('CLIENT_MASTER da org B enxerga só a org B, espelho do caso da org A', () => {
      expect(ids(masterB)).toEqual(['t-cb', 't-cmb', 't-group', 't-cross']);
    });

    it('CLIENT_MASTER sem organização cai nos próprios tickets', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(TenantHelper.getTicketWhere(masterNoOrg)).toEqual({ requesterId: 'cm-none' });
      expect(ids(masterNoOrg)).toEqual(['t-cm-none']);
    });

    it('CLIENT_MASTER com organizationId vazio ou null também cai nos próprios tickets', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(TenantHelper.getTicketWhere(user('cm-x', Role.CLIENT_MASTER, ''))).toEqual({ requesterId: 'cm-x' });
      expect(TenantHelper.getTicketWhere(user('cm-x', Role.CLIENT_MASTER, null))).toEqual({ requesterId: 'cm-x' });
    });

    it('AGENT vinculado direto à mesa enxerga os tickets dela e os de mesas com interação entre mesas', () => {
      expect(ids(agentDirect)).toEqual(['t-direct', 't-cross']);
    });

    it('AGENT_MASTER vinculado direto segue a mesma regra do AGENT', () => {
      expect(ids(agentMaster)).toEqual(['t-direct', 't-cross']);
    });

    it('AGENT via grupo técnico enxerga os tickets da mesa do grupo', () => {
      expect(ids(agentGroup)).toEqual(['t-group', 't-cross']);
    });

    it('AGENT sem vínculo enxerga só tickets de mesa com allowCrossDeskInteraction, de qualquer organização', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(agentNone)).toEqual(['t-cross']);
      expect(ids(agentMasterNone)).toEqual(['t-cross']);
    });

    it('o escopo do AGENT ignora mesa inativa, acceptingNewTickets=false e internalUse', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      const inactive = ticket('t-inactive', 'c-a', 'org-a', desk({ id: 'x', active: false, agents: [{ id: 'a-direct' }] }));
      const closed = ticket('t-closed', 'c-a', 'org-a', desk({ id: 'y', acceptingNewTickets: false, agents: [{ id: 'a-direct' }] }));
      const internal = ticket('t-internal', 'c-a', 'org-a', desk({ id: 'z', internalUse: true, agents: [{ id: 'a-direct' }] }));
      expect(visible([inactive, closed, internal], TenantHelper.getTicketWhere(agentDirect))).toEqual([
        't-inactive',
        't-closed',
        't-internal',
      ]);
    });

    it('o escopo do CLIENT não depende do estado da mesa (inativa, interna, fechada)', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      const odd = [
        ticket('t1', 'c-a', 'org-a', desk({ active: false })),
        ticket('t2', 'c-a', 'org-a', desk({ internalUse: true })),
        ticket('t3', 'c-a', 'org-a', desk({ acceptingNewTickets: false })),
      ];
      expect(visible(odd, TenantHelper.getTicketWhere(clientA))).toEqual(['t1', 't2', 't3']);
    });

    it('papel desconhecido não enxerga nada (fail-closed)', () => {
      expect(ids(spy)).toEqual([]);
    });
  });

  describe('getServiceDeskWhere', () => {
    const desks: Rec[] = [
      desk({ id: 'global' }),
      desk({ id: 'org-a-desk', organizations: [{ id: 'org-a' }] }),
      desk({ id: 'org-b-desk', organizations: [{ id: 'org-b' }] }),
      desk({ id: 'both', organizations: [{ id: 'org-a' }, { id: 'org-b' }] }),
      desk({ id: 'inactive', active: false }),
      desk({ id: 'closed', acceptingNewTickets: false }),
      desk({ id: 'internal', internalUse: true }),
      desk({ id: 'cross-active', allowCrossDeskInteraction: true }),
      desk({ id: 'cross-inactive', allowCrossDeskInteraction: true, active: false }),
      desk({ id: 'listed', agents: [{ id: 'a-direct' }] }),
      desk({ id: 'listed-inactive', active: false, agents: [{ id: 'a-direct' }] }),
      desk({ id: 'listed-internal', internalUse: true, agents: [{ id: 'a-direct' }] }),
      desk({ id: 'grouped', agentGroups: [{ members: [{ id: 'a-group' }] }] }),
    ];
    const ids = (u: CurrentUserPayload) => visible(desks, TenantHelper.getServiceDeskWhere(u));

    it('ADMIN enxerga todas as mesas, inclusive inativas e internas', () => {
      expect(ids(admin)).toHaveLength(desks.length);
    });

    it('CLIENT da org A enxerga mesas globais e da própria org, só ativas, abertas a tickets e não internas', () => {
      expect(ids(clientA)).toEqual(['global', 'org-a-desk', 'both', 'cross-active', 'listed', 'grouped']);
    });

    it('CLIENT_MASTER da org A recebe o mesmo recorte de mesas do CLIENT da org A', () => {
      expect(ids(masterA)).toEqual(ids(clientA));
    });

    it('CLIENT_MASTER da org B nunca enxerga a mesa exclusiva da org A', () => {
      expect(ids(masterB)).not.toContain('org-a-desk');
      expect(ids(masterB)).toContain('org-b-desk');
    });

    it('CLIENT sem organização enxerga só mesas globais ativas', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(clientNoOrg)).toEqual(['global', 'cross-active', 'listed', 'grouped']);
    });

    it('CLIENT_MASTER sem organização enxerga só mesas globais ativas', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(masterNoOrg)).toEqual(['global', 'cross-active', 'listed', 'grouped']);
    });

    it('AGENT vinculado direto enxerga as mesas listadas, mesmo inativas ou internas, e as de interação ativas', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(agentDirect)).toEqual(['cross-active', 'listed', 'listed-inactive', 'listed-internal']);
    });

    it('AGENT_MASTER segue a regra do AGENT', () => {
      expect(ids(user('a-direct', Role.AGENT_MASTER))).toEqual(ids(agentDirect));
    });

    it('AGENT via grupo enxerga a mesa do grupo', () => {
      expect(ids(agentGroup)).toEqual(['cross-active', 'grouped']);
    });

    it('AGENT sem vínculo enxerga só mesa ativa com interação entre mesas, nunca a inativa', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(agentNone)).toEqual(['cross-active']);
      expect(ids(agentNone)).not.toContain('cross-inactive');
    });

    it('papel desconhecido não enxerga mesa nenhuma', () => {
      expect(ids(spy)).toEqual([]);
    });
  });

  describe('getCredentialWhere', () => {
    const credentials = [{ id: 'cred-1' }, { id: 'cred-2' }];
    const ids = (u: CurrentUserPayload) => visible(credentials, TenantHelper.getCredentialWhere(u));

    it('ADMIN enxerga todas as credenciais', () => {
      expect(TenantHelper.getCredentialWhere(admin)).toEqual({});
      expect(ids(admin)).toEqual(['cred-1', 'cred-2']);
    });

    it('AGENT e AGENT_MASTER enxergam todas as credenciais, sem filtro por mesa nem organização', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(TenantHelper.getCredentialWhere(agentNone)).toEqual({});
      expect(ids(agentNone)).toEqual(['cred-1', 'cred-2']);
      expect(ids(agentMasterNone)).toEqual(['cred-1', 'cred-2']);
    });

    it.each([
      ['CLIENT', clientA],
      ['CLIENT_MASTER', masterA],
      ['CLIENT_MASTER sem organização', masterNoOrg],
      ['papel desconhecido', spy],
    ])('%s não enxerga credencial nenhuma (fail-closed)', (_label, u) => {
      expect(ids(u)).toEqual([]);
    });
  });

  describe('getContractWhere', () => {
    const contract = (id: string, organizationId: string, active: boolean, serviceDesks: Rec[]): Rec => ({
      id,
      organizationId,
      active,
      serviceDesks,
    });
    const contracts = [
      contract('k-a', 'org-a', true, [deskIsolated]),
      contract('k-a-inactive', 'org-a', false, [deskDirect]),
      contract('k-b', 'org-b', true, [deskIsolated]),
      contract('k-direct', 'org-b', true, [deskDirect]),
      contract('k-direct-inactive', 'org-b', false, [deskDirect]),
      contract('k-group', 'org-b', true, [deskGroup]),
      contract('k-cross', 'org-b', true, [deskCross]),
      contract('k-nodesk', 'org-b', true, []),
    ];
    const ids = (u: CurrentUserPayload) => visible(contracts, TenantHelper.getContractWhere(u));

    it('ADMIN enxerga todos os contratos', () => {
      expect(ids(admin)).toHaveLength(contracts.length);
    });

    it('CLIENT_MASTER da org A enxerga os contratos da org A (inclusive inativo) e nunca os da org B', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(masterA)).toEqual(['k-a', 'k-a-inactive']);
      for (const id of ids(masterA)) {
        expect(contracts.find((c) => c.id === id)!.organizationId).toBe('org-a');
      }
    });

    it('CLIENT_MASTER da org B enxerga só contratos da org B', () => {
      expect(ids(masterB)).not.toContain('k-a');
      expect(ids(masterB)).toEqual(contracts.filter((c) => c.organizationId === 'org-b').map((c) => c.id));
    });

    it('CLIENT_MASTER sem organização não enxerga contrato nenhum', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(TenantHelper.getContractWhere(masterNoOrg)).toEqual({ id: '00000000-0000-0000-0000-000000000000' });
      expect(ids(masterNoOrg)).toEqual([]);
    });

    it('CLIENT não enxerga contrato nenhum', () => {
      expect(ids(clientA)).toEqual([]);
    });

    it('AGENT vinculado direto enxerga só contrato ativo de mesa dele ou de interação entre mesas', () => {
      expect(ids(agentDirect)).toEqual(['k-direct', 'k-cross']);
    });

    it('AGENT via grupo enxerga contrato ativo da mesa do grupo', () => {
      expect(ids(agentGroup)).toEqual(['k-group', 'k-cross']);
    });

    it('AGENT sem vínculo enxerga só contrato ativo de mesa com interação entre mesas, de qualquer organização', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(agentNone)).toEqual(['k-cross']);
      expect(ids(agentMasterNone)).toEqual(['k-cross']);
    });

    it('contrato sem mesa vinculada fica invisível para o AGENT', () => {
      expect(ids(agentDirect)).not.toContain('k-nodesk');
      expect(ids(agentNone)).not.toContain('k-nodesk');
    });

    it('papel desconhecido não enxerga contrato nenhum', () => {
      expect(ids(spy)).toEqual([]);
    });
  });

  describe('getAppointmentWhere', () => {
    const appt = (id: string, userId: string, organizationId: string, type: string): Rec => ({
      id,
      userId,
      organizationId,
      type,
    });
    const appointments = [
      appt('p-a-agenda', 'a-direct', 'org-a', AppointmentType.AGENDA),
      appt('p-a-absence', 'a-direct', 'org-a', AppointmentType.ABSENCE),
      appt('p-a-vacation', 'a-group', 'org-a', AppointmentType.VACATION),
      appt('p-b-agenda', 'a-direct', 'org-b', AppointmentType.AGENDA),
      appt('p-b-absence', 'am', 'org-b', AppointmentType.ABSENCE),
    ];
    const ids = (u: CurrentUserPayload) => visible(appointments, TenantHelper.getAppointmentWhere(u));

    it('ADMIN enxerga todos os compromissos', () => {
      expect(ids(admin)).toHaveLength(appointments.length);
    });

    it('CLIENT_MASTER da org A enxerga a agenda e a férias da org A, nunca ausência nem a org B', () => {
      expect(ids(masterA)).toEqual(['p-a-agenda', 'p-a-vacation']);
    });

    it('CLIENT_MASTER da org B nunca enxerga compromissos da org A', () => {
      expect(ids(masterB)).toEqual(['p-b-agenda']);
    });

    it('CLIENT_MASTER sem organização não enxerga compromisso nenhum', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(masterNoOrg)).toEqual([]);
    });

    it('AGENT enxerga só os compromissos em que é o usuário, de qualquer organização, inclusive ausência', () => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      expect(ids(agentDirect)).toEqual(['p-a-agenda', 'p-a-absence', 'p-b-agenda']);
      expect(ids(agentGroup)).toEqual(['p-a-vacation']);
      expect(ids(agentMaster)).toEqual(['p-b-absence']);
    });

    it('AGENT sem nenhum compromisso não enxerga nada, e o escopo não depende de vínculo com mesa', () => {
      expect(ids(agentNone)).toEqual([]);
    });

    it('CLIENT e papel desconhecido não enxergam compromisso nenhum', () => {
      expect(ids(clientA)).toEqual([]);
      expect(ids(spy)).toEqual([]);
    });
  });
});
