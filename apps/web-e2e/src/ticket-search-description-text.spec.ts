import { test, expect } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHmac, randomUUID } from 'node:crypto';
import { linkFixtureUserToDefaultPermissionGroup } from './support/permission-groups';

/**
 * GH-370 T3: GET /api/tickets?search= casa título, protocolo e o texto visível
 * derivado (`descriptionText`), nunca nome de tag ou de atributo; a linha ainda
 * sem texto derivado cai na descrição crua; o escopo de tenant e de mesa não
 * afrouxa; a coluna nunca volta na resposta. Banco real, fixtures sintéticas,
 * só em banco local/descartável.
 */
test('search matches descriptionText, falls back for rows without it and keeps tenant scope (real Postgres)', async ({
  request,
}) => {
  test.setTimeout(120000);
  const connectionString = process.env['DATABASE_URL'];
  const secret = process.env['JWT_SECRET'];
  test.skip(
    process.env['E2E_TESTING'] !== 'true' || !connectionString || !secret,
    'Explicit local test database required',
  );
  expect(['localhost', '127.0.0.1']).toContain(new URL(connectionString!).hostname);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const id = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    deskX: randomUUID(),
    deskY: randomUUID(),
    deskZ: randomUUID(),
    admin: randomUUID(),
    agentX: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    clientLit: randomUUID(),
    clientPuro: randomUUID(),
    tickets: {
      erro: randomUUID(),
      rd: randomUUID(),
      literais: randomUUID(),
      puro: randomUUID(),
      legado: randomUUID(),
      outroCliente: randomUUID(),
    },
  };
  const token = (userId: string, role: Role) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        email: `${userId}@e2e.invalid`,
        role,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');
    return `${header}.${payload}.${createHmac('sha256', secret!).update(`${header}.${payload}`).digest('base64url')}`;
  };
  const as = (userId: string, role: Role) => ({ Authorization: `Bearer ${token(userId, role)}` });
  const admin = as(id.admin, Role.ADMIN);
  const agentX = as(id.agentX, Role.AGENT);
  const clientA = as(id.clientA, Role.CLIENT);
  const clientB = as(id.clientB, Role.CLIENT);
  const mine = new Set<string>(Object.values(id.tickets));

  /**
   * Ids das minhas fixtures devolvidos pelo filtro `param`; confere que a coluna não vaza.
   * `deskId` escopa a busca à mesa do fixture: o admin enxerga o banco inteiro e o
   * `limit=100` podia deixar as minhas linhas fora da página.
   */
  async function filter(
    headers: Record<string, string>,
    param: string,
    term: string,
    deskId?: string,
  ): Promise<string[]> {
    const scope = deskId ? `&serviceDeskId=${deskId}` : '';
    const response = await request.get(`/api/tickets?limit=100${scope}&${param}=${encodeURIComponent(term)}`, {
      headers,
    });
    expect(response.status(), `${param}=${term}`).toBe(200);
    const body = await response.json();
    for (const row of body.data) expect(row).not.toHaveProperty('descriptionText');
    return body.data.map((row: { id: string }) => row.id).filter((ticketId: string) => mine.has(ticketId));
  }

  const search = (headers: Record<string, string>, term: string, deskId?: string) =>
    filter(headers, 'search', term, deskId);
  /** Busca global do admin, sempre escopada à mesa X do fixture. */
  const adminSearch = (term: string) => search(admin, term, id.deskX);

  try {
    await db.organization.createMany({
      data: [
        { id: id.orgA, name: `Busca A ${id.orgA}` },
        { id: id.orgB, name: `Busca B ${id.orgB}` },
      ],
    });
    await db.user.createMany({
      data: [
        { id: id.admin, role: Role.ADMIN },
        { id: id.agentX, role: Role.AGENT },
        { id: id.clientA, role: Role.CLIENT, organizationId: id.orgA },
        { id: id.clientB, role: Role.CLIENT, organizationId: id.orgB },
        { id: id.clientLit, role: Role.CLIENT, organizationId: id.orgA },
        { id: id.clientPuro, role: Role.CLIENT, organizationId: id.orgA },
      ].map((user) => ({
        ...user,
        name:
          user.id === id.clientLit
            ? `Lit 100% ok_agora C:${String.fromCharCode(92)}dir`
            : user.id === id.clientPuro
              ? 'Puro 100% ok'
              : `Busca ${user.role}`,
        email: `${user.id}@e2e.invalid`,
        password: 'unused-jwt-fixture',
      })),
    });
    for (const [userId, role] of [
      [id.admin, Role.ADMIN],
      [id.agentX, Role.AGENT],
      [id.clientA, Role.CLIENT],
      [id.clientB, Role.CLIENT],
      [id.clientLit, Role.CLIENT],
      [id.clientPuro, Role.CLIENT],
    ] as const) {
      await linkFixtureUserToDefaultPermissionGroup(db, userId, role);
    }
    await db.serviceDesk.create({
      data: {
        id: id.deskX,
        name: `Busca X ${id.deskX}`,
        agents: { connect: { id: id.agentX } },
        organizations: { connect: { id: id.orgA } },
      },
    });
    await db.serviceDesk.create({
      data: { id: id.deskY, name: `Busca Y ${id.deskY}`, organizations: { connect: { id: id.orgB } } },
    });
    // Mesa só do ticket com `%` e sem barra invertida (GH-386): fica fora das buscas da mesa X.
    await db.serviceDesk.create({
      data: { id: id.deskZ, name: `Busca Z ${id.deskZ}`, organizations: { connect: { id: id.orgA } } },
    });

    const ticket = (
      key: keyof typeof id.tickets,
      requesterId: string,
      serviceDeskId: string,
      title: string,
      description: string,
      descriptionText: string | null,
      protocol = `E2E-${id.tickets[key]}`,
    ) =>
      db.ticket.create({
        data: {
          id: id.tickets[key],
          protocol,
          title,
          description,
          descriptionText,
          requesterId,
          serviceDeskId,
        },
      });
    const backslash = String.fromCharCode(92);
    await ticket('erro', id.clientA, id.deskX, 'Chamado alfa', '<p><strong>Erro</strong> na nota fiscal</p>', 'Erro na nota fiscal');
    await ticket(
      'rd',
      id.clientA,
      id.deskX,
      'Chamado beta',
      '<div>R&amp;D <a href="https://exemplo.test/x">link</a></div>',
      'R&D link',
    );
    // Curingas literais no texto, no título, no protocolo e no nome do solicitante.
    await ticket(
      'literais',
      id.clientLit,
      id.deskX,
      `Chamado gama 100% ok_agora C:${backslash}dir`,
      `<p>100% ok_agora C:${backslash}dir</p>`,
      `100% ok_agora C:${backslash}dir`,
      `E2E-%_${backslash}-${id.tickets.literais}`,
    );
    // `%` em título, protocolo e solicitante, mas SEM barra invertida.
    await ticket(
      'puro',
      id.clientPuro,
      id.deskZ,
      '100% puro',
      '<p>100% puro</p>',
      '100% puro',
      `E2E-%-${id.tickets.puro}`,
    );
    // Linha antiga, sem texto derivado: cai na descrição crua.
    await ticket('legado', id.clientA, id.deskX, 'Chamado delta', '<p>legado ANTIGO</p>', null);
    await ticket(
      'outroCliente',
      id.clientB,
      id.deskY,
      'Chamado outro',
      '<p>segredo-do-cliente-b</p>',
      'segredo-do-cliente-b',
    );
    const t = id.tickets;

    // AC-09: texto real casa, caixa não importa, entidade decodificada.
    expect(await adminSearch('Erro')).toEqual([t.erro]);
    expect(await adminSearch('erro')).toEqual([t.erro]);
    expect(await adminSearch('ERRO')).toEqual([t.erro]);
    expect(await adminSearch('R&D')).toEqual([t.rd]);
    // AC-09: nome de tag e de atributo não casam.
    for (const term of ['strong', 'div', 'href']) {
      expect(await adminSearch(term), term).toEqual([]);
    }
    const byP = await adminSearch('p');
    expect(byP).not.toContain(t.erro);
    expect(byP).not.toContain(t.rd);
    // Título e protocolo como antes.
    expect(await adminSearch('Chamado alfa')).toEqual([t.erro]);
    expect(await adminSearch(`E2E-${t.rd}`)).toEqual([t.rd]);
    // AC-08: linha sem texto derivado continua achável pela descrição crua.
    expect(await adminSearch('legado')).toEqual([t.legado]);
    // AC-10: %, _ e barra invertida são literais; injeção não quebra nem traz tudo.
    expect(await adminSearch('%')).toEqual([t.literais]);
    expect(await adminSearch('_')).toEqual([t.literais]);
    expect(await adminSearch(backslash)).toEqual([t.literais]);
    expect(await adminSearch("' OR 1=1 --")).toEqual([]);

    // GH-386: number, titleContains e requesterQuery também tratam %, _ e barra invertida como literais.
    for (const param of ['number', 'titleContains', 'requesterQuery']) {
      for (const term of ['%', '_', backslash]) {
        expect(await filter(admin, param, term, id.deskX), `${param}=${term}`).toEqual([t.literais]);
      }
      // Barra invertida literal: o ticket com `%` e sem barra invertida não pode aparecer. Sem escape
      // o padrão `%\%` viraria "contém %" e traria o `puro` (e a barra passaria sem ser provada).
      expect(await filter(admin, param, '%', id.deskZ), `${param}=% (fixture puro)`).toEqual([t.puro]);
      expect(await filter(admin, param, backslash, id.deskZ), `${param}=barra sem puro`).toEqual([]);
      expect(await filter(admin, param, "' OR 1=1 --", id.deskX), `${param} injeção`).toEqual([]);
      expect(await filter(admin, param, '100% OK_AGORA', id.deskX), `${param} caixa`).toEqual(
        param === 'number' ? [] : [t.literais],
      );
    }

    // AC-11: cliente A não acha termo do cliente B; o dono acha; o atendente de outra mesa não.
    expect(await search(clientA, 'segredo-do-cliente-b')).toEqual([]);
    expect(await search(clientB, 'segredo-do-cliente-b')).toEqual([t.outroCliente]);
    expect(await search(agentX, 'segredo-do-cliente-b')).toEqual([]);
    expect(await search(agentX, 'Erro')).toEqual([t.erro]);
    expect(await search(clientA, 'Erro')).toEqual([t.erro]);
    expect(await search(clientB, 'Erro')).toEqual([]);

    // AC-12: o detalhe também não expõe a coluna.
    const detail = await request.get(`/api/tickets/${t.erro}`, { headers: admin });
    expect(detail.status()).toBe(200);
    expect(await detail.json()).not.toHaveProperty('descriptionText');
  } finally {
    await db.ticket.deleteMany({ where: { id: { in: [...mine] } } });
    await db.serviceDesk.deleteMany({ where: { id: { in: [id.deskX, id.deskY, id.deskZ] } } });
    await db.permissionGroupUser.deleteMany({
      where: { userId: { in: [id.admin, id.agentX, id.clientA, id.clientB, id.clientLit, id.clientPuro] } },
    });
    await db.user.deleteMany({ where: { id: { in: [id.admin, id.agentX, id.clientA, id.clientB, id.clientLit, id.clientPuro] } } });
    await db.organization.deleteMany({ where: { id: { in: [id.orgA, id.orgB] } } });
    await db.$disconnect();
  }
});
