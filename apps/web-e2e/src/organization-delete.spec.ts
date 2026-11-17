import { test, expect } from '@playwright/test';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHmac, randomUUID } from 'node:crypto';

// DMTE-560 AC-15: banco real. O Prisma simulado dos testes unitários não prova as chaves
// estrangeiras nem o que sai em cascata; aqui a API e o Postgres são os de verdade (E2E isolado).
test.describe('excluir cliente (real API/Postgres)', () => {
  test('cliente sem vínculos é apagado com o que sai junto; cliente com vínculos é recusado e continua cadastrado', async ({ request }) => {
    test.setTimeout(120000);
    const connectionString = process.env['DATABASE_URL'];
    const secret = process.env['JWT_SECRET'];
    test.skip(process.env['E2E_TESTING'] !== 'true' || !connectionString || !secret, 'Requires explicit local E2E database and JWT secret');
    expect(['localhost', '127.0.0.1']).toContain(new URL(connectionString!).hostname);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const suffix = randomUUID();
    const ids = {
      admin: randomUUID(), agent: randomUUID(), requester: randomUUID(), agentGroup: randomUUID(), techGroup: randomUUID(), article: randomUUID(),
      free: randomUUID(), busy: randomUUID(), desk: randomUUID(), ticket: randomUUID(), contract: randomUUID(),
    };
    const token = () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: ids.admin, email: `${ids.admin}@e2e.invalid`, role: Role.ADMIN, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
      const signature = createHmac('sha256', secret!).update(`${header}.${payload}`).digest('base64url');
      return `${header}.${payload}.${signature}`;
    };
    const headers = { Authorization: `Bearer ${token()}` };
    try {
      await prisma.user.createMany({ data: [
        { id: ids.admin, role: Role.ADMIN }, { id: ids.agent, role: Role.AGENT },
      ].map((user) => ({ ...user, name: `E2E ${user.role}`, email: `${user.id}@e2e.invalid`, password: 'unused-jwt-fixture' })) });
      await prisma.organization.createMany({ data: [
        { id: ids.free, name: `Cliente Livre E2E ${suffix}` }, { id: ids.busy, name: `Cliente Com Vínculos E2E ${suffix}` },
      ] });
      await prisma.user.create({ data: { id: ids.requester, role: Role.CLIENT, organizationId: ids.busy, name: 'E2E CLIENT', email: `${ids.requester}@e2e.invalid`, password: 'unused-jwt-fixture' } });

      // Cliente livre: o que sai junto (endereço, contato, histórico de mesa) existe antes e some depois.
      await prisma.organizationAddress.create({ data: { organizationId: ids.free, street: 'Rua E2E', city: 'São Paulo', state: 'SP', zipCode: '01000000' } });
      await prisma.organizationContact.create({ data: { organizationId: ids.free, name: 'Contato E2E' } });
      await prisma.serviceDesk.create({ data: { id: ids.desk, name: `Mesa Excluir E2E ${suffix}`, agents: { connect: { id: ids.agent } } } });
      await prisma.organizationDeskEvent.create({ data: { organizationId: ids.free, serviceDeskId: ids.desk, linked: true } });
      // As demais cascatas: grupo de atendentes, vínculo com grupo técnico e compartilhamento de artigo.
      await prisma.agentGroup.create({ data: { id: ids.agentGroup, organizationId: ids.free, name: `Grupo E2E ${suffix}` } });
      await prisma.technicalGroup.create({ data: { id: ids.techGroup, name: `Grupo técnico E2E ${suffix}`, organizationLinks: { create: { organizationId: ids.free } } } });
      await prisma.article.create({ data: { id: ids.article, title: `Artigo E2E ${suffix}`, content: 'x', authorId: ids.admin, visibility: 'PRIVATE', allowedOrganizations: { connect: [{ id: ids.free }] } } });

      const check = await request.post('/api/organizations/deletion-check', { headers, data: { ids: [ids.free] } });
      expect(check.status(), await check.text()).toBe(201);
      expect(await check.json()).toMatchObject([{ id: ids.free, canDelete: true, blockers: [], cascade: { addresses: 1, contacts: 1, agentGroups: 1, technicalGroups: 1, sharedArticles: 1, deskEvents: 1 } }]);

      const removed = await request.delete(`/api/organizations/${ids.free}`, { headers });
      expect(removed.status(), await removed.text()).toBe(200);
      expect(await removed.json()).toEqual({ id: ids.free });
      expect(await prisma.organization.findUnique({ where: { id: ids.free } })).toBeNull();
      expect(await prisma.organizationAddress.count({ where: { organizationId: ids.free } })).toBe(0);
      expect(await prisma.organizationContact.count({ where: { organizationId: ids.free } })).toBe(0);
      expect(await prisma.organizationDeskEvent.count({ where: { organizationId: ids.free } })).toBe(0);
      expect(await prisma.agentGroup.count({ where: { id: ids.agentGroup } })).toBe(0);
      expect(await prisma.technicalGroupOrganization.count({ where: { organizationId: ids.free } })).toBe(0);
      expect(await prisma.technicalGroup.count({ where: { id: ids.techGroup } })).toBe(1); // o grupo técnico em si fica; só o vínculo sai
      expect(await prisma.article.count({ where: { id: ids.article, allowedOrganizations: { some: { id: ids.free } } } })).toBe(0);
      expect(await prisma.article.count({ where: { id: ids.article } })).toBe(1); // o artigo fica; só o compartilhamento sai
      const list = await request.get('/api/organizations', { headers });
      expect((await list.json()).map((o: { id: string }) => o.id)).not.toContain(ids.free);

      // Cliente com mesa, ticket, contrato, usuário, cofre e agenda: recusado, e nada é apagado.
      await prisma.serviceDesk.update({ where: { id: ids.desk }, data: { organizations: { connect: { id: ids.busy } } } });
      await prisma.ticket.create({ data: {
        id: ids.ticket, protocol: `E2E-DEL-${suffix}`, title: `Ticket excluir cliente ${suffix}`, description: 'Vínculo forte',
        requesterId: ids.requester, commercialOrganizationId: ids.busy, serviceDeskId: ids.desk,
      } });
      await prisma.contract.create({ data: { id: ids.contract, organizationId: ids.busy, name: `Contrato E2E ${suffix}`, active: false } });
      await prisma.credential.create({ data: { organizationId: ids.busy, name: 'Credencial E2E', password: 'unused' } });
      await prisma.appointment.create({ data: { title: 'Visita E2E', startTime: new Date('2026-11-20T12:00:00Z'), endTime: new Date('2026-11-20T13:00:00Z'), userId: ids.agent, organizationId: ids.busy } });

      const busyCheck = await request.post('/api/organizations/deletion-check', { headers, data: { ids: [ids.busy] } });
      expect(busyCheck.status(), await busyCheck.text()).toBe(201);
      const [entry] = await busyCheck.json();
      expect(entry.canDelete).toBe(false);
      expect(entry.blockers.map((b: { code: string }) => b.code).sort()).toEqual(['APPOINTMENTS', 'CONTRACTS', 'SERVICE_DESKS', 'TICKETS', 'USERS', 'VAULT']);

      const refused = await request.delete(`/api/organizations/${ids.busy}`, { headers });
      expect(refused.status(), await refused.text()).toBe(409);
      expect((await refused.json()).blockers.map((b: { code: string }) => b.code).sort()).toEqual(['APPOINTMENTS', 'CONTRACTS', 'SERVICE_DESKS', 'TICKETS', 'USERS', 'VAULT']);
      expect(await prisma.organization.findUnique({ where: { id: ids.busy } })).not.toBeNull();
    } finally {
      await prisma.article.deleteMany({ where: { id: ids.article } });
      await prisma.technicalGroup.deleteMany({ where: { id: ids.techGroup } });
      await prisma.agentGroup.deleteMany({ where: { id: ids.agentGroup } });
      await prisma.appointment.deleteMany({ where: { userId: ids.agent } });
      await prisma.credential.deleteMany({ where: { organizationId: ids.busy } });
      await prisma.ticket.deleteMany({ where: { id: ids.ticket } });
      await prisma.contract.deleteMany({ where: { id: ids.contract } });
      await prisma.organizationDeskEvent.deleteMany({ where: { organizationId: { in: [ids.free, ids.busy] } } });
      await prisma.serviceDesk.deleteMany({ where: { id: ids.desk } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.agent, ids.requester] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ids.free, ids.busy] } } });
      await prisma.$disconnect();
    }
  });
});
