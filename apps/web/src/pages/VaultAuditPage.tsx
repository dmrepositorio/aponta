import { FormEvent, useState } from 'react';
import axios from 'axios';
import {
  useVaultAudit,
  useVaultAgents,
  VaultAuditFilters,
  CredentialAction,
} from '../hooks/useVaultAudit';
import {
  EzAlert,
  EzButton,
  EzCardItem,
  EzComboBox,
  EzDateInput,
  EzEmptyCard,
  EzPageHeader,
  EzPageLayout,
  EzPagination,
  EzSpinner,
  EzTextInput,
} from '../components/ds';
// O EzEmptyCard do barrel (EzCardItem) não tem variant de erro nem onRetry; o standalone tem.
import { EzEmptyCard as EzErrorCard } from '../components/ds/EzEmptyCard';
import { brasiliaDayEndIso, brasiliaDayStartIso } from '../lib/billingTime';
import { formatDateTime } from '../lib/formatDateTime';

const PAGE_SIZE = 20;

/**
 * Ação labels (pt-BR), Tiflux-parity. Only actions that have a real emitter
 * in the Aponta vault are listed — "Restaurou a senha" / "Viu o histórico" /
 * "Abriu um anexo" from the Tiflux reference screen have no backing feature
 * here (no version history/attachments) and are intentionally left out of
 * this select, per the spec's "fora do escopo" note.
 */
const ACTION_LABELS: Record<CredentialAction, string> = {
  CREATE_FOLDER: 'Criou a pasta',
  DELETE_FOLDER: 'Excluiu a pasta',
  CREATE_CREDENTIAL: 'Criou a senha',
  UPDATE_CREDENTIAL: 'Alterou a senha',
  DELETE_CREDENTIAL: 'Excluiu a senha',
  REVEAL_CREDENTIAL: 'Revelou a senha',
  COPY_USERNAME: 'Copiou o usuário',
  COPY_PASSWORD: 'Copiou a senha',
};

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));

interface DraftFilters {
  from: string;
  to: string;
  actorId: string;
  action: string;
  query: string;
}

const EMPTY_FILTERS: DraftFilters = { from: '', to: '', actorId: '', action: '', query: '' };

function formatDay(day: string) {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

/** Filtros aplicados em texto, para o usuário saber de qual consulta é a tabela. */
function describeFilters(filters: DraftFilters, agentName: (id: string) => string) {
  const parts = [
    filters.from && `de ${formatDay(filters.from)}`,
    filters.to && `até ${formatDay(filters.to)}`,
    filters.actorId && `atendente ${agentName(filters.actorId)}`,
    filters.action && `ação ${ACTION_LABELS[filters.action as CredentialAction] ?? filters.action}`,
    filters.query && `busca "${filters.query}"`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nenhum';
}

export function VaultAuditPage() {
  // Rascunho: o que está digitado. Aplicado: o que gerou a tabela (null = ainda não consultou).
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters | null>(null);
  const [page, setPage] = useState(1);

  const setField = (field: keyof DraftFilters) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const filters: VaultAuditFilters = {
    from: applied?.from ? brasiliaDayStartIso(applied.from) : undefined,
    to: applied?.to ? brasiliaDayEndIso(applied.to) : undefined,
    actorId: applied?.actorId || undefined,
    action: applied?.action ? (applied.action as CredentialAction) : undefined,
    query: applied?.query || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const agentsQuery = useVaultAgents();
  const auditQuery = useVaultAudit(filters, applied !== null);

  const agents = agentsQuery.data ?? [];
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setApplied(draft);
  };

  const handleClear = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(null);
    setPage(1);
  };

  const logs = auditQuery.data?.data ?? [];
  const meta = auditQuery.data?.meta;
  const forbidden = axios.isAxiosError(auditQuery.error) && auditQuery.error.response?.status === 403;

  return (
    <EzPageLayout header={<EzPageHeader title="Auditoria do Cofre de Senhas" />}>
    <div className="space-y-6">
      <EzAlert variant="info">
        O endereço IP de origem e o horário de cada ação são registrados e exibidos na tabela abaixo (horário de
        Brasília).
      </EzAlert>

      <EzCardItem flat className="p-4">
        <form onSubmit={handleSubmit} aria-label="Filtros da auditoria">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <EzDateInput label="Data (de)" value={draft.from} onChange={(e) => setField('from')(e.target.value)} />
            <EzDateInput label="Data (até)" value={draft.to} onChange={(e) => setField('to')(e.target.value)} />
            <EzComboBox label="Atendente" value={draft.actorId} onChange={(e) => setField('actorId')(e.target.value)}>
              <option value="">Todos os atendentes</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </EzComboBox>
            <EzComboBox label="Ação" value={draft.action} onChange={(e) => setField('action')(e.target.value)}>
              <option value="">Todas as ações</option>
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </EzComboBox>
            <EzTextInput
              id="vault-audit-query"
              label="Buscar (cofre, pasta ou senha)"
              placeholder="Nome do cofre, pasta ou senha..."
              value={draft.query}
              onChange={(e) => setField('query')(e.target.value)}
              className="md:col-span-2"
            />
            <div className="flex items-end gap-2">
              <EzButton type="submit" label="Exibir" className="w-full md:w-auto" />
              <EzButton
                type="button"
                variant="secondary"
                label="Limpar filtros"
                onClick={handleClear}
                className="w-full md:w-auto"
              />
            </div>
          </div>
        </form>
      </EzCardItem>

      {!applied && (
        <EzEmptyCard title="Defina os filtros e clique em Exibir para consultar a auditoria." />
      )}

      {applied && auditQuery.isLoading && (
        <div className="flex justify-center p-8">
          <EzSpinner label="Carregando auditoria..." />
        </div>
      )}

      {applied && auditQuery.isError && (
        <EzErrorCard
          variant="error"
          title={forbidden ? 'Apenas administradores acessam a auditoria.' : 'Erro ao carregar a auditoria do cofre.'}
          onRetry={() => void auditQuery.refetch()}
        />
      )}

      {applied && !auditQuery.isLoading && !auditQuery.isError && (
        <EzCardItem flat className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 text-[13px] text-gray-600">
            <span>Filtros aplicados: {describeFilters(applied, agentName)}</span>
            {meta && <span>{meta.total === 1 ? '1 registro' : `${meta.total} registros`}</span>}
          </div>
          <div
            aria-busy={auditQuery.isPlaceholderData || undefined}
            className={auditQuery.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}
          >
            {!logs.length ? (
              <EzEmptyCard title="Nenhum registro de auditoria encontrado para os filtros selecionados." />
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-gray-90/60 text-gray-600">
                  <tr>
                    <th className="px-4 py-2 font-medium">Data/Hora</th>
                    <th className="px-4 py-2 font-medium">Atendente</th>
                    <th className="px-4 py-2 font-medium">Ação</th>
                    <th className="px-4 py-2 font-medium">Cofre / Pasta / Senha</th>
                    <th className="px-4 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-90/40">
                      <td className="px-4 py-3 text-gray-700">{formatDateTime(log.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-700">{log.actorName}</td>
                      <td className="px-4 py-3 text-gray-700">{ACTION_LABELS[log.action] ?? log.action}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{log.targetName}</td>
                      <td className="px-4 py-3 text-gray-500">{log.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex justify-end border-t border-gray-100 px-4 py-3">
              <EzPagination currentPage={meta.page} totalPages={meta.totalPages} totalItems={meta.total} pageSize={meta.limit} onChange={setPage} />
            </div>
          )}
        </EzCardItem>
      )}
    </div>
    </EzPageLayout>
  );
}
