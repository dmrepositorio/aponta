import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { EzAlert, EzDialog } from '../ds';

/** DMTE-560: pop-up da lixeira de Clientes; consulta os vínculos antes de confirmar e só exclui os clientes livres. */

interface Blocker {
  code: string;
  message: string;
  count: number;
  items: { id: string; label: string; reasons?: string[] }[];
  resolvable: boolean;
  howToResolve: string | null;
}

interface Cascade {
  addresses: number;
  contacts: number;
  agentGroups: number;
  technicalGroups: number;
  sharedArticles: number;
  deskEvents: number;
}

interface Check {
  id: string;
  name: string;
  canDelete: boolean;
  blockers: Blocker[];
  cascade: Cascade;
}

export interface OrganizationDeleteResult {
  deleted: string[];
  failed: string[];
}

interface Props {
  targets: { id: string; name: string }[];
  onClose: () => void;
  /** Chamado assim que as exclusões terminam, para a página atualizar a lista e a seleção. */
  onDone: (result: OrganizationDeleteResult) => void;
}

const apiMessage = (error: unknown) => (error as { response?: { data?: { message?: string } } }).response?.data?.message;

const pluralize = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const blockerName: Record<string, string> = {
  TICKETS: 'tickets', SERVICE_DESKS: 'mesas', CONTRACTS: 'contratos', USERS: 'usuários', VAULT: 'cofre', APPOINTMENTS: 'agenda',
};

function cascadeText(c: Cascade): string | null {
  const parts = [
    c.addresses > 0 && pluralize(c.addresses, 'endereço', 'endereços'),
    c.contacts > 0 && pluralize(c.contacts, 'contato', 'contatos'),
    c.agentGroups > 0 && pluralize(c.agentGroups, 'grupo de atendentes', 'grupos de atendentes'),
    c.technicalGroups > 0 && pluralize(c.technicalGroups, 'vínculo com grupo técnico', 'vínculos com grupos técnicos'),
    c.sharedArticles > 0 && pluralize(c.sharedArticles, 'compartilhamento de artigo', 'compartilhamentos de artigo'),
    c.deskEvents > 0 && pluralize(c.deskEvents, 'registro de histórico de mesa', 'registros de histórico de mesa'),
  ].filter(Boolean);
  return parts.length > 0 ? `Também serão apagados: ${parts.join(', ')}.` : null;
}

export function OrganizationDeleteDialog({ targets, onClose, onDone }: Props) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [failures, setFailures] = useState<{ id: string; name: string; message: string }[] | null>(null);
  const ids = useRef(targets.map((t) => t.id));

  useEffect(() => {
    let active = true;
    api
      .post<Check[]>('/organizations/deletion-check', { ids: ids.current })
      .then(({ data }) => active && setChecks(data))
      .catch((error) => active && setCheckError(apiMessage(error) ?? 'Não foi possível verificar os vínculos. Tente de novo.'));
    return () => {
      active = false;
    };
  }, []);

  const free = (checks ?? []).filter((check) => check.canDelete);

  const confirm = async () => {
    setRunning(true);
    const deleted: string[] = [];
    const failed: { id: string; name: string; message: string }[] = [];
    for (const check of free) {
      try {
        await api.delete(`/organizations/${check.id}`);
        deleted.push(check.id);
      } catch (error) {
        failed.push({ id: check.id, name: check.name, message: apiMessage(error) ?? 'Não foi possível excluir o cliente.' });
      }
    }
    onDone({ deleted, failed: failed.map((f) => f.id) });
    if (failed.length === 0) return onClose();
    setFailures(failed);
    setRunning(false);
  };

  const title = targets.length === 1 ? 'Excluir cliente' : `Excluir ${targets.length} clientes`;
  const message = failures
    ? 'Não foi possível excluir:'
    : checkError
      ? 'Não foi possível verificar os vínculos.'
      : !checks
        ? 'Verificando vínculos…'
        : free.length > 0
          ? 'Esta ação não pode ser desfeita.'
          : 'Não é possível excluir.';
  const canConfirm = !!checks && free.length > 0 && !failures && !running;

  return (
    <EzDialog
      open
      variant="danger"
      title={title}
      message={message}
      confirmLabel="Confirmar"
      cancelLabel={canConfirm || running ? 'Cancelar' : 'Fechar'}
      confirmDisabled={!canConfirm}
      onConfirm={() => void confirm()}
      onCancel={() => {
        if (!running) onClose();
      }}
    >
      <div aria-live="polite" className="max-h-[50vh] overflow-y-auto">
        {checkError && <EzAlert variant="error" role="alert" className="mt-3">{checkError}</EzAlert>}
        {failures && (
          <ul className="mt-3 space-y-1">
            {failures.map((failure) => (
              <li key={failure.id} className="text-red-700">{`${failure.name}: ${failure.message}`}</li>
            ))}
          </ul>
        )}
        {!failures && checks && (
          <ul className="mt-3 space-y-3">
            {checks.map((check) => (
              <li key={check.id}>
                {checks.length > 1 && (
                  <p className="font-medium text-gray-900">{`${check.name}: ${check.canDelete ? 'pode excluir' : `bloqueado: ${check.blockers.map((b) => blockerName[b.code] ?? b.code).join(', ')}`}`}</p>
                )}
                {check.canDelete && cascadeText(check.cascade) && <p className="mt-1">{cascadeText(check.cascade)}</p>}
                {check.blockers.map((blocker) => (
                  <div key={blocker.code} className="mt-2">
                    <p className="font-medium text-gray-900">{blocker.message}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {blocker.items.map((item) => (
                        <li key={item.id}>
                          {item.reasons && item.reasons.length > 0 ? `${item.label} (${item.reasons.join(', ')})` : item.label}
                        </li>
                      ))}
                    </ul>
                    {blocker.count > blocker.items.length && <p className="pl-5">{`e mais ${blocker.count - blocker.items.length}`}</p>}
                    <p className="mt-1 text-gray-700">
                      {blocker.resolvable && blocker.howToResolve
                        ? `Como resolver: ${blocker.howToResolve}`
                        : 'Não é possível resolver: inative o cliente.'}
                    </p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </EzDialog>
  );
}
