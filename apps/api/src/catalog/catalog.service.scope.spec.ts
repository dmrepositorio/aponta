import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';

/**
 * Fase 0b-1 (#525, tracker #523): caracterização do recorte por Cliente em
 * `findActiveCatalog` (catalog.service.ts, filtro por isClient / organizationId /
 * deskServesOrganization), por perfil.
 */
describe('CatalogService.findActiveCatalog: recorte por Cliente e perfil (0b-1)', () => {
  let service: CatalogService;
  let findMany: jest.Mock;

  const desk = (organizations: { id: string }[]) => ({
    active: true,
    acceptingNewTickets: true,
    internalUse: false,
    openByAgentsOnly: false,
    listedGroupsOnly: false,
    unlistedCanCreateTicket: true,
    allowCrossDeskInteraction: true,
    agents: [],
    agentGroups: [],
    organizations,
  });
  const item = (id: string, organizations: { id: string }[]) => ({
    id,
    title: id,
    isActive: true,
    defaultServiceDesk: desk(organizations),
  });
  const catalog = () => [
    {
      id: 'cat',
      name: 'cat',
      items: [
        item('global', []),
        item('org-a', [{ id: 'org-a' }]),
        item('org-b', [{ id: 'org-b' }]),
        item('org-a-and-b', [{ id: 'org-a' }, { id: 'org-b' }]),
      ],
    },
  ];
  const ids = (result: { items: { id: string }[] }[]) => result.flatMap((c) => c.items.map((i) => i.id));
  const user = (id: string, role: Role, organizationId?: string | null) => ({ id, role, organizationId });

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue(catalog());
    service = new CatalogService({ serviceCatalogCategory: { findMany } } as any);
  });

  it.each([Role.CLIENT, Role.CLIENT_MASTER])(
    '%s com organização recebe itens globais e da própria organização, nunca de outro Cliente',
    async (role) => {
      const result = await service.findActiveCatalog(user('u', role, 'org-a'));
      expect(ids(result)).toEqual(['global', 'org-a', 'org-a-and-b']);
    },
  );

  it.each([Role.CLIENT, Role.CLIENT_MASTER])(
    '%s ignora o organizationId recebido e não enxerga o catálogo de outro Cliente',
    async (role) => {
      const result = await service.findActiveCatalog(user('u', role, 'org-a'), 'org-b');
      expect(ids(result)).toEqual(['global', 'org-a', 'org-a-and-b']);
    },
  );

  it.each([Role.CLIENT, Role.CLIENT_MASTER])(
    '%s sem organização recebe só itens globais, mesmo ao passar organizationId',
    async (role) => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      const result = await service.findActiveCatalog(user('u', role), 'org-a');
      expect(ids(result)).toEqual(['global']);
    },
  );

  it.each([Role.AGENT, Role.AGENT_MASTER, Role.ADMIN])(
    '%s com organizationId recebe itens globais e do Cliente pedido',
    async (role) => {
      const result = await service.findActiveCatalog(user('u', role), 'org-b');
      expect(ids(result)).toEqual(['global', 'org-b', 'org-a-and-b']);
    },
  );

  it.each([Role.AGENT, Role.AGENT_MASTER, Role.ADMIN])(
    '%s sem organizationId recebe todos os itens, de todos os Clientes',
    async (role) => {
      // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
      const result = await service.findActiveCatalog(user('u', role));
      expect(ids(result)).toEqual(['global', 'org-a', 'org-b', 'org-a-and-b']);
    },
  );

  it('atendente ignora o próprio organizationId do token: só o parâmetro filtra', async () => {
    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    const result = await service.findActiveCatalog(user('u', Role.AGENT, 'org-a'));
    expect(ids(result)).toEqual(['global', 'org-a', 'org-b', 'org-a-and-b']);
  });

  it('organizationId vazio é tratado como ausente para o atendente', async () => {
    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    const result = await service.findActiveCatalog(user('u', Role.AGENT), '');
    expect(ids(result)).toEqual(['global', 'org-a', 'org-b', 'org-a-and-b']);
  });
});
