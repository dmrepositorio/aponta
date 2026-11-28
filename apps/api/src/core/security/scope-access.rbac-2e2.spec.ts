import { Role } from '@prisma/client';
import { DEFAULT_PERMISSION_GROUPS } from '../../permission-groups/default-permission-groups';
import { CurrentUserPayload } from '../../tickets/decorators/current-user.decorator';
import { ScopeAccess } from './scope-access';
import { SCOPE_KEYS } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e2 do tracker #523 (#584): escopo de dados de CHAMADOS. Flag `rbac-permission-only`
 * desligada: o `where` e o do TenantHelper (por perfil), sem consultar permissoes. Ligada: vem do
 * ScopeResolver com as permissoes do usuario, sem olhar `User.role`; para os 5 grupos padrao o
 * resultado e IGUAL ao de hoje. Area critica: vazamento entre organizacoes.
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

describe('ScopeAccess.ticketWhere: equivalencia nos dois modos para os 5 perfis (grupos padrao reais)', () => {
  const cases = modes.flatMap(([label, flagOn]) =>
    roles.flatMap((role) => orgs.map((org) => ({ label, flagOn, role, org }))),
  );

  it.each(cases)('$label, perfil $role, organizationId=$org: mesmo where do TenantHelper', async ({ flagOn, role, org }) => {
    const { access } = setup(flagOn, defaults());
    const user = userOf(role, org);
    expect(await access.ticketWhere(user)).toEqual(TenantHelper.getTicketWhere(user));
  });

  it('o ADMIN tem todas as chaves de escopo de chamados: o mais amplo vence e nada e filtrado', async () => {
    const admin = DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions;
    for (const key of [K.TICKETS_ALL, K.TICKETS_ORGANIZATION, K.TICKETS_DESKS, K.TICKETS_OWN]) expect(admin).toContain(key);
    const { access } = setup(true, defaults());
    expect(await access.ticketWhere(userOf(Role.ADMIN, 'org-a'))).toEqual({});
  });
});

describe.each(modes)('ScopeAccess.ticketWhere (%s): fonte da decisao', (_label, flagOn) => {
  it('desligada nao consulta permissoes; ligada consulta as do usuario uma vez por decisao', async () => {
    const { access, getEffectivePermissions } = setup(flagOn, defaults());
    await access.ticketWhere(userOf(Role.AGENT));
    await access.ticketReadScope(userOf(Role.AGENT));
    if (flagOn) {
      expect(getEffectivePermissions).toHaveBeenCalledTimes(2);
      expect(getEffectivePermissions).toHaveBeenCalledWith('u-AGENT');
    } else {
      expect(getEffectivePermissions).not.toHaveBeenCalled();
    }
  });

  it('CLIENT com VIEW_ALL_TICKETS: so a flag ligada segue a permissao', async () => {
    const { access } = setup(flagOn, { 'u-CLIENT': [K.TICKETS_ALL] });
    expect(await access.ticketWhere(userOf(Role.CLIENT, 'org-a'))).toEqual(
      flagOn ? {} : { requesterId: 'u-CLIENT' },
    );
  });

  it('ADMIN sem chave de escopo: so a flag ligada fecha tudo (fail-closed)', async () => {
    const { access } = setup(flagOn, { 'u-ADMIN': [] });
    expect(await access.ticketWhere(userOf(Role.ADMIN, 'org-a'))).toEqual(flagOn ? { id: ZERO } : {});
  });

  it('AGENT so com VIEW_OWN_TICKETS: so a flag ligada restringe aos proprios', async () => {
    const { access } = setup(flagOn, { 'u-AGENT': [K.TICKETS_OWN] });
    const where = await access.ticketWhere(userOf(Role.AGENT));
    if (flagOn) expect(where).toEqual({ requesterId: 'u-AGENT' });
    else expect(where).toEqual(TenantHelper.getTicketWhere(userOf(Role.AGENT)));
  });

  it('papel sem mapeamento e sem chaves e fail-closed nos dois modos', async () => {
    const { access } = setup(flagOn, {});
    expect(await access.ticketWhere({ id: 'spy', role: 'SPY' as Role, organizationId: 'org-a' })).toEqual({ id: ZERO });
  });
});

describe.each(modes)('ScopeAccess.ticketWhere (%s): vazamento entre organizacoes', (_label, flagOn) => {
  const desk = { agents: [], agentGroups: [], allowCrossDeskInteraction: false };
  const tickets = [
    { id: 't-a1', requesterId: 'cm-a', requester: { organizationId: 'org-a' }, serviceDesk: desk },
    { id: 't-a2', requesterId: 'c-a', requester: { organizationId: 'org-a' }, serviceDesk: desk },
    { id: 't-b1', requesterId: 'cm-b', requester: { organizationId: 'org-b' }, serviceDesk: desk },
    { id: 't-none', requesterId: 'c-x', requester: { organizationId: null }, serviceDesk: desk },
  ];
  const masterGroup = DEFAULT_PERMISSION_GROUPS[Role.CLIENT_MASTER].permissions;

  it('CLIENT_MASTER de A ve so os da organizacao A, nunca os de B nem os sem organizacao', async () => {
    const { access } = setup(flagOn, { 'cm-a': masterGroup });
    const where = await access.ticketWhere(userOf(Role.CLIENT_MASTER, 'org-a', 'cm-a'));
    expect(visible(tickets, where)).toEqual(['t-a1', 't-a2']);
  });

  it('CLIENT_MASTER de B ve so os de B', async () => {
    const { access } = setup(flagOn, { 'cm-b': masterGroup });
    const where = await access.ticketWhere(userOf(Role.CLIENT_MASTER, 'org-b', 'cm-b'));
    expect(visible(tickets, where)).toEqual(['t-b1']);
  });

  it('CLIENT_MASTER sem organizacao ve so os proprios (nunca os sem organizacao de terceiros)', async () => {
    for (const org of [null, undefined, '']) {
      const { access } = setup(flagOn, { 'c-x': masterGroup });
      const where = await access.ticketWhere(userOf(Role.CLIENT_MASTER, org, 'c-x'));
      expect(visible(tickets, where)).toEqual(['t-none']);
    }
  });

  it('CLIENT de A ve so os proprios, mesmo com a organizacao igual', async () => {
    const { access } = setup(flagOn, { 'c-a': DEFAULT_PERMISSION_GROUPS[Role.CLIENT].permissions });
    const where = await access.ticketWhere(userOf(Role.CLIENT, 'org-a', 'c-a'));
    expect(visible(tickets, where)).toEqual(['t-a2']);
  });
});

describe.each(modes)('ScopeAccess.ticketReadScope (%s): o que assertTicketVisibleTo barra', (_label, flagOn) => {
  const expectedByRole = (role: Role) => (role === Role.CLIENT ? 'own' : 'unrestricted');
  const cases = roles.flatMap((role) => orgs.map((org) => ({ role, org })));

  it.each(cases)('grupo padrao de $role, organizationId=$org: so CLIENT fica restrito aos proprios', async ({ role, org }) => {
    const { access } = setup(flagOn, defaults());
    expect(await access.ticketReadScope(userOf(role, org))).toBe(expectedByRole(role));
  });

  it('CLIENT_MASTER sem organizacao continua lendo (CARACTERIZACAO preservada, nao corrigida)', async () => {
    const { access } = setup(flagOn, defaults());
    expect(await access.ticketReadScope(userOf(Role.CLIENT_MASTER, null))).toBe('unrestricted');
  });

  it('AGENT sem vinculo a nenhuma mesa continua lendo (CARACTERIZACAO preservada, nao corrigida)', async () => {
    const { access } = setup(flagOn, defaults());
    expect(await access.ticketReadScope(userOf(Role.AGENT, undefined))).toBe('unrestricted');
  });

  it('ADMIN sem nenhuma chave: so a flag ligada nega tudo', async () => {
    const { access } = setup(flagOn, { 'u-ADMIN': [] });
    expect(await access.ticketReadScope(userOf(Role.ADMIN))).toBe(flagOn ? 'none' : 'unrestricted');
  });

  it('CLIENT com VIEW_ALL_TICKETS: so a flag ligada deixa de restringir', async () => {
    const { access } = setup(flagOn, { 'u-CLIENT': [K.TICKETS_OWN, K.TICKETS_ALL] });
    expect(await access.ticketReadScope(userOf(Role.CLIENT))).toBe(flagOn ? 'unrestricted' : 'own');
  });

  it('AGENT so com VIEW_OWN_TICKETS: so a flag ligada restringe aos proprios', async () => {
    const { access } = setup(flagOn, { 'u-AGENT': [K.TICKETS_OWN] });
    expect(await access.ticketReadScope(userOf(Role.AGENT))).toBe(flagOn ? 'own' : 'unrestricted');
  });

  it.each([K.TICKETS_ALL, K.TICKETS_ORGANIZATION, K.TICKETS_DESKS])(
    'uma chave ampla (%s) sozinha basta para nao restringir (flag ligada)',
    async (key) => {
      const { access } = setup(flagOn, { 'u-CLIENT': [key] });
      expect(await access.ticketReadScope(userOf(Role.CLIENT))).toBe(flagOn ? 'unrestricted' : 'own');
    },
  );
});

describe('ScopeAccess.isPermissionOnly', () => {
  it.each(modes)('%s: reflete a flag', (_label, flagOn) => {
    expect(setup(flagOn).access.isPermissionOnly()).toBe(flagOn);
  });
});
