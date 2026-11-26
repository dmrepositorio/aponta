import { HTMLAttributes, Ref, forwardRef } from 'react';
import { cn } from './utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface EzPaginationProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange'> {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
  /**
   * Total de registros da lista. Junto com `pageSize` exibe o resumo
   * "Mostrando 1–25 de 312" (aria-live polite), inclusive com 1 página.
   * Sem as duas props o comportamento anterior é mantido (nada com 1 página).
   */
  totalItems?: number;
  /** Registros por página; usado só para calcular o intervalo do resumo. */
  pageSize?: number;
  /**
   * Only emit events, does not control state. Allows parent to control URL params.
   */
}

// Alvo de 44px só com ponteiro grosseiro: no desktop o controle segue com 32px.
const TARGET = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';

const summaryText = (currentPage: number, totalItems: number, pageSize: number): string => {
  if (totalItems <= 0) return 'Nenhum registro';
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  return `Mostrando ${start}–${end} de ${totalItems}`;
};

/**
 * Aponta DS Pagination
 */
export const EzPagination = forwardRef<HTMLElement, EzPaginationProps>(
  ({ currentPage, totalPages, onChange, totalItems, pageSize, className, ...props }, ref) => {
    // Generate page numbers for a sliding window around the current page
    const getPageNumbers = () => {
      const delta = 1;
      const range: number[] = [];
      const rangeWithDots: (number | string)[] = [];
      let l: number | undefined;

      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
          range.push(i);
        }
      }

      for (const i of range) {
        if (l !== undefined) {
          if (i - l === 2) {
            rangeWithDots.push(l + 1);
          } else if (i - l !== 1) {
            rangeWithDots.push('…');
          }
        }
        rangeWithDots.push(i);
        l = i;
      }

      return rangeWithDots;
    };

    const summary =
      totalItems !== undefined && pageSize !== undefined && pageSize > 0
        ? summaryText(currentPage, totalItems, pageSize)
        : null;

    if (totalPages <= 1) {
      if (!summary) return null;
      return (
        <p
          ref={ref as Ref<HTMLParagraphElement>}
          aria-live="polite"
          className={cn('text-[14px] text-gray-500', className)}
        >
          {summary}
        </p>
      );
    }

    return (
      <nav
        ref={ref}
        aria-label="Paginação"
        className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}
        {...props}
      >
        {summary && (
          <span aria-live="polite" className="text-[14px] text-gray-500">
            {summary}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(currentPage - 1)}
            disabled={currentPage === 1}
            aria-label="Página anterior"
            className={cn(
              'ez-focus flex items-center justify-center p-2 rounded-[8px] text-gray-500 hover:bg-gray-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
              TARGET
            )}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          {getPageNumbers().map((page, index) => {
            if (typeof page === 'string') {
              return (
                <span key={`dot-${index}`} aria-hidden="true" className="px-3 py-2 text-gray-500">
                  {page}
                </span>
              );
            }

            const isCurrent = page === currentPage;

            return (
              <button
                key={`page-${page}`}
                type="button"
                onClick={() => !isCurrent && onChange(page)}
                aria-label={`Página ${page}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'ez-focus min-w-[32px] h-[32px] px-2 rounded-[8px] text-[14px] font-medium transition-colors flex items-center justify-center',
                  '[@media(pointer:coarse)]:h-auto',
                  TARGET,
                  isCurrent ? 'bg-brand-100 text-brand-700' : 'text-gray-700 hover:bg-gray-90'
                )}
              >
                {page}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            aria-label="Próxima página"
            className={cn(
              'ez-focus flex items-center justify-center p-2 rounded-[8px] text-gray-500 hover:bg-gray-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
              TARGET
            )}
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </nav>
    );
  }
);

EzPagination.displayName = 'EzPagination';
