import { useEffect, useState } from 'react';
import {
  EzAlert,
  EzButton,
  EzCardItem,
  EzCheck,
  EzDialog,
  EzEmptyCard,
  EzPageHeader,
  EzPageLayout,
  EzSpinner,
  EzTag,
  EzTextInput,
  EzToast,
} from '../components/ds';
import { JobRun, ScheduledJob, useScheduledJobs, useUpdateScheduledJob } from '../hooks/useScheduledJobs';
import { validateCron } from '../lib/cron';

const JOB_LABELS: Record<string, string> = {
  HEARTBEAT: 'Verificação do agendador',
  WORKLOG_AUTOCLOSE: 'Fechamento automático de cronômetros',
};
const RUN_STATUS: Record<JobRun['status'], { label: string; variant: 'petroleum' | 'green' | 'red' }> = {
  RUNNING: { label: 'Em execução', variant: 'petroleum' },
  SUCCESS: { label: 'Sucesso', variant: 'green' },
  FAILED: { label: 'Falhou', variant: 'red' },
};
const TOAST_MS = 4000;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

function errorMessage(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(message) ? message.join(' ') : message) || 'Não foi possível salvar a tarefa.';
}

function JobCard({ job }: { job: ScheduledJob }) {
  const label = JOB_LABELS[job.type] ?? job.type;
  const update = useUpdateScheduledJob();
  const [cron, setCron] = useState(job.cron);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  // O servidor é a fonte do valor salvo: quando ele muda, o campo acompanha.
  useEffect(() => setCron(job.cron), [job.cron]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const save = (body: { cron?: string; enabled?: boolean }, success: string) => {
    setError(null);
    update.mutate(
      { type: job.type, ...body },
      { onSuccess: () => setNotice(success), onError: (e) => setError(errorMessage(e)) },
    );
  };

  const cronError = validateCron(cron);
  const cronDirty = cron.trim() !== job.cron.trim();
  const cannotSave = !cronDirty || cronError !== null;
  const saveReason = cronError ?? 'Sem alterações para salvar.';

  return (
    <EzCardItem flat className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-gray-900">{label}</h2>
        <EzCheck
          label="Ativa"
          aria-label={`Ativa: ${label}`}
          checked={job.enabled}
          disabled={update.isPending}
          onChange={() => (job.enabled ? setConfirmingDisable(true) : save({ enabled: true }, 'Tarefa ativada.'))}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <EzTextInput
          id={`cron-${job.type}`}
          label={`Cron de ${label}`}
          message={cronDirty && cronError ? cronError : 'Minuto hora dia mês dia-da-semana'}
          hasError={cronDirty && cronError !== null}
          value={cron}
          onChange={(e) => setCron(e.target.value)}
        />
        <EzButton
          size="small"
          aria-label={`Salvar cron de ${label}`}
          disabled={cannotSave}
          disabledReason={cannotSave && !update.isPending ? saveReason : undefined}
          loading={update.isPending}
          onClick={() => save({ cron: cron.trim() }, 'Cron salvo.')}
        >
          Salvar
        </EzButton>
        {cronDirty && <span className="pb-2 text-[13px] text-gray-600">Alterações não salvas</span>}
      </div>
      {error && <EzAlert variant="error">{error}</EzAlert>}
      <p className="text-[13px] text-gray-600">
        <span>Próxima execução: {when(job.nextRunAt)}</span> · <span>Última execução: {when(job.lastRunAt)}</span>
      </p>
      {job.runs.length > 0 && (
        <table className="w-full text-left text-[13px]">
          <caption className="pb-1 text-left text-[13px] text-gray-600">
            {job.runs.length === 1 ? `Execução mais recente de ${label}` : `Últimas ${job.runs.length} execuções de ${label}`}
          </caption>
          <thead>
            <tr className="text-gray-600">
              <th scope="col" className="py-1">Início</th>
              <th scope="col" className="py-1">Estado</th>
              <th scope="col" className="py-1">Tentativa</th>
              <th scope="col" className="py-1">Erro</th>
            </tr>
          </thead>
          <tbody>
            {job.runs.map((run) => (
              <tr key={run.id} className="border-t border-gray-100">
                <td className="py-1">{when(run.startedAt)}</td>
                <td className="py-1">
                  <EzTag label={RUN_STATUS[run.status].label} variant={RUN_STATUS[run.status].variant} />
                </td>
                <td className="py-1">{run.attempt}</td>
                <td className="max-w-[16rem] py-1">
                  {run.error && (
                    <span className="block truncate" title={run.error}>
                      {run.error}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <EzDialog
        open={confirmingDisable}
        variant="danger"
        title="Desativar tarefa agendada?"
        message={`A tarefa "${label}" deixa de rodar até ser ativada de novo.`}
        onCancel={() => setConfirmingDisable(false)}
        onConfirm={() => {
          setConfirmingDisable(false);
          save({ enabled: false }, 'Tarefa desativada.');
        }}
      />
      {notice && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 w-[calc(100%-2rem)] max-w-sm">
          <EzToast variant="success" title={notice} description={label} onClose={() => setNotice(null)} />
        </div>
      )}
    </EzCardItem>
  );
}

export function ScheduledJobsPage() {
  const { data: jobs, isLoading, isError } = useScheduledJobs();
  return (
    <EzPageLayout header={<EzPageHeader title="Tarefas agendadas" />}>
      {isLoading ? (
        <div className="p-8">
          <EzSpinner label="Carregando tarefas…" />
        </div>
      ) : isError ? (
        <EzAlert variant="error">Erro ao carregar as tarefas agendadas.</EzAlert>
      ) : !jobs || jobs.length === 0 ? (
        <EzEmptyCard title="Nenhuma tarefa agendada." />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.type} job={job} />
          ))}
        </div>
      )}
    </EzPageLayout>
  );
}

export default ScheduledJobsPage;
