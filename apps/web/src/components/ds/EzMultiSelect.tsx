import { InputHTMLAttributes, forwardRef, useEffect, useId, useRef, useState } from 'react';
import { cn } from './utils';
import { AlertCircle, Check, ChevronDown, X } from 'lucide-react';
import { EzTag } from './EzTag';

export interface EzMultiSelectOption {
  label: string;
  value: string | number;
}

export interface EzMultiSelectProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  label?: string;
  message?: string;
  hasError?: boolean;
  value?: (string | number)[];
  onChange?: (values: (string | number)[]) => void;
  options?: EzMultiSelectOption[];
  onSearchChange?: (term: string) => void;
  placeholder?: string;
}

/**
 * Aponta DS Multi Select
 * Allows selecting multiple options from a dropdown, displaying them as tags.
 *
 * Acessibilidade: sem a prop `id` o campo gera um (useId) e o rótulo se associa a ele; o
 * asterisco de obrigatório fica `aria-hidden` e o controle recebe `aria-required`.
 *
 * Padrão combobox (DS-14): o input é `role="combobox"` (aria-expanded, aria-controls,
 * aria-activedescendant); a lista é `role="listbox"` com `aria-multiselectable` e os itens
 * são `role="option"` com `aria-selected`. Setas movem a opção ativa, Enter alterna, Esc fecha.
 * Em erro o campo recebe `aria-invalid` e a mensagem entra em `aria-describedby`.
 */
export const EzMultiSelect = forwardRef<HTMLInputElement, EzMultiSelectProps>(
  (
    {
      label,
      message,
      hasError = false,
      value = [],
      onChange,
      options = [],
      onSearchChange,
      disabled,
      className,
      placeholder = 'Selecione as opções...',
      id: idProp,
      required,
      'aria-describedby': describedByProp,
      onKeyDown: onKeyDownProp,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const listId = `${id}-listbox`;
    const messageId = `${id}-message`;
    const describedBy =
      [describedByProp, hasError && message ? messageId : undefined].filter(Boolean).join(' ') || undefined;
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [active, setActive] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    // Get selected option objects
    const selectedOptions = options.filter((opt) => value.includes(opt.value));

    useEffect(() => {
      const handleOutsideClick = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
          setActive(-1);
          setSearchTerm('');
          if (onSearchChange) onSearchChange('');
        }
      };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [onSearchChange]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setSearchTerm(text);
      setIsOpen(true);
      setActive(-1);
      if (onSearchChange) {
        onSearchChange(text);
      }
    };

    const toggleOption = (opt: EzMultiSelectOption) => {
      if (!onChange) return;
      const isSelected = value.includes(opt.value);
      if (isSelected) {
        onChange(value.filter((v) => v !== opt.value));
      } else {
        onChange([...value, opt.value]);
      }
    };

    const removeOption = (e: React.MouseEvent, optValue: string | number) => {
      e.stopPropagation();
      onChange?.(value.filter((v) => v !== optValue));
    };

    const clearAll = (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange?.([]);
    };

    const visibleOptions = onSearchChange
      ? options
      : options.filter((opt) =>
          opt.label.toLowerCase().includes(searchTerm.toLowerCase())
        );

    const activeIndex = isOpen && active >= 0 && active < visibleOptions.length ? active : -1;
    const optionId = (index: number) => `${listId}-${index}`;

    // Lista longa: a opção ativa pelo teclado precisa continuar visível.
    useEffect(() => {
      if (activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, listId]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDownProp?.(e);
      if (e.defaultPrevented) return;
      const last = visibleOptions.length - 1;
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setActive(last < 0 ? -1 : e.key === 'ArrowDown' ? 0 : last);
          } else if (last >= 0) {
            setActive(
              e.key === 'ArrowDown'
                ? activeIndex >= last
                  ? 0
                  : activeIndex + 1
                : activeIndex <= 0
                  ? last
                  : activeIndex - 1
            );
          }
          break;
        case 'Enter':
          // Sem opção ativa o Enter segue o comportamento normal do formulário.
          if (activeIndex >= 0) {
            e.preventDefault();
            toggleOption(visibleOptions[activeIndex]);
          }
          break;
        case 'Escape':
          if (!isOpen) break;
          e.stopPropagation();
          setIsOpen(false);
          setActive(-1);
          break;
        case 'Tab':
          setIsOpen(false);
          setActive(-1);
          break;
      }
    };

    const wrapperClasses = cn(
      'relative flex items-start flex-wrap w-full transition-colors border ez-focus-within',
      'rounded-[12px] bg-white group min-h-[42px] py-1.5',
      isOpen || hasError ? 'border-brand-600 ring-1 ring-brand-600' : 'border-gray-200 hover:border-gray-300',
      hasError && !isOpen && 'border-red-600 ring-red-600',
      hasError && '[--color-focus:var(--color-red-600)]',
      disabled && 'bg-gray-80 border-gray-100 cursor-not-allowed'
    );

    return (
      <div className={cn('flex flex-col w-full gap-1.5 relative', className)} ref={containerRef}>
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
            if (!disabled) setIsOpen(true);
          }}
        >
          <div className="flex flex-wrap gap-1.5 pl-3 pr-8 flex-1 items-center">
            {selectedOptions.map((opt) => (
              <EzTag
                key={opt.value}
                label={opt.label}
                variant="outline"
                className="bg-white"
                rightIcon={
                  !disabled && (
                    <button
                      type="button"
                      aria-label={`Remover ${opt.label}`}
                      onClick={(e) => removeOption(e, opt.value)}
                      className="inline-flex items-center justify-center ml-1 rounded cursor-pointer hover:text-red-600 ez-focus"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )
                }
              />
            ))}

            <input
              ref={ref}
              id={id}
              type="text"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls={isOpen ? listId : undefined}
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              aria-required={required || undefined}
              aria-invalid={hasError || undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              value={searchTerm}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsOpen(true)}
              placeholder={value.length === 0 ? placeholder : ''}
              className={cn(
                'flex-1 min-w-[120px] bg-transparent border-none outline-none text-[14px] text-gray-900 placeholder:text-gray-400',
                disabled && 'text-gray-400 cursor-not-allowed hidden'
              )}
              autoComplete="off"
              {...props}
            />
          </div>

          <div className="absolute right-2 top-0 h-[42px] flex items-center justify-center shrink-0 text-gray-500 gap-1 opacity-70 bg-white/80">
            {value.length > 0 && !disabled && (
              <button
                type="button"
                onClick={clearAll}
                className="p-1 rounded-full hover:bg-gray-100 transition-colors ez-focus"
                title="Limpar todos"
                aria-label="Limpar todos"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
          </div>
        </div>

        {/* Dropdown Options */}
        {isOpen && (
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label ?? props['aria-label']}
            className="absolute top-[calc(100%-4px)] left-0 w-full z-50 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-[8px] shadow-lg py-1"
          >
            {visibleOptions.length === 0 ? (
              <li role="presentation" className="px-4 py-3 text-sm text-gray-500 text-center">
                Nenhum resultado encontrado
              </li>
            ) : (
              visibleOptions.map((opt, index) => {
                const isSelected = value.includes(opt.value);
                return (
                  <li
                    key={opt.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => toggleOption(opt)}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 text-sm cursor-pointer mx-1 rounded-[4px] transition-colors',
                      isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-900',
                      index === activeIndex && 'bg-brand-50',
                      !isSelected && index !== activeIndex && 'hover:bg-gray-90'
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className="w-4 h-4 text-brand-600 shrink-0 ml-2" aria-hidden="true" />}
                  </li>
                );
              })
            )}
          </ul>
        )}

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
            {hasError && <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{message}</span>
          </div>
        )}
      </div>
    );
  }
);

EzMultiSelect.displayName = 'EzMultiSelect';
