import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '../lib/api';
import { EzAlert, EzButton, EzCardItem, EzClassicTextArea } from '../components/ds';

interface PublicCsatSummary {
  protocol: string;
  title: string;
  score: number | null;
  comment: string | null;
}

/**
 * Public, no-login confirmation page reached from the CSAT invitation
 * e-mail (`/avaliar/:token`). Deliberately does NOT submit anything on
 * page load — e-mail clients (Outlook/Gmail) prefetch links automatically,
 * so saving on mount would record a rating nobody actually chose. The
 * score starts pre-selected at 5 stars but is only persisted when the
 * user explicitly clicks "Confirmar avaliação".
 */
export function PublicCsatPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState('');
  const starRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const thanksRef = useRef<HTMLParagraphElement>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<PublicCsatSummary>({
    queryKey: ['public-csat', token],
    queryFn: async () => {
      const res = await api.get(`/public/csat/${token}`);
      return res.data;
    },
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch(`/public/csat/${token}`, {
        score,
        comment: comment || undefined,
      });
      return res.data;
    },
  });

  // Foco no agradecimento ao concluir: quem usa leitor de tela perde o botão que acabou de sumir.
  useEffect(() => {
    if (mutation.isSuccess) thanksRef.current?.focus();
  }, [mutation.isSuccess]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-80">
        <p role="status" className="text-gray-700">Carregando…</p>
      </div>
    );
  }

  if (isError) {
    const isNotFound =
      axios.isAxiosError(error) && error.response?.status === 404;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-80 px-4">
        <EzCardItem className="max-w-md w-full p-6 text-center">
          <div role="alert">
            <h1 className="text-lg font-semibold text-gray-900 mb-2">
              {isNotFound
                ? 'Link inválido'
                : 'Não foi possível carregar a avaliação'}
            </h1>
            <p className="text-sm text-gray-500">
              {isNotFound
                ? 'Este link de avaliação é inválido ou já não existe mais.'
                : 'Houve um problema de conexão ou do servidor. Tente novamente.'}
            </p>
          </div>
          {!isNotFound && (
            <EzButton
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={() => refetch()}
            >
              Tentar de novo
            </EzButton>
          )}
        </EzCardItem>
      </div>
    );
  }

  const submitErrorMessage =
    axios.isAxiosError(mutation.error) &&
    mutation.error.response?.status === 404
      ? 'Este link de avaliação é inválido ou já não existe mais.'
      : 'Falha ao enviar sua avaliação. Verifique sua conexão e tente novamente.';

  const alreadyRated = data?.score != null && !mutation.isSuccess;

  const onStarKeyDown = (e: KeyboardEvent<HTMLButtonElement>, star: number) => {
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? Math.min(star + 1, 5)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? Math.max(star - 1, 1)
          : e.key === 'Home'
            ? 1
            : e.key === 'End'
              ? 5
              : null;
    if (next === null) return;
    e.preventDefault();
    setScore(next);
    starRefs.current[next - 1]?.focus();
  };

  const renderStars = (currentScore: number, interactive: boolean) => (
    <div
      role="radiogroup"
      aria-label="Nota de 1 a 5"
      aria-readonly={!interactive || undefined}
      className="flex justify-center gap-2 text-3xl"
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          ref={(el) => {
            starRefs.current[star - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={star === currentScore}
          aria-label={`${star} estrela${star > 1 ? 's' : ''}`}
          tabIndex={interactive && star === currentScore ? 0 : -1}
          disabled={!interactive}
          onClick={() => interactive && setScore(star)}
          onKeyDown={(e) => interactive && onStarKeyDown(e, star)}
          className={`min-h-11 min-w-11 inline-flex items-center justify-center ${
            star <= currentScore ? 'text-brand-600' : 'text-gray-300'
          } ${interactive ? 'hover:scale-110 transition-transform' : 'cursor-default'}`}
        >
          ★
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-80 px-4">
      <EzCardItem className="max-w-md w-full p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">
          Chamado {data?.protocol}
        </h1>
        <p className="text-sm text-gray-500 mb-6">{data?.title}</p>

        {mutation.isSuccess ? (
          <p ref={thanksRef} role="status" tabIndex={-1} className="text-center text-lg text-green-700 font-medium focus:outline-none">
            Obrigado pela sua avaliação!
          </p>
        ) : alreadyRated ? (
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-3">
              Este chamado já foi avaliado anteriormente:
            </p>
            {renderStars(data?.score ?? 0, false)}
            {data?.comment && (
              <p className="text-sm text-gray-500 mt-3 italic">
                "{data.comment}"
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 text-center">
              Como foi sua experiência com nosso atendimento?
            </p>
            {renderStars(score, true)}

            <EzClassicTextArea
              id="public-csat-comment"
              label="Comentário (opcional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Conte um pouco sobre sua experiência…"
            />

            {mutation.isError && (
              <EzAlert variant="error" role="alert">
                {submitErrorMessage}
              </EzAlert>
            )}

            <EzButton
              type="button"
              className="w-full"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Enviando…' : 'Confirmar avaliação'}
            </EzButton>
          </div>
        )}
      </EzCardItem>
    </div>
  );
}
