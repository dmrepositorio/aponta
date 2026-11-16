import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

export interface SavedFilter {
  id: string;
  name: string;
  criteria: Record<string, any>;
}

export interface UserScreenConfig {
  grid: {
    columnVisibility: Record<string, boolean>;
    density: 'compact' | 'comfortable';
    columnOrder?: string[];
  };
  form: {
    layout: 'CASCADE' | 'SIDE_BY_SIDE';
  };
  viewMode: 'GRID' | 'FORM';
  savedFilters: SavedFilter[];
  /** Generic "Agrupar por" preference (e.g. Lista de Tickets, D5) — an opaque key the caller defines. */
  groupBy: string;
  /** DMTE-527 T2: colunas recolhidas do Kanban (id da coluna -> recolhida); só o que o usuário mexeu. */
  collapsed: Record<string, boolean>;
}

const DEFAULT_CONFIG: UserScreenConfig = {
  grid: {
    columnVisibility: {},
    density: 'compact',
    columnOrder: undefined,
  },
  form: {
    layout: 'CASCADE',
  },
  viewMode: 'GRID',
  savedFilters: [],
  groupBy: '',
  collapsed: {},
};

/** Chave do navegador (legado): lida só na importação única, quando o servidor ainda não tem a tela do usuário. */
function getStorageKey(userId: string | null | undefined, screenId: string): string {
  const uid = userId ?? 'default';
  return `aponta_screen_config_${uid}_${screenId}`;
}

type Check = (v: any) => boolean;
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBoolMap: Check = (v) => isObj(v) && Object.values(v).every((x) => typeof x === 'boolean');
const allValid = (table: Record<string, Check>, o: Record<string, unknown>) =>
  Object.entries(o).every(([k, v]) => Object.prototype.hasOwnProperty.call(table, k) && (v === undefined || table[k](v)));

/** Mesmo formato que a API valida (sem os limites de tamanho); chave desconhecida ou tipo errado invalida tudo. */
const GRID_OK: Record<string, Check> = {
  columnVisibility: isBoolMap,
  density: (v) => v === 'compact' || v === 'comfortable',
  columnOrder: (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
};
const PREFERENCE_OK: Record<string, Check> = {
  grid: (v) => isObj(v) && allValid(GRID_OK, v),
  form: (v) => isObj(v) && allValid({ layout: (l) => l === 'CASCADE' || l === 'SIDE_BY_SIDE' }, v),
  viewMode: (v) => v === 'GRID' || v === 'FORM',
  savedFilters: (v) =>
    Array.isArray(v) && v.every((f) => isObj(f) && typeof f.id === 'string' && typeof f.name === 'string' && isObj(f.criteria)),
  groupBy: (v) => typeof v === 'string',
  collapsed: isBoolMap,
};

type StoredPreference = {
  [K in keyof UserScreenConfig]?: K extends 'grid' | 'form' ? Partial<UserScreenConfig[K]> : UserScreenConfig[K];
};
const parsePreference = (raw: unknown): StoredPreference | null =>
  isObj(raw) && allValid(PREFERENCE_OK, raw) ? raw : null;
const hasContent = (p: StoredPreference | null): p is StoredPreference => !!p && Object.keys(p).length > 0;

function readLegacy(key: string): StoredPreference | null {
  try {
    return parsePreference(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return null;
  }
}

function applyPreference(d: UserScreenConfig, p: StoredPreference): UserScreenConfig {
  return {
    grid: {
      columnVisibility: { ...d.grid.columnVisibility, ...p.grid?.columnVisibility },
      density: p.grid?.density ?? d.grid.density,
      columnOrder: p.grid?.columnOrder ?? d.grid.columnOrder,
    },
    form: { layout: p.form?.layout ?? d.form.layout },
    viewMode: p.viewMode ?? d.viewMode,
    savedFilters: p.savedFilters ?? d.savedFilters,
    groupBy: p.groupBy ?? d.groupBy,
    collapsed: p.collapsed ?? d.collapsed,
  };
}

/** Grava a preferência inteira; falha (rede, 4xx) não propaga: a tela segue com o estado em memória. */
async function persist(url: string, config: UserScreenConfig): Promise<boolean> {
  try {
    await api.put(url, config);
    return true;
  } catch {
    return false;
  }
}

const SAVE_DELAY_MS = 400;

/**
 * Manages user-specific screen configurations for both Grid Mode and Form Mode
 * (parity with Sankhya ERP personalização de tela por usuário).
 * DMTE-527 T2: lê e grava no servidor (GET/PUT /me/screen-preferences/:screenId), por usuário;
 * o localStorage só é lido uma vez, para importar o que o usuário já tinha.
 */
export function useUserScreenConfig(
  screenId: string,
  initialDefaults?: Partial<UserScreenConfig>
) {
  const user = useAuthStore((state) => state.user);
  const userId = user ? ((user as any).id ?? user.sub) : null;
  const url = `/me/screen-preferences/${screenId}`;

  const resolvedDefaults: UserScreenConfig = {
    grid: {
      columnVisibility: initialDefaults?.grid?.columnVisibility ?? DEFAULT_CONFIG.grid.columnVisibility,
      density: initialDefaults?.grid?.density ?? DEFAULT_CONFIG.grid.density,
      columnOrder: initialDefaults?.grid?.columnOrder ?? DEFAULT_CONFIG.grid.columnOrder,
    },
    form: {
      layout: initialDefaults?.form?.layout ?? DEFAULT_CONFIG.form.layout,
    },
    viewMode: initialDefaults?.viewMode ?? DEFAULT_CONFIG.viewMode,
    savedFilters: initialDefaults?.savedFilters ?? DEFAULT_CONFIG.savedFilters,
    groupBy: initialDefaults?.groupBy ?? DEFAULT_CONFIG.groupBy,
    collapsed: initialDefaults?.collapsed ?? DEFAULT_CONFIG.collapsed,
  };
  // Os chamadores passam objetos novos a cada render: o efeito de leitura não pode depender deles.
  const defaultsRef = useRef(resolvedDefaults);
  defaultsRef.current = resolvedDefaults;

  const [config, setConfig] = useState<UserScreenConfig>(resolvedDefaults);
  const [isLoading, setIsLoading] = useState(true);
  const configRef = useRef(config);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    configRef.current = defaultsRef.current;
    setConfig(defaultsRef.current);
    setIsLoading(true);
    (async () => {
      let next = defaultsRef.current;
      let imported = false;
      try {
        const server = parsePreference((await api.get(url)).data);
        const legacy = server && !hasContent(server) ? readLegacy(getStorageKey(userId, screenId)) : null;
        if (hasContent(server)) next = applyPreference(next, server);
        else if (hasContent(legacy)) {
          next = applyPreference(next, legacy);
          imported = true;
        }
      } catch {
        // leitura falhou: a tela segue com os padrões e grava na próxima mudança
      }
      if (cancelled) return;
      configRef.current = next;
      setConfig(next);
      setIsLoading(false);
      if (imported && (await persist(url, next))) {
        try {
          localStorage.removeItem(getStorageKey(userId, screenId));
        } catch {
          // ignore storage error
        }
      }
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        void persist(url, configRef.current);
      }
    };
  }, [url, userId, screenId]);

  /** Mostra a mudança na hora e grava no servidor 400 ms depois da última. */
  const update = useCallback(
    (change: (prev: UserScreenConfig) => UserScreenConfig) => {
      const next = change(configRef.current);
      configRef.current = next;
      setConfig(next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = undefined;
        void persist(url, configRef.current);
      }, SAVE_DELAY_MS);
    },
    [url]
  );

  const setColumnVisibility = useCallback(
    (updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) =>
      update((prev) => ({
        ...prev,
        grid: {
          ...prev.grid,
          columnVisibility: typeof updater === 'function' ? updater(prev.grid.columnVisibility) : updater,
        },
      })),
    [update]
  );

  const setColumnOrder = useCallback(
    (columnOrder: string[]) => update((prev) => ({ ...prev, grid: { ...prev.grid, columnOrder } })),
    [update]
  );

  const setDensity = useCallback(
    (density: 'compact' | 'comfortable') => update((prev) => ({ ...prev, grid: { ...prev.grid, density } })),
    [update]
  );

  const setFormLayout = useCallback(
    (layout: 'CASCADE' | 'SIDE_BY_SIDE') => update((prev) => ({ ...prev, form: { ...prev.form, layout } })),
    [update]
  );

  const setViewMode = useCallback(
    (viewMode: 'GRID' | 'FORM') => update((prev) => ({ ...prev, viewMode })),
    [update]
  );

  const setGroupBy = useCallback((groupBy: string) => update((prev) => ({ ...prev, groupBy })), [update]);

  const saveFilter = useCallback(
    (name: string, criteria: Record<string, any>) =>
      update((prev) => {
        const id = `filter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        return { ...prev, savedFilters: [...(prev.savedFilters ?? []), { id, name, criteria }] };
      }),
    [update]
  );

  const deleteFilter = useCallback(
    (filterId: string) =>
      update((prev) => ({ ...prev, savedFilters: (prev.savedFilters ?? []).filter((f) => f.id !== filterId) })),
    [update]
  );

  const restoreDefaults = useCallback(() => update(() => defaultsRef.current), [update]);

  /** Grava o recolhimento de uma coluna do Kanban; o mapa guarda só o que o usuário mexeu. */
  const setColumnCollapsed = useCallback(
    (columnId: string, collapsed: boolean) =>
      update((prev) => ({ ...prev, collapsed: { ...prev.collapsed, [columnId]: collapsed } })),
    [update]
  );

  return {
    config,
    /** Verdadeiro enquanto lê a preferência do servidor. */
    isLoading,
    setColumnCollapsed,
    setColumnVisibility,
    setColumnOrder,
    setDensity,
    setFormLayout,
    setViewMode,
    setGroupBy,
    saveFilter,
    deleteFilter,
    restoreDefaults,
  };
}
