import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { FileArchive, FileText, Image as ImageIcon, Paperclip, type LucideIcon } from 'lucide-react';
import { formatDateTime } from '../../lib/formatDateTime';
import { EzAlert, EzButton, EzDialog, EzSpinner } from '../ds';

export interface TicketAttachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileUrl: string;
  createdAt: string;
  uploaderId: string;
  uploader?: { id: string; name: string; email: string };
}

export const attachmentsQueryKey = (ticketId: string) => [
  'tickets',
  ticketId,
  'attachments',
];

function attachmentIcon(mimeType: string): LucideIcon {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType === 'application/zip') return FileArchive;
  return Paperclip;
}

interface TicketAttachmentsProps {
  ticketId: string;
}

/**
 * Attachment panel for a ticket: lists uploaded files and lets any
 * authenticated participant (client/agent) upload new ones via a plain
 * file input (works without JS drag-and-drop quirks and is fully
 * keyboard/screen-reader accessible).
 */
export function TicketAttachments({ ticketId }: TicketAttachmentsProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<TicketAttachment | null>(null);
  const userId = useAuthStore((state) => state.user?.sub);
  const role = useAuthStore((state) => state.user?.role);
  const canDeleteAny = role === 'ADMIN' || role === 'AGENT_MASTER' || role === 'AGENT';

  const { data: attachments, isLoading } = useQuery<TicketAttachment[]>({
    queryKey: attachmentsQueryKey(ticketId),
    queryFn: async () => {
      const { data } = await api.get<TicketAttachment[]>(
        `/tickets/${ticketId}/attachments`,
      );
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<TicketAttachment>(
        `/tickets/${ticketId}/attachments`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      void queryClient.invalidateQueries({
        queryKey: attachmentsQueryKey(ticketId),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (attachmentId: string) => {
      await api.delete(`/tickets/${ticketId}/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: attachmentsQueryKey(ticketId),
      });
    },
  });

  const handleUpload = () => {
    if (!selectedFile) return;
    uploadMutation.mutate(selectedFile);
  };

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-gray-900">Anexos</h2>

      {isLoading && (
        <div className="flex justify-center py-4">
          <EzSpinner label="Carregando anexos…" />
        </div>
      )}

      {attachments && attachments.length === 0 && (
        <p className="text-sm text-gray-500">
          Nenhum anexo neste chamado ainda.
        </p>
      )}

      {attachments && attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((attachment) => {
            const Icon = attachmentIcon(attachment.mimeType);
            return (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <a
                  href={attachment.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-2 truncate text-brand-600 hover:underline"
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{attachment.originalName}</span>
                </a>
                <p className="mt-0.5 text-xs text-gray-500">
                  {attachment.uploader?.name ? `${attachment.uploader.name} · ` : ''}
                  {formatDateTime(attachment.createdAt)}
                </p>
              </div>
              {(canDeleteAny || attachment.uploaderId === userId) && (
                <EzButton
                  type="button"
                  variant="danger"
                  size="small"
                  onClick={() => setPendingRemoval(attachment)}
                >
                  Remover
                </EzButton>
              )}
            </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <input
          id="attachment-file"
          ref={fileInputRef}
          type="file"
          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        <label
          htmlFor="attachment-file"
          className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-80"
        >
          Selecionar arquivo
        </label>
        <span className="truncate text-sm text-gray-500">
          {selectedFile ? selectedFile.name : 'Nenhum arquivo selecionado'}
        </span>
        <EzButton
          type="button"
          size="small"
          onClick={handleUpload}
          disabled={!selectedFile || uploadMutation.isPending}
        >
          {uploadMutation.isPending ? 'Enviando…' : 'Anexar arquivo'}
        </EzButton>
      </div>

      {deleteMutation.isError && (
        <EzAlert variant="error" role="alert">
          Falha ao remover o anexo. Tente novamente.
        </EzAlert>
      )}

      <EzDialog
        open={pendingRemoval !== null}
        variant="danger"
        title="Remover anexo"
        message={`Remover o anexo "${pendingRemoval?.originalName ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Confirmar"
        onConfirm={() => {
          if (pendingRemoval) deleteMutation.mutate(pendingRemoval.id);
          setPendingRemoval(null);
        }}
        onCancel={() => setPendingRemoval(null)}
      />

      {uploadMutation.isError && (
        <EzAlert variant="error" role="alert">
          Falha ao enviar o anexo. Verifique o tipo e o tamanho do arquivo
          (máx. 10MB).
        </EzAlert>
      )}
    </section>
  );
}

export default TicketAttachments;
