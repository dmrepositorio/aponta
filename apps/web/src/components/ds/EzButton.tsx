import {
  ButtonHTMLAttributes,
  forwardRef,
  MouseEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import { cn } from './utils';
import { Loader2, LucideIcon } from 'lucide-react';

const RIPPLE_MS = 600;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface EzButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * The visual variant of the button.
   * @default 'primary'
   */
  variant?: 'primary' | 'secondary' | 'tertiary';
  /**
   * The size of the button.
   * @default 'medium'
   */
  size?: 'x-small' | 'small' | 'medium' | 'large';
  /**
   * Text label for the button. If omitted, you should provide an icon.
   */
  label?: string;
  /**
   * An optional icon to display on the left side of the label (or centered if no label).
   */
  leftIcon?: LucideIcon;
  /**
   * An optional icon to display on the right side of the label.
   */
  rightIcon?: LucideIcon;
  /**
   * Async action in progress: sets aria-busy, shows a spinner and blocks clicks
   * (onClick is not fired).
   * @default false
   */
  loading?: boolean;
  /**
   * Why the button is disabled. Exposed through aria-describedby (hidden text,
   * works even where `title` does not show on disabled buttons) and `title`.
   * Only applies while the button is disabled.
   */
  disabledReason?: string;
}

/**
 * Accessible name source: a visible label/children, or an explicit
 * aria-label / aria-labelledby for icon-only buttons.
 */
type EzButtonNameSource =
  | { label: string }
  | { children: NonNullable<ReactNode> }
  | { 'aria-label': string }
  | { 'aria-labelledby': string };

export type EzButtonProps = EzButtonBaseProps & EzButtonNameSource;

/**
 * Aponta DS Button (inspired by @sankhyalabs/ezui)
 * React native implementation with Tailwind CSS and Lucide Icons.
 */
export const EzButton = forwardRef<HTMLButtonElement, EzButtonProps>(
  (
    {
      variant = 'primary',
      size = 'medium',
      label,
      leftIcon: LeftIcon,
      rightIcon: RightIcon,
      className,
      disabled,
      children,
      onClick,
      loading = false,
      disabledReason,
      type = 'button',
      title,
      'aria-describedby': describedBy,
      ...props
    },
    ref
  ) => {
    const reasonId = useId();
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const isDisabled = disabled || loading;
    const reason = disabled && disabledReason ? disabledReason : undefined;

    // No pending ripple timer (or orphan span) after unmount.
    useEffect(() => {
      const pending = timers.current;
      return () => {
        pending.forEach(clearTimeout);
        pending.clear();
      };
    }, []);

    // We emulate the ripple effect via CSS + simple mouse position
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
      if (isDisabled) return;

      if (!prefersReducedMotion()) {
        const button = e.currentTarget;
        const rect = button.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const ripple = document.createElement('span');
        ripple.className =
          'pointer-events-none absolute w-[20px] h-[20px] rounded-full scale-0 animate-ripple z-0';

        // Ripple color depends on variant
        if (variant === 'primary') ripple.classList.add('bg-white/30');
        if (variant === 'secondary') ripple.classList.add('bg-brand-600/20');
        if (variant === 'tertiary') ripple.classList.add('bg-brand-600/15');

        ripple.style.left = `${x - 10}px`;
        ripple.style.top = `${y - 10}px`;

        button.appendChild(ripple);
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          ripple.remove();
        }, RIPPLE_MS);
        timers.current.add(timer);
      }

      onClick?.(e);
    };

    const hasNoLabel = !label && !children;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-describedby={[describedBy, reason ? reasonId : undefined].filter(Boolean).join(' ') || undefined}
        title={reason ?? title}
        onClick={handleClick}
        className={cn(
          // Base styles
          'relative flex items-center justify-center overflow-hidden whitespace-nowrap rounded-[24px] box-border transition-all duration-200 outline-none select-none',
          'ez-focus',
          'motion-safe:active:scale-[0.98] motion-safe:disabled:active:scale-100 disabled:cursor-not-allowed',
          // Variants
          variant === 'primary' &&
            'bg-brand-600 text-gray-70 border border-brand-600 hover:bg-brand-700 hover:border-brand-700 disabled:bg-gray-400 disabled:border-gray-400 disabled:text-gray-70',
          variant === 'secondary' &&
            'bg-transparent text-brand-600 border border-gray-200 hover:bg-gray-80 hover:border-gray-90 disabled:bg-gray-80 disabled:border-gray-200 disabled:text-gray-500',
          variant === 'tertiary' &&
            'bg-transparent text-brand-600 hover:text-brand-800 disabled:text-gray-400 disabled:bg-transparent',
          // Sizes
          size === 'x-small' && 'h-[28px] text-xs',
          size === 'small' && 'h-[32px] text-xs',
          size === 'medium' && 'h-[42px] text-sm',
          size === 'large' && 'h-[46px] text-base',
          // Padding logic (icon-only vs text)
          hasNoLabel && size === 'x-small' && 'w-[28px]',
          hasNoLabel && size === 'small' && 'w-[32px]',
          hasNoLabel && size === 'medium' && 'w-[42px]',
          hasNoLabel && size === 'large' && 'w-[46px]',
          !hasNoLabel && 'px-4', // Base horizontal padding
          className
        )}
        {...props}
      >
        {reason && (
          <span id={reasonId} hidden>
            {reason}
          </span>
        )}
        <div className="relative z-10 flex items-center gap-2">
          {loading && (
            <Loader2
              aria-hidden="true"
              className={cn(
                'shrink-0 animate-spin motion-reduce:animate-none',
                size === 'x-small' || size === 'small' ? 'h-3.5 w-3.5' : 'h-4 w-4'
              )}
            />
          )}

          {LeftIcon && !loading && (
            <LeftIcon
              className={cn(
                'shrink-0',
                size === 'x-small' || size === 'small' ? 'h-3.5 w-3.5' : 'h-4 w-4'
              )}
            />
          )}

          {(label || children) && (
            <span className="font-medium">
              {label || children}
            </span>
          )}

          {RightIcon && (
            <RightIcon
              className={cn(
                'shrink-0',
                size === 'x-small' || size === 'small' ? 'h-3.5 w-3.5' : 'h-4 w-4'
              )}
            />
          )}
        </div>
      </button>
    );
  }
);

EzButton.displayName = 'EzButton';
