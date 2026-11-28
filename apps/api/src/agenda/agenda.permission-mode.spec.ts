import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgendaAccess } from './agenda-access';
import { AgendaService } from './agenda.service';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a5 (#545): agenda nos dois modos da flag `rbac-permission-only`. Com os grupos
 * padrao o resultado ligado e igual ao desligado (matriz da Fase 0); com grupos
 * customizados so a flag ligada segue as permissoes. Lote 2a5b (#575): query.userId
 * (VIEW_OTHER_USERS_APPOINTMENTS) e ausencia interna (VIEW_INTERNAL_ABSENCES). Fora do
 * lote: o escopo base (2e) e o CLIENT barrado em AgendaService.create (fica por perfil).
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER] as const;
const allRoles = [...roles, Role.CLIENT] as const;
const DENIED = '00000000-0000-0000-0000-000000000000';
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

const start = '2030-05-01T10:00:00Z';
const end = '2030-05-01T11:00:00Z';
const dto = { title: 'Reuniao', startTime: start, endTime: end };

const existing = (userId: string) => ({ id: 'a1', userId, ignoresWorklogRule: false, startTime: new Date(start), endTime: new Date(end) });

const setup = (flagOn: boolean, grants: Record<string, string[]>) => {
  const prisma: any = {
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(existing('u-outro')),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      update: jest.fn().mockResolvedValue({ id: 'a1' }),
      delete: jest.fn().mockResolvedValue({ id: 'a1' }),
    },
    ticket: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const permissions = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
  const access = new AgendaAccess({ isRbacPermissionOnly: () => flagOn } as any, permissions as any);
  return { prisma, service: new AgendaService(prisma, permissions as any, access) };
};

const defaultGrants = () => Object.fromEntries(allRoles.map((r) => [`u-${r}`, DEFAULT_PERMISSION_GROUPS[r].permissions]));

describe.each(modes)('agenda com grupos padrao: %s', (_label, flagOn) => {
  it.each(roles)('%s: query.organizationId so vale fora da organizacao propria', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    await service.findAll({ organizationId: 'org-9' }, actors[role]);
    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(role === Role.CLIENT_MASTER ? 'org-1' : 'org-9');
  });

  it.each(allRoles)('%s: query.userId so vale para ADMIN e AGENT_MASTER', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    await service.findAll({ userId: 'u-outro' }, actors[role]);
    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    if (role === Role.ADMIN || role === Role.AGENT_MASTER) expect(where.userId).toBe('u-outro');
    else expect(where.userId).not.toBe('u-outro');
  });

  it.each(allRoles)('%s: type=ABSENCE (CLIENT_MASTER nao ve; CLIENT segue sem dados)', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    const result = await service.findAll({ type: 'ABSENCE' } as any, actors[role]);
    if (role === Role.CLIENT_MASTER) {
      expect(result).toEqual([]);
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    } else if (role === Role.CLIENT) {
      // nenhum dado em nenhum modo: ou lista vazia sem consulta, ou o id sentinela do escopo base
      const denied = prisma.appointment.findMany.mock.calls.length === 0 || prisma.appointment.findMany.mock.calls[0][0].where.id === DENIED;
      expect(denied).toBe(true);
    } else {
      expect(prisma.appointment.findMany.mock.calls[0][0].where.type).toBe('ABSENCE');
    }
  });

  it.each([Role.CLIENT_MASTER, Role.AGENT] as const)('%s: type diferente de ausencia segue aplicado, sem exigir VIEW_INTERNAL_ABSENCES', async (role) => {
    const { prisma, service } = setup(flagOn, { [`u-${role}`]: [] });
    await service.findAll({ type: 'VACATION' } as any, actors[role]);
    expect(prisma.appointment.findMany.mock.calls[0][0].where.type).toBe('VACATION');
  });

  it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT] as const)('%s: create respeita dto.organizationId; so ADMIN agenda em nome de outro', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    await service.create({ ...dto, userId: 'u-outro', organizationId: 'org-9' } as any, actors[role]);
    const data = prisma.appointment.create.mock.calls[0][0].data;
    expect(data.organizationId).toBe('org-9');
    expect(data.userId).toBe(role === Role.ADMIN ? 'u-outro' : actors[role].id);
  });

  it('CLIENT_MASTER: create forca a propria organizacao', async () => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    await service.create({ ...dto, organizationId: 'org-9' } as any, actors[Role.CLIENT_MASTER]);
    expect(prisma.appointment.create.mock.calls[0][0].data.organizationId).toBe('org-1');
  });

  it.each(roles)('%s: update e remove de compromisso alheio so para ADMIN (os demais 403)', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    if (role === Role.ADMIN) {
      await service.update('a1', { title: 'X', userId: 'u-novo' } as any, actors[role]);
      await service.remove('a1', actors[role]);
      expect(prisma.appointment.update.mock.calls[0][0].data.userId).toBe('u-novo');
      expect(prisma.appointment.delete).toHaveBeenCalledTimes(1);
    } else {
      await expect(service.update('a1', { title: 'X' } as any, actors[role])).rejects.toThrow(ForbiddenException);
      await expect(service.remove('a1', actors[role])).rejects.toThrow(ForbiddenException);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(prisma.appointment.delete).not.toHaveBeenCalled();
    }
  });

  it.each([Role.AGENT_MASTER, Role.AGENT] as const)('%s: dono altera e exclui o proprio compromisso, sem reatribuir', async (role) => {
    const { prisma, service } = setup(flagOn, defaultGrants());
    prisma.appointment.findFirst.mockResolvedValue(existing(actors[role].id));
    await service.update('a1', { title: 'X', userId: 'u-novo' } as any, actors[role]);
    await service.remove('a1', actors[role]);
    expect(prisma.appointment.update.mock.calls[0][0].data.userId).toBeUndefined();
    expect(prisma.appointment.delete).toHaveBeenCalledTimes(1);
  });
});

describe('agenda com grupos customizados', () => {
  it('flag ligada: VIEW_OTHER_USERS_APPOINTMENTS, mesmo em AGENT, le a agenda de outro; ADMIN sem a chave nao', async () => {
    const { prisma, service } = setup(true, { 'u-AGENT': ['VIEW_OTHER_USERS_APPOINTMENTS'], 'u-ADMIN': [] });
    await service.findAll({ userId: 'u-outro' }, actors[Role.AGENT]);
    expect(prisma.appointment.findMany.mock.calls[0][0].where.userId).toBe('u-outro');
    await service.findAll({ userId: 'u-outro' }, actors[Role.ADMIN]);
    expect(prisma.appointment.findMany.mock.calls[1][0].where.userId).toBeUndefined();
  });

  it('flag desligada: VIEW_OTHER_USERS_APPOINTMENTS nao vale, o perfil decide', async () => {
    const { prisma, service } = setup(false, { 'u-AGENT': ['VIEW_OTHER_USERS_APPOINTMENTS'], 'u-ADMIN': [] });
    await service.findAll({ userId: 'u-outro' }, actors[Role.AGENT]);
    expect(prisma.appointment.findMany.mock.calls[0][0].where.userId).not.toBe('u-outro');
    await service.findAll({ userId: 'u-outro' }, actors[Role.ADMIN]);
    expect(prisma.appointment.findMany.mock.calls[1][0].where.userId).toBe('u-outro');
  });

  it('flag ligada: VIEW_INTERNAL_ABSENCES libera a ausencia ao CLIENT_MASTER; AGENT sem a chave recebe lista vazia', async () => {
    const { prisma, service } = setup(true, { 'u-CLIENT_MASTER': ['VIEW_INTERNAL_ABSENCES'], 'u-AGENT': [] });
    await service.findAll({ type: 'ABSENCE' } as any, actors[Role.CLIENT_MASTER]);
    expect(prisma.appointment.findMany.mock.calls[0][0].where.type).toBe('ABSENCE');
    prisma.appointment.findMany.mockClear();
    await expect(service.findAll({ type: 'ABSENCE' } as any, actors[Role.AGENT])).resolves.toEqual([]);
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('flag desligada: VIEW_INTERNAL_ABSENCES nao vale, o perfil decide', async () => {
    const { prisma, service } = setup(false, { 'u-CLIENT_MASTER': ['VIEW_INTERNAL_ABSENCES'], 'u-AGENT': [] });
    await expect(service.findAll({ type: 'ABSENCE' } as any, actors[Role.CLIENT_MASTER])).resolves.toEqual([]);
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    await service.findAll({ type: 'ABSENCE' } as any, actors[Role.AGENT]);
    expect(prisma.appointment.findMany.mock.calls[0][0].where.type).toBe('ABSENCE');
  });

  it('flag ligada: MANAGE_SCHEDULES_ADMIN, mesmo em AGENT, gere agenda alheia; ADMIN sem a chave nao', async () => {
    const { prisma, service } = setup(true, { 'u-AGENT': ['MANAGE_SCHEDULES_ADMIN'], 'u-ADMIN': [] });
    await service.create({ ...dto, userId: 'u-outro' } as any, actors[Role.AGENT]);
    expect(prisma.appointment.create.mock.calls[0][0].data.userId).toBe('u-outro');
    await service.update('a1', { title: 'X', userId: 'u-novo' } as any, actors[Role.AGENT]);
    expect(prisma.appointment.update.mock.calls[0][0].data.userId).toBe('u-novo');
    await service.remove('a1', actors[Role.AGENT]);
    expect(prisma.appointment.delete).toHaveBeenCalledTimes(1);

    prisma.appointment.create.mockClear();
    await service.create({ ...dto, userId: 'u-outro' } as any, actors[Role.ADMIN]);
    expect(prisma.appointment.create.mock.calls[0][0].data.userId).toBe('u-ADMIN');
    await expect(service.remove('a1', actors[Role.ADMIN])).rejects.toThrow(ForbiddenException);
  });

  it('flag desligada: a chave customizada nao vale, o perfil decide', async () => {
    const { prisma, service } = setup(false, { 'u-AGENT': ['MANAGE_SCHEDULES_ADMIN'], 'u-ADMIN': [] });
    await expect(service.remove('a1', actors[Role.AGENT])).rejects.toThrow(ForbiddenException);
    await service.remove('a1', actors[Role.ADMIN]);
    expect(prisma.appointment.delete).toHaveBeenCalledTimes(1);
  });

  it('flag ligada: VIEW_ORGANIZATION_APPOINTMENTS prende a organizacao; sem ela CLIENT_MASTER escolhe outra', async () => {
    const withKey = setup(true, { 'u-AGENT': ['VIEW_ORGANIZATION_APPOINTMENTS'] });
    await withKey.service.create({ ...dto, organizationId: 'org-9' } as any, { ...actors[Role.AGENT], organizationId: 'org-2' });
    expect(withKey.prisma.appointment.create.mock.calls[0][0].data.organizationId).toBe('org-2');

    const without = setup(true, { 'u-CLIENT_MASTER': [] });
    await without.service.findAll({ organizationId: 'org-9' }, actors[Role.CLIENT_MASTER]);
    expect(without.prisma.appointment.findMany.mock.calls[0][0].where.organizationId).toBe('org-9');
  });
});
