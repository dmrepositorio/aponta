import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleasesPage } from './ReleasesPage';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const ROWS = [
  {
    id: 'w-1', approvalType: 'LANCAMENTO', approvalStatus: 'PENDING', minutes: 60,
    approvalReason: 'O início 12/11 08:10 não cai na janela de nenhuma agenda deste ticket. A regra: o lançamento manual precisa começar dentro da janela.',
    startTime: '2026-11-12T11:10:00.000Z', endTime: '2026-11-12T12:10:00.000Z', ticketId: 't-1',
    ticket: { id: 't-1', protocol: 'T-1001', title: 'Erro no ERP' }, author: { id: 'u-2', name: 'Ana Consultora', email: 'ana@aponta.test' },
  },
  {
    id: 'w-2', approvalType: 'CRONOMETRO_ENCERRADO', approvalStatus: 'PENDING', minutes: 240,
    approvalReason: 'O sistema encerrou este cronômetro sozinho porque o tempo trabalhado chegou aos 240 min da agenda.',
    startTime: '2026-11-12T11:00:00.000Z', endTime: '2026-11-12T15:00:00.000Z', ticketId: 't-2',
    ticket: { id: 't-2', protocol: 'T-1002', title: 'Impressora parada' }, author: { id: 'u-3', name: 'Bia Consultora', email: 'bia@aponta.test' },
  },
];

let lastQueryClient: QueryClient;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReleasesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReleasesPage (DMTE-462 T5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: ROWS });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('AC-30: lista os pendentes no grid do DS, com consultor, ticket, tipo e motivo', async () => {
    renderPage();
    expect(await screen.findByText('Ana Consultora')).toBeInTheDocument();
    expect(screen.getByText('Bia Consultora')).toBeInTheDocument();
    expect(screen.getByText('T-1001')).toBeInTheDocument();
    expect(screen.getByText('Lançamento')).toBeInTheDocument();
    expect(screen.getByText('Cronômetro encerrado')).toBeInTheDocument();
    expect(screen.getByText(/não cai na janela/i)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/worklog-approvals');
  });

  it('AC-30: não oferece incluir nem excluir', async () => {
    renderPage();
    await screen.findByText('Ana Consultora');
    expect(screen.queryByRole('button', { name: /novo|incluir|adicionar|excluir|remover|apagar/i })).not.toBeInTheDocument();
  });

  it('AC-30: sem linha selecionada, Liberar e Negar ficam desativados', async () => {
    renderPage();
    await screen.findByText('Ana Consultora');
    expect(screen.getByRole('button', { name: 'Liberar selecionado' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Negar selecionado' })).toBeDisabled();
  });

  it('AC-30: o duplo clique abre a decisão com o motivo completo, e Liberar chama a API', async () => {
    renderPage();
    fireEvent.doubleClick(await screen.findByText('Ana Consultora'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/A regra: o lançamento manual precisa começar dentro da janela/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Liberar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/worklog-approvals/w-1/approve'));
  });

  it('AC-30: com uma linha selecionada, Liberar selecionado decide só ela', async () => {
    renderPage();
    await screen.findByText('Ana Consultora');
    const row = screen.getByText('Bia Consultora').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Liberar selecionado' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/worklog-approvals/w-2/approve'));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('AC-30: negar pede o motivo, não envia sem ele e envia com ele', async () => {
    renderPage();
    await screen.findByText('Ana Consultora');
    const row = screen.getByText('Ana Consultora').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Negar selecionado' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar negação' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/motivo/i);
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Motivo da negação'), 'Horário não confere com o atendimento');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar negação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/worklog-approvals/w-1/reject', { note: 'Horário não confere com o atendimento' }));
  });

  it('AC-25: erro do servidor na decisão aparece na própria janela', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Ninguém libera o próprio apontamento' } } });
    renderPage();
    fireEvent.doubleClick(await screen.findByText('Ana Consultora'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Liberar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ninguém libera o próprio apontamento');
  });

  it('REL-02: cada linha tem o botão Ver detalhes, que abre a decisão com o motivo sem duplo clique', async () => {
    renderPage();
    await screen.findByText('Ana Consultora');
    const row = screen.getByText('Ana Consultora').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /^Ver detalhes/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/A regra: o lançamento manual precisa começar dentro da janela/i)).toBeInTheDocument();
    expect(screen.queryByText(/dê duplo clique/i)).not.toBeInTheDocument();
  });

  it('REL-04: depois de liberar, avisa "Liberação concedida"', async () => {
    renderPage();
    fireEvent.doubleClick(await screen.findByText('Ana Consultora'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Liberar' }));
    expect(await screen.findByText('Liberação concedida')).toBeInTheDocument();
  });

  it('REL-04: depois de negar, avisa "Liberação negada"', async () => {
    renderPage();
    fireEvent.doubleClick(await screen.findByText('Ana Consultora'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Negar' }));
    await userEvent.type(within(dialog).getByLabelText('Motivo da negação'), 'Não confere');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar negação' }));
    expect(await screen.findByText('Liberação negada')).toBeInTheDocument();
  });

  it('REL-05: ao abrir Negar o textarea recebe foco', async () => {
    renderPage();
    fireEvent.doubleClick(await screen.findByText('Ana Consultora'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Negar' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Motivo da negação')).toHaveFocus());
  });

  it('REL-05: negar sem motivo marca o textarea como inválido, com a mensagem ligada ao campo e foco nele', async () => {
    renderPage();
    fireEvent.doubleClick(await screen.findByText('Ana Consultora'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Negar' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar negação' }));
    const field = within(dialog).getByLabelText('Motivo da negação');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Informe o motivo da negação.');
    expect(field).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('REL-06: a duração aparece como Xh Ym e o período em duas linhas, início e fim', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ ...ROWS[0], minutes: 135 }] });
    renderPage();
    await screen.findByText('Ana Consultora');
    expect(screen.getByRole('columnheader', { name: /Duração/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Minutos/ })).not.toBeInTheDocument();
    const row = screen.getByText('Ana Consultora').closest('tr') as HTMLElement;
    expect(within(row).getByText('2h 15m')).toBeInTheDocument();
    expect(within(row).getByText('12/11/2026 08:10')).toBeInTheDocument();
    expect(within(row).getByText('12/11/2026 09:10')).toBeInTheDocument();
  });

  it('AC-30: lista vazia e falha de carga têm mensagens próprias', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const vazia = renderPage();
    expect(await screen.findByText('Nenhuma liberação pendente.')).toBeInTheDocument();
    vazia.unmount();
    vi.mocked(api.get).mockRejectedValue(new Error('403'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/erro ao carregar/i);
  });

  it('REL-09: a falha de carga traz Tentar novamente, que refaz a consulta', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('500'));
    renderPage();
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent(/erro ao carregar/i);
    expect(api.get).toHaveBeenCalledTimes(1);

    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Ana Consultora', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('REL-08: atualizar a lista não remonta a grade (mesmo nó DOM)', async () => {
    renderPage();
    await screen.findByText('Ana Consultora', {}, { timeout: 5000 });
    const table = screen.getByRole('table');
    const extra = { ...ROWS[0], id: 'w-3', ticketId: 't-3', ticket: { id: 't-3', protocol: 'T-1003', title: 'Fila parada' }, author: { id: 'u-4', name: 'Caio Consultor', email: 'caio@aponta.test' } };
    // Mesma quantidade de linhas, outro conjunto de ids (a Bia saiu, o Caio entrou).
    vi.mocked(api.get).mockResolvedValue({ data: [ROWS[0], extra] });

    await lastQueryClient.invalidateQueries();

    expect(await screen.findByText('Caio Consultor', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('Bia Consultora')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBe(table);
  });

  it('REL-08: uma liberação nova na lista aparece mesmo com a grade já montada', async () => {
    renderPage();
    await screen.findByText('Ana Consultora', {}, { timeout: 5000 });
    const extra = { ...ROWS[0], id: 'w-3', ticketId: 't-3', ticket: { id: 't-3', protocol: 'T-1003', title: 'Fila parada' }, author: { id: 'u-4', name: 'Caio Consultor', email: 'caio@aponta.test' } };
    vi.mocked(api.get).mockResolvedValue({ data: [...ROWS, extra] });

    await lastQueryClient.invalidateQueries();

    expect(await screen.findByText('Caio Consultor', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Ana Consultora')).toBeInTheDocument();
  });

  it('REL-08: depois de decidir a linha selecionada, a seleção é limpa e Liberar selecionado não age em outra linha', async () => {
    renderPage();
    await screen.findByText('Ana Consultora', {}, { timeout: 5000 });
    const row = screen.getByText('Ana Consultora').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Liberar selecionado' })).toBeEnabled();
    vi.mocked(api.get).mockResolvedValue({ data: [ROWS[1]] });

    await userEvent.click(screen.getByRole('button', { name: 'Liberar selecionado' }));

    await waitFor(() => expect(screen.queryByText('Ana Consultora')).not.toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Liberar selecionado' })).toBeDisabled();
    const left = screen.getByText('Bia Consultora').closest('tr') as HTMLElement;
    expect(within(left).getByRole('checkbox')).not.toBeChecked();
  });
});
