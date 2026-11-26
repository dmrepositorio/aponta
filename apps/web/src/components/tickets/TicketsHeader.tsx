import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { EzSegmented } from '../ds';

export type TicketsViewMode = 'list' | 'kanban';

interface TicketsHeaderProps {
  isClient: boolean;
  viewMode: TicketsViewMode;
  onViewModeChange: (mode: TicketsViewMode) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenAdvancedSearch: () => void;
  /** Há requisição de chamados em curso: o campo Buscar expõe `aria-busy`. */
  isSearching?: boolean;
}

/**
 * Cabeçalho do painel de Tickets (SPEC DMTE-137 D3): esquerda "Tickets" +
 * alternância Lista/Kanban (oculta para CLIENT, que não tem Kanban);
 * direita campo Buscar (texto livre, debounced) + botão Busca avançada.
 */
export function TicketsHeader({
  isClient,
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  onOpenAdvancedSearch,
  isSearching = false,
}: TicketsHeaderProps) {
  const [searchText, setSearchText] = useState(search);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Atalho "/": foca Buscar, exceto quando a tecla é digitada num campo de texto
  // (aí é texto) ou combinada com Ctrl/Meta/Alt (atalho do navegador ou do sistema) ou com um diálogo aberto.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setSearchText(search);
  }, [search]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchText !== search) {
        onSearchChange(searchText);
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
      <div className="flex shrink-0 items-center gap-4">
        <h1 className="flex items-center text-[20px] font-semibold text-gray-900 sm:h-[var(--control-height-toolbar)]">Tickets</h1>
        {!isClient && (
          <EzSegmented
            size="toolbar"
            aria-label="Visualização"
            value={viewMode}
            onChange={onViewModeChange}
            options={[
              { value: 'list', label: 'Lista' },
              { value: 'kanban', label: 'Kanban' },
            ]}
          />
        )}
      </div>

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
        <div className="relative min-w-0 sm:flex-1 lg:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <label htmlFor="tickets-header-search" className="sr-only">
            Buscar
          </label>
          <input
            id="tickets-header-search"
            ref={searchInputRef}
            aria-keyshortcuts="/"
            title="Buscar (atalho: /)"
            type="search"
            name="search"
            autoComplete="off"
            aria-busy={isSearching}
            placeholder="Buscar…"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="w-full rounded-control max-sm:h-11 sm:h-[var(--control-height-toolbar)] lg:w-56 border border-gray-200 bg-white pl-8 pr-3 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>
        <button
          type="button"
          onClick={onOpenAdvancedSearch}
          className="w-full shrink-0 rounded-control max-sm:h-11 sm:h-[var(--control-height-toolbar)] sm:w-auto border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-90"
        >
          Busca avançada
        </button>
      </div>
    </div>
  );
}

export default TicketsHeader;
