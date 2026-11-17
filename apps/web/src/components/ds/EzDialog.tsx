import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './utils';
import { EzButton } from './EzButton';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';
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
}: EzDialogProps) {
  useEscapeLayer(onCancel, open);
  const titleId = useId();
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
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-sm rounded-[24px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Icon className={iconClass} />
            <span id={titleId} className="text-[16px] font-semibold text-gray-900">{title}</span>
          </div>
          <button onClick={onCancel} aria-label="Fechar diálogo" className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-4 text-[14px] text-gray-700">
          <p>{message}</p>
          {children}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-gray-90/50 px-6 py-4 rounded-b-[24px]">
          <EzButton ref={cancelRef} variant="secondary" label={cancelLabel} onClick={onCancel} />
          <EzButton variant="primary" label={confirmLabel} onClick={onConfirm} disabled={confirmDisabled} />
        </div>
      </div>
    </div>,
    document.body
  );
}
