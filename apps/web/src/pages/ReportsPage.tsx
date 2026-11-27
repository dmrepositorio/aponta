import { useState, type ReactNode } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  useReportWorkload,
  useReportBilling,
  type BillingItem,
} from '../hooks/useReports';
import { useAuthStore } from '../stores/authStore';
import { useCanViewTicketValues } from '../hooks/usePermissions';
import {
  EzAlert,
  EzButton,
  EzComboBox,
  EzEmptyCard,
  EzGridWrapper,
  EzPageHeader,
  EzPageLayout,
  EzTextInput,
  EzSpinner,
  EzTabs,
  ezTabId,
  ezTabPanelId,
} from '../components/ds';
import { useContracts } from '../hooks/useContracts';
import { billingMonthStartIso } from '../lib/billingTime';
import { CommercialReport } from '../components/contracts/CommercialReport';

type TabId = 'WORKLOAD' | 'BILLING' | 'COMMERCIAL';

const TABS_ID_PREFIX = 'reports';
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const billingErrorStatus = (error: unknown) =>
  axios.isAxiosError(error) ? error.response?.status : undefined;

// REP-02: a mensagem segue o status; só o 400 aponta o período.
function billingErrorMessage(error: unknown): string {
  const status = billingErrorStatus(error);
  if (status === 400) {
    return 'Não foi possível carregar o relatório. Verifique o período selecionado.';
  }
  if (status === 403) {
    return 'Você não tem permissão para ver o faturamento.';
  }
  return 'Falha temporária ao carregar o faturamento. Tente novamente em instantes.';
}

// REP-04: ordenação por coluna no cliente (ainda sem paginação nem CSV; ver #420).
type SortState = { key: string; dir: 'asc' | 'desc' } | null;

const nextSort = (previous: SortState, key: string): SortState =>
  previous?.key === key
    ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };

function sortRows<T>(
  rows: T[],
  sort: SortState,
  values: Record<string, (row: T) => string | number>,
): T[] {
  const read = sort && values[sort.key];
  if (!sort || !read) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * factor;
    }
    return String(left).localeCompare(String(right), 'pt-BR') * factor;
  });
}

const sumBy = <T,>(rows: T[], pick: (row: T) => number) =>
  rows.reduce((sum, row) => sum + pick(row), 0);

const formatBrl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function SortableTh({
  columnKey,
  label,
  icon,
  align = 'left',
  describedBy,
  sort,
  onSort,
}: {
  columnKey: string;
  label: string;
  icon?: ReactNode;
  align?: 'left' | 'right';
  describedBy?: string;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const active = sort?.key === columnKey;
  const SortIcon = sort?.dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      aria-describedby={describedBy}
      className={`px-4 py-3 font-semibold text-gray-700 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-control outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {icon}
        {label}
        {active && <SortIcon aria-hidden="true" className="h-3 w-3" />}
      </button>
    </th>
  );
}

const LEGEND_KNOWN_ID = 'reports-legend-known-value';
const LEGEND_UNKNOWN_ID = 'reports-legend-unknown-valuation';

const BILLING_COLUMNS: { key: string; label: string; describedBy?: string }[] = [
  { key: 'billable', label: 'Horas Faturáveis' },
  { key: 'nonBillable', label: 'Horas Não Faturáveis' },
  { key: 'worked', label: 'Total Trabalhado' },
  { key: 'covered', label: 'Coberto / Excedente' },
  { key: 'value', label: 'Valor conhecido', describedBy: LEGEND_KNOWN_ID },
  { key: 'unknown', label: 'Sem valorização', describedBy: LEGEND_UNKNOWN_ID },
];

const BILLING_SORT_VALUES: Record<string, (item: BillingItem) => string | number> = {
  organization: (item) => item.organizationName,
  billable: (item) => item.billableMinutes,
  nonBillable: (item) => item.nonBillableMinutes,
  worked: (item) => item.billableMinutes + item.nonBillableMinutes,
  covered: (item) => item.coveredMinutes,
  value: (item) => item.totalValueCents,
  unknown: (item) => item.unknownValuationCount,
};

export function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const [workloadSort, setWorkloadSort] = useState<SortState>(null);
  const [billingSort, setBillingSort] = useState<SortState>(null);
  // REP-07: aba e filtros de faturamento vivem na query string (?aba=&contrato=&de=&ate=).
  const [searchParams, setSearchParams] = useSearchParams();
  const updateParams = (patch: Record<string, string>, replace = true) =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );
  const monthParam = (key: string) => {
    const value = searchParams.get(key) ?? '';
    return MONTH_PATTERN.test(value) ? value : '';
  };

  // DMTE-479: valor só com VIEW_TICKET_VALUES; o role continua como recorte.
  const canViewValues = useCanViewTicketValues();
  const canSeeBilling =
    canViewValues && user
      ? ['ADMIN', 'CLIENT_MASTER'].includes(user.role)
      : false;
  const contractId = searchParams.get('contrato') ?? '';
  const startMonth = monthParam('de');
  const endMonth = monthParam('ate');
  const contractsQ = useContracts();

  const workloadQ = useReportWorkload();
  // REP-03: início depois do fim não vira consulta; o campo final mostra o erro.
  const rangeInvalid = !!startMonth && !!endMonth && startMonth > endMonth;
  const billingQ = useReportBilling(canSeeBilling && !rangeInvalid, {
    contractId: contractId || undefined,
    startDate: startMonth ? billingMonthStartIso(startMonth) : undefined,
    endDate: endMonth ? billingMonthStartIso(endMonth) : undefined,
  });

  const formatHours = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const tabs = [
    { id: 'WORKLOAD' as const, label: 'Carga de Trabalho' },
    ...(canSeeBilling
      ? [{ id: 'BILLING' as const, label: 'Faturamento Base' }]
      : []),
    ...(canViewValues && user?.role === 'ADMIN'
      ? [{ id: 'COMMERCIAL' as const, label: 'Resultado gerencial' }]
      : []),
  ];
  // A aba pedida na URL só vale se o usuário a enxerga; senão cai em Carga de Trabalho.
  const activeTab: TabId =
    tabs.find((tab) => tab.id === searchParams.get('aba'))?.id ?? 'WORKLOAD';

  return (
    <EzPageLayout header={<EzPageHeader title="Relatórios" />}>
    <div className="space-y-6">
      <EzTabs
        tabs={tabs}
        idPrefix={TABS_ID_PREFIX}
        activeTab={activeTab}
        onChange={(id) => updateParams({ aba: String(id) }, false)}
      />
      <div
        role="tabpanel"
        id={ezTabPanelId(TABS_ID_PREFIX, activeTab)}
        aria-labelledby={ezTabId(TABS_ID_PREFIX, activeTab)}
        className="space-y-6"
      >
      {activeTab === 'COMMERCIAL' &&
        canViewValues &&
        user?.role === 'ADMIN' && (
          <CommercialReport contracts={contractsQ.data || []} />
        )}

      {activeTab === 'WORKLOAD' && (
        <>
          {workloadQ.isLoading && (
            <div className="flex justify-center p-4">
              <EzSpinner label="Carregando..." />
            </div>
          )}
          {!workloadQ.isLoading && workloadQ.data?.length === 0 && (
            <EzEmptyCard
              title="Nenhum apontamento registrado."
              description="Quando houver horas apontadas, elas aparecem aqui."
            />
          )}
          {workloadQ.data && workloadQ.data.length > 0 && (
            <EzGridWrapper tableLabel="Carga de trabalho por usuário">
              <thead className="bg-gray-90">
                <tr>
                  <SortableTh
                    columnKey="agent"
                    label="Atendente"
                    sort={workloadSort}
                    onSort={(key) => setWorkloadSort(nextSort(workloadSort, key))}
                  />
                  <SortableTh
                    columnKey="minutes"
                    label="Tempo Apontado"
                    align="right"
                    sort={workloadSort}
                    onSort={(key) => setWorkloadSort(nextSort(workloadSort, key))}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortRows(workloadQ.data, workloadSort, {
                  agent: (item) => item.agentName,
                  minutes: (item) => item.totalMinutes,
                }).map((item) => (
                  <tr key={item.agentId} className="hover:bg-gray-90">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {item.agentName}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 tabular-nums">
                      {formatHours(item.totalMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-90">
                <tr>
                  <th scope="row" className="px-4 py-3 text-left font-semibold text-gray-900">
                    Total
                  </th>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatHours(
                      workloadQ.data.reduce((sum, item) => sum + item.totalMinutes, 0),
                    )}
                  </td>
                </tr>
              </tfoot>
            </EzGridWrapper>
          )}
        </>
      )}

      {activeTab === 'BILLING' && canSeeBilling && (
        <>
          <p className="text-sm text-gray-600">
            Valores informativos dos apontamentos, sem emissão de cobrança ou
            mensalidade. Ciclos mensais em America/Sao_Paulo; valores históricos
            preservados.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <EzComboBox
              id="billing-contract"
              label="Contrato"
              value={contractId}
              onChange={(event) => updateParams({ contrato: event.target.value })}
            >
              <option value="">Todos os contratos</option>
              {contractsQ.data?.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.name || contract.organization?.name || contract.id}
                </option>
              ))}
            </EzComboBox>
            <EzTextInput
              id="billing-start-month"
              label="Ciclos desde"
              type="month"
              value={startMonth}
              onChange={(event) => updateParams({ de: event.target.value })}
            />
            <EzTextInput
              id="billing-end-month"
              label="Ciclos até"
              type="month"
              value={endMonth}
              hasError={rangeInvalid}
              message={
                rangeInvalid
                  ? 'O mês final não pode ser anterior ao início.'
                  : 'O mês escolhido não é incluído no relatório.'
              }
              onChange={(event) => updateParams({ ate: event.target.value })}
            />
            {(startMonth || endMonth) && (
              <EzButton
                variant="tertiary"
                onClick={() => updateParams({ de: '', ate: '' })}
              >
                Limpar período
              </EzButton>
            )}
          </div>
          {billingQ.isError && (
            <EzAlert
              variant="error"
              action={
                billingErrorStatus(billingQ.error) === 400 ||
                billingErrorStatus(billingQ.error) === 403 ? undefined : (
                  <EzButton
                    variant="secondary"
                    size="small"
                    loading={billingQ.isFetching}
                    onClick={() => void billingQ.refetch()}
                  >
                    Tentar de novo
                  </EzButton>
                )
              }
            >
              {billingErrorMessage(billingQ.error)}
            </EzAlert>
          )}
          {billingQ.isLoading && (
            <div className="flex justify-center p-4">
              <EzSpinner label="Carregando faturamento..." />
            </div>
          )}
          {!billingQ.isLoading && billingQ.data?.length === 0 && (
            <EzEmptyCard
              title="Nenhum dado financeiro no período."
              description="Amplie o período ou escolha outro contrato."
            />
          )}
          {billingQ.data && billingQ.data.length > 0 && (
            <>
            <EzGridWrapper tableLabel="Faturamento base por contrato">
              <thead className="bg-gray-90">
                <tr>
                  <SortableTh
                    columnKey="organization"
                    label="Cliente / Organização"
                    sort={billingSort}
                    onSort={(key) => setBillingSort(nextSort(billingSort, key))}
                  />
                  {BILLING_COLUMNS.map((column) => (
                    <SortableTh
                      key={column.key}
                      columnKey={column.key}
                      label={column.label}
                      align="right"
                      describedBy={column.describedBy}
                      sort={billingSort}
                      onSort={(key) => setBillingSort(nextSort(billingSort, key))}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortRows(billingQ.data, billingSort, BILLING_SORT_VALUES).map((item) => (
                  <tr key={item.organizationId} className="hover:bg-gray-90">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {item.organizationName}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums">
                      {formatHours(item.billableMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                      {formatHours(item.nonBillableMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">
                      {formatHours(
                        item.billableMinutes + item.nonBillableMinutes,
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatHours(item.coveredMinutes)} /{' '}
                      {formatHours(item.excessMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatBrl(item.totalValueCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.unknownValuationCount}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-90">
                <tr>
                  <th scope="row" className="px-4 py-3 text-left font-semibold text-gray-900">
                    Total
                  </th>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatHours(sumBy(billingQ.data, (item) => item.billableMinutes))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatHours(sumBy(billingQ.data, (item) => item.nonBillableMinutes))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatHours(
                      sumBy(billingQ.data, (item) => item.billableMinutes + item.nonBillableMinutes),
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatHours(sumBy(billingQ.data, (item) => item.coveredMinutes))} /{' '}
                    {formatHours(sumBy(billingQ.data, (item) => item.excessMinutes))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatBrl(sumBy(billingQ.data, (item) => item.totalValueCents))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {sumBy(billingQ.data, (item) => item.unknownValuationCount)}
                  </td>
                </tr>
              </tfoot>
            </EzGridWrapper>
            <ul className="space-y-1 text-[13px] text-gray-600">
              <li id={LEGEND_KNOWN_ID}>
                Valor conhecido: soma dos valores calculados dos apontamentos.
              </li>
              <li id={LEGEND_UNKNOWN_ID}>
                Sem valorização: quantidade de apontamentos sem valor calculado.
              </li>
            </ul>
            </>
          )}
        </>
      )}
      </div>
    </div>
    </EzPageLayout>
  );
}
