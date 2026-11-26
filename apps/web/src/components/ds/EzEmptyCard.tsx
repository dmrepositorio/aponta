import { ReactNode } from 'react';
import { cn } from './utils';
import { AlertCircle, Inbox, LucideIcon } from 'lucide-react';
import { EzButton } from './EzButton';

export interface EzEmptyCardProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * `default` covers empty and no-result states. `error` signals a failed load
   * and shows a "Tentar novamente" button when `onRetry` is provided.
   * @default 'default'
   */
  variant?: 'default' | 'error';
  /** Called by the "Tentar novamente" button (only in the `error` variant). */
  onRetry?: () => void;
}

export function EzEmptyCard({ icon, title, description, action, className, variant = 'default', onRetry }: EzEmptyCardProps) {
  const isError = variant === 'error';
  const Icon = icon ?? (isError ? AlertCircle : Inbox);
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[24px] border border-gray-200 bg-gray-80 px-6 py-10 text-center',
        className
      )}
    >
      <Icon className={cn('h-10 w-10', isError ? 'text-red-600' : 'text-gray-400')} aria-hidden="true" />
      <div className="text-[15px] font-semibold text-gray-900">{title}</div>
      {description && <div className="max-w-sm text-[13px] text-gray-500">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
      {isError && onRetry && (
        <div className="mt-2">
          <EzButton variant="secondary" size="small" label="Tentar novamente" onClick={onRetry} />
        </div>
      )}
    </div>
  );
}
