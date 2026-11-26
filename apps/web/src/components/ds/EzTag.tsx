import { HTMLAttributes, Ref, forwardRef, ReactNode } from 'react';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { cn } from './utils';

export interface EzTagProps extends HTMLAttributes<HTMLElement> {
  /**
   * Main text of the tag.
   */
  label: string;
  /**
   * The variant style based on Aponta palettes.
   * @default 'ocean'
   */
  variant?: 'ocean' | 'gray' | 'green' | 'yellow' | 'red' | 'petroleum' | 'outline';
  /**
   * Prepend an icon. Substitui o indicador automático das variantes green/yellow/red.
   */
  leftIcon?: ReactNode;
  /**
   * Append an icon (e.g. an "X" button to dismiss).
   */
  rightIcon?: ReactNode;
}

const SEVERITY_INDICATORS = {
  green: { kind: 'success', Icon: CircleCheck },
  yellow: { kind: 'warning', Icon: TriangleAlert },
  red: { kind: 'danger', Icon: CircleX },
} as const;

/**
 * Aponta DS Tag (Chip)
 * Pill shaped element for status, categories, or filters.
 *
 * Renderiza um `span`; com `onClick` renderiza um `button type="button"`.
 * As variantes green/yellow/red mostram um ícone de prefixo distinto (check,
 * alerta, X) para que a severidade não dependa só da cor (WCAG 1.4.1).
 */
export const EzTag = forwardRef<HTMLElement, EzTagProps>(
  ({ label, variant = 'ocean', leftIcon, rightIcon, className, onClick, ...props }, ref) => {
    const severity =
      !leftIcon && (variant === 'green' || variant === 'yellow' || variant === 'red')
        ? SEVERITY_INDICATORS[variant]
        : null;
    const Root = (onClick ? 'button' : 'span') as 'span';
    return (
      <Root
        ref={ref as Ref<HTMLSpanElement>}
        data-ez-tag=""
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        className={cn(
          'inline-flex items-center justify-center rounded-[24px] px-2.5 py-1 min-w-[32px] min-h-[24px]',
          'text-[12px] font-medium leading-none select-none transition-colors border',
          // Variants mapping to Sankhya semantic colors
          variant === 'ocean' && 'bg-brand-100/50 text-brand-700 border-brand-200',
          variant === 'gray' && 'bg-gray-90 text-gray-700 border-gray-200',
          variant === 'green' && 'bg-green-100 text-green-800 border-green-200',
          variant === 'yellow' && 'bg-yellow-100 text-yellow-800 border-yellow-300',
          variant === 'red' && 'bg-red-100 text-red-800 border-red-200',
          variant === 'petroleum' && 'bg-petroleum-100 text-petroleum-800 border-petroleum-200',
          variant === 'outline' && 'bg-transparent text-gray-700 border-gray-300',
          onClick && 'cursor-pointer hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600',
          className
        )}
        {...props}
      >
        {severity && (
          <severity.Icon
            data-testid="ez-tag-indicator"
            data-indicator={severity.kind}
            aria-hidden="true"
            className="mr-1 -ml-0.5 h-3 w-3 shrink-0"
          />
        )}
        {leftIcon && (
          <span className="flex items-center justify-center mr-1.5 -ml-0.5">
            {leftIcon}
          </span>
        )}
        <span>{label}</span>
        {rightIcon && (
          <span className="flex items-center justify-center ml-1.5 -mr-0.5">
            {rightIcon}
          </span>
        )}
      </Root>
    );
  }
);

EzTag.displayName = 'EzTag';
