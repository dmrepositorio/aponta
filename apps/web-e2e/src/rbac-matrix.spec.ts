import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { PrismaClient, Role, TicketStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHmac, randomUUID } from 'node:crypto';
import { linkFixtureUserToDefaultPermissionGroup } from './support/permission-groups';

/**
 * #589 (lote T1 do tracker #523): matriz de acesso por grupo padrao contra API + Postgres reais.
 *
 * Um usuario fixture por grupo padrao (Administrador, Gerente, Atendente, Cliente Master, Cliente) e uma
 * segunda organizacao (B) para provar vazamento. Cada linha da matriz faz a requisicao real com o token
 * do grupo e confere o status e, quando importa, o conteudo. A matriz e a de hoje.
 *
 * Dois modos, escolhidos por `E2E_RBAC_PERMISSION_ONLY` (o playwright.config.ts repassa
 * `FEATURE_RBAC_PERMISSION_ONLY=true` a API): desligado (padrao) e ligado ('1'). Com os grupos padrao a
 * matriz e a mesma nos dois modos; as unicas diferencas permitidas estao em
 * `DIFERENCAS_COM_A_FLAG_LIGADA` abaixo e no bloco "Cliente Master com a chave de comunicacao interna".
 *
 * Fixtures sinteticas: usuarios `@e2e.invalid` com JWT assinado no proprio spec, segredo de cofre fictício,
 * nada de dado de cliente. So roda com E2E_TESTING=true e banco em localhost.
 */
const PERMISSION_ONLY = process.env['E2E_RBAC_PERMISSION_ONLY'] === '1';

/**
 * Unica diferenca documentada entre os modos: Cliente Master que recebe a chave de comunicacao interna.
 * Desligada a flag, o perfil (nao CLIENT) basta para postar nota interna e ver o nome da equipe; ligada,
 * so valem POST_INTERNAL_NOTES e VIEW_TEAM_MEMBER_NAMES, que o grupo Cliente Master nao tem. Ligada, quem
 * tem VIEW_ADD_INTERNAL_COMMUNICATION le nota interna mesmo com perfil CLIENT (o perfil deixa de contar).
 */
const DIFERENCAS_COM_A_FLAG_LIGADA = {
  clienteMasterPostaNotaInterna: !PERMISSION_ONLY,
  clienteMasterVeNomeDaEquipe: !PERMISSION_ONLY,
  /** Ligada, quem tem a chave le a nota interna mesmo com o perfil CLIENT; desligada, o perfil CLIENT nunca le. */
  clienteComAChaveLeNotaInterna: PERMISSION_ONLY,
};

type Group = 'admin' | 'gerente' | 'atendente' | 'clienteMaster' | 'cliente';
const GROUPS: Group[] = ['admin', 'gerente', 'atendente', 'clienteMaster', 'cliente'];
const STAFF: Group[] = ['admin', 'gerente', 'atendente'];
const CLIENTS: Group[] = ['clienteMaster', 'cliente'];
const ROLE: Record<Group, Role> = {
  admin: Role.ADMIN,
  gerente: Role.AGENT_MASTER,
  atendente: Role.AGENT,
  clienteMaster: Role.CLIENT_MASTER,
  cliente: Role.CLIENT,
};

const SYNTHETIC_SECRET = 'segredo-sintetico-e2e-sem-valor-real';
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  admin: randomUUID(), gerente: randomUUID(), atendente: randomUUID(), clienteMaster: randomUUID(), cliente: randomUUID(),
  outsider: randomUUID(), // Cliente Master da organizacao B
  masterComm: randomUUID(), // Cliente Master A com a chave de comunicacao interna
  clientComm: randomUUID(), // Cliente A com a chave de comunicacao interna
  deskA: randomUUID(), deskB: randomUUID(),
  ticketA: randomUUID(), ticketA2: randomUUID(), ticketC: randomUUID(), ticketB: randomUUID(),
  contractA: randomUUID(), contractB: randomUUID(),
  folder: randomUUID(), credential: randomUUID(),
  commGroup: randomUUID(),
};
const suffix = ids.orgA.slice(0, 8);
const userIds = [ids.admin, ids.gerente, ids.atendente, ids.clienteMaster, ids.cliente, ids.outsider, ids.masterComm, ids.clientComm];

function tokenFor(secret: string, id: string, role: Role, organizationId?: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: id, email: `${id}@e2e.invalid`, role, organizationId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test.describe.configure({ mode: 'serial' });
test.describe(`RBAC: matriz de acesso por grupo padrao, flag ${PERMISSION_ONLY ? 'LIGADA' : 'desligada'} (API/Postgres reais)`, () => {
  test.use({ actionTimeout: 15000 });
  let prisma: PrismaClient;
  const bearer: Record<string, { Authorization: string }> = {};

  const send = async (request: APIRequestContext, who: string, method: string, url: string, data?: unknown) => {
    const response = await request.fetch(url, { method, headers: bearer[who], data });
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* corpo vazio ou nao JSON */ }
    return { status: response.status(), body, text };
  };
  const rows = (body: unknown): Array<Record<string, any>> => (Array.isArray(body) ? body : ((body as any)?.data ?? (body as any)?.items ?? []));
  const mine = (body: unknown, wanted: string[]) => rows(body).map((row) => row['id'] as string).filter((id) => wanted.includes(id));

  test.beforeAll(async () => {
    const connectionString = process.env['DATABASE_URL'];
    const secret = process.env['JWT_SECRET'];
    test.skip(process.env['E2E_TESTING'] !== 'true' || !connectionString || !secret, 'Requires explicit local E2E database and JWT secret');
    expect(['localhost', '127.0.0.1']).toContain(new URL(connectionString!).hostname);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: `Org A matriz ${suffix}` }, { id: ids.orgB, name: `Org B matriz ${suffix}` }] });
    const fixtures: Array<[string, Role, string | undefined]> = [
      [ids.admin, Role.ADMIN, undefined], [ids.gerente, Role.AGENT_MASTER, undefined], [ids.atendente, Role.AGENT, undefined],
      [ids.clienteMaster, Role.CLIENT_MASTER, ids.orgA], [ids.cliente, Role.CLIENT, ids.orgA],
      [ids.outsider, Role.CLIENT_MASTER, ids.orgB], [ids.masterComm, Role.CLIENT_MASTER, ids.orgA], [ids.clientComm, Role.CLIENT, ids.orgA],
    ];
    await prisma.user.createMany({ data: fixtures.map(([id, role, organizationId]) => ({ id, role, organizationId, name: `E2E matriz ${role} ${suffix}`, email: `${id}@e2e.invalid`, password: 'unused-jwt-fixture' })) });
    for (const [id, role, organizationId] of fixtures) {
      await linkFixtureUserToDefaultPermissionGroup(prisma, id, role);
      bearer[id] = { Authorization: `Bearer ${tokenFor(secret!, id, role, organizationId)}` };
    }
    for (const group of GROUPS) bearer[group] = bearer[ids[group]];
    bearer['outsider'] = bearer[ids.outsider];
    bearer['masterComm'] = bearer[ids.masterComm];
    bearer['clientComm'] = bearer[ids.clientComm];

    // Grupo extra (so a chave de comunicacao interna) para o bloco das diferencas entre os modos.
    await prisma.permissionGroup.create({ data: { id: ids.commGroup, name: `E2E comunicacao ${suffix}`, permissions: ['VIEW_ADD_INTERNAL_COMMUNICATION'] } });
    await prisma.permissionGroupUser.createMany({ data: [ids.masterComm, ids.clientComm].map((userId) => ({ permissionGroupId: ids.commGroup, userId })) });

    await prisma.serviceDesk.create({ data: { id: ids.deskA, name: `Mesa A matriz ${suffix}`, organizations: { connect: { id: ids.orgA } }, agents: { connect: [{ id: ids.atendente }, { id: ids.gerente }] } } });
    await prisma.serviceDesk.create({ data: { id: ids.deskB, name: `Mesa B matriz ${suffix}`, organizations: { connect: { id: ids.orgB } } } });
    const ticket = (id: string, title: string, requesterId: string, org: string, serviceDeskId: string, status: TicketStatus = TicketStatus.OPEN) =>
      prisma.ticket.create({ data: { id, protocol: `E2E-${id}`, title: `${title} ${suffix}`, description: 'Chamado sintetico da matriz', requesterId, commercialOrganizationId: org, serviceDeskId, status } });
    await ticket(ids.ticketA, 'Chamado A do Cliente', ids.cliente, ids.orgA, ids.deskA);
    await ticket(ids.ticketA2, 'Chamado A do Master', ids.clienteMaster, ids.orgA, ids.deskA);
    await ticket(ids.ticketC, 'Chamado A do Cliente comunicacao', ids.clientComm, ids.orgA, ids.deskA);
    await ticket(ids.ticketB, 'Chamado B', ids.outsider, ids.orgB, ids.deskB);

    // Contratos pela API real (termos e vigencia sao criados pelo servico, nao a mao).
    const admin = await playwrightRequest.newContext({ baseURL: test.info().project.use.baseURL, extraHTTPHeaders: bearer[ids.admin] });
    for (const [key, organizationId, serviceDeskId] of [['contractA', ids.orgA, ids.deskA], ['contractB', ids.orgB, ids.deskB]] as const) {
      const created = await admin.post('/api/contracts', { data: { organizationId, name: `Contrato matriz ${key} ${suffix}`, type: 'MONTHLY_HOURS', includedMinutes: 60, excessHourlyRateCents: 12000, monthlyFeeCents: 10000, approved: true, active: true, startsAt: '2026-10-01T03:00:00Z', serviceDeskIds: [serviceDeskId] } });
      expect(created.status(), await created.text()).toBe(201);
      ids[key] = (await created.json()).id;
    }
    await admin.dispose();

    await prisma.credentialFolder.create({ data: { id: ids.folder, name: `Pasta matriz ${suffix}`, organizationId: ids.orgA } });
    await prisma.credential.create({ data: { id: ids.credential, name: `Credencial matriz ${suffix}`, username: 'usuario-sintetico', password: SYNTHETIC_SECRET, organizationId: ids.orgA, folderId: ids.folder } });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    const tickets = { where: { serviceDeskId: { in: [ids.deskA, ids.deskB] } } };
    const ticketScope = { ticket: { serviceDeskId: { in: [ids.deskA, ids.deskB] } } };
    await prisma.comment.deleteMany({ where: ticketScope });
    await prisma.worklog.deleteMany({ where: ticketScope });
    await prisma.ticketAudit.deleteMany({ where: ticketScope });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ticket.deleteMany(tickets);
    await prisma.credentialAuditLog.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.credential.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.credentialFolder.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.contractTerm.deleteMany({ where: { contract: { organizationId: { in: [ids.orgA, ids.orgB] } } } });
    await prisma.contractLifecycleEvent.deleteMany({ where: { contract: { organizationId: { in: [ids.orgA, ids.orgB] } } } });
    await prisma.contract.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.serviceDesk.deleteMany({ where: { OR: [{ id: { in: [ids.deskA, ids.deskB] } }, { name: { endsWith: ` ${suffix}` } }] } });
    await prisma.permissionGroupUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.permissionGroup.deleteMany({ where: { id: ids.commGroup } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await prisma.$disconnect();
  });

  test('o servidor da API esta no modo pedido (a flag chega ao processo)', async ({ request }) => {
    const flags = await (await request.get('/api/feature-flags')).json();
    expect(flags['rbac-permission-only']).toBe(PERMISSION_ONLY);
  });

  test('/auth/me devolve o grupo e as chaves de cada grupo padrao', async ({ request }) => {
    const keys = {} as Record<Group, string[]>;
    for (const group of GROUPS) {
      const me = await send(request, group, 'GET', '/api/auth/me');
      expect(me.status, group).toBe(200);
      const body = me.body as { isAdmin: boolean; permissions: string[]; canViewTicketValues: boolean; role: Role };
      expect(body.role).toBe(ROLE[group]);
      expect(body.isAdmin).toBe(group === 'admin');
      keys[group] = body.permissions;
    }
    expect(keys.admin).toEqual([]); // ADMIN vale pelo bypass do guard, nunca pela lista
    expect(keys.gerente).toEqual(expect.arrayContaining(['VIEW_PASSWORD_VAULT', 'EDIT_TICKETS', 'MANAGE_SERVICE_DESKS']));
    expect(keys.gerente).not.toContain('MANAGE_USERS');
    expect(keys.atendente).toEqual(expect.arrayContaining(['VIEW_AND_OPEN_TICKETS', 'CREATE_EDIT_WORKLOGS', 'VIEW_PASSWORD_VAULT']));
    expect(keys.atendente).not.toEqual(expect.arrayContaining(['MANAGE_SERVICE_DESKS']));
    expect(keys.clienteMaster).toEqual(expect.arrayContaining(['ACCESS_CLIENT_PORTAL', 'VIEW_CONTRACTS_CLIENT', 'VIEW_ALL_CLIENT_TICKETS']));
    expect(keys.clienteMaster).not.toEqual(expect.arrayContaining(['VIEW_ADD_INTERNAL_COMMUNICATION', 'VIEW_PASSWORD_VAULT']));
    expect(keys.cliente).toEqual(expect.arrayContaining(['ACCESS_CLIENT_PORTAL', 'VIEW_OWN_TICKETS']));
    expect(keys.cliente).not.toContain('VIEW_ALL_CLIENT_TICKETS');
    // Os valores de tickets so valem pelo grupo explicito (fixtures ADMIN e CLIENT_MASTER entram nele).
    const flagsByGroup = await Promise.all(GROUPS.map(async (group) => [group, ((await send(request, group, 'GET', '/api/auth/me')).body as any).canViewTicketValues] as const));
    expect(Object.fromEntries(flagsByGroup)).toEqual({ admin: true, gerente: false, atendente: false, clienteMaster: true, cliente: false });
  });

  test.describe('chamados: listar, ver e isolamento entre organizacoes', () => {
    const seen = (group: string) => async ({ request }: { request: APIRequestContext }) => {
      const list = await send(request, group, 'GET', '/api/tickets');
      expect(list.status).toBe(200);
      return new Set(mine(list.body, [ids.ticketA, ids.ticketA2, ids.ticketB]));
    };

    test('listar: cada grupo ve so os chamados do seu escopo', async ({ request }) => {
      expect(await seen('admin')({ request })).toEqual(new Set([ids.ticketA, ids.ticketA2, ids.ticketB]));
      for (const group of ['gerente', 'atendente', 'clienteMaster'] as Group[]) {
        expect(await seen(group)({ request }), group).toEqual(new Set([ids.ticketA, ids.ticketA2]));
      }
      expect(await seen('cliente')({ request })).toEqual(new Set([ids.ticketA])); // so o proprio
      expect(await seen('outsider')({ request })).toEqual(new Set([ids.ticketB]));
    });

    test('ver um chamado: 200 no escopo, 404 fora dele; Cliente Master da org A nunca ve a org B e vice-versa', async ({ request }) => {
      const expected: Record<string, Record<string, number>> = {
        admin: { [ids.ticketA]: 200, [ids.ticketB]: 200 },
        gerente: { [ids.ticketA]: 200, [ids.ticketB]: 404 },
        atendente: { [ids.ticketA]: 200, [ids.ticketB]: 404 },
        clienteMaster: { [ids.ticketA]: 200, [ids.ticketA2]: 200, [ids.ticketB]: 404 },
        cliente: { [ids.ticketA]: 200, [ids.ticketA2]: 404, [ids.ticketB]: 404 },
        outsider: { [ids.ticketA]: 404, [ids.ticketA2]: 404, [ids.ticketB]: 200 },
      };
      for (const [who, byTicket] of Object.entries(expected)) {
        for (const [ticketId, status] of Object.entries(byTicket)) {
          expect((await send(request, who, 'GET', `/api/tickets/${ticketId}`)).status, `${who} -> ${ticketId}`).toBe(status);
        }
      }
    });

    test('criar chamado na mesa da propria organizacao: 201 para todos os grupos; o titulo volta como enviado', async ({ request }) => {
      for (const group of GROUPS) {
        const title = `Criado por ${group} ${suffix}`;
        const created = await send(request, group, 'POST', '/api/tickets', { title, description: 'Criado pela matriz', serviceDeskId: ids.deskA });
        expect(created.status, group).toBe(201);
        expect((created.body as any).title).toBe(title);
      }
      const own = await send(request, 'outsider', 'POST', '/api/tickets', { title: `Criado por outsider ${suffix}`, description: 'Criado pela matriz', serviceDeskId: ids.deskB });
      expect(own.status).toBe(201);
    });
  });

  test('comentar e ler comentarios: equipe 200/201; Cliente Master e Cliente 403 com os grupos padrao (sem nota interna nem nome da equipe)', async ({ request }) => {
    for (const group of STAFF) {
      const posted = await send(request, group, 'POST', `/api/tickets/${ids.ticketA}/comments`, { content: `Resposta publica de ${group}` });
      expect(posted.status, group).toBe(201);
      expect((posted.body as any).isInternal).toBe(false);
    }
    const note = await send(request, 'atendente', 'POST', `/api/tickets/${ids.ticketA}/comments`, { content: `Nota interna ${suffix}`, isInternal: true });
    expect(note.status).toBe(201);
    expect((note.body as any).isInternal).toBe(true);

    for (const group of STAFF) {
      const listed = await send(request, group, 'GET', `/api/tickets/${ids.ticketA}/comments`);
      expect(listed.status, group).toBe(200);
      const comments = listed.body as Array<{ content: string; isInternal: boolean; author: { name: string | null } | null }>;
      expect(comments.some((comment) => comment.isInternal && comment.content === `Nota interna ${suffix}`), group).toBe(true);
      expect(comments.every((comment) => comment.author?.name), `${group} ve o nome da equipe`).toBeTruthy();
    }
    for (const group of CLIENTS) {
      for (const [method, data] of [['GET', undefined], ['POST', { content: 'tentativa' }], ['POST', { content: 'tentativa interna', isInternal: true }]] as const) {
        const denied = await send(request, group, method, `/api/tickets/${ids.ticketA}/comments`, data);
        expect(denied.status, `${group} ${method}`).toBe(403);
        expect(denied.text).not.toContain(`Nota interna ${suffix}`);
      }
    }
    // Comentar no chamado de outra organizacao tambem nao passa (o Cliente Master da org B nao tem a chave).
    expect((await send(request, 'outsider', 'GET', `/api/tickets/${ids.ticketA}/comments`)).status).toBe(403);
  });

  test.describe('Cliente Master e Cliente com a chave de comunicacao interna (unica diferenca permitida entre os modos)', () => {
    test('nota interna e nome da equipe seguem a flag; o Cliente (perfil CLIENT) nunca ve nota interna nem nome', async ({ request }) => {
      const internal = `Nota da equipe para o master ${suffix}`;
      expect((await send(request, 'atendente', 'POST', `/api/tickets/${ids.ticketA2}/comments`, { content: internal, isInternal: true })).status).toBe(201);

      // Cliente Master: posta nota interna so com a flag desligada (perfil); ligada, o campo e forcado a false.
      const masterNote = await send(request, 'masterComm', 'POST', `/api/tickets/${ids.ticketA2}/comments`, { content: `Nota do master ${suffix}`, isInternal: true });
      expect(masterNote.status).toBe(201);
      expect((masterNote.body as any).isInternal).toBe(DIFERENCAS_COM_A_FLAG_LIGADA.clienteMasterPostaNotaInterna);

      const masterView = (await send(request, 'masterComm', 'GET', `/api/tickets/${ids.ticketA2}/comments`)).body as Array<{ content: string; author: { name: string | null; role: Role } | null }>;
      const fromTeam = masterView.filter((comment) => comment.author && comment.author.role !== Role.CLIENT_MASTER && comment.author.role !== Role.CLIENT);
      expect(fromTeam.length).toBeGreaterThan(0);
      for (const comment of fromTeam) expect(comment.author!.name !== null).toBe(DIFERENCAS_COM_A_FLAG_LIGADA.clienteMasterVeNomeDaEquipe);

      // Cliente (perfil CLIENT, dono do chamado C): nunca posta nota interna nem ve o nome da equipe; ler a nota
      // interna depende da flag (perfil desligada, chave ligada).
      expect((await send(request, 'atendente', 'POST', `/api/tickets/${ids.ticketC}/comments`, { content: `Nota interna C ${suffix}`, isInternal: true })).status).toBe(201);
      expect((await send(request, 'atendente', 'POST', `/api/tickets/${ids.ticketC}/comments`, { content: `Resposta publica C ${suffix}` })).status).toBe(201);
      const clientNote = await send(request, 'clientComm', 'POST', `/api/tickets/${ids.ticketC}/comments`, { content: `Nota do cliente ${suffix}`, isInternal: true });
      expect(clientNote.status).toBe(201);
      expect((clientNote.body as any).isInternal).toBe(false);
      const clientView = (await send(request, 'clientComm', 'GET', `/api/tickets/${ids.ticketC}/comments`)).body as Array<{ content: string; isInternal: boolean; author: { name: string | null; role: Role } | null }>;
      expect(clientView.some((comment) => comment.content === `Nota interna C ${suffix}`)).toBe(DIFERENCAS_COM_A_FLAG_LIGADA.clienteComAChaveLeNotaInterna);
      expect(clientView.some((comment) => comment.content === `Resposta publica C ${suffix}`)).toBe(true);
      for (const comment of clientView.filter((c) => c.author && c.author.role !== Role.CLIENT_MASTER && c.author.role !== Role.CLIENT)) expect(comment.author!.name).toBeNull();
    });
  });

  test('apontamentos: equipe lista (200) e lanca; Cliente Master e Cliente 403', async ({ request }) => {
    for (const group of STAFF) expect((await send(request, group, 'GET', `/api/tickets/${ids.ticketA}/worklogs`)).status, group).toBe(200);
    for (const group of CLIENTS) expect((await send(request, group, 'GET', `/api/tickets/${ids.ticketA}/worklogs`)).status, group).toBe(403);
    const logged = await send(request, 'atendente', 'POST', `/api/tickets/${ids.ticketA}/worklogs`, { startTime: '2026-10-16T12:00:00Z', endTime: '2026-10-16T13:00:00Z', description: 'Apontamento sintetico da matriz', contractId: ids.contractA, valuationType: 'CONTRACT' });
    expect(logged.status, logged.text).toBe(201);
    for (const group of CLIENTS) {
      const denied = await send(request, group, 'POST', `/api/tickets/${ids.ticketA}/worklogs`, { startTime: '2026-10-16T14:00:00Z', endTime: '2026-10-16T15:00:00Z', description: 'Tentativa do cliente' });
      expect(denied.status, group).toBe(403);
    }
    // O atendente lista sem valores (mascara); o admin ve o valor registrado.
    const asAgent = rows((await send(request, 'atendente', 'GET', `/api/tickets/${ids.ticketA}/worklogs`)).body);
    expect(asAgent.length).toBeGreaterThan(0);
    for (const row of asAgent) expect(row['valueCents']).toBeNull();
  });

  test('contratos: lista e detalhe por escopo, criacao so do Administrador, Cliente Master nunca ve a outra organizacao', async ({ request }) => {
    const visible = async (who: string) => mine((await send(request, who, 'GET', '/api/contracts')).body, [ids.contractA, ids.contractB]);
    expect(new Set(await visible('admin'))).toEqual(new Set([ids.contractA, ids.contractB]));
    for (const group of ['gerente', 'atendente', 'clienteMaster'] as Group[]) expect(await visible(group), group).toEqual([ids.contractA]);
    expect(await visible('outsider')).toEqual([ids.contractB]);
    expect((await send(request, 'cliente', 'GET', '/api/contracts')).status).toBe(403);

    expect((await send(request, 'clienteMaster', 'GET', `/api/contracts/${ids.contractB}`)).status).toBe(404);
    expect((await send(request, 'outsider', 'GET', `/api/contracts/${ids.contractA}`)).status).toBe(404);
    expect((await send(request, 'clienteMaster', 'GET', `/api/contracts/${ids.contractA}`)).status).toBe(200);
    expect((await send(request, 'atendente', 'GET', `/api/contracts/${ids.contractB}`)).status).toBe(404);

    const body = { organizationId: ids.orgA, name: `Contrato novo ${suffix}`, type: 'MONTHLY_HOURS', includedMinutes: 60, excessHourlyRateCents: 12000, monthlyFeeCents: 10000, approved: false, active: false, startsAt: '2026-10-01T03:00:00Z', serviceDeskIds: [] };
    for (const group of GROUPS.filter((group) => group !== 'admin')) {
      expect((await send(request, group, 'POST', '/api/contracts', body)).status, group).toBe(403);
    }
    const created = await send(request, 'admin', 'POST', '/api/contracts', body);
    expect(created.status, created.text).toBe(201);
    expect(await prisma.contract.count({ where: { name: body.name } })).toBe(1);
  });

  test('relatorios: faturamento so Administrador e Cliente Master (so da propria organizacao); resumo para todos', async ({ request }) => {
    const billing: Record<Group, number> = { admin: 200, gerente: 403, atendente: 403, clienteMaster: 200, cliente: 403 };
    for (const group of GROUPS) expect((await send(request, group, 'GET', '/api/reports/billing')).status, group).toBe(billing[group]);
    for (const group of GROUPS) expect((await send(request, group, 'GET', '/api/reports/summary')).status, group).toBe(200);
    expect((await send(request, 'gerente', 'GET', '/api/reports/response-time-comparison')).status).toBe(403);
    // Vazamento: o Cliente Master da org A pedindo o contrato da org B recebe lista vazia.
    const foreign = await send(request, 'clienteMaster', 'GET', `/api/reports/billing?contractId=${ids.contractB}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
  });

  test('cofre: equipe le e revela; so o Administrador gerencia e audita; o cliente nao entra; o segredo e sintetico', async ({ request }) => {
    for (const group of STAFF) {
      expect((await send(request, group, 'GET', '/api/vault/folders')).status, group).toBe(200);
      const listed = await send(request, group, 'GET', '/api/vault/credentials');
      expect(listed.status, group).toBe(200);
      expect(listed.text, `${group} nao recebe o segredo na lista`).not.toContain(SYNTHETIC_SECRET);
      const revealed = await send(request, group, 'POST', `/api/vault/credentials/${ids.credential}/reveal`, { field: 'password', intent: 'reveal' });
      expect(revealed.status, group).toBe(201);
      expect((revealed.body as any).value).toBe(SYNTHETIC_SECRET);
    }
    for (const group of CLIENTS) {
      for (const [method, url, data] of [
        ['GET', '/api/vault/folders'], ['GET', '/api/vault/credentials'], ['GET', '/api/vault/audit'],
        ['POST', `/api/vault/credentials/${ids.credential}/reveal`, { field: 'password', intent: 'reveal' }],
      ] as const) {
        const denied = await send(request, group, method, url, data);
        expect(denied.status, `${group} ${method} ${url}`).toBe(403);
        expect(denied.text).not.toContain(SYNTHETIC_SECRET);
      }
    }
    const audit: Record<Group, number> = { admin: 200, gerente: 403, atendente: 403, clienteMaster: 403, cliente: 403 };
    for (const group of GROUPS) expect((await send(request, group, 'GET', '/api/vault/audit')).status, group).toBe(audit[group]);
    for (const group of GROUPS.filter((group) => group !== 'admin')) {
      expect((await send(request, group, 'POST', '/api/vault/folders', { name: `Pasta ${group} ${suffix}` })).status, group).toBe(403);
      expect((await send(request, group, 'PATCH', `/api/vault/credentials/${ids.credential}`, { name: 'alterada' })).status, group).toBe(403);
    }
    expect((await send(request, 'admin', 'POST', '/api/vault/folders', { name: `Pasta admin ${suffix}` })).status).toBe(201);
    expect(await prisma.credential.findUniqueOrThrow({ where: { id: ids.credential } })).toMatchObject({ name: `Credencial matriz ${suffix}` });
  });

  test('mesas: a lista segue o escopo; criar e excluir exigem MANAGE_SERVICE_DESKS', async ({ request }) => {
    const desks = async (who: string) => mine((await send(request, who, 'GET', '/api/service-desks')).body, [ids.deskA, ids.deskB]);
    expect(new Set(await desks('admin'))).toEqual(new Set([ids.deskA, ids.deskB]));
    for (const group of ['gerente', 'atendente', 'clienteMaster', 'cliente'] as Group[]) expect(await desks(group), group).toEqual([ids.deskA]);
    expect(await desks('outsider')).toEqual([ids.deskB]);

    const manage: Record<Group, number> = { admin: 201, gerente: 201, atendente: 403, clienteMaster: 403, cliente: 403 };
    for (const group of GROUPS) {
      const created = await send(request, group, 'POST', '/api/service-desks', { name: `Mesa criada por ${group} ${suffix}` });
      expect(created.status, `${group}: ${created.text}`).toBe(manage[group]);
    }
    const stray = await prisma.serviceDesk.findFirstOrThrow({ where: { name: `Mesa criada por admin ${suffix}` } });
    expect((await send(request, 'atendente', 'DELETE', `/api/service-desks/${stray.id}`)).status).toBe(403);
    expect(await prisma.serviceDesk.count({ where: { id: stray.id } })).toBe(1);
  });

  test('usuarios: so o Administrador gerencia; a lista de atendentes e da equipe; ninguem inativa a si mesmo', async ({ request }) => {
    const manage: Record<Group, number> = { admin: 200, gerente: 403, atendente: 403, clienteMaster: 403, cliente: 403 };
    for (const group of GROUPS) expect((await send(request, group, 'GET', '/api/users')).status, group).toBe(manage[group]);
    const agents: Record<Group, number> = { admin: 200, gerente: 200, atendente: 200, clienteMaster: 403, cliente: 403 };
    for (const group of GROUPS) expect((await send(request, group, 'GET', '/api/users/agents')).status, group).toBe(agents[group]);
    for (const group of GROUPS.filter((group) => group !== 'admin')) {
      expect((await send(request, group, 'PATCH', `/api/users/${ids.cliente}/active`, { active: false })).status, group).toBe(403);
    }
    const self = await send(request, 'admin', 'PATCH', `/api/users/${ids.admin}/active`, { active: false });
    expect(self.status).toBe(409);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })).toMatchObject({ active: true });
  });

  test('grupos de permissao: so o Administrador gerencia; o grupo Administrador nao e excluido nem perde chave essencial', async ({ request }) => {
    for (const group of GROUPS.filter((group) => group !== 'admin')) {
      expect((await send(request, group, 'GET', '/api/permission-groups')).status, group).toBe(403);
    }
    const list = await send(request, 'admin', 'GET', '/api/permission-groups');
    expect(list.status).toBe(200);
    const adminGroup = rows(list.body).find((group) => group['defaultKey'] === 'default-admin')!;
    expect(adminGroup).toBeTruthy();

    const removed = (adminGroup['permissions'] as string[]).filter((key) => key !== 'MANAGE_USERS');
    const strip = await send(request, 'admin', 'PATCH', `/api/permission-groups/${adminGroup['id']}/permissions`, { permissions: removed });
    expect(strip.status, strip.text).toBe(409);
    expect(strip.text).toContain('MANAGE_USERS');
    expect((await send(request, 'admin', 'DELETE', `/api/permission-groups/${adminGroup['id']}`)).status).toBe(409);
    const after = await prisma.permissionGroup.findUniqueOrThrow({ where: { id: adminGroup['id'] } });
    expect(after.permissions).toContain('MANAGE_USERS');
  });

  test('status: allowedStatuses por grupo e quem libera PENDING_APPROVAL', async ({ request }) => {
    const open = async (who: string) => (await send(request, who, 'GET', `/api/tickets/${ids.ticketA}`)).body as { allowedStatuses?: string[] };
    for (const group of ['admin', 'gerente', 'atendente', 'clienteMaster'] as Group[]) {
      expect((await open(group)).allowedStatuses, group).toEqual(['IN_PROGRESS', 'ESCALATED']);
    }
    expect((await open('cliente')).allowedStatuses).toBeUndefined();

    // Um chamado em PENDING_APPROVAL por grupo: quem pode liberar o faz; os outros levam 403 e o status nao muda.
    const release: Record<Group, number> = { admin: 200, gerente: 200, atendente: 403, clienteMaster: 403, cliente: 403 };
    for (const group of GROUPS) {
      const id = randomUUID();
      await prisma.ticket.create({ data: { id, protocol: `E2E-${id}`, title: `Pendente ${group} ${suffix}`, description: 'Aguardando aprovacao', requesterId: ids.cliente, commercialOrganizationId: ids.orgA, serviceDeskId: ids.deskA, status: TicketStatus.PENDING_APPROVAL } });
      const moved = await send(request, group, 'PATCH', `/api/tickets/${id}/status`, { status: 'IN_PROGRESS' });
      expect(moved.status, `${group}: ${moved.text}`).toBe(release[group]);
      const status = (await prisma.ticket.findUniqueOrThrow({ where: { id } })).status;
      expect(status, group).toBe(release[group] === 200 ? TicketStatus.IN_PROGRESS : TicketStatus.PENDING_APPROVAL);
    }
    const pending = await prisma.ticket.findFirstOrThrow({ where: { title: `Pendente atendente ${suffix}` } });
    const asAgent = (await send(request, 'atendente', 'GET', `/api/tickets/${pending.id}`)).body as { allowedStatuses?: string[] };
    expect(asAgent.allowedStatuses).toEqual([]);
  });
  // ---------------------------------------------------------------------------------------------------
  // Tela real (Playwright UI): Configuracoes > Permissoes e menu/rotas por grupo.
  // ---------------------------------------------------------------------------------------------------
  const openAs = async (page: Page, who: string) => {
    const jwt = bearer[who].Authorization.replace('Bearer ', '');
    await page.addInitScript((token) => localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 })), jwt);
  };
  const openGroup = async (page: Page, name: string) => {
    await page.goto('/settings/permission-groups');
    await page.getByText(name, { exact: true }).click();
    await page.getByRole('tab', { name: 'Permissões' }).click();
  };
  const permissionBox = (page: Page, label: string) => page.getByLabel(label, { exact: true });

  test('tela de permissoes: marcar e desmarcar chaves, salvar, recarregar e conferir a persistencia', async ({ page }) => {
    test.setTimeout(120000);
    const name = `E2E tela matriz ${suffix}`;
    await prisma.permissionGroup.create({ data: { name, permissions: ['VIEW_AND_OPEN_TICKETS'] } });
    try {
      await openAs(page, 'admin');
      await openGroup(page, name);
      await expect(permissionBox(page, 'Visualizar e abrir tickets')).toBeChecked();
      await expect(permissionBox(page, 'Gerenciar usuários')).not.toBeChecked();

      await permissionBox(page, 'Gerenciar usuários').check();
      await permissionBox(page, 'Visualizar e abrir tickets').uncheck();
      const saved = page.waitForResponse((r) => r.url().includes('/permission-groups/') && r.url().endsWith('/permissions') && r.request().method() === 'PATCH');
      await page.getByRole('button', { name: 'Salvar permissões' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
      expect((await saved).status()).toBe(200);

      await page.reload();
      await page.getByText(name, { exact: true }).click();
      await page.getByRole('tab', { name: 'Permissões' }).click();
      await expect(permissionBox(page, 'Gerenciar usuários')).toBeChecked();
      await expect(permissionBox(page, 'Visualizar e abrir tickets')).not.toBeChecked();
      expect((await prisma.permissionGroup.findFirstOrThrow({ where: { name } })).permissions).toEqual(['MANAGE_USERS']);
    } finally {
      await prisma.permissionGroup.deleteMany({ where: { name } });
    }
  });

  test('tela de permissoes: o Administrador nao perde as proprias permissoes protegidas (mensagem de bloqueio)', async ({ page }) => {
    test.setTimeout(120000);
    await openAs(page, 'admin');
    await openGroup(page, 'Administrador');
    await expect(permissionBox(page, 'Gerenciar usuários')).toBeChecked();
    await permissionBox(page, 'Gerenciar usuários').uncheck();
    const blocked = page.waitForResponse((r) => r.url().includes('/permission-groups/') && r.url().endsWith('/permissions') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Salvar permissões' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    expect((await blocked).status()).toBe(409);
    await expect(page.getByText(/não pode perder as permissões essenciais/)).toBeVisible();

    await page.reload();
    await page.getByText('Administrador', { exact: true }).click();
    await page.getByRole('tab', { name: 'Permissões' }).click();
    await expect(permissionBox(page, 'Gerenciar usuários')).toBeChecked();
    const adminGroup = await prisma.permissionGroup.findFirstOrThrow({ where: { defaultKey: 'default-admin' } });
    expect(adminGroup.permissions).toContain('MANAGE_USERS');
  });

  test('menu e rotas por grupo: cada grupo ve so os itens do seu perfil e a tela de grupos e so do Administrador', async ({ page }) => {
    test.setTimeout(180000);
    const items = ['Dashboard', 'Clientes', 'Mesa', 'Contratos', 'Relatórios', 'Cofre de Senhas', 'Conhecimentos', 'Configurações'];
    const menu: Record<Group, string[]> = {
      admin: items,
      gerente: ['Dashboard', 'Contratos', 'Relatórios', 'Cofre de Senhas', 'Conhecimentos', 'Configurações'],
      atendente: ['Dashboard', 'Contratos', 'Relatórios', 'Cofre de Senhas', 'Conhecimentos', 'Configurações'],
      clienteMaster: ['Contratos', 'Relatórios', 'Conhecimentos', 'Configurações'],
      cliente: ['Conhecimentos', 'Configurações'],
    };
    for (const group of GROUPS) {
      const context = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL });
      const view = await context.newPage();
      try {
        await openAs(view, group);
        await view.goto('/');
        await expect(view.locator('nav').getByRole('button', { name: 'Tickets', exact: true })).toBeVisible();
        for (const item of items) {
          const entry = view.locator('nav').getByRole('button', { name: item, exact: true });
          if (menu[group].includes(item)) await expect(entry, `${group} ve ${item}`).toBeVisible();
          else await expect(entry, `${group} nao ve ${item}`).toHaveCount(0);
        }
        await view.goto('/settings/permission-groups');
        if (group === 'admin') await expect(view.getByText('Novo grupo')).toBeVisible();
        else await expect(view.getByText('Sem acesso a esta área')).toBeVisible();
      } finally {
        await context.close();
      }
    }
  });
});
