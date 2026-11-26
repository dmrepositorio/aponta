import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledJobsPage } from './ScheduledJobsPage';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

const JOBS = [
  {
    type: 'HEARTBEAT',
    cron: '* * * * *',
    enabled: true,
    nextRunAt: '2026-11-11T12:01:00.000Z',
    lastRunAt: '2026-11-11T12:00:00.000Z',
    failures: 1,
    runs: [
      { id: 'r-2', status: 'FAILED', attempt: 2, startedAt: '2026-11-11T12:00:00.000Z', finishedAt: '2026-11-11T12:00:01.000Z', error: 'Tempo esgotado' },
      { id: 'r-1', status: 'SUCCESS', attempt: 1, startedAt: '2026-11-11T11:59:00.000Z', finishedAt: '2026-11-11T11:59:01.000Z', error: null },
    ],
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ScheduledJobsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const LABEL = 'Verificação do agendador';
/** EzAlert de erro: fundo vermelho do DS e ícone (a severidade não depende só da cor). */
const isErrorAlert = (element: HTMLElement) =>
  element.className.includes('bg-red-100') && element.querySelector('svg') !== null;

describe('ScheduledJobsPage (DMTE-462 T3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: JOBS });
    vi.mocked(api.patch).mockResolvedValue({ data: JOBS[0] });
  });

  it('AC-16: lista a tarefa com o cron atual, a próxima e a última execução', async () => {
    renderPage();
    expect(await screen.findByText('Verificação do agendador')).toBeInTheDocument();
    expect(screen.getByLabelText('Cron de Verificação do agendador')).toHaveValue('* * * * *');
    expect(screen.getByText(/próxima execução/i)).toBeInTheDocument();
    expect(screen.getByText(/última execução/i)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/scheduled-jobs');
  });

  it('AC-18: a tarefa do fechamento automático aparece com nome em português', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ ...JOBS[0], type: 'WORKLOG_AUTOCLOSE', runs: [] }] });
    renderPage();
    expect(await screen.findByText('Fechamento automático de cronômetros')).toBeInTheDocument();
    expect(screen.queryByText('WORKLOG_AUTOCLOSE')).not.toBeInTheDocument();
  });

  it('AC-16 / JOB-03: falha ao carregar aparece em EzAlert de erro (ícone e texto), não como lista vazia', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('403'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/erro ao carregar/i);
    expect(isErrorAlert(alert)).toBe(true);
    expect(screen.queryByText('Nenhuma tarefa agendada.')).not.toBeInTheDocument();
  });

  it('AC-16: mostra as execuções recentes com estado, tentativa e erro', async () => {
    renderPage();
    await screen.findByText('Verificação do agendador');
    expect(screen.getByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('Sucesso')).toBeInTheDocument();
    expect(screen.getByText('Tempo esgotado')).toBeInTheDocument();
  });

  it('AC-15: editar o cron e salvar envia só o cron daquele tipo', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText('Cron de Verificação do agendador');
    await user.clear(input);
    await user.type(input, '*/5 * * * *');
    await user.click(screen.getByRole('button', { name: 'Salvar cron de Verificação do agendador' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/scheduled-jobs/HEARTBEAT', { cron: '*/5 * * * *' }));
  });

  it('AC-15 / JOB-03: cron recusado pelo servidor mostra a mensagem dele em EzAlert de erro', async () => {
    vi.mocked(api.patch).mockRejectedValue({ response: { data: { message: 'Expressão cron inválida' } } });
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText('Cron de Verificação do agendador');
    await user.clear(input);
    // 31 de fevereiro passa na checagem local (5 campos válidos) e só o servidor recusa.
    await user.type(input, '0 0 31 2 *');
    await user.click(screen.getByRole('button', { name: 'Salvar cron de Verificação do agendador' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Expressão cron inválida');
    expect(isErrorAlert(alert)).toBe(true);
  });

  describe('JOB-01: ativar e desativar', () => {
    const toggle = () => screen.findByLabelText(`Ativa: ${LABEL}`);
    const confirm = async () =>
      userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));

    it('desmarcar Ativa só chama o PATCH depois de confirmar, e a confirmação nomeia a tarefa', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await toggle());
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(LABEL);
      expect(api.patch).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/scheduled-jobs/HEARTBEAT', { enabled: false }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('cancelar a confirmação não altera a tarefa', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await toggle());
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
      expect(await toggle()).toBeChecked();
    });

    it('ativar uma tarefa desativada segue direto, sem confirmação', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [{ ...JOBS[0], enabled: false }] });
      const user = userEvent.setup();
      renderPage();
      await user.click(await toggle());
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/scheduled-jobs/HEARTBEAT', { enabled: true }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('o checkbox fica desabilitado enquanto a mutação pende', async () => {
      vi.mocked(api.patch).mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      renderPage();
      await user.click(await toggle());
      await confirm();
      await waitFor(() => expect(screen.getByLabelText(`Ativa: ${LABEL}`)).toBeDisabled());
    });

    it('sucesso mostra um aviso (toast) de que a tarefa foi desativada', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await toggle());
      await confirm();
      expect(await screen.findByRole('status')).toHaveTextContent(/tarefa desativada/i);
    });

    it('erro ao gravar aparece em EzAlert e o checkbox continua com o valor do servidor', async () => {
      vi.mocked(api.patch).mockRejectedValue({ response: { data: { message: 'Sem permissão' } } });
      const user = userEvent.setup();
      renderPage();
      await user.click(await toggle());
      await confirm();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Sem permissão');
      expect(isErrorAlert(alert)).toBe(true);
      expect(await toggle()).toBeChecked();
    });
  });

  describe('JOB-02: campo cron', () => {
    const input = () => screen.findByLabelText(`Cron de ${LABEL}`);
    const save = () => screen.getByRole('button', { name: `Salvar cron de ${LABEL}` });

    it('cron inválido mostra o erro no campo e desabilita Salvar', async () => {
      const user = userEvent.setup();
      renderPage();
      const field = await input();
      await user.clear(field);
      await user.type(field, '* * *');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(/5 campos/i);
      expect(save()).toBeDisabled();
      await user.click(save());
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('valor igual ao atual deixa Salvar desabilitado e não sinaliza alteração', async () => {
      renderPage();
      await input();
      expect(save()).toBeDisabled();
      expect(screen.queryByText(/alterações não salvas/i)).not.toBeInTheDocument();
    });

    it('editar para um cron válido sinaliza "Alterações não salvas" e habilita Salvar', async () => {
      const user = userEvent.setup();
      renderPage();
      const field = await input();
      await user.clear(field);
      await user.type(field, '*/5 * * * *');
      expect(screen.getByText(/alterações não salvas/i)).toBeInTheDocument();
      expect(save()).toBeEnabled();
      await user.clear(field);
      await user.type(field, '* * * * *');
      expect(screen.queryByText(/alterações não salvas/i)).not.toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('sucesso ao salvar o cron mostra um aviso (toast)', async () => {
      const user = userEvent.setup();
      renderPage();
      const field = await input();
      await user.clear(field);
      await user.type(field, '*/5 * * * *');
      await user.click(save());
      expect(await screen.findByRole('status')).toHaveTextContent(/cron salvo/i);
    });

    it('ressincroniza o campo quando o cron do servidor muda', async () => {
      const { queryClient } = renderPage();
      expect(await input()).toHaveValue('* * * * *');
      vi.mocked(api.get).mockResolvedValue({ data: [{ ...JOBS[0], cron: '0 3 * * *' }] });
      await queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      await waitFor(() => expect(screen.getByLabelText(`Cron de ${LABEL}`)).toHaveValue('0 3 * * *'));
    });
  });

  describe('JOB-04: histórico de execuções', () => {
    const tagOf = (text: string) => screen.getByText(text).closest('[data-ez-tag]') as HTMLElement;

    it('o estado da execução aparece em tag com destaque: Falhou em vermelho, Sucesso em verde', async () => {
      renderPage();
      await screen.findByText(LABEL);
      expect(tagOf('Falhou').className).toContain('bg-red-100');
      expect(tagOf('Sucesso').className).toContain('bg-green-100');
    });

    it('a tabela tem caption com o limite e cabeçalhos com scope=col', async () => {
      renderPage();
      await screen.findByText(LABEL);
      const table = screen.getByRole('table', { name: /últimas 2 execuções de verificação do agendador/i });
      const headers = within(table).getAllByRole('columnheader');
      expect(headers).toHaveLength(4);
      headers.forEach((header) => expect(header).toHaveAttribute('scope', 'col'));
    });

    it('erro longo é truncado na célula e o texto completo fica no title', async () => {
      const longError = 'Falha ao fechar o cronômetro: '.repeat(10).trim();
      vi.mocked(api.get).mockResolvedValue({
        data: [{ ...JOBS[0], runs: [{ ...JOBS[0].runs[0], error: longError }] }],
      });
      renderPage();
      await screen.findByText(LABEL);
      const cell = screen.getByTitle(longError);
      expect(cell.className).toContain('truncate');
      expect(cell).toHaveTextContent(longError);
    });
  });
});
