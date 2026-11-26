import { HTMLAttributes, forwardRef, ReactNode, useState } from 'react';
import { cn } from './utils';
import { ChevronRight } from 'lucide-react';

export interface EzBreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
}

export interface EzBreadcrumbProps extends HTMLAttributes<HTMLElement> {
  items: EzBreadcrumbItem[];
}

/** Trilhas com mais de 3 itens colapsam os intermediários em tela estreita. */
const COLLAPSE_AFTER = 3;

const Separator = () => <ChevronRight aria-hidden="true" className="w-4 h-4 text-gray-300 mx-1 shrink-0" />;

/**
 * Aponta DS Breadcrumb
 * Indicates current page's location within a navigational hierarchy.
 *
 * Colapso mobile (DS-25): em trilhas com mais de 3 itens, os intermediários
 * ficam `max-sm:hidden` (CSS puro, abaixo de 640px) e uma reticência em botão
 * (`sm:hidden`) os revela. Escolha por CSS e não por matchMedia: não precisa
 * de efeito nem de estado de viewport e o teste confere as classes.
 */
export const EzBreadcrumb = forwardRef<HTMLElement, EzBreadcrumbProps>(
  ({ items, className, ...props }, ref) => {
    const [expanded, setExpanded] = useState(false);
    const collapsible = items.length > COLLAPSE_AFTER && !expanded;

    return (
      <nav
        ref={ref}
        aria-label="Trilha de navegação"
        className={cn('flex items-center text-[14px]', className)}
        {...props}
      >
        <ol className="flex items-center space-x-1.5 md:space-x-2">
          {items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            const hidden = collapsible && !isFirst && !isLast;
            const interactive = Boolean(item.href || item.onClick);
            const itemClass = cn(
              'inline-flex items-center gap-1.5 transition-colors font-medium',
              isLast ? 'text-brand-600' : 'text-gray-500 hover:text-brand-600',
              interactive && 'cursor-pointer ez-focus rounded-[4px]'
            );
            const content = (
              <>
                {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                {item.label}
              </>
            );
            const current = isLast ? ('page' as const) : undefined;

            const row = (
              <li key={index} className={cn('flex items-center', hidden && 'max-sm:hidden')}>
                {index > 0 && <Separator />}
                {item.href ? (
                  <a href={item.href} onClick={item.onClick} aria-current={current} className={itemClass}>
                    {content}
                  </a>
                ) : item.onClick ? (
                  <button type="button" onClick={item.onClick} aria-current={current} className={itemClass}>
                    {content}
                  </button>
                ) : (
                  <span aria-current={current} className={itemClass}>
                    {content}
                  </span>
                )}
              </li>
            );

            if (!(collapsible && isLast)) return row;
            return [
              <li key="collapsed" className="flex items-center sm:hidden">
                <Separator />
                <button
                  type="button"
                  aria-label="Mostrar itens intermediários"
                  aria-expanded="false"
                  onClick={() => setExpanded(true)}
                  className="ez-focus inline-flex items-center rounded-[6px] px-1 font-medium text-gray-500 hover:text-brand-600 cursor-pointer"
                >
                  <span aria-hidden="true">…</span>
                </button>
              </li>,
              row,
            ];
          })}
        </ol>
      </nav>
    );
  }
);

EzBreadcrumb.displayName = 'EzBreadcrumb';
