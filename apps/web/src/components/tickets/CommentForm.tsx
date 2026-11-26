import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../lib/api';
import { readCommentDraft, writeCommentDraft } from '../../lib/commentDraft';
import { useAuthStore } from '../../stores/authStore';
import type { TicketComment } from './TicketComments';
import { commentsQueryKey } from './TicketComments';
import { cn } from '../ds/utils';
import { EzAlert, EzButton, EzCheck, EzTextArea } from '../ds';

const commentSchema = z.object({
  content: z.string().trim().min(1, 'Comentário é obrigatório'),
  isInternal: z.boolean(),
});

type CommentFormValues = z.infer<typeof commentSchema>;

interface CommentFormProps {
  ticketId: string;
}

/**
 * New-comment form for the ticket timeline. The "Internal note" checkbox is
 * shown to AGENT and ADMIN only — matching the server-side permission model
 * (Task 6 forces `isInternal: false` for CLIENT callers anyway, so this is a
 * UX affordance, not the security boundary). On success the comments query is
 * invalidated so the timeline refetches and shows the new comment.
 */
export function CommentForm({ ticketId }: CommentFormProps) {
  const role = useAuthStore((state) => state.user?.role);
  const userId = useAuthStore((state) => state.user?.sub);
  const canMarkInternal = ['AGENT', 'AGENT_MASTER', 'ADMIN'].includes(role as string);
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { content: readCommentDraft(userId, ticketId), isInternal: false },
  });

  const isInternal = watch('isInternal');
  const content = watch('content');
  const showInternal = canMarkInternal && isInternal;

  // O flag de nota interna não é restaurado; por isso um rascunho de nota interna nunca é guardado
  // (senão voltaria como texto de um comentário público).
  useEffect(() => {
    writeCommentDraft(userId, ticketId, showInternal ? '' : content);
  }, [userId, ticketId, content, showInternal]);

  const mutation = useMutation({
    mutationFn: async (values: CommentFormValues) => {
      const { data } = await api.post<TicketComment>(
        `/tickets/${ticketId}/comments`,
        {
          content: values.content,
          isInternal: canMarkInternal ? values.isInternal : false,
        },
      );
      return data;
    },
    onSuccess: () => {
      reset();
      writeCommentDraft(userId, ticketId, '');
      void queryClient.invalidateQueries({
        queryKey: commentsQueryKey(ticketId),
      });
    },
  });

  const onSubmit = (values: CommentFormValues) => {
    mutation.mutate(values);
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      data-internal={showInternal ? 'true' : undefined}
      className={cn(
        'space-y-3 rounded-lg border p-4',
        showInternal ? 'border-yellow-300 bg-yellow-100' : 'border-gray-200 bg-white',
      )}
    >
      <EzTextArea
        id="comment-content"
        label="Adicionar um comentário"
        rows={3}
        hasError={!!errors.content}
        message={errors.content?.message}
        aria-describedby={showInternal ? 'comment-internal-hint' : undefined}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!mutation.isPending) void handleSubmit(onSubmit)();
          }
        }}
        {...register('content')}
      />
      {showInternal && (
        <p id="comment-internal-hint" className="text-[12px] font-medium text-yellow-800">
          Nota interna: o cliente não vê este comentário.
        </p>
      )}

      {canMarkInternal && (
        <EzCheck
          id="comment-is-internal"
          label="Nota interna"
          checked={isInternal}
          onChange={(e) => setValue('isInternal', e.target.checked)}
        />
      )}

      {mutation.isError && (
        <EzAlert variant="error" role="alert">
          Falha ao publicar o comentário. Tente novamente.
        </EzAlert>
      )}

      <EzButton type="submit" disabled={mutation.isPending}>
        Publicar comentário
      </EzButton>
    </form>
  );
}

export default CommentForm;
