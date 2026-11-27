import { InputHTMLAttributes, KeyboardEvent, forwardRef, useId, useState } from 'react';
import { cn } from './utils';
import { Pencil } from 'lucide-react';

export interface EzTextEditProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  /**
   * The current text value.
   */
  value: string;
  /**
   * Called with the new value when editing is committed (Enter or blur).
   */
  onChange: (value: string) => void;
  /**
   * Optional extra callback fired alongside `onChange` when the value is saved.
   */
  onSave?: (value: string) => void;
  /**
   * The saved value is being persisted: shows "Salvando…" next to the text and marks the button busy.
   */
  saving?: boolean;
  /**
   * Message of the last failed save, shown next to the text and linked to the button.
   */
  error?: string;
}

/**
 * Aponta DS Text Edit (inspired by @sankhyalabs/ezui)
 * Clickable text that turns into an inline editable input; Enter or blur saves it.
 */
export const EzTextEdit = forwardRef<HTMLInputElement, EzTextEditProps>(
  ({ value, onChange, onSave, saving, error, className, disabled, placeholder, ...props }, ref) => {
    const feedbackId = useId();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);

    const startEdit = () => {
      if (disabled) return;
      setDraft(value);
      setEditing(true);
    };

    const commit = () => {
      setEditing(false);
      onChange(draft);
      onSave?.(draft);
    };

    const cancel = () => {
      setDraft(value);
      setEditing(false);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };

    if (editing) {
      return (
        <input
          ref={ref}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'px-2 py-1 text-[14px] text-gray-900 border border-brand-600 rounded-[8px] outline-none',
            'ring-1 ring-brand-600 bg-white',
            className
          )}
          {...props}
        />
      );
    }

    return (
      <>
        <button
          type="button"
          onClick={startEdit}
          disabled={disabled}
          aria-busy={saving || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? feedbackId : undefined}
          className={cn(
            'group inline-flex items-center gap-1.5 px-2 py-1 rounded-[8px] text-[14px] text-gray-900 text-left transition-colors',
            'hover:bg-gray-90 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            className
          )}
        >
          <span className={cn(!value && 'text-gray-400')}>
            {value || placeholder || 'Clique para editar'}
          </span>
          {!disabled && (
            <Pencil className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
        <span aria-live="polite" className="contents">
          {saving && <span className="ml-1 text-xs text-gray-600">Salvando…</span>}
          {!saving && error && (
            <span id={feedbackId} className="ml-1 text-xs text-red-700">
              {error}
            </span>
          )}
        </span>
      </>
    );
  }
);

EzTextEdit.displayName = 'EzTextEdit';
