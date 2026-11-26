import { HTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from './utils';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface EzAlertProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Semantic variant of the alert.
   * @default 'info'
   */
  variant?: 'success' | 'warning' | 'error' | 'info';
  /**
   * Main title of the alert.
   */
  title?: string;
  /**
   * Action button or content to display on the far right.
   */
  action?: ReactNode;
  /**
   * If provided, shows an X button that fires this callback.
   */
  onClose?: () => void;
  /**
   * Custom icon (overrides the semantic default one).
   */
  icon?: ReactNode;
}

/**
 * Aponta DS Alert
 * Banner for contextual feedback messages.
 */
export const EzAlert = forwardRef<HTMLDivElement, EzAlertProps>(
  ({ variant = 'info', title, action, onClose, icon, children, className, role, ...props }, ref) => {
    // Map variants to colors and default icons
    const config = {
      success: {
        bg: 'bg-green-100',
        border: 'border-green-200',
        text: 'text-green-800',
        iconColor: 'text-green-600',
        Icon: CheckCircle2,
      },
      warning: {
        bg: 'bg-yellow-100',
        border: 'border-yellow-300',
        text: 'text-yellow-800',
        iconColor: 'text-yellow-600',
        Icon: AlertTriangle,
      },
      error: {
        bg: 'bg-red-100',
        border: 'border-red-200',
        text: 'text-red-800',
        iconColor: 'text-red-600',
        Icon: AlertCircle,
      },
      info: {
        bg: 'bg-petroleum-100',
        border: 'border-petroleum-200',
        text: 'text-petroleum-800',
        iconColor: 'text-petroleum-600',
        Icon: Info,
      },
    }[variant];

    const DefaultIcon = config.Icon;

    return (
      <div
        ref={ref}
        role={role ?? (variant === 'error' || variant === 'warning' ? 'alert' : 'status')}
        className={cn(
          'relative flex w-full flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-[12px] border transition-colors',
          config.bg,
          config.border,
          config.text,
          className
        )}
        {...props}
      >
        <div className={cn('shrink-0 mt-0.5', config.iconColor)}>
          {icon ? icon : <DefaultIcon className="w-5 h-5" />}
        </div>
        
        <div className="flex flex-1 flex-col gap-1">
          {title && <p className="font-semibold text-[14px] leading-tight">{title}</p>}
          {children && (
            <div className={cn('text-[14px] leading-relaxed', title ? 'opacity-90' : 'font-medium')}>
              {children}
            </div>
          )}
        </div>

        {(action || onClose) && (
          <div className="flex shrink-0 items-center justify-end gap-3 mt-2 sm:mt-0 sm:ml-auto">
            {action && <div>{action}</div>}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={cn('inline-flex min-h-8 min-w-8 items-center justify-center rounded-md transition-colors hover:bg-black/5 ez-focus', config.iconColor)}
                aria-label="Fechar"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);

EzAlert.displayName = 'EzAlert';
