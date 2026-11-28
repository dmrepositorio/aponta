import { ForbiddenException } from '@nestjs/common';
import { ArticleVisibility, Role } from '@prisma/client';
import { ArticleAccess } from './article-access';
import { ArticlesService } from './articles.service';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a5 (#545): artigos nos dois modos da flag `rbac-permission-only`. Com os grupos
 * padrao o resultado ligado e igual ao desligado (matriz da Fase 0); com grupos
 * customizados so a flag ligada segue as permissoes. Edicao de artigo alheio
 * segue por perfil (lacuna #566).
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const actors = {
  [Role.ADMIN]: { id: 'u-ADMIN', role: Role.ADMIN },
  [Role.AGENT_MASTER]: { id: 'u-AGENT_MASTER', role: Role.AGENT_MASTER },
  [Role.AGENT]: { id: 'u-AGENT', role: Role.AGENT },
  [Role.CLIENT_MASTER]: { id: 'u-CLIENT_MASTER', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
  [Role.CLIENT]: { id: 'u-CLIENT', role: Role.CLIENT, organizationId: 'org-1' },
} as const;

const setup = (flagOn: boolean, grants: Record<string, string[]>) => {
  const prisma: any = {
    article: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'a1', authorId: 'u-autor', attachments: [] }),
      update: jest.fn().mockResolvedValue({ id: 'a1' }),
      delete: jest.fn().mockResolvedValue({ id: 'a1' }),
    },
  };
  const permissions = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
  const access = new ArticleAccess({ isRbacPermissionOnly: () => flagOn } as any, permissions as any);
  return { prisma, service: new ArticlesService(prisma, access) };
};

const defaultGrants = () => Object.fromEntries(roles.map((r) => [`u-${r}`, DEFAULT_PERMISSION_GROUPS[r].permissions]));
const filtered = (id: string, orgId?: string) => ({
  OR: [
    { visibility: ArticleVisibility.PUBLIC },
    {
      visibility: ArticleVisibility.PRIVATE,
      OR: [
        { authorId: id },
        { allowedAgentGroups: { some: { members: { some: { id } } } } },
        ...(orgId ? [{ allowedOrganizations: { some: { id: orgId } } }] : []),
      ],
    },
  ],
});

describe.each(modes)('artigos com grupos padrao: %s', (_label, flagOn) => {
  it.each(roles)('%s: so ADMIN le tudo sem filtro de visibilidade', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    await service.findAll(actors[role]);
    await service.findOne('a1', actors[role]);
    const user = actors[role];
    const orgId = 'organizationId' in user ? user.organizationId : undefined;
    if (role === Role.ADMIN) {
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({});
      expect(prisma.article.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1' });
    } else {
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual(filtered(user.id, orgId));
      expect(prisma.article.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1', ...filtered(user.id, orgId) });
    }
  });

  it('anonimo: so PUBLIC', async () => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    await service.findAll(undefined);
    expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({ OR: [{ visibility: ArticleVisibility.PUBLIC }] });
  });

  it.each(roles)('%s que nao e autor: so ADMIN edita e exclui (os demais 403)', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    if (role === Role.ADMIN) {
      await service.update('a1', { title: 'X' } as any, actors[role]);
      await service.remove('a1', actors[role]);
      expect(prisma.article.update).toHaveBeenCalledTimes(1);
      expect(prisma.article.delete).toHaveBeenCalledTimes(1);
    } else {
      await expect(service.update('a1', { title: 'X' } as any, actors[role])).rejects.toThrow(ForbiddenException);
      await expect(service.remove('a1', actors[role])).rejects.toThrow(ForbiddenException);
      expect(prisma.article.update).not.toHaveBeenCalled();
      expect(prisma.article.delete).not.toHaveBeenCalled();
    }
  });

  it.each([Role.AGENT_MASTER, Role.AGENT] as const)('%s autor: edita e exclui o proprio artigo', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    prisma.article.findUnique.mockResolvedValue({ id: 'a1', authorId: actors[role].id, attachments: [] });
    await service.update('a1', { title: 'X' } as any, actors[role]);
    await service.remove('a1', actors[role]);
    expect(prisma.article.update).toHaveBeenCalledTimes(1);
    expect(prisma.article.delete).toHaveBeenCalledTimes(1);
  });
});

describe('artigos com grupos customizados', () => {
  it('flag ligada: VIEW_ALL_KNOWLEDGE_ARTICLES, mesmo em AGENT, le sem filtro; ADMIN sem a chave fica filtrado', async () => {
    const { prisma, service } = setup(true, { 'u-AGENT': ['VIEW_ALL_KNOWLEDGE_ARTICLES'], 'u-ADMIN': [] });
    await service.findAll(actors[Role.AGENT]);
    expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({});
    await service.findAll(actors[Role.ADMIN]);
    expect(prisma.article.findMany.mock.calls[1][0].where).toEqual(filtered('u-ADMIN'));
  });

  it('flag ligada: DELETE_KNOWLEDGE_ARTICLES exclui artigo alheio; ADMIN sem a chave nao exclui, mas ainda edita (lacuna)', async () => {
    const { prisma, service } = setup(true, { 'u-AGENT': ['DELETE_KNOWLEDGE_ARTICLES'], 'u-ADMIN': [] });
    await service.remove('a1', actors[Role.AGENT]);
    expect(prisma.article.delete).toHaveBeenCalledTimes(1);
    await expect(service.remove('a1', actors[Role.ADMIN])).rejects.toThrow(ForbiddenException);
    await service.update('a1', { title: 'X' } as any, actors[Role.ADMIN]);
    expect(prisma.article.update).toHaveBeenCalledTimes(1);
  });

  it('flag desligada: as chaves customizadas nao valem, o perfil decide', async () => {
    const { prisma, service } = setup(false, { 'u-AGENT': ['VIEW_ALL_KNOWLEDGE_ARTICLES', 'DELETE_KNOWLEDGE_ARTICLES'], 'u-ADMIN': [] });
    await service.findAll(actors[Role.AGENT]);
    expect(prisma.article.findMany.mock.calls[0][0].where).toEqual(filtered('u-AGENT'));
    await expect(service.remove('a1', actors[Role.AGENT])).rejects.toThrow(ForbiddenException);
    await service.remove('a1', actors[Role.ADMIN]);
    expect(prisma.article.delete).toHaveBeenCalledTimes(1);
  });
});
