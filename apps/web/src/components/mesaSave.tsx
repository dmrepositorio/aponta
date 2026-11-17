import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api';
import { EzToast } from './ds';

/**
 * Modelo único de salvamento da tela de Mesa (DMTE-533): cada aba edita um rascunho e grava
 * com o seu botão Salvar. O provedor guarda quais editores têm alteração não salva e mostra o
 * resultado de toda gravação num único aviso. Fora do provedor os editores funcionam sem aviso.
 */

const SUCCESS_MS = 5000;

interface Notice {
  variant: 'success' | 'error';
}

interface MesaSaveApi {
  setDirty: (id: string, dirty: boolean) => void;
  notify: (notice: Notice) => void;
}

const SaveContext = createContext<MesaSaveApi | null>(null);
const PendingContext = createContext(false);

export function MesaSaveProvider({ children }: { children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((prev) => {
      if (prev.has(id) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ setDirty, notify: (next: Notice) => setNotice({ ...next }) }), [setDirty]);

  const pending = dirtyIds.size > 0;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  useEffect(() => {
    if (notice?.variant !== 'success') return;
    const timer = setTimeout(() => setNotice(null), SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <SaveContext.Provider value={value}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {notice && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 w-[calc(100%-2rem)] max-w-sm">
          <div role={notice.variant === 'error' ? 'alert' : 'status'}>
            <EzToast
              variant={notice.variant}
              title={notice.variant === 'error' ? 'Não foi possível salvar.' : 'Alterações salvas.'}
              description={notice.variant === 'error' ? 'Tente novamente.' : undefined}
              onClose={() => setNotice(null)}
            />
          </div>
        </div>
      )}
    </SaveContext.Provider>
  );
}

/** Há alteração não salva em algum editor da tela? */
export function useMesaPending(): boolean {
  return useContext(PendingContext);
}

/** Registra a pendência do editor e devolve como avisar o resultado da gravação. */
export function useMesaSave(dirty: boolean) {
  const context = useContext(SaveContext);
  const id = useId();
  useEffect(() => {
    context?.setDirty(id, dirty);
  }, [context, id, dirty]);
  useEffect(() => () => context?.setDirty(id, false), [context, id]);
  return useMemo(
    () => ({
      saved: () => context?.notify({ variant: 'success' }),
      failed: () => context?.notify({ variant: 'error' }),
    }),
    [context],
  );
}

/**
 * Rascunho de campos simples da mesa: um PATCH com o rascunho inteiro (ou o que `toPayload`
 * montar). A pendência é a diferença para o último valor salvo; salvar com sucesso o atualiza.
 */
export function useDeskDraft<T extends Record<string, string | boolean>>(
  deskId: string,
  initial: () => T,
  toPayload: (draft: T) => object = (draft) => draft,
) {
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(baseline);
  const dirty = Object.keys(draft).some((key) => draft[key] !== baseline[key]);
  const notice = useMesaSave(dirty);

  const mutation = useMutation({
    mutationFn: async (next: T) => {
      await api.patch(`/service-desks/${deskId}`, toPayload(next));
    },
    onSuccess: (_result, next) => {
      setBaseline(next);
      void queryClient.invalidateQueries({ queryKey: ['service-desks'] });
      notice.saved();
    },
    onError: notice.failed,
  });

  return { draft, setDraft, save: () => mutation.mutate(draft), isPending: mutation.isPending };
}
