import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ArticleVisibility, Role } from '@prisma/client';
import { ArticlesService } from './articles.service';

/**
 * Caracterização por perfil dos artigos (#527, Fase 0b-3 do tracker #523).
 * Trava o comportamento ATUAL de visibilidade (PUBLIC/PRIVATE) e de edição; nenhuma
 * mudança de produção.
 */
const actors = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
  clientMasterNoOrg: { id: 'u-client-master-2', role: Role.CLIENT_MASTER },
  client: { id: 'u-client', role: Role.CLIENT, organizationId: 'org-1' },
};

const privateClause = (userId: string, organizationId?: string | null) => ({
  visibility: ArticleVisibility.PRIVATE,
  OR: [
    { authorId: userId },
    { allowedAgentGroups: { some: { members: { some: { id: userId } } } } },
    ...(organizationId ? [{ allowedOrganizations: { some: { id: organizationId } } }] : []),
  ],
});

describe('ArticlesService: matriz por perfil (caracterização)', () => {
  let prisma: any;
  let service: ArticlesService;

  beforeEach(() => {
    prisma = {
      article: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'a1', authorId: 'u-autor', attachments: [] }),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn().mockResolvedValue({ id: 'a1' }),
        delete: jest.fn().mockResolvedValue({ id: 'a1' }),
      },
    };
    service = new ArticlesService(prisma);
  });

  describe('findAll: regra de visibilidade por perfil', () => {
    it('ADMIN: sem filtro de visibilidade (vê PUBLIC e PRIVATE)', async () => {
      await service.findAll(actors.admin);
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({});
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
    ])('%s: sem bypass; PRIVATE só se for autor ou membro de grupo permitido', async (_label, user) => {
      await service.findAll(user);
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ visibility: ArticleVisibility.PUBLIC }, privateClause(user.id)],
      });
    });

    it.each([
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s com organização: PRIVATE também se a organização estiver liberada', async (_label, user) => {
      await service.findAll(user);
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ visibility: ArticleVisibility.PUBLIC }, privateClause(user.id, 'org-1')],
      });
    });

    it('CLIENT_MASTER sem organização: sem a cláusula de organização liberada', async () => {
      await service.findAll(actors.clientMasterNoOrg);
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ visibility: ArticleVisibility.PUBLIC }, privateClause('u-client-master-2')],
      });
    });

    it('anônimo (sem usuário): só PUBLIC', async () => {
      await service.findAll(undefined);
      expect(prisma.article.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ visibility: ArticleVisibility.PUBLIC }],
      });
    });
  });

  describe('findOne: mesma regra; artigo invisível responde 404 (não 403)', () => {
    it('ADMIN: busca só pelo id', async () => {
      await service.findOne('a1', actors.admin);
      expect(prisma.article.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1' });
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
    ])('%s: id mais a regra de visibilidade', async (_label, user) => {
      await service.findOne('a1', user);
      expect(prisma.article.findFirst.mock.calls[0][0].where).toEqual({
        id: 'a1',
        OR: [{ visibility: ArticleVisibility.PUBLIC }, privateClause(user.id)],
      });
    });

    it('anônimo: id mais só PUBLIC', async () => {
      await service.findOne('a1', undefined);
      expect(prisma.article.findFirst.mock.calls[0][0].where).toEqual({
        id: 'a1',
        OR: [{ visibility: ArticleVisibility.PUBLIC }],
      });
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s: artigo PRIVATE que não alcança é 404', async (_label, user) => {
      prisma.article.findFirst.mockResolvedValue(null);
      await expect(service.findOne('privado', user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create: o autor é sempre o usuário autenticado, qualquer perfil', () => {
    it.each([
      ['ADMIN', actors.admin],
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s: authorId é o próprio id', async (_label, user) => {
      await service.create({ title: 'T', content: 'c', visibility: ArticleVisibility.PRIVATE } as any, user);
      expect(prisma.article.create.mock.calls[0][0].data).toMatchObject({ authorId: user.id, visibility: ArticleVisibility.PRIVATE });
    });
  });

  describe('update e remove: só o autor ou ADMIN (assertCanModify)', () => {
    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s que não é autor: 403 sem gravar nem apagar', async (_label, user) => {
      await expect(service.update('a1', { title: 'X' } as any, user)).rejects.toThrow(ForbiddenException);
      await expect(service.remove('a1', user)).rejects.toThrow(ForbiddenException);
      expect(prisma.article.update).not.toHaveBeenCalled();
      expect(prisma.article.delete).not.toHaveBeenCalled();
    });

    it('ADMIN que não é autor: pode editar e excluir', async () => {
      await service.update('a1', { title: 'X' } as any, actors.admin);
      await service.remove('a1', actors.admin);
      expect(prisma.article.update).toHaveBeenCalledTimes(1);
      expect(prisma.article.delete).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s autor: pode editar e excluir o próprio artigo', async (_label, user) => {
      prisma.article.findUnique.mockResolvedValue({ id: 'a1', authorId: user.id, attachments: [] });
      await service.update('a1', { title: 'X' } as any, user);
      await service.remove('a1', user);
      expect(prisma.article.update).toHaveBeenCalledTimes(1);
      expect(prisma.article.delete).toHaveBeenCalledTimes(1);
    });

    it('artigo inexistente é 404 antes da checagem de perfil', async () => {
      prisma.article.findUnique.mockResolvedValue(null);
      await expect(service.update('x', {} as any, actors.agent)).rejects.toThrow(NotFoundException);
      await expect(service.remove('x', actors.agent)).rejects.toThrow(NotFoundException);
    });
  });
});
