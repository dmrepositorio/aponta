import { InputHTMLAttributes, forwardRef, ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from './utils';

export interface EzCheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /**
   * Label directly next to the checkbox.
   */
  label?: string | ReactNode;
  /**
   * Has an error state.
   */
  hasError?: boolean;
  /**
   * Help or error text below the checkbox. With `hasError` it is announced as the
   * field description (`aria-describedby`) and shown with an icon, so the error
   * does not depend on color alone.
   */
  message?: string;
  /**
   * Mixed state for "select all" over a partial selection: sets the input's
   * `indeterminate` property (not an HTML attribute), exposes `aria-checked="mixed"`
   * and draws a dash instead of the check.
   */
  indeterminate?: boolean;
  /**
   * Extra classes applied to the label <span> (e.g. 'line-through' for
   * completed checklist items).
   */
  labelClassName?: string;
}

/**
 * Aponta DS Checkbox
 */
export const EzCheck = forwardRef<HTMLInputElement, EzCheckProps>(
  (
    {
      label,
      hasError,
      message,
      indeterminate = false,
      labelClassName,
      className,
      disabled,
      id: idProp,
      'aria-describedby': describedByProp,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const messageId = `${id}-message`;
    const describedBy =
      [describedByProp, hasError && message ? messageId : undefined].filter(Boolean).join(' ') || undefined;

    const inputRef = useRef<HTMLInputElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );
    useEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = indeterminate;
    }, [indeterminate, props.checked]);

    const control = (
      <label
        className={cn(
          'inline-flex items-center gap-2 group cursor-pointer select-none',
          disabled && 'cursor-not-allowed opacity-60',
          !message && className
        )}
        htmlFor={id}
      >
        <div className="relative flex items-center justify-center">
          <input
            {...props}
            type="checkbox"
            id={id}
            ref={setRefs}
            disabled={disabled}
            aria-checked={indeterminate ? 'mixed' : undefined}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            className={cn(
              'peer appearance-none w-5 h-5 border-2 rounded transition-colors',
              'checked:bg-brand-600 checked:border-brand-600 ez-focus',
              indeterminate && 'bg-brand-600 border-brand-600',
              hasError ? 'border-red-600' : 'border-gray-300 hover:border-gray-400',
              disabled && 'border-gray-200 bg-gray-90'
            )}
          />
          {/* Custom mark drawn using SVG over the input: dash when mixed, check otherwise */}
          <svg
            aria-hidden="true"
            className={cn(
              'absolute w-3.5 h-3.5 pointer-events-none text-white stroke-current stroke-[3] fill-none stroke-linecap-round stroke-linejoin-round',
              indeterminate ? 'opacity-100' : 'opacity-0 peer-checked:opacity-100'
            )}
            viewBox="0 0 24 24"
          >
            {indeterminate ? <line x1="5" y1="12" x2="19" y2="12"></line> : <polyline points="20 6 9 17 4 12"></polyline>}
          </svg>
        </div>
        {label && (
          <span className={cn('text-[14px] font-medium text-gray-900', hasError && 'text-red-700', labelClassName)}>
            {label}
          </span>
        )}
      </label>
    );

    if (!message) return control;

    return (
      <div className={cn('inline-flex flex-col gap-1', className)}>
        {control}
        <div
          id={messageId}
          role={hasError ? 'alert' : undefined}
          className={cn(
            'flex items-center gap-1.5 text-[12px] font-medium leading-none',
            hasError ? 'text-red-700' : 'text-gray-500',
            disabled && 'text-gray-400'
          )}
        >
          {hasError && <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
          <span>{message}</span>
        </div>
      </div>
    );
  }
);

EzCheck.displayName = 'EzCheck';
