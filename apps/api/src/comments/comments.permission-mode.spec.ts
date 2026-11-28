import { Role } from '@prisma/client';
import { CommentsService } from './comments.service';
import { MaskAccess } from './mask-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2c (#547): CommentsService nos dois modos da flag `rbac-permission-only`.
 * Com os grupos padrão o resultado ligado é igual ao desligado (matriz da Fase 0),
 * salvo a mudança aprovada pelo dono: CLIENT_MASTER sem nota interna nem nome da equipe.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const user = (role: Role) => ({ id: `u-${role}`, role });
const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));

const setup = (flagOn: boolean, grants: Record<string, string[]> = defaultGrants()) => {
  const prisma: any = {
    // O chamado é do próprio CLIENT: a matriz inteira passa pelo escopo, que segue por perfil.
    ticket: { findUnique: jest.fn(async () => ({ id: 't1', requesterId: 'u-CLIENT', serviceDesk: null })) },
    comment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'c1', ...data, author: { email: 'a@x' } })),
      findMany: jest.fn(async () => [
        { id: 'k1', author: { id: 'u-a', name: 'Adm', role: Role.ADMIN } },
        { id: 'k2', author: { id: 'u-b', name: 'Cli', role: Role.CLIENT } },
      ]),
    },
  };
  const permissions = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
  const access = new MaskAccess({ isRbacPermissionOnly: () => flagOn } as any, permissions as any);
  return { prisma, permissions, service: new CommentsService(prisma, { emit: jest.fn() } as any, access) };
};

describe.each(modes)('comentários com grupos padrão: %s', (_label, flagOn) => {
  // Intencional: CLIENT_MASTER perde nota interna e nome da equipe só com a flag ligada.
  const seesTeamSide = (role: Role) => (role === Role.CLIENT_MASTER ? !flagOn : role !== Role.CLIENT);

  it.each(roles)('%s pedindo isInternal=true grava o esperado', async (role) => {
    const { service, prisma } = setup(flagOn);
    await service.create('t1', { content: 'n', isInternal: true }, user(role));
    expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(seesTeamSide(role));
  });

  it.each(roles)('%s sem isInternal grava comentário público', async (role) => {
    const { service, prisma } = setup(flagOn);
    await service.create('t1', { content: 'n' }, user(role));
    expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(false);
  });

  it.each(roles)('%s: filtro de notas internas na consulta', async (role) => {
    const { service, prisma } = setup(flagOn);
    await service.findByTicket('t1', user(role));
    const where = prisma.comment.findMany.mock.calls[0][0].where;
    expect(where).toEqual(seesTeamSide(role) ? { ticketId: 't1' } : { ticketId: 't1', isInternal: false });
  });

  it.each(roles)('%s: nome do autor da equipe', async (role) => {
    const { service } = setup(flagOn);
    const [teamAuthor, clientAuthor] = await service.findByTicket('t1', user(role));
    expect(teamAuthor.author).toEqual({ id: 'u-a', name: seesTeamSide(role) ? 'Adm' : null, role: Role.ADMIN });
    expect(clientAuthor.author?.name).toBe('Cli');
  });
});

describe('comentários com flag ligada: só a permissão decide', () => {
  it('grupo sem POST_INTERNAL_NOTES não grava nota interna, mesmo sendo AGENT', async () => {
    const { service, prisma } = setup(true, { 'u-AGENT': ['VIEW_ADD_INTERNAL_COMMUNICATION'] });
    await service.create('t1', { content: 'n', isInternal: true }, user(Role.AGENT));
    expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(false);
  });

  it('grupo de cliente com POST_INTERNAL_NOTES grava nota interna', async () => {
    const { service, prisma } = setup(true, { 'u-CLIENT': ['POST_INTERNAL_NOTES'] });
    await service.create('t1', { content: 'n', isInternal: true }, user(Role.CLIENT));
    expect(prisma.comment.create.mock.calls[0][0].data.isInternal).toBe(true);
  });

  it('grupo sem VIEW_ADD_INTERNAL_COMMUNICATION não lê nota interna, mesmo sendo ADMIN', async () => {
    const { service, prisma } = setup(true, { 'u-ADMIN': ['VIEW_TEAM_MEMBER_NAMES'] });
    await service.findByTicket('t1', user(Role.ADMIN));
    expect(prisma.comment.findMany.mock.calls[0][0].where).toEqual({ ticketId: 't1', isInternal: false });
  });

  it('grupo sem VIEW_TEAM_MEMBER_NAMES não vê o nome da equipe, mesmo sendo AGENT', async () => {
    const { service } = setup(true, { 'u-AGENT': ['VIEW_ADD_INTERNAL_COMMUNICATION'] });
    const [teamAuthor] = await service.findByTicket('t1', user(Role.AGENT));
    expect(teamAuthor.author?.name).toBeNull();
  });

  it('comentário público não consulta a permissão de nota interna', async () => {
    const { service, permissions } = setup(true);
    await service.create('t1', { content: 'n' }, user(Role.AGENT));
    expect(permissions.hasPermission).not.toHaveBeenCalled();
  });

  it('o escopo do chamado segue por perfil: CLIENT em chamado alheio continua com NotFound', async () => {
    const { service, prisma } = setup(true);
    prisma.ticket.findUnique.mockResolvedValue({ id: 't1', requesterId: 'outro', serviceDesk: null });
    await expect(service.findByTicket('t1', user(Role.CLIENT))).rejects.toThrow('not found');
  });
});
