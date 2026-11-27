import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { EzAlert, EzButton, EzEmptyCard, EzModal, EzPageHeader, EzPageLayout, EzSpinner, EzTextArea } from '../components/ds';
import { EzEntityGrid } from '../components/ds/EzEntityGrid';
import { formatWorklogMinutes } from '../components/tickets/TicketWorklogs';
import { useEffectivePermissions } from '../hooks/usePermissions';
import { APPROVAL_TYPE_LABELS, WorklogApproval, useDecideWorklogApproval, useWorklogApprovals } from '../hooks/useWorklogApprovals';
import { formatDateTime } from '../lib/formatDateTime';

const NOTE_REQUIRED = 'Informe o motivo da negação.';

function errorMessage(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(message) ? message.join(' ') : message) || 'Não foi possível concluir a decisão.';
}

function buildColumns(onDetails: (row: WorklogApproval) => void): ColumnDef<WorklogApproval>[] {
  return [
    { id: 'author', header: 'Consultor', accessorFn: (row) => row.author.name },
    { id: 'ticket', header: 'Ticket', accessorFn: (row) => row.ticket.protocol },
    { id: 'type', header: 'Tipo', accessorFn: (row) => APPROVAL_TYPE_LABELS[row.approvalType] },
    {
      id: 'period',
      header: 'Período',
      // O valor da coluna é o início (ISO), para a ordenação ser cronológica.
      accessorFn: (row) => row.startTime,
      cell: ({ row }) => (
        <div className="leading-snug">
          <div>{formatDateTime(row.original.startTime)}</div>
          <div className="text-gray-500">{formatDateTime(row.original.endTime)}</div>
        </div>
      ),
    },
    {
      id: 'minutes',
      header: 'Duração',
      // Numérico: a ordenação é por duração; o texto "Xh Ym" só vive na célula.
      accessorFn: (row) => row.minutes,
      cell: ({ row }) => formatWorklogMinutes(row.original.minutes),
      meta: { align: 'right' },
    },
    { id: 'reason', header: 'Motivo', accessorFn: (row) => row.approvalReason },
    {
      id: 'details',
      header: 'Ações',
      enableSorting: false,
      cell: ({ row }) => (
        <EzButton
          size="small"
          variant="secondary"
          label="Ver detalhes"
          aria-label={`Ver detalhes de ${row.original.author.name}, ticket ${row.original.ticket.protocol}`}
          onClick={(event) => {
            event.stopPropagation();
            onDetails(row.original);
          }}
        />
      ),
    },
  ];
}

/** DMTE-462 T5: liberações pendentes dos tipos que a pessoa decide; decide só o registro escolhido. */
export function ReleasesPage() {
  const { data, isLoading, isError, refetch } = useWorklogApprovals();
  const decide = useDecideWorklogApproval();
  const [selected, setSelected] = useState<WorklogApproval[]>([]);
  // A grade guarda a seleção pela posição da linha em `data`; guardamos a posição para detectar seleção obsoleta.
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // Só muda quando a seleção precisa ser zerada: a grade mantém identidade (e rolagem) nas demais atualizações.
  const [gridEpoch, setGridEpoch] = useState(0);
  // A grade fixa a página no nº de linhas do primeiro render; lista maior que isso só aparece inteira em grade nova.
  const [gridCapacity, setGridCapacity] = useState(0);
  const [open, setOpen] = useState<WorklogApproval | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const rows = useMemo(() => data ?? [], [data]);
  const missingNote = rejecting && error === NOTE_REQUIRED;
  if (rows.length > gridCapacity) {
    setGridCapacity(rows.length);
    setSelected([]);
    setSelectedIndex(-1);
  }
  const selectionStale =
    selected.length > 0 &&
    (selected.some((row) => !rows.some((item) => item.id === row.id)) ||
      (selected.length === 1 && rows[selectedIndex]?.id !== selected[0].id));
  const only = selected.length === 1 && !selectionStale ? selected[0] : null;

  const resetSelection = () => {
    setSelected([]);
    setSelectedIndex(-1);
    setGridEpoch((epoch) => epoch + 1);
  };
  // A lista mudou sob a seleção (registro decidido, ou linhas reordenadas): zera para não agir na linha errada.
  useEffect(() => {
    if (selectionStale) resetSelection();
  }, [selectionStale]);

  const handleSelectionChange = (picked: WorklogApproval[]) => {
    setSelected(picked);
    setSelectedIndex(picked.length === 1 ? rows.findIndex((row) => row.id === picked[0].id) : -1);
  };

  const close = () => {
    setOpen(null);
    resetSelection();
    setRejecting(false);
    setNote('');
    setError(null);
  };
  const openDecision = useCallback((row: WorklogApproval, reject: boolean) => {
    setOpen(row);
    setRejecting(reject);
    setNote('');
    setError(null);
  }, []);
  const columns = useMemo(() => buildColumns((row) => openDecision(row, false)), [openDecision]);

  // Ao abrir "Negar" o foco vai para o campo do motivo.
  useEffect(() => {
    if (rejecting) noteRef.current?.focus();
  }, [rejecting]);
  const approve = (row: WorklogApproval, fromDialog: boolean) => {
    setError(null);
    setPageError(null);
    setNotice(null);
    decide.mutate({ id: row.id }, {
      onSuccess: () => {
        close();
        setNotice('Liberação concedida');
      },
      onError: (e) => (fromDialog ? setError(errorMessage(e)) : setPageError(errorMessage(e))),
    });
  };
  const confirmReject = (row: WorklogApproval) => {
    if (!note.trim()) {
      setError(NOTE_REQUIRED);
      noteRef.current?.focus();
      return;
    }
    setError(null);
    setNotice(null);
    decide.mutate(
      { id: row.id, note: note.trim() },
      {
        onSuccess: () => {
          close();
          setNotice('Liberação negada');
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <EzPageLayout header={<EzPageHeader title="Liberações" />}>
      {notice && (
        <EzAlert variant="success" role="status" className="mb-3" onClose={() => setNotice(null)}>{notice}</EzAlert>
      )}
      {isLoading ? (
        <div className="p-8"><EzSpinner label="Carregando liberações…" /></div>
      ) : isError ? (
        <EzAlert
          variant="error"
          className="m-4"
          action={<EzButton variant="secondary" size="small" label="Tentar novamente" onClick={() => void refetch()} />}
        >
          Erro ao carregar as liberações.
        </EzAlert>
      ) : rows.length === 0 ? (
        <EzEmptyCard title="Nenhuma liberação pendente." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <EzButton size="small" disabled={!only || decide.isPending} onClick={() => only && approve(only, false)}>
              Liberar selecionado
            </EzButton>
            <EzButton size="small" variant="secondary" disabled={!only || decide.isPending} onClick={() => only && openDecision(only, true)}>
              Negar selecionado
            </EzButton>
            <span className="text-[12px] text-gray-500">Selecione um registro para decidir, ou use Ver detalhes na linha para ler o motivo e decidir.</span>
          </div>
          {pageError && <EzAlert variant="error">{pageError}</EzAlert>}
          <EzEntityGrid
            tableLabel="Liberações"
            key={`${gridEpoch}:${gridCapacity}`}
            data={rows}
            columns={columns}
            selectable
            zebraStriping
            onSelectionChange={handleSelectionChange}
            onRowDoubleClick={(row) => openDecision(row, false)}
          />
        </div>
      )}

      {open && (
        <EzModal
          isOpen
          onClose={close}
          title={`Liberação: ${APPROVAL_TYPE_LABELS[open.approvalType]}`}
          maxWidth="lg"
          footer={
            rejecting ? (
              <>
                <EzButton variant="secondary" onClick={() => setRejecting(false)}>Voltar</EzButton>
                <EzButton disabled={decide.isPending} onClick={() => confirmReject(open)}>Confirmar negação</EzButton>
              </>
            ) : (
              <>
                <EzButton variant="secondary" onClick={() => setRejecting(true)}>Negar</EzButton>
                <EzButton disabled={decide.isPending} onClick={() => approve(open, true)}>Liberar</EzButton>
              </>
            )
          }
        >
          <div className="space-y-3 text-[13px] text-gray-800">
            <p><span className="font-semibold">{open.author.name}</span> no ticket {open.ticket.protocol} ({open.ticket.title})</p>
            <p>{formatDateTime(open.startTime)} a {formatDateTime(open.endTime)} · {formatWorklogMinutes(open.minutes)}</p>
            <p className="whitespace-pre-line rounded border border-gray-200 bg-gray-50 p-3">{open.approvalReason}</p>
            {rejecting && (
              <EzTextArea
                ref={noteRef}
                id="release-reject-note"
                label="Motivo da negação"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                hasError={missingNote}
                message={missingNote ? error ?? undefined : undefined}
              />
            )}
            {error && !missingNote && <EzAlert variant="error">{error}</EzAlert>}
          </div>
        </EzModal>
      )}
    </EzPageLayout>
  );
}

/** DMTE-462 T5: a rota só abre para quem tem permissão de liberar; a API confere de novo em cada chamada. */
export function ReleasesRoute() {
  const { data, isLoading } = useEffectivePermissions();
  if (isLoading) return <div className="p-8"><EzSpinner label="Carregando…" /></div>;
  if (data?.canReleaseWorklogs !== true) {
    return (
      <EzPageLayout header={<EzPageHeader title="Liberações" />}>
        <EzEmptyCard title="Sem permissão" description="Você não tem permissão para decidir liberações." />
      </EzPageLayout>
    );
  }
  return <ReleasesPage />;
}

export default ReleasesPage;
