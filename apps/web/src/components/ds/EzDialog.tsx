import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './utils';
import { EzButton } from './EzButton';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useScrollLock } from '../../hooks/useScrollLock';
import { AlertTriangle, Info, X } from 'lucide-react';

export interface EzDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'info' | 'danger' | 'warning';
  /** Conteúdo extra abaixo da mensagem (lista, detalhes). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  /** Ação em andamento: desabilita o Confirmar (aria-busy) e impede cliques repetidos. */
  confirmLoading?: boolean;
}

export function EzDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  variant = 'info',
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmDisabled = false,
  confirmLoading = false,
}: EzDialogProps) {
  useEscapeLayer(onCancel, open);
  useScrollLock(open);
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepFocusInside = useFocusTrap(dialogRef, open);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Ação destrutiva abre com o foco na ação segura.
  useEffect(() => {
    if (open && variant === 'danger') cancelRef.current?.focus();
  }, [open, variant]);

  if (!open) return null;

  const Icon = variant === 'info' ? Info : AlertTriangle;
  const iconClass = cn(
    'h-5 w-5 shrink-0',
    variant === 'danger' && 'text-red-600',
    variant === 'warning' && 'text-yellow-600',
    variant === 'info' && 'text-brand-600'
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-gray-900/60" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className="relative w-full max-w-sm rounded-[24px] bg-white shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Icon className={iconClass} />
            <span id={titleId} className="text-[16px] font-semibold text-gray-900">{title}</span>
          </div>
          <button onClick={onCancel} aria-label="Fechar diálogo" className="inline-flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-full p-1 text-gray-600 hover:bg-gray-100 hover:text-gray-700 ez-focus">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-4 text-[14px] text-gray-700">
          <p id={messageId}>{message}</p>
          {children}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-gray-90/50 px-6 py-4 rounded-b-[24px]">
          <EzButton ref={cancelRef} variant="secondary" label={cancelLabel} onClick={onCancel} />
          <EzButton
            variant={variant === 'danger' ? 'danger' : 'primary'}
            label={confirmLabel}
            onClick={onConfirm}
            disabled={confirmDisabled}
            loading={confirmLoading}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
