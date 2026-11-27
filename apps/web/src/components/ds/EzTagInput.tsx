import { InputHTMLAttributes, KeyboardEvent, forwardRef, useId, useMemo, useState } from 'react';
import { cn } from './utils';
import { X } from 'lucide-react';

export interface EzTagInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  /**
   * The current list of tags.
   */
  tags: string[];
  /**
   * Called with the full updated tag list whenever a tag is added or removed.
   */
  onChange: (tags: string[]) => void;
  /**
   * Placeholder shown in the text field when there are no tags yet.
   */
  placeholder?: string;
  /**
   * Optional label displayed above the field.
   */
  label?: string;
  /**
   * Existing tags offered while typing (matched ignoring case). A tag already
   * selected is never offered, and typed text that matches a suggestion is
   * added with the suggestion's casing.
   */
  suggestions?: string[];
  /**
   * Commit the typed text as a tag when the field loses focus.
   */
  addOnBlur?: boolean;
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Aponta DS Tag Input (inspired by @sankhyalabs/ezui)
 * A text field that turns typed text into removable tags (Enter or comma to add,
 * X to remove). With `suggestions` it behaves as a combobox: the arrow keys move
 * through the matches and Enter picks the active one. Tags are unique ignoring case.
 */
export const EzTagInput = forwardRef<HTMLInputElement, EzTagInputProps>(
  (
    {
      tags,
      onChange,
      placeholder = 'Adicionar e pressionar Enter...',
      label,
      className,
      disabled,
      id,
      suggestions,
      addOnBlur = false,
      onBlur,
      ...props
    },
    ref
  ) => {
    const [draft, setDraft] = useState('');
    const [activeIndex, setActiveIndex] = useState(-1);
    const [dismissed, setDismissed] = useState(false);
    const listId = useId();

    const matches = useMemo(() => {
      const text = draft.trim().toLowerCase();
      if (!suggestions || !text) return [];
      const seen: string[] = [];
      for (const suggestion of suggestions) {
        if (!suggestion.toLowerCase().includes(text)) continue;
        if (tags.some((t) => sameTag(t, suggestion))) continue;
        if (seen.some((s) => sameTag(s, suggestion))) continue;
        seen.push(suggestion);
      }
      return seen;
    }, [draft, suggestions, tags]);

    const open = !dismissed && matches.length > 0;
    const optionId = (index: number) => `${listId}-option-${index}`;

    const addTag = (raw: string) => {
      const typed = raw.trim();
      if (typed) {
        const value = suggestions?.find((s) => sameTag(s, typed)) ?? typed;
        if (!tags.some((t) => sameTag(t, value))) {
          onChange([...tags, value]);
        }
      }
      setDraft('');
      setActiveIndex(-1);
      setDismissed(false);
    };

    const removeTag = (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(open && activeIndex >= 0 ? matches[activeIndex] : draft);
      } else if (e.key === ',') {
        e.preventDefault();
        addTag(draft);
      } else if (e.key === 'ArrowDown' && matches.length > 0) {
        e.preventDefault();
        setDismissed(false);
        setActiveIndex((i) => (i + 1) % matches.length);
      } else if (e.key === 'ArrowUp' && matches.length > 0) {
        e.preventDefault();
        setDismissed(false);
        setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        setActiveIndex(-1);
      } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
        removeTag(tags[tags.length - 1]);
      }
    };

    return (
      <div className={cn('relative flex flex-col w-full gap-1.5', className)}>
        {label && (
          <label
            htmlFor={id}
            className={cn(
              'text-[14px] font-medium leading-none mb-0.5 select-none',
              disabled ? 'text-gray-400' : 'text-gray-900'
            )}
          >
            {label}
          </label>
        )}

        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 w-full min-h-[42px] px-2 py-1.5 border rounded-[12px] bg-white transition-colors',
            'focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600',
            'border-gray-200 hover:border-gray-300',
            disabled && 'bg-gray-80 border-gray-100 cursor-not-allowed'
          )}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-[24px] bg-brand-100/50 border border-brand-200 text-brand-700 text-[12px] font-medium px-2 py-1"
            >
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remover ${tag}`}
                  className="rounded-full hover:bg-brand-200/60 p-0.5 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}

          <input
            ref={ref}
            id={id}
            type="text"
            disabled={disabled}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setActiveIndex(-1);
              setDismissed(false);
            }}
            onKeyDown={handleKeyDown}
            onBlur={(e) => {
              if (addOnBlur) addTag(draft);
              onBlur?.(e);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-[14px] text-gray-900 placeholder:text-gray-400 py-1"
            {...(suggestions
              ? {
                  role: 'combobox',
                  'aria-autocomplete': 'list' as const,
                  'aria-expanded': open,
                  'aria-controls': open ? listId : undefined,
                  'aria-activedescendant': open && activeIndex >= 0 ? optionId(activeIndex) : undefined,
                }
              : {})}
            {...props}
          />
        </div>

        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-[12px] border border-gray-200 bg-white py-1 shadow-md"
          >
            {matches.map((suggestion, index) => (
              <li
                key={suggestion}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                // mousedown keeps the focus in the field, so the blur commit does not fire first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(suggestion);
                }}
                className={cn(
                  'cursor-pointer px-3 py-1.5 text-[14px] text-gray-900',
                  index === activeIndex ? 'bg-brand-50' : 'hover:bg-gray-90'
                )}
              >
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
);

EzTagInput.displayName = 'EzTagInput';
