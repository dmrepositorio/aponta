import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useUserScreenConfig } from './useUserScreenConfig';

// DMTE-527 T2 (AC-14 a AC-17): o hook lê e grava no servidor (GET/PUT /me/screen-preferences/:screen).
// O GET devolve a preferência (objeto vazio quando não há linha); o PUT envia a preferência inteira.
vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const SCREENS = ['organizations', 'contracts', 'service-desks', 'tickets-list', 'tickets-kanban'];
const urlOf = (screen: string) => `/me/screen-preferences/${screen}`;
const storageKey = (userId: string, screen: string) => `aponta_screen_config_${userId}_${screen}`;

const setUser = (sub: string) =>
  useAuthStore.setState({
    token: null,
    user: { sub, email: `${sub}@dm.test`, role: 'AGENT', organizationId: null } as never,
  });

/** Servidor falso por usuário (o do authStore no momento da chamada) e tela. */
function fakeServer(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const keyOf = (url: string) => `${useAuthStore.getState().user?.sub}|${url.split('/').pop()}`;
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ data: store.get(keyOf(url)) ?? {} })) as never);
  vi.mocked(api.put).mockImplementation((async (url: string, body: unknown) => {
    store.set(keyOf(url), body);
    return { data: body };
  }) as never);
  return { store, keyOf: (user: string, screen: string) => `${user}|${screen}` };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function renderLoaded(screen: string, defaults?: Parameters<typeof useUserScreenConfig>[1]) {
  const view = renderHook(() => useUserScreenConfig(screen, defaults));
  await flush();
  return view;
}

describe('useUserScreenConfig no servidor (DMTE-527 T2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    setUser('user-123');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('AC-14: leitura e gravação no servidor', () => {
    it.each(SCREENS)('AC-14: mantém a assinatura e lê GET /me/screen-preferences/%s', async (screen) => {
      fakeServer();
      const { result } = await renderLoaded(screen);
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(urlOf(screen));
      for (const name of [
        'setColumnVisibility', 'setColumnOrder', 'setDensity', 'setFormLayout', 'setViewMode',
        'setGroupBy', 'saveFilter', 'deleteFilter', 'restoreDefaults',
      ]) {
        expect(typeof (result.current as Record<string, unknown>)[name]).toBe('function');
      }
      expect(result.current.config.grid.density).toBe('compact');
      expect(result.current.config.form.layout).toBe('CASCADE');
    });

    it('AC-14: lê do servidor antes de entregar a configuração (isLoading até a resposta)', async () => {
      const pending = deferred<{ data: unknown }>();
      vi.mocked(api.get).mockReturnValue(pending.promise as never);
      const { result } = await renderLoaded('tickets-kanban', { groupBy: 'stage' });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.config.groupBy).toBe('stage');

      pending.resolve({ data: { groupBy: 'status', grid: { density: 'comfortable', columnVisibility: { sla: false } } } });
      await flush();

      expect(result.current.isLoading).toBe(false);
      expect(result.current.config.groupBy).toBe('status');
      expect(result.current.config.grid.density).toBe('comfortable');
      expect(result.current.config.grid.columnVisibility).toEqual({ sla: false });
    });

    it('AC-14: o que o servidor não tem fica com os padrões do chamador', async () => {
      fakeServer({ 'user-123|tickets-kanban': { groupBy: 'status' } });
      const { result } = await renderLoaded('tickets-kanban', {
        groupBy: 'stage',
        grid: { columnVisibility: { sla: true }, density: 'compact' },
      });
      expect(result.current.config.groupBy).toBe('status');
      expect(result.current.config.grid.columnVisibility).toEqual({ sla: true });
      expect(result.current.config.grid.density).toBe('compact');
    });

    it('AC-14: grava cada mudança no servidor (PUT) só depois de 400 ms de espera', async () => {
      fakeServer();
      const { result } = await renderLoaded('tickets-list');

      act(() => result.current.setGroupBy('organization'));
      expect(result.current.config.groupBy).toBe('organization');
      await advance(399);
      expect(vi.mocked(api.put)).not.toHaveBeenCalled();
      await advance(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('tickets-list'),
        expect.objectContaining({ groupBy: 'organization' }),
      );
    });

    it('AC-14: junta cliques seguidos em uma só gravação, com o último estado', async () => {
      fakeServer();
      const { result } = await renderLoaded('tickets-list');

      act(() => result.current.setGroupBy('organization'));
      await advance(200);
      act(() => result.current.setDensity('comfortable'));
      await advance(200);
      act(() => result.current.setGroupBy('stage'));
      await advance(399);
      expect(vi.mocked(api.put)).not.toHaveBeenCalled();
      await advance(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('tickets-list'),
        expect.objectContaining({ groupBy: 'stage', grid: expect.objectContaining({ density: 'comfortable' }) }),
      );
    });

    it('AC-14: a mudança gravada é relida igual numa nova montagem do hook', async () => {
      fakeServer();
      const first = await renderLoaded('organizations');
      act(() => first.result.current.setColumnOrder(['name', 'document']));
      act(() => first.result.current.setColumnVisibility({ name: true, document: false }));
      await advance(400);
      first.unmount();
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('organizations'),
        expect.objectContaining({ grid: expect.objectContaining({ columnOrder: ['name', 'document'] }) }),
      );
      expect(localStorage.getItem(storageKey('user-123', 'organizations'))).toBeNull();

      const second = await renderLoaded('organizations');
      expect(second.result.current.config.grid.columnOrder).toEqual(['name', 'document']);
      expect(second.result.current.config.grid.columnVisibility).toEqual({ name: true, document: false });
    });

    it('AC-14: com a preferência no servidor, o localStorage não é lido nem escrito', async () => {
      fakeServer({ 'user-123|tickets-list': { groupBy: 'status' } });
      const stale = JSON.stringify({ groupBy: 'obsoleto' });
      localStorage.setItem(storageKey('user-123', 'tickets-list'), stale);
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const { result } = await renderLoaded('tickets-list');

      expect(result.current.config.groupBy).toBe('status');
      act(() => result.current.setGroupBy('stage'));
      await advance(400);

      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(storageKey('user-123', 'tickets-list'))).toBe(stale);
    });

    // Cobertura que o teste antigo (localStorage, removido) dava e continua valendo, agora contra o servidor.
    it('AC-14: viewMode e layout do formulário mudam na hora e vão na gravação do servidor', async () => {
      fakeServer();
      const { result } = await renderLoaded('contracts');
      expect(result.current.config.viewMode).toBe('GRID');

      act(() => {
        result.current.setViewMode('FORM');
        result.current.setFormLayout('SIDE_BY_SIDE');
      });
      expect(result.current.config.viewMode).toBe('FORM');
      expect(result.current.config.form.layout).toBe('SIDE_BY_SIDE');
      await advance(400);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('contracts'),
        expect.objectContaining({ viewMode: 'FORM', form: expect.objectContaining({ layout: 'SIDE_BY_SIDE' }) }),
      );
    });

    it('AC-14: saveFilter e deleteFilter mudam os filtros salvos e gravam a lista no servidor', async () => {
      fakeServer();
      const { result } = await renderLoaded('service-desks');

      act(() => result.current.saveFilter('Filtro VIP', { status: 'ACTIVE', search: 'VIP' }));
      expect(result.current.config.savedFilters).toHaveLength(1);
      expect(result.current.config.savedFilters[0].name).toBe('Filtro VIP');
      await advance(400);
      expect(vi.mocked(api.put)).toHaveBeenLastCalledWith(
        urlOf('service-desks'),
        expect.objectContaining({
          savedFilters: [expect.objectContaining({ name: 'Filtro VIP', criteria: { status: 'ACTIVE', search: 'VIP' } })],
        }),
      );

      const filterId = result.current.config.savedFilters[0].id;
      act(() => result.current.deleteFilter(filterId));
      expect(result.current.config.savedFilters).toHaveLength(0);
      await advance(400);
      expect(vi.mocked(api.put)).toHaveBeenLastCalledWith(
        urlOf('service-desks'),
        expect.objectContaining({ savedFilters: [] }),
      );
    });

    it('AC-14: restoreDefaults devolve a configuração aos padrões do chamador', async () => {
      fakeServer({ 'user-123|contracts': { form: { layout: 'SIDE_BY_SIDE' } } });
      const { result } = await renderLoaded('contracts', { form: { layout: 'CASCADE' } });
      expect(result.current.config.form.layout).toBe('SIDE_BY_SIDE');

      act(() => result.current.restoreDefaults());
      expect(result.current.config.form.layout).toBe('CASCADE');
    });
  });

  describe('AC-15: importação única do localStorage', () => {
    const stored = {
      grid: { columnVisibility: { protocol: false }, density: 'comfortable' },
      groupBy: 'organization',
      savedFilters: [{ id: 'f-1', name: 'VIP', criteria: { status: 'ACTIVE' } }],
    };

    it('AC-15: sem linha no servidor e com chave no navegador, envia ao servidor e usa a configuração', async () => {
      fakeServer();
      localStorage.setItem(storageKey('user-123', 'tickets-list'), JSON.stringify(stored));
      const { result } = await renderLoaded('tickets-list');
      await advance(400);

      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('tickets-list'),
        expect.objectContaining({
          groupBy: 'organization',
          grid: expect.objectContaining({ density: 'comfortable', columnVisibility: { protocol: false } }),
          savedFilters: stored.savedFilters,
        }),
      );
      expect(result.current.config.groupBy).toBe('organization');
      expect(result.current.config.grid.density).toBe('comfortable');
      expect(result.current.config.savedFilters).toEqual(stored.savedFilters);
    });

    it('AC-15: apaga a chave só depois da gravação confirmada, e o navegador deixa de ser usado', async () => {
      const key = storageKey('user-123', 'tickets-list');
      const pending = deferred<{ data: unknown }>();
      vi.mocked(api.get).mockResolvedValue({ data: {} } as never);
      vi.mocked(api.put).mockReturnValue(pending.promise as never);
      localStorage.setItem(key, JSON.stringify(stored));
      const { result } = await renderLoaded('tickets-list');
      await advance(400);

      expect(vi.mocked(api.put)).toHaveBeenCalled();
      expect(localStorage.getItem(key)).not.toBeNull();

      pending.resolve({ data: stored });
      await flush();
      expect(localStorage.getItem(key)).toBeNull();

      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      act(() => result.current.setGroupBy('stage'));
      await advance(400);
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(key)).toBeNull();
    });

    it('AC-15: se a gravação da importação falhar, a chave fica no navegador (nova tentativa na próxima leitura)', async () => {
      const key = storageKey('user-123', 'tickets-list');
      vi.mocked(api.get).mockResolvedValue({ data: {} } as never);
      vi.mocked(api.put).mockRejectedValue(new Error('Network Error'));
      localStorage.setItem(key, JSON.stringify(stored));
      const { result } = await renderLoaded('tickets-list');
      await advance(400);

      expect(vi.mocked(api.put)).toHaveBeenCalled();
      expect(localStorage.getItem(key)).not.toBeNull();
      expect(result.current.config.groupBy).toBe('organization');
    });

    it('AC-15: importa só a chave do próprio usuário e da própria tela', async () => {
      fakeServer();
      localStorage.setItem(storageKey('outro-usuario', 'tickets-list'), JSON.stringify({ groupBy: 'de-outro-usuario' }));
      localStorage.setItem(storageKey('user-123', 'tickets-kanban'), JSON.stringify({ groupBy: 'de-outra-tela' }));
      localStorage.setItem(storageKey('user-123', 'tickets-list'), JSON.stringify({ groupBy: 'propria' }));
      const { result } = await renderLoaded('tickets-list');
      await advance(400);

      expect(vi.mocked(api.put)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(urlOf('tickets-list'), expect.objectContaining({ groupBy: 'propria' }));
      expect(result.current.config.groupBy).toBe('propria');
      expect(localStorage.getItem(storageKey('outro-usuario', 'tickets-list'))).not.toBeNull();
      expect(localStorage.getItem(storageKey('user-123', 'tickets-kanban'))).not.toBeNull();
    });

    it.each([
      ['texto que não é JSON', '{nao e json'],
      ['JSON que não é objeto', '[1,2,3]'],
      ['groupBy com tipo errado', JSON.stringify({ groupBy: 5 })],
      ['campo desconhecido', JSON.stringify({ foo: 'bar' })],
    ])('AC-15: conteúdo inválido no navegador é descartado (%s): padrões e nada enviado', async (_name, raw) => {
      fakeServer();
      localStorage.setItem(storageKey('user-123', 'tickets-list'), raw);
      const { result } = await renderLoaded('tickets-list', { groupBy: 'none' });
      await advance(400);

      expect(vi.mocked(api.get)).toHaveBeenCalledWith(urlOf('tickets-list'));
      expect(vi.mocked(api.put)).not.toHaveBeenCalled();
      expect(result.current.config.groupBy).toBe('none');
      expect(result.current.config.grid.density).toBe('compact');
    });
  });

  describe('AC-16: falha de leitura ou gravação não trava a tela', () => {
    it('AC-16: se a leitura falhar, usa os padrões, sai do carregamento e não alerta', async () => {
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      vi.mocked(api.get).mockRejectedValue(new Error('Network Error'));
      const { result } = await renderLoaded('tickets-kanban', { groupBy: 'stage' });

      expect(vi.mocked(api.get)).toHaveBeenCalledWith(urlOf('tickets-kanban'));
      expect(result.current.isLoading).toBe(false);
      expect(result.current.config.groupBy).toBe('stage');
      expect(alert).not.toHaveBeenCalled();
    });

    it('AC-16: depois de uma leitura que falhou, a mudança fica em memória e tenta gravar', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network Error'));
      vi.mocked(api.put).mockResolvedValue({ data: {} } as never);
      const { result } = await renderLoaded('tickets-kanban', { groupBy: 'stage' });

      act(() => result.current.setGroupBy('priority'));
      expect(result.current.config.groupBy).toBe('priority');
      await advance(400);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('tickets-kanban'),
        expect.objectContaining({ groupBy: 'priority' }),
      );
    });

    it('AC-16: se a gravação falhar, a escolha continua em memória, sem alerta, e a próxima mudança grava de novo', async () => {
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      fakeServer();
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Network Error'));
      const { result } = await renderLoaded('tickets-kanban');

      act(() => result.current.setGroupBy('priority'));
      await advance(400);
      expect(vi.mocked(api.put)).toHaveBeenCalledTimes(1);
      expect(result.current.config.groupBy).toBe('priority');
      expect(alert).not.toHaveBeenCalled();

      act(() => result.current.setDensity('comfortable'));
      await advance(400);
      expect(vi.mocked(api.put)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.put)).toHaveBeenLastCalledWith(
        urlOf('tickets-kanban'),
        expect.objectContaining({ groupBy: 'priority', grid: expect.objectContaining({ density: 'comfortable' }) }),
      );
    });
  });

  describe('AC-17: recolhimento das colunas do Kanban no mapa collapsed', () => {
    it('AC-17: lê o mapa collapsed do servidor e não inventa entrada para as demais colunas', async () => {
      fakeServer({ 'user-123|tickets-kanban': { collapsed: { OPEN: true, RESOLVED: false } } });
      const { result } = await renderLoaded('tickets-kanban');
      expect(result.current.config.collapsed).toEqual({ OPEN: true, RESOLVED: false });
    });

    it('AC-17: setColumnCollapsed grava só o que o usuário mexeu, em 400 ms', async () => {
      fakeServer({ 'user-123|tickets-kanban': { collapsed: { OPEN: true } } });
      const { result } = await renderLoaded('tickets-kanban');

      act(() => result.current.setColumnCollapsed('RESOLVED', false));
      expect(result.current.config.collapsed).toEqual({ OPEN: true, RESOLVED: false });
      await advance(399);
      expect(vi.mocked(api.put)).not.toHaveBeenCalled();
      await advance(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(
        urlOf('tickets-kanban'),
        expect.objectContaining({ collapsed: { OPEN: true, RESOLVED: false } }),
      );
    });

    it('AC-17: o recolhimento de um usuário não afeta o de outro', async () => {
      const server = fakeServer();
      const alice = await renderLoaded('tickets-kanban');
      act(() => alice.result.current.setColumnCollapsed('OPEN', true));
      await advance(400);
      alice.unmount();

      setUser('user-456');
      const bob = await renderLoaded('tickets-kanban');
      expect(bob.result.current.config.collapsed).toEqual({});
      act(() => bob.result.current.setColumnCollapsed('OPEN', false));
      await advance(400);
      bob.unmount();

      const saved = (user: string) => (server.store.get(server.keyOf(user, 'tickets-kanban')) as { collapsed?: unknown } | undefined)?.collapsed;
      expect(saved('user-123')).toEqual({ OPEN: true });
      expect(saved('user-456')).toEqual({ OPEN: false });

      setUser('user-123');
      const aliceAgain = await renderLoaded('tickets-kanban');
      expect(aliceAgain.result.current.config.collapsed).toEqual({ OPEN: true });
    });

    it('AC-17: ao trocar de usuário no mesmo hook, lê a preferência do novo usuário', async () => {
      fakeServer({
        'user-123|tickets-kanban': { collapsed: { OPEN: true } },
        'user-456|tickets-kanban': { collapsed: { CLOSED: false } },
      });
      const { result, rerender } = await renderLoaded('tickets-kanban');
      expect(result.current.config.collapsed).toEqual({ OPEN: true });

      act(() => setUser('user-456'));
      rerender();
      await flush();
      expect(result.current.config.collapsed).toEqual({ CLOSED: false });
    });
  });
});
