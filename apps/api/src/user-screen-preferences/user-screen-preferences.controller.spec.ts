import { UserScreenPreferencesController } from './user-screen-preferences.controller';

describe('UserScreenPreferencesController (DMTE-527 T2)', () => {
  const service = {
    get: jest.fn().mockResolvedValue({}),
    put: jest.fn().mockResolvedValue({ groupBy: 'stage' }),
  };
  const controller = new UserScreenPreferencesController(service as any);
  const req = { user: { id: 'u-1', role: 'AGENT' } } as never;

  beforeEach(() => jest.clearAllMocks());

  it('AC-13: sempre age com o id do usuário do token (req.user.id), nunca com id vindo da requisição', async () => {
    await controller.get('tickets-kanban', req);
    await controller.put('tickets-kanban', { groupBy: 'stage' }, req);
    expect(service.get).toHaveBeenCalledWith('u-1', 'tickets-kanban');
    expect(service.put).toHaveBeenCalledWith('u-1', 'tickets-kanban', { groupBy: 'stage' });
  });

  it('AC-13: devolve o que o service devolve', async () => {
    await expect(controller.put('tickets-kanban', { groupBy: 'stage' }, req)).resolves.toEqual({ groupBy: 'stage' });
  });

  it('AC-11: a rota fica atrás do JwtAuthGuard e só recebe o parâmetro :screen', () => {
    const guards = Reflect.getMetadata('__guards__', UserScreenPreferencesController) as unknown[] | undefined;
    expect((guards ?? []).map((g) => (g as { name: string }).name)).toEqual(['JwtAuthGuard']);
    expect(Reflect.getMetadata('path', UserScreenPreferencesController)).toBe('me/screen-preferences');
    expect(Reflect.getMetadata('path', UserScreenPreferencesController.prototype.get)).toBe(':screen');
    expect(Reflect.getMetadata('path', UserScreenPreferencesController.prototype.put)).toBe(':screen');
  });
});
