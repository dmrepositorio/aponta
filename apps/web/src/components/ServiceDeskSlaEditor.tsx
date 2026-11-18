import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { EzButton, EzComboBox, EzTextInput } from './ds';
import { useMesaSave } from './mesaSave';

interface Organization {
  id: string;
  name: string;
}

interface ServiceDeskSlaFields {
  /** Clientes vinculados à mesa (N:N). */
  organizations: Organization[];
  slaCriticalResponseHours?: number | null;
  slaCriticalResolveHours?: number | null;
  slaHighResponseHours?: number | null;
  slaHighResolveHours?: number | null;
  slaMediumResponseHours?: number | null;
  slaMediumResolveHours?: number | null;
  slaLowResponseHours?: number | null;
  slaLowResolveHours?: number | null;
}

const PRIORITIES: { key: 'Critical' | 'High' | 'Medium' | 'Low'; label: string; defaults: { response: number; resolve: number } }[] = [
  { key: 'Critical', label: 'Crítica', defaults: { response: 1, resolve: 4 } },
  { key: 'High', label: 'Alta', defaults: { response: 4, resolve: 8 } },
  { key: 'Medium', label: 'Média', defaults: { response: 8, resolve: 24 } },
  { key: 'Low', label: 'Baixa', defaults: { response: 24, resolve: 72 } },
];

function toFormValue(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n);
}

function toApiValue(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toSlaValues(initial: ServiceDeskSlaFields): Record<string, string> {
  return {
    CriticalResponse: toFormValue(initial.slaCriticalResponseHours),
    CriticalResolve: toFormValue(initial.slaCriticalResolveHours),
    HighResponse: toFormValue(initial.slaHighResponseHours),
    HighResolve: toFormValue(initial.slaHighResolveHours),
    MediumResponse: toFormValue(initial.slaMediumResponseHours),
    MediumResolve: toFormValue(initial.slaMediumResolveHours),
    LowResponse: toFormValue(initial.slaLowResponseHours),
    LowResolve: toFormValue(initial.slaLowResolveHours),
  };
}

/**
 * Lets ADMIN link a ServiceDesk to specific clients (Organization, N:N) and
 * configure per-priority SLA targets that override the global defaults
 * in `tickets.service.ts`'s SLA_HOURS — Tiflux-parity "Mesa do cliente"
 * + "Meta de SLA". A blank field falls back to the global default for
 * that priority (see `calculateSla`/`buildSlaOverrides` on the API).
 */
export function ServiceDeskSlaEditor({
  deskId,
  initial,
}: {
  deskId: string;
  initial: ServiceDeskSlaFields;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const labelId = `desk-orgs-${deskId}`;
  const initialOrgIds = initial.organizations.map((org) => org.id);
  const [organizationIds, setOrganizationIds] = useState(initialOrgIds);
  const [slaValues, setSlaValues] = useState<Record<string, string>>(() => toSlaValues(initial));
  const initialSla = toSlaValues(initial);
  const dirty =
    isEditing &&
    (organizationIds.join() !== initialOrgIds.join() ||
      Object.keys(initialSla).some((key) => slaValues[key] !== initialSla[key]));
  const feedback = useMesaSave(dirty);

  const { data: organizations } = useQuery({
    queryKey: ['organizations', 'all-for-desk-link'],
    queryFn: async () => {
      const { data } = await api.get<Organization[]>('/organizations');
      return data;
    },
    enabled: isEditing,
  });

  const nameOf = (id: string) =>
    [...initial.organizations, ...(organizations ?? [])].find((org) => org.id === id)?.name ?? id;
  const addable = (organizations ?? []).filter((org) => !organizationIds.includes(org.id));

  const mutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/service-desks/${deskId}`, {
        organizationIds,
        slaCriticalResponseHours: toApiValue(slaValues.CriticalResponse),
        slaCriticalResolveHours: toApiValue(slaValues.CriticalResolve),
        slaHighResponseHours: toApiValue(slaValues.HighResponse),
        slaHighResolveHours: toApiValue(slaValues.HighResolve),
        slaMediumResponseHours: toApiValue(slaValues.MediumResponse),
        slaMediumResolveHours: toApiValue(slaValues.MediumResolve),
        slaLowResponseHours: toApiValue(slaValues.LowResponse),
        slaLowResolveHours: toApiValue(slaValues.LowResolve),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-desks'] });
      setIsEditing(false);
      feedback.saved();
    },
    onError: feedback.failed,
  });

  // Abrir a edição parte sempre do valor atual da mesa, não de um rascunho antigo.
  const startEditing = () => {
    setOrganizationIds(initialOrgIds);
    setSlaValues(initialSla);
    setIsEditing(true);
  };

  if (!isEditing) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-600">
          <span id={labelId} className="mb-1 block text-xs font-medium text-gray-500">Clientes vinculados</span>
          {initial.organizations.length === 0 ? (
            <strong className="text-gray-900">Mesa compartilhada (sem cliente)</strong>
          ) : (
            <ul aria-labelledby={labelId} className="font-semibold text-gray-900">
              {initial.organizations.map((org) => (
                <li key={org.id}>{org.name}</li>
              ))}
            </ul>
          )}
        </div>
        <EzButton type="button" variant="secondary" size="small" onClick={startEditing}>
          Editar cliente e SLA
        </EzButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="max-w-md">
        <span id={labelId} className="mb-1 block text-xs font-medium text-gray-500">Clientes vinculados</span>
        {organizationIds.length === 0 ? (
          <p className="text-gray-900">
            <strong>Mesa compartilhada (sem cliente)</strong>: atende todos os clientes.
          </p>
        ) : (
          <ul aria-labelledby={labelId} className="divide-y divide-gray-100 rounded-[12px] border border-gray-200">
            {organizationIds.map((id) => (
              <li key={id} className="flex items-center justify-between px-3 py-2">
                <span className="min-w-0 truncate text-gray-900">{nameOf(id)}</span>
                <EzButton
                  type="button"
                  variant="tertiary"
                  size="x-small"
                  aria-label={`Desvincular ${nameOf(id)}`}
                  onClick={() => setOrganizationIds((ids) => ids.filter((other) => other !== id))}
                >
                  Desvincular
                </EzButton>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <EzComboBox
            id={`desk-org-${deskId}`}
            label="Adicionar cliente"
            value=""
            onChange={(e) => e.target.value && setOrganizationIds((ids) => [...ids, e.target.value])}
          >
            <option value="">Selecione um cliente…</option>
            {addable.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </EzComboBox>
        </div>
      </div>

      <div>
        <label className="font-semibold block mb-1 text-gray-900">
          Meta de SLA por prioridade (horas úteis)
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Deixe em branco para usar o padrão global do sistema.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PRIORITIES.map(({ key, label, defaults }) => (
            <div key={key} className="rounded-[8px] border border-gray-200 p-2">
              <div className="text-xs font-medium text-gray-700 mb-1">{label}</div>
              <div className="flex gap-2">
                <EzTextInput
                  id={`desk-sla-${deskId}-${key}-response`}
                  label={`1ª resposta (pad. ${defaults.response}h)`}
                  type="number"
                  min={0}
                  value={slaValues[`${key}Response`]}
                  onChange={(e) =>
                    setSlaValues((prev) => ({ ...prev, [`${key}Response`]: e.target.value }))
                  }
                />
                <EzTextInput
                  id={`desk-sla-${deskId}-${key}-resolve`}
                  label={`Resolução (pad. ${defaults.resolve}h)`}
                  type="number"
                  min={0}
                  value={slaValues[`${key}Resolve`]}
                  onChange={(e) =>
                    setSlaValues((prev) => ({ ...prev, [`${key}Resolve`]: e.target.value }))
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <EzButton type="button" variant="secondary" size="small" onClick={() => setIsEditing(false)}>
          Cancelar
        </EzButton>
        <EzButton
          type="button"
          size="small"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Salvar cliente e SLA
        </EzButton>
      </div>
    </div>
  );
}
