import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AppointmentType, Role } from '@prisma/client';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';
import { ScopeResolver, SCOPE_KEYS } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Fase 1c (#534, tracker #523): o ScopeResolver decide o alcance de dados so
 * pelas permissoes (sem olhar o perfil). Prova: com as chaves de escopo que o
 * grupo padrao de cada perfil devera ter, o `where` e igual ao do TenantHelper.
 */
const ZERO = '00000000-0000-0000-0000-000000000000';
const K = SCOPE_KEYS;

// Chaves de escopo que o 1a/1b devem registrar em cada grupo padrao.
const DEFAULT_GROUP_SCOPE: Record<Role, string[]> = {
  [Role.ADMIN]: Object.values(K),
  [Role.AGENT_MASTER]: [K.TICKETS_DESKS, K.SERVICE_DESKS_ASSIGNED, K.CREDENTIALS_ALL, K.CONTRACTS_DESKS, K.APPOINTMENTS_OWN],
  [Role.AGENT]: [K.TICKETS_DESKS, K.SERVICE_DESKS_ASSIGNED, K.CREDENTIALS_ALL, K.CONTRACTS_DESKS, K.APPOINTMENTS_OWN],
  [Role.CLIENT_MASTER]: [
    K.TICKETS_ORGANIZATION,
    K.TICKETS_OWN,
    K.SERVICE_DESKS_ORGANIZATION,
    K.CONTRACTS_ORGANIZATION,
    K.APPOINTMENTS_ORGANIZATION,
  ],
  [Role.CLIENT]: [K.TICKETS_OWN, K.SERVICE_DESKS_ORGANIZATION],
};

type Rec = Record<string, any>;
function matches(rec: Rec, where: Rec): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Rec[]).some((w) => matches(rec, w));
    if (cond === undefined) return true;
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

const orgs: Array<string | null | undefined> = ['org-a', 'org-b', null, undefined, ''];
const roles = Object.values(Role) as Role[];

describe('ScopeResolver: equivalencia com o TenantHelper por perfil e vinculo', () => {
  const cases = roles.flatMap((role) => orgs.map((org) => ({ role, org })));

  it.each(cases)('perfil $role, organizationId=$org: mesmo where em todas as entidades', ({ role, org }) => {
    const user: CurrentUserPayload = { id: 'u1', role, organizationId: org };
    const perms = DEFAULT_GROUP_SCOPE[role];
    expect(ScopeResolver.getTicketWhere(user, perms)).toEqual(TenantHelper.getTicketWhere(user));
    expect(ScopeResolver.getServiceDeskWhere(user, perms)).toEqual(TenantHelper.getServiceDeskWhere(user));
    expect(ScopeResolver.getCredentialWhere(user, perms)).toEqual(TenantHelper.getCredentialWhere(user));
    expect(ScopeResolver.getContractWhere(user, perms)).toEqual(TenantHelper.getContractWhere(user));
    expect(ScopeResolver.getAppointmentWhere(user, perms)).toEqual(TenantHelper.getAppointmentWhere(user));
  });

  it('papel desconhecido sem chaves de escopo e fail-closed igual ao TenantHelper', () => {
    const spy = { id: 'spy', role: 'SPY' as Role };
    expect(ScopeResolver.getTicketWhere(spy, [])).toEqual(TenantHelper.getTicketWhere(spy));
    expect(ScopeResolver.getServiceDeskWhere(spy, [])).toEqual(TenantHelper.getServiceDeskWhere(spy));
    expect(ScopeResolver.getCredentialWhere(spy, [])).toEqual(TenantHelper.getCredentialWhere(spy));
    expect(ScopeResolver.getContractWhere(spy, [])).toEqual(TenantHelper.getContractWhere(spy));
    expect(ScopeResolver.getAppointmentWhere(spy, [])).toEqual(TenantHelper.getAppointmentWhere(spy));
  });
});

describe('ScopeResolver: decide so pelas permissoes', () => {
  const u = { id: 'u1', organizationId: 'org-a' };

  it('sem nenhuma chave de escopo, tudo e fail-closed (UUID zero)', () => {
    const none: string[] = [];
    expect(ScopeResolver.getTicketWhere(u, none)).toEqual({ id: ZERO });
    expect(ScopeResolver.getServiceDeskWhere(u, none)).toEqual({ id: ZERO });
    expect(ScopeResolver.getCredentialWhere(u, none)).toEqual({ id: ZERO });
    expect(ScopeResolver.getContractWhere(u, none)).toEqual({ id: ZERO });
    expect(ScopeResolver.getAppointmentWhere(u, none)).toEqual({ id: ZERO });
  });

  it('ignora o perfil do usuario: o mesmo conjunto de chaves da o mesmo where', () => {
    const perms = [K.TICKETS_ORGANIZATION];
    const asClient = { ...u, role: Role.CLIENT } as CurrentUserPayload;
    const asAdmin = { ...u, role: Role.ADMIN } as CurrentUserPayload;
    expect(ScopeResolver.getTicketWhere(asClient, perms)).toEqual({ requester: { organizationId: 'org-a' } });
    expect(ScopeResolver.getTicketWhere(asAdmin, perms)).toEqual({ requester: { organizationId: 'org-a' } });
  });

  it('chaves desconhecidas nao concedem nada', () => {
    expect(ScopeResolver.getTicketWhere(u, ['ADMIN', 'MANAGE_CONTRACTS', 'VIEW_AND_OPEN_TICKETS'])).toEqual({ id: ZERO });
  });

  it('o escopo mais amplo vence quando o usuario tem varias chaves', () => {
    expect(ScopeResolver.getTicketWhere(u, [K.TICKETS_OWN, K.TICKETS_ORGANIZATION, K.TICKETS_ALL])).toEqual({});
    expect(ScopeResolver.getTicketWhere(u, [K.TICKETS_OWN, K.TICKETS_DESKS])).toEqual(
      ScopeResolver.getTicketWhere(u, [K.TICKETS_DESKS]),
    );
    expect(ScopeResolver.getContractWhere(u, [K.CONTRACTS_DESKS, K.CONTRACTS_ALL])).toEqual({});
    expect(ScopeResolver.getAppointmentWhere(u, [K.APPOINTMENTS_OWN, K.APPOINTMENTS_ALL])).toEqual({});
    expect(ScopeResolver.getServiceDeskWhere(u, [K.SERVICE_DESKS_ASSIGNED, K.SERVICE_DESKS_ALL])).toEqual({});
    expect(ScopeResolver.getCredentialWhere(u, [K.CREDENTIALS_ALL])).toEqual({});
  });

  it('escopo de organizacao sem organizationId cai no escopo mais estreito que o usuario tem, senao fail-closed', () => {
    const noOrg = { id: 'u1', organizationId: null };
    expect(ScopeResolver.getTicketWhere(noOrg, [K.TICKETS_ORGANIZATION, K.TICKETS_OWN])).toEqual({ requesterId: 'u1' });
    expect(ScopeResolver.getTicketWhere(noOrg, [K.TICKETS_ORGANIZATION])).toEqual({ id: ZERO });
    expect(ScopeResolver.getContractWhere(noOrg, [K.CONTRACTS_ORGANIZATION])).toEqual({ id: ZERO });
    expect(ScopeResolver.getAppointmentWhere(noOrg, [K.APPOINTMENTS_ORGANIZATION])).toEqual({ id: ZERO });
  });

  it('aceita qualquer iteravel de permissoes (Set)', () => {
    expect(ScopeResolver.getTicketWhere(u, new Set([K.TICKETS_OWN]))).toEqual({ requesterId: 'u1' });
  });
});

describe('ScopeResolver: sem vazamento entre organizacoes (avaliado em registros)', () => {
  const masterA = { id: 'cm-a', organizationId: 'org-a' };
  const perms = DEFAULT_GROUP_SCOPE[Role.CLIENT_MASTER];

  it('CLIENT_MASTER de A nunca ve tickets, contratos, compromissos nem mesas exclusivas de B', () => {
    const tickets = [
      { id: 't-a', requesterId: 'x', requester: { organizationId: 'org-a' } },
      { id: 't-b', requesterId: 'y', requester: { organizationId: 'org-b' } },
    ];
    const contracts = [
      { id: 'k-a', organizationId: 'org-a' },
      { id: 'k-b', organizationId: 'org-b' },
    ];
    const appts = [
      { id: 'p-a', organizationId: 'org-a', type: AppointmentType.AGENDA },
      { id: 'p-b', organizationId: 'org-b', type: AppointmentType.AGENDA },
      { id: 'p-a-abs', organizationId: 'org-a', type: AppointmentType.ABSENCE },
    ];
    const desk = (id: string, organizations: Rec[]) => ({
      id,
      active: true,
      acceptingNewTickets: true,
      internalUse: false,
      organizations,
    });
    const desks = [desk('d-a', [{ id: 'org-a' }]), desk('d-b', [{ id: 'org-b' }]), desk('d-global', [])];
    expect(visible(tickets, ScopeResolver.getTicketWhere(masterA, perms))).toEqual(['t-a']);
    expect(visible(contracts, ScopeResolver.getContractWhere(masterA, perms))).toEqual(['k-a']);
    expect(visible(appts, ScopeResolver.getAppointmentWhere(masterA, perms))).toEqual(['p-a']);
    expect(visible(desks, ScopeResolver.getServiceDeskWhere(masterA, perms))).toEqual(['d-a', 'd-global']);
  });

  it('CLIENT_MASTER sem organizacao nao ve contrato nem compromisso de nenhuma organizacao', () => {
    const noOrg = { id: 'cm-none', organizationId: undefined };
    const contracts = [{ id: 'k-a', organizationId: 'org-a' }];
    const appts = [{ id: 'p-a', organizationId: 'org-a', type: AppointmentType.AGENDA }];
    expect(visible(contracts, ScopeResolver.getContractWhere(noOrg, perms))).toEqual([]);
    expect(visible(appts, ScopeResolver.getAppointmentWhere(noOrg, perms))).toEqual([]);
  });
});

describe('ScopeResolver: ainda nao ligado a nenhum caller', () => {
  it('nenhum arquivo de producao em src importa scope-resolver', () => {
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('scope-resolver.ts')) {
          if (readFileSync(p, 'utf8').includes('scope-resolver')) offenders.push(p);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
