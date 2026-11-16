import { UserScreenPreferencesService } from './user-screen-preferences.service';

type Key = { userId: string; screen: string };
const keyOf = ({ userId, screen }: Key) => `${userId}|${screen}`;

/** Prisma falso com estado: findUnique e upsert pela chave composta `userId_screen` (único de AC-10). */
function setup() {
  const rows = new Map<string, { userId: string; screen: string; data: unknown; updatedAt: Date }>();
  const prisma: any = {
    userScreenPreference: {
      findUnique: jest.fn(async ({ where }: { where: { userId_screen: Key } }) => rows.get(keyOf(where.userId_screen)) ?? null),
      upsert: jest.fn(async ({ where, create, update }: { where: { userId_screen: Key }; create: any; update: any }) => {
        const key = keyOf(where.userId_screen);
        const row = rows.has(key)
          ? { ...rows.get(key)!, ...update, updatedAt: new Date() }
          : { ...create, updatedAt: new Date() };
        rows.set(key, row);
        return row;
      }),
    },
  };
  return { prisma, rows, service: new UserScreenPreferencesService(prisma) };
}

const kanban = { groupBy: 'stage', collapsed: { RESOLVED: false } };

describe('UserScreenPreferencesService (DMTE-527 T2)', () => {
  it('AC-11: GET sem linha devolve preferência vazia, buscando pela chave (userId, screen) do dono', async () => {
    const { service, prisma } = setup();
    await expect(service.get('u-1', 'tickets-kanban')).resolves.toEqual({});
    expect(prisma.userScreenPreference.findUnique).toHaveBeenCalledWith({
      where: { userId_screen: { userId: 'u-1', screen: 'tickets-kanban' } },
    });
  });

  it('AC-12: o que o PUT grava, o GET relê igual', async () => {
    const { service } = setup();
    await service.put('u-1', 'tickets-kanban', kanban);
    await expect(service.get('u-1', 'tickets-kanban')).resolves.toEqual(kanban);
  });

  it('AC-11: o PUT substitui o data inteiro daquela tela (vale a última gravação)', async () => {
    const { service } = setup();
    await service.put('u-1', 'tickets-kanban', kanban);
    await service.put('u-1', 'tickets-kanban', { groupBy: 'status' });
    await expect(service.get('u-1', 'tickets-kanban')).resolves.toEqual({ groupBy: 'status' });
  });

  it('AC-13: dois usuários gravam a mesma tela e cada um lê só a sua', async () => {
    const { service } = setup();
    await service.put('u-1', 'tickets-kanban', { groupBy: 'status' });
    await service.put('u-2', 'tickets-kanban', { groupBy: 'priority' });
    await expect(service.get('u-1', 'tickets-kanban')).resolves.toEqual({ groupBy: 'status' });
    await expect(service.get('u-2', 'tickets-kanban')).resolves.toEqual({ groupBy: 'priority' });
    await expect(service.get('u-3', 'tickets-kanban')).resolves.toEqual({});
  });

  it('AC-13: o mesmo usuário em telas diferentes tem preferências separadas', async () => {
    const { service } = setup();
    await service.put('u-1', 'tickets-kanban', { groupBy: 'status' });
    await expect(service.get('u-1', 'tickets-list')).resolves.toEqual({});
  });
});
