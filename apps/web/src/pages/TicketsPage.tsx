import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TicketList } from '../components/tickets/TicketList';
import { TicketKanban } from '../components/tickets/TicketKanban';
import {
  TicketActiveFilters,
  hasActiveFilters,
  type ActiveFilterKey,
} from '../components/tickets/TicketActiveFilters';
import { TicketShortcuts } from '../components/tickets/TicketShortcuts';
import { TicketsHeader, type TicketsViewMode } from '../components/tickets/TicketsHeader';
import { EzAlert, EzButton, EzSpinner } from '../components/ds';
import { useTicketFilterNames } from '../hooks/useTicketFilterNames';
import type { TicketFiltersInput } from '../hooks/useTickets';
import { useTickets } from '../hooks/useTickets';
import { useAuthStore } from '../stores/authStore';
import { useOpenInTab } from '../contexts/TabsContext';
import {
  filtersToSearchParams,
  parseFiltersFromSearchParams,
} from '../lib/ticketFilterParams';

/** 403 é falta de permissão; o resto (rede, 5xx) é falha de carga que vale tentar de novo. */
function loadErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 403
    ? 'Você não tem permissão para ver estes chamados.'
    : 'Falha ao carregar os chamados. Verifique a conexão e tente novamente.';
}

const countLabel = (total: number) => `${total} ${total === 1 ? 'chamado' : 'chamados'}`;

export function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TicketFiltersInput>(() =>
    parseFiltersFromSearchParams(searchParams),
  );
  const { data, isLoading, isError, error, isFetching, isPlaceholderData, refetch } = useTickets(filters);
  const filterNames = useTicketFilterNames(filters);
  const user = useAuthStore((state) => state.user);
  const isClient = user?.role === 'CLIENT';
  const openInTab = useOpenInTab();

  // One-way sync: filters state -> URL, so every change the user makes via
  // Busca avançada/pagination stays reflected in a shareable, bookmarkable
  // URL and survives a back-button navigation. `replace` avoids piling up
  // a history entry per filter tweak.
  useEffect(() => {
    setSearchParams(filtersToSearchParams(filters), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Agentes default to Kanban, Clientes default to Lista; modo fica na URL
  // (?view=list|kanban, D3) para ser bookmarkable como os filtros.
  const [viewMode, setViewMode] = useState<TicketsViewMode>(() => {
    const fromUrl = searchParams.get('view');
    if (fromUrl === 'list' || fromUrl === 'kanban') return fromUrl;
    return isClient ? 'list' : 'kanban';
  });

  // Only writes `?view=` once `viewMode` actually CHANGES from what this
  // effect last saw — never on mount, where it still equals the value
  // `viewMode`'s own lazy initializer above already read from the URL (or
  // picked as the role default). A plain "first render" boolean ref is NOT
  // enough here: React 18 StrictMode (apps/web/src/main.tsx) double-invokes
  // effects on the initial mount commit, which would flip a one-shot flag
  // on the first invocation and then fall through to the write on the
  // immediate second one — reintroducing `?view=` on a bare `/` URL and
  // breaking `toHaveURL('/')` right after login (auth/dashboard/tickets
  // e2e specs). Comparing against the last-seen VALUE is idempotent across
  // that double-invoke, since the value never changed between the two.
  const lastSyncedViewMode = useRef(viewMode);
  useEffect(() => {
    if (lastSyncedViewMode.current === viewMode) {
      return;
    }
    lastSyncedViewMode.current = viewMode;
    const params = new URLSearchParams(searchParams);
    if (params.get('view') !== viewMode) {
      params.set('view', viewMode);
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Sync: se client, trava em list
  useEffect(() => {
    if (isClient && viewMode === 'kanban') {
      setViewMode('list');
    }
  }, [isClient, viewMode]);

  const tickets = data?.data ?? [];
  const meta = data?.meta;
  const currentPage = filters.page ?? 1;
  const foundCount = meta?.total ?? tickets.length;

  const resetFilters = () =>
    setFilters((prev) => ({ sortBy: prev.sortBy, sortDir: prev.sortDir }));
  const removeFilter = (key: ActiveFilterKey) =>
    setFilters((prev) => {
      const next: TicketFiltersInput = { ...prev, page: 1 };
      if (key === 'period') {
        delete next.dateFrom;
        delete next.dateTo;
        delete next.dateField;
      } else {
        delete next[key];
      }
      return next;
    });

  return (
    <div className="space-y-4">
      <TicketsHeader
        isClient={isClient}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        search={filters.search ?? ''}
        onSearchChange={(search) =>
          setFilters((prev) => ({ ...prev, search: search || undefined, page: 1 }))
        }
        onOpenAdvancedSearch={() => {
          const query = filtersToSearchParams(filters).toString();
          openInTab(query ? `/tickets/search?${query}` : '/tickets/search', 'Busca avançada');
        }}
        isSearching={isFetching}
      />

      {/* Anuncia o resultado a leitores de tela quando a busca ou os filtros mudam a contagem. */}
      {!isLoading && !isError && (
        <p role="status" aria-live="polite" className="sr-only">
          {foundCount} {foundCount === 1 ? 'chamado encontrado' : 'chamados encontrados'}
        </p>
      )}

      {viewMode === 'list' && (
        <TicketShortcuts
          role={user?.role}
          status={filters.status}
          closedOnly={filters.closedOnly}
          mine={filters.mine}
          unassigned={filters.unassigned}
          overdue={filters.overdue}
          paused={filters.paused}
          onSelect={(patch) => setFilters((prev) => ({ ...prev, ...patch, page: 1 }))}
        />
      )}

      {viewMode === 'list' && (
        <TicketActiveFilters
          filters={filters}
          onReset={resetFilters}
          onRemove={removeFilter}
          names={filterNames}
        />
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <EzSpinner label="Carregando chamados…" />
        </div>
      ) : isError ? (
        <EzAlert
          variant="error"
          action={
            <EzButton
              variant="secondary"
              size="small"
              label="Tentar novamente"
              loading={isFetching}
              onClick={() => void refetch()}
            />
          }
        >
          {loadErrorMessage(error)}
        </EzAlert>
      ) : viewMode === 'kanban' ? (
        <div aria-busy={isFetching} className={isPlaceholderData ? 'space-y-3 opacity-60' : 'space-y-3'}>
          {/* O Kanban recebe só a primeira página; avisa quando há mais chamados do que os exibidos. */}
          {meta && meta.total > tickets.length ? (
            <EzAlert variant="info">
              Mostrando {tickets.length} de {meta.total} chamados, refine os filtros.
            </EzAlert>
          ) : (
            meta && <p className="text-sm text-gray-500">{countLabel(meta.total)}</p>
          )}
          <TicketKanban
            tickets={tickets}
            isLoading={isLoading}
            isError={isError}
            initialServiceDeskId={filters.serviceDeskId}
          />
        </div>
      ) : (
        /* ================= LIST VIEW (MODO LISTA) ================= */
        <div aria-busy={isFetching} className={isPlaceholderData ? 'space-y-4 opacity-60' : 'space-y-4'}>
          <TicketList
            tickets={tickets}
            isLoading={isLoading}
            hasFilters={hasActiveFilters(filters)}
            onResetFilters={resetFilters}
            totalPages={meta?.totalPages}
            sortBy={filters.sortBy}
            sortDir={filters.sortDir}
            onSortChange={(sortBy, sortDir) =>
              setFilters((prev) => ({ ...prev, sortBy, sortDir, page: 1 }))
            }
          />
          {meta && meta.totalPages <= 1 && (
            <p className="pt-2 text-sm text-gray-500">{countLabel(meta.total)}</p>
          )}
          {meta && meta.totalPages > 1 && (
            <nav
              aria-label="Paginação de chamados"
              className="flex items-center justify-between pt-2 text-sm"
            >
              <span className="text-gray-500">
                Página {meta.page} de {meta.totalPages} ({meta.total}{' '}
                {meta.total === 1 ? 'chamado' : 'chamados'})
              </span>
              <div className="flex gap-2">
                <EzButton
                  variant="secondary"
                  size="small"
                  label="Anterior"
                  disabled={currentPage <= 1}
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, page: currentPage - 1 }))
                  }
                />
                <EzButton
                  variant="secondary"
                  size="small"
                  label="Próxima"
                  disabled={currentPage >= meta.totalPages}
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, page: currentPage + 1 }))
                  }
                />
              </div>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

export default TicketsPage;
