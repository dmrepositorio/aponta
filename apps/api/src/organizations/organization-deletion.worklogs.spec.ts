import { Role } from '@prisma/client';
import { checkOrganizationDeletion } from './organization-deletion';

/**
 * Lote 2a2 (#542), tracker #523: apontamento de outro autor no ticket do cliente.
 * Quem chama resolve a permissão DELETE_ANY_WORKLOG (por perfil com a flag desligada,
 * por permissão com ela ligada) e entrega em `mayRemoveAnyWorklog`; sem esse campo
 * vale o comportamento de hoje (só o ADMIN).
 */
const ZERO = { addresses: 0, contacts: 0, agentGroups: 0, technicalGroupLinks: 0, articlesSharedWith: 0, deskEvents: 0, serviceDesks: 0, contracts: 0, users: 0, credentials: 0, credentialFolders: 0, appointments: 0 };

const dbWith = (worklogAuthor: string) =>
  ({
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'org', name: 'Cliente', _count: ZERO, serviceDesks: [], contracts: [], users: [], credentials: [], credentialFolders: [], appointments: [],
      }),
    },
    ticket: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 't1', protocol: 'DMTE-1', requester: { organizationId: null },
          worklogs: [{ authorId: worklogAuthor, voidedAt: null }], preAppointments: [], _count: { subTickets: 0 },
        },
      ]),
    },
  }) as never;

const tickets = async (user: { id: string; role: Role; mayRemoveAnyWorklog?: boolean }) =>
  (await checkOrganizationDeletion(dbWith('other'), 'org', true, user)).blockers.find((blocker) => blocker.code === 'TICKETS');

describe('checkOrganizationDeletion: remover apontamento alheio', () => {
  it('com a permissão resolvida pelo chamador, qualquer perfil resolve o bloqueio', async () => {
    expect((await tickets({ id: 'u', role: Role.AGENT, mayRemoveAnyWorklog: true }))?.resolvable).toBe(true);
  });

  it('sem a permissão resolvida, nem o perfil ADMIN resolve o bloqueio, e o motivo cita o autor', async () => {
    const blocker = await tickets({ id: 'u', role: Role.ADMIN, mayRemoveAnyWorklog: false });
    expect(blocker?.resolvable).toBe(false);
    expect(blocker?.items[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('outro usuário')]));
  });

  it('sem o campo, vale o comportamento de hoje: ADMIN resolve, os demais não', async () => {
    expect((await tickets({ id: 'u', role: Role.ADMIN }))?.resolvable).toBe(true);
    expect((await tickets({ id: 'u', role: Role.AGENT_MASTER }))?.resolvable).toBe(false);
  });

  it('o autor dos apontamentos resolve sem a permissão', async () => {
    const check = await checkOrganizationDeletion(dbWith('u'), 'org', true, { id: 'u', role: Role.AGENT, mayRemoveAnyWorklog: false });
    expect(check.blockers.find((blocker) => blocker.code === 'TICKETS')?.resolvable).toBe(true);
  });

  it('sem usuário, nenhum apontamento conta como removível', async () => {
    const check = await checkOrganizationDeletion(dbWith('u'), 'org', true);
    expect(check.blockers.find((blocker) => blocker.code === 'TICKETS')?.resolvable).toBe(false);
  });
});
