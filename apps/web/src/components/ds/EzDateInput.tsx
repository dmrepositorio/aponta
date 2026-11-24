import { InputHTMLAttributes, forwardRef, useRef, useId } from 'react';
import { cn } from './utils';
import { AlertCircle, Calendar } from 'lucide-react';

export interface EzDateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  message?: string;
  hasError?: boolean;
}

/**
 * Aponta DS Date Input
 * Wraps the native browser date picker with the DS styling.
 *
 * Acessibilidade: sem a prop `id` o campo gera um (useId) e o rótulo se associa a ele; o
 * asterisco de obrigatório fica `aria-hidden` e o controle recebe `aria-required`.
 */
export const EzDateInput = forwardRef<HTMLInputElement, EzDateInputProps>(
  ({ label, message, hasError = false, className, disabled, id: idProp, required, 'aria-describedby': describedByProp, ...props }, ref) => {
    // We use a ref to programmatically open the date picker when clicking the icon
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const messageId = `${id}-message`;
    const describedBy = [describedByProp, hasError && message ? messageId : undefined].filter(Boolean).join(' ') || undefined;
    const fallbackRef = useRef<HTMLInputElement>(null);
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || fallbackRef;

    const wrapperClasses = cn(
      'relative flex items-center w-full overflow-hidden transition-colors border',
      'rounded-[12px] bg-white group h-[42px]',
      'ez-focus-within',
      hasError
        ? 'border-red-600 [--color-focus:var(--color-red-600)]'
        : 'border-gray-200 hover:border-gray-300 focus-within:border-brand-600',
      disabled && 'bg-gray-80 border-gray-100 cursor-not-allowed'
    );

    return (
      <div className={cn('flex flex-col w-full gap-1.5', className)}>
        {label && (
          <label
            htmlFor={id}
            className={cn(
              'text-[14px] font-medium leading-none mb-0.5 select-none',
              disabled ? 'text-gray-400' : 'text-gray-900',
              hasError && 'text-red-700'
            )}
          >
            {label}
            {required && (
              <span aria-hidden="true" className="ml-1 text-red-600">
                *
              </span>
            )}
          </label>
        )}

        <div 
          className={wrapperClasses}
          onClick={() => {
            if (!disabled && inputRef.current && 'showPicker' in HTMLInputElement.prototype) {
              try {
                inputRef.current.showPicker();
              } catch {
                // Ignore if showPicker fails (e.g. cross-origin iframe or unsupported)
                inputRef.current.focus();
              }
            }
          }}
        >
          <div className="flex items-center justify-center shrink-0 pl-3 pr-2 text-gray-500">
            <Calendar className="w-4 h-4 cursor-pointer" />
          </div>

          <input
            ref={inputRef}
            id={id}
            type="date"
            disabled={disabled}
            required={required}
            aria-required={required || undefined}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            className={cn(
              'flex-1 w-full bg-transparent border-none outline-none text-[14px] text-gray-900 placeholder:text-gray-400 h-full',
              'pr-3',
              // Hide the native icon in webkit based browsers to use our custom one
              '[&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer',
              disabled && 'text-gray-400 placeholder:text-gray-300 cursor-not-allowed'
            )}
            {...props}
          />
        </div>

        {message && (
          <div
            id={messageId}
            role={hasError ? 'alert' : undefined}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-medium leading-none mt-0.5',
              hasError ? 'text-red-700' : 'text-gray-500',
              disabled && 'text-gray-400'
            )}
          >
            {hasError && <AlertCircle className="w-3.5 h-3.5" />}
            <span>{message}</span>
          </div>
        )}
      </div>
    );
  }
);

EzDateInput.displayName = 'EzDateInput';
