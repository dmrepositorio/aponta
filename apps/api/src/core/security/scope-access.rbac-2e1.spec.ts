import { AppointmentType, Role } from '@prisma/client';
import { DEFAULT_PERMISSION_GROUPS } from '../../permission-groups/default-permission-groups';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';
import { ScopeAccess } from './scope-access';
import { SCOPE_KEYS } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e1 do tracker #523 (#549): escopo de dados de mesas, credenciais, contratos e agenda.
 * Flag `rbac-permission-only` desligada: o `where` e o do TenantHelper (por perfil), sem consultar
 * permissoes. Ligada: vem do ScopeResolver com as permissoes do usuario, sem olhar `User.role`; para
 * os 5 grupos padrao o resultado e IGUAL ao de hoje. Area critica: vazamento entre organizacoes.
 */
const ZERO = '00000000-0000-0000-0000-000000000000';
const K = SCOPE_KEYS;
const roles = Object.values(Role) as Role[];
const orgs: Array<string | null | undefined> = ['org-a', 'org-b', null, undefined, ''];
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

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

const setup = (flagOn: boolean, grants: Record<string, string[]> = {}) => {
  const getEffectivePermissions = jest.fn(async (id: string) => new Set(grants[id] ?? []));
  const access = new ScopeAccess({ isRbacPermissionOnly: () => flagOn } as any, { getEffectivePermissions } as any);
  return { access, getEffectivePermissions };
};
const userOf = (role: Role, organizationId?: string | null, id = `u-${role}`): CurrentUserPayload => ({ id, role, organizationId });
const defaults = (): Record<string, string[]> =>
  Object.fromEntries(roles.map((r) => [`u-${r}`, DEFAULT_PERMISSION_GROUPS[r].permissions]));

async function allWheres(access: ScopeAccess, user: CurrentUserPayload) {
  return {
    desk: await access.serviceDeskWhere(user),
    credential: await access.credentialWhere(user),
    contract: await access.contractWhere(user),
    appointment: await access.appointmentWhere(user),
  };
}
const legacyWheres = (user: CurrentUserPayload) => ({
  desk: TenantHelper.getServiceDeskWhere(user),
  credential: TenantHelper.getCredentialWhere(user),
  contract: TenantHelper.getContractWhere(user),
  appointment: TenantHelper.getAppointmentWhere(user),
});

describe('ScopeAccess: equivalencia nos dois modos para os 5 perfis (grupos padrao reais)', () => {
  const cases = modes.flatMap(([label, flagOn]) =>
    roles.flatMap((role) => orgs.map((org) => ({ label, flagOn, role, org }))),
  );

  it.each(cases)('$label, perfil $role, organizationId=$org: mesmo where do TenantHelper nas 4 entidades', async ({ flagOn, role, org }) => {
    const { access } = setup(flagOn, defaults());
    const user = userOf(role, org);
    expect(await allWheres(access, user)).toEqual(legacyWheres(user));
  });

  it('o ADMIN tem todas as chaves de escopo: o mais amplo vence e nada e filtrado', async () => {
    const admin = DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions;
    for (const key of Object.values(K)) expect(admin).toContain(key);
    const { access } = setup(true, defaults());
    expect(await allWheres(access, userOf(Role.ADMIN, 'org-a'))).toEqual({
      desk: {},
      credential: {},
      contract: {},
      appointment: {},
    });
  });
});

describe('ScopeAccess: flag desligada decide so pelo perfil', () => {
  it.each(roles.map((role) => ({ role })))('perfil $role: nao consulta permissoes mesmo com chaves de outro perfil', async ({ role }) => {
    const { access, getEffectivePermissions } = setup(false, { [`u-${role}`]: Object.values(K) });
    const user = userOf(role, 'org-a');
    expect(await allWheres(access, user)).toEqual(legacyWheres(user));
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('CLIENT com todas as chaves continua sem credencial nem contrato (perfil manda)', async () => {
    const { access } = setup(false, { 'u-CLIENT': Object.values(K) });
    const client = userOf(Role.CLIENT, 'org-a');
    expect(await access.credentialWhere(client)).toEqual({ id: ZERO });
    expect(await access.contractWhere(client)).toEqual({ id: ZERO });
    expect(await access.appointmentWhere(client)).toEqual({ id: ZERO });
  });
});

describe('ScopeAccess: flag ligada decide so pelas permissoes, sem olhar o perfil', () => {
  it('consulta as permissoes do proprio usuario, uma vez por chamada', async () => {
    const { access, getEffectivePermissions } = setup(true, { 'u-x': [K.CREDENTIALS_ALL] });
    await access.credentialWhere(userOf(Role.CLIENT, 'org-a', 'u-x'));
    expect(getEffectivePermissions).toHaveBeenCalledTimes(1);
    expect(getEffectivePermissions).toHaveBeenCalledWith('u-x');
  });

  it('ADMIN sem nenhuma chave de escopo fica fail-closed (sem bypass por perfil)', async () => {
    const { access } = setup(true, { 'u-ADMIN': ['ADMIN', 'VIEW_AND_OPEN_TICKETS'] });
    expect(await allWheres(access, userOf(Role.ADMIN, 'org-a'))).toEqual({
      desk: { id: ZERO },
      credential: { id: ZERO },
      contract: { id: ZERO },
      appointment: { id: ZERO },
    });
  });

  it('perfil desconhecido sem chaves e fail-closed nas 4 entidades', async () => {
    const { access } = setup(true, {});
    const spy = userOf('SPY' as Role, 'org-a');
    expect(await allWheres(access, spy)).toEqual({
      desk: { id: ZERO },
      credential: { id: ZERO },
      contract: { id: ZERO },
      appointment: { id: ZERO },
    });
  });

  it('CLIENT com VIEW_ALL_CREDENTIALS le credenciais; AGENT sem a chave nao', async () => {
    const { access } = setup(true, { 'u-c': [K.CREDENTIALS_ALL], 'u-a': [K.TICKETS_DESKS] });
    expect(await access.credentialWhere(userOf(Role.CLIENT, 'org-a', 'u-c'))).toEqual({});
    expect(await access.credentialWhere(userOf(Role.AGENT, undefined, 'u-a'))).toEqual({ id: ZERO });
  });

  it('cada entidade usa as chaves da propria entidade (chave de outra entidade nao concede)', async () => {
    const { access } = setup(true, {
      'u-t': [K.TICKETS_ALL, K.TICKETS_DESKS, K.TICKETS_ORGANIZATION, K.TICKETS_OWN],
    });
    expect(await allWheres(access, userOf(Role.ADMIN, 'org-a', 'u-t'))).toEqual({
      desk: { id: ZERO },
      credential: { id: ZERO },
      contract: { id: ZERO },
      appointment: { id: ZERO },
    });
  });

  it('mesas: chave de mesas em que atua vence a da organizacao e a de todas vence as duas', async () => {
    const { access } = setup(true, {
      'u-o': [K.SERVICE_DESKS_ORGANIZATION],
      'u-as': [K.SERVICE_DESKS_ORGANIZATION, K.SERVICE_DESKS_ASSIGNED],
      'u-al': [K.SERVICE_DESKS_ORGANIZATION, K.SERVICE_DESKS_ASSIGNED, K.SERVICE_DESKS_ALL],
    });
    const org = await access.serviceDeskWhere(userOf(Role.CLIENT, 'org-a', 'u-o'));
    expect(org).toMatchObject({ active: true, acceptingNewTickets: true, internalUse: false });
    const assigned = await access.serviceDeskWhere(userOf(Role.CLIENT, 'org-a', 'u-as'));
    expect(assigned).toEqual({
      OR: [
        { agents: { some: { id: 'u-as' } } },
        { agentGroups: { some: { members: { some: { id: 'u-as' } } } } },
        { allowCrossDeskInteraction: true, active: true },
      ],
    });
    expect(await access.serviceDeskWhere(userOf(Role.CLIENT, 'org-a', 'u-al'))).toEqual({});
  });

  it('contratos e agenda: o escopo de organizacao exige organizationId; sem ele cai no mais estreito ou fail-closed', async () => {
    const { access } = setup(true, {
      'u-o': [K.CONTRACTS_ORGANIZATION, K.APPOINTMENTS_ORGANIZATION],
      'u-on': [K.CONTRACTS_ORGANIZATION, K.CONTRACTS_DESKS, K.APPOINTMENTS_ORGANIZATION, K.APPOINTMENTS_OWN],
    });
    expect(await access.contractWhere(userOf(Role.CLIENT_MASTER, 'org-a', 'u-o'))).toEqual({ organizationId: 'org-a' });
    expect(await access.contractWhere(userOf(Role.CLIENT_MASTER, undefined, 'u-o'))).toEqual({ id: ZERO });
    expect(await access.contractWhere(userOf(Role.CLIENT_MASTER, '', 'u-o'))).toEqual({ id: ZERO });
    expect(await access.appointmentWhere(userOf(Role.CLIENT_MASTER, null, 'u-o'))).toEqual({ id: ZERO });
    expect(await access.appointmentWhere(userOf(Role.CLIENT_MASTER, null, 'u-on'))).toEqual({ userId: 'u-on' });
    expect(await access.appointmentWhere(userOf(Role.CLIENT_MASTER, 'org-a', 'u-o'))).toEqual({
      organizationId: 'org-a',
      type: { not: AppointmentType.ABSENCE },
    });
  });
});

describe.each(modes)('ScopeAccess (%s): sem vazamento entre organizacoes, avaliado em registros', (_label, flagOn) => {
  const desk = (id: string, extra: Rec = {}) => ({
    id,
    active: true,
    acceptingNewTickets: true,
    internalUse: false,
    organizations: [] as Rec[],
    agents: [] as Rec[],
    agentGroups: [] as Rec[],
    allowCrossDeskInteraction: false,
    ...extra,
  });
  const desks = [
    desk('d-a', { organizations: [{ id: 'org-a' }] }),
    desk('d-b', { organizations: [{ id: 'org-b' }] }),
    desk('d-ab', { organizations: [{ id: 'org-a' }, { id: 'org-b' }] }),
    desk('d-global'),
    desk('d-internal', { internalUse: true }),
    desk('d-inactive', { active: false }),
    desk('d-closed', { acceptingNewTickets: false }),
    desk('d-b-internal', { organizations: [{ id: 'org-b' }], internalUse: true }),
  ];
  const contracts = [
    { id: 'k-a', organizationId: 'org-a', active: true },
    { id: 'k-b', organizationId: 'org-b', active: true },
    { id: 'k-b-off', organizationId: 'org-b', active: false },
  ];
  const appts = [
    { id: 'p-a', organizationId: 'org-a', userId: 'x', type: AppointmentType.AGENDA },
    { id: 'p-b', organizationId: 'org-b', userId: 'y', type: AppointmentType.AGENDA },
    { id: 'p-a-abs', organizationId: 'org-a', userId: 'x', type: AppointmentType.ABSENCE },
    { id: 'p-b-abs', organizationId: 'org-b', userId: 'y', type: AppointmentType.ABSENCE },
    { id: 'p-none', organizationId: null, userId: 'z', type: AppointmentType.AGENDA },
  ];

  it('CLIENT_MASTER de A nunca ve mesas, contratos nem agenda de B', async () => {
    const { access } = setup(flagOn, defaults());
    const masterA = userOf(Role.CLIENT_MASTER, 'org-a');
    expect(visible(desks, await access.serviceDeskWhere(masterA))).toEqual(['d-a', 'd-ab', 'd-global']);
    expect(visible(contracts, await access.contractWhere(masterA))).toEqual(['k-a']);
    expect(visible(appts, await access.appointmentWhere(masterA))).toEqual(['p-a']);
  });

  it('CLIENT de A nunca ve mesa exclusiva de B nem contrato/agenda de ninguem', async () => {
    const { access } = setup(flagOn, defaults());
    const clientA = userOf(Role.CLIENT, 'org-a');
    expect(visible(desks, await access.serviceDeskWhere(clientA))).toEqual(['d-a', 'd-ab', 'd-global']);
    expect(visible(contracts, await access.contractWhere(clientA))).toEqual([]);
    expect(visible(appts, await access.appointmentWhere(clientA))).toEqual([]);
  });

  it('CLIENT_MASTER sem organizacao so ve mesas globais e nenhum contrato nem agenda', async () => {
    const { access } = setup(flagOn, defaults());
    for (const org of [null, undefined, '']) {
      const master = userOf(Role.CLIENT_MASTER, org);
      expect(visible(desks, await access.serviceDeskWhere(master))).toEqual(['d-global']);
      expect(visible(contracts, await access.contractWhere(master))).toEqual([]);
      expect(visible(appts, await access.appointmentWhere(master))).toEqual([]);
    }
  });

  it('cliente nunca ve mesa de uso interno, inativa ou que nao recebe tickets', async () => {
    const { access } = setup(flagOn, defaults());
    for (const role of [Role.CLIENT, Role.CLIENT_MASTER]) {
      const ids = visible(desks, await access.serviceDeskWhere(userOf(role, 'org-a')));
      expect(ids).not.toContain('d-internal');
      expect(ids).not.toContain('d-inactive');
      expect(ids).not.toContain('d-closed');
    }
  });

  it('AGENT ve mesas em que atua (mesmo internas), as cross-desk ativas, e contratos so de mesas com vinculo', async () => {
    const { access } = setup(flagOn, defaults());
    const agent = userOf(Role.AGENT, undefined, 'u-AGENT');
    const agentDesks = [
      desk('d-linked', { agents: [{ id: 'u-AGENT' }], internalUse: true }),
      desk('d-group', { agentGroups: [{ members: [{ id: 'u-AGENT' }] }] }),
      desk('d-other'),
      desk('d-cross', { allowCrossDeskInteraction: true }),
      desk('d-cross-off', { allowCrossDeskInteraction: true, active: false }),
      desk('d-linked-off', { agents: [{ id: 'u-AGENT' }], active: false }),
    ];
    expect(visible(agentDesks, await access.serviceDeskWhere(agent))).toEqual(['d-linked', 'd-group', 'd-cross', 'd-linked-off']);
    const linkedContracts = [
      { id: 'k-linked', active: true, serviceDesks: [agentDesks[0]] },
      { id: 'k-other', active: true, serviceDesks: [agentDesks[2]] },
      { id: 'k-linked-off', active: false, serviceDesks: [agentDesks[0]] },
      { id: 'k-nodesk', active: true, serviceDesks: [] },
    ];
    expect(visible(linkedContracts, await access.contractWhere(agent))).toEqual(['k-linked']);
  });

  it('AGENT sem vinculo a nenhuma mesa nao ve mesa nem contrato (exceto cross-desk); agenda so a propria', async () => {
    const { access } = setup(flagOn, defaults());
    const agent = userOf(Role.AGENT, undefined, 'u-AGENT');
    const plain = [desk('d-1'), desk('d-2', { organizations: [{ id: 'org-a' }] })];
    expect(visible(plain, await access.serviceDeskWhere(agent))).toEqual([]);
    expect(visible([{ id: 'k', active: true, serviceDesks: plain }], await access.contractWhere(agent))).toEqual([]);
    expect(
      visible(
        [
          { id: 'mine', userId: 'u-AGENT', organizationId: 'org-a', type: AppointmentType.ABSENCE },
          { id: 'theirs', userId: 'u-other', organizationId: 'org-a', type: AppointmentType.AGENDA },
        ],
        await access.appointmentWhere(agent),
      ),
    ).toEqual(['mine']);
  });

  it('CARACTERIZACAO (#523): AGENT sem vinculo ve contrato e mesa cross-desk de qualquer organizacao; preservado', async () => {
    const { access } = setup(flagOn, defaults());
    const agent = userOf(Role.AGENT, undefined, 'u-AGENT');
    const cross = desk('d-cross', { allowCrossDeskInteraction: true, organizations: [{ id: 'org-b' }] });
    expect(visible([cross], await access.serviceDeskWhere(agent))).toEqual(['d-cross']);
    expect(visible([{ id: 'k-b', active: true, serviceDesks: [cross] }], await access.contractWhere(agent))).toEqual(['k-b']);
  });

  it('AGENT_MASTER e AGENT enxergam credenciais; CLIENT e CLIENT_MASTER, nenhuma', async () => {
    const { access } = setup(flagOn, defaults());
    expect(await access.credentialWhere(userOf(Role.AGENT_MASTER))).toEqual({});
    expect(await access.credentialWhere(userOf(Role.AGENT))).toEqual({});
    expect(await access.credentialWhere(userOf(Role.CLIENT, 'org-a'))).toEqual({ id: ZERO });
    expect(await access.credentialWhere(userOf(Role.CLIENT_MASTER, 'org-a'))).toEqual({ id: ZERO });
  });

  it('ADMIN ve tudo, inclusive mesas internas e inativas, contratos e agenda de todas as organizacoes', async () => {
    const { access } = setup(flagOn, defaults());
    const admin = userOf(Role.ADMIN, 'org-a');
    expect(visible(desks, await access.serviceDeskWhere(admin))).toHaveLength(desks.length);
    expect(visible(contracts, await access.contractWhere(admin))).toHaveLength(contracts.length);
    expect(visible(appts, await access.appointmentWhere(admin))).toHaveLength(appts.length);
  });
});

describe('ScopeAccess: flag ligada nao deixa um cliente herdar escopo de outra organizacao', () => {
  it('CLIENT_MASTER de A com chave so de organizacao nunca ve B, mesmo se o objeto de usuario trouxer perfil ADMIN', async () => {
    const { access } = setup(true, { 'u-m': [K.CONTRACTS_ORGANIZATION, K.APPOINTMENTS_ORGANIZATION, K.SERVICE_DESKS_ORGANIZATION] });
    const user = userOf(Role.ADMIN, 'org-a', 'u-m');
    expect(await access.contractWhere(user)).toEqual({ organizationId: 'org-a' });
    expect(await access.appointmentWhere(user)).toEqual({ organizationId: 'org-a', type: { not: AppointmentType.ABSENCE } });
    expect(await access.serviceDeskWhere(user)).toMatchObject({ internalUse: false });
  });
});
