import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../hooks/useTickets';
import type { DeskStage } from '../MesaStagesEditor';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { TicketKanban } from './TicketKanban';

// DMTE-527 T2 (AC-14 a AC-17), Kanban: o recolhimento das colunas vem do servidor (mapa `collapsed` da tela
// tickets-kanban), por usuário, e a tela espera a leitura antes de desenhar o quadro.
vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

// @hello-pangea/dnd não roda em jsdom: casca mínima que só registra isDropDisabled de cada coluna.
const capturedDroppables: Record<string, { isDropDisabled: boolean }> = {};
vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => children,
  Droppable: ({
    droppableId,
    isDropDisabled,
    children,
  }: {
    droppableId: string;
    isDropDisabled?: boolean;
    children: (provided: unknown, snapshot: unknown) => React.ReactNode;
  }) => {
    capturedDroppables[droppableId] = { isDropDisabled: Boolean(isDropDisabled) };
    return children({ innerRef: () => undefined, droppableProps: {} }, { isDraggingOver: false });
  },
  Draggable: ({ children }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode }) =>
    children(
      { innerRef: () => undefined, draggableProps: { style: {} }, dragHandleProps: {} },
      { isDragging: false },
    ),
}));

const baseTicket: Ticket = {
  id: 't1',
  protocol: 'AP-2026-0001',
  title: 'Aberto um',
  description: 'desc',
  status: 'OPEN',
  priority: 'HIGH',
  requesterId: 'r1',
  agentId: null,
  serviceDeskId: 'desk-1',
  responseDeadline: '2026-01-01T10:00:00.000Z',
  resolveDeadline: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const resolvedTicket: Ticket = { ...baseTicket, id: 't2', protocol: 'AP-2026-0002', title: 'Resolvido um', status: 'RESOLVED' };
const closedTicket: Ticket = { ...baseTicket, id: 't3', protocol: 'AP-2026-0003', title: 'Fechado um', status: 'CLOSED' };
const statusTickets = [baseTicket, resolvedTicket, closedTicket];

const stage = (id: string, name: string, position: number, isFinal = false): DeskStage => ({
  id,
  name,
  position,
  isInitial: position === 0,
  isFinal,
  transitionToIds: [],
});
const deskStages = [stage('s-n1', 'N1', 0), stage('s-n2', 'N2', 1), stage('s-aguardando-cliente', 'Aguardando Cliente', 2, true)];
const stageTickets: Ticket[] = [
  { ...baseTicket, stageId: 's-n1' },
  { ...resolvedTicket, status: 'OPEN', stageId: 's-n2', title: 'Dois' },
  { ...closedTicket, status: 'OPEN', stageId: 's-aguardando-cliente', title: 'Final' },
];

const PREF_URL = '/me/screen-preferences/tickets-kanban';
const setUser = (sub: string) =>
  useAuthStore.setState({
    token: null,
    user: { sub, email: `${sub}@dm.test`, role: 'AGENT', organizationId: null } as never,
  });

/** Servidor falso: preferência da tela por usuário (o do authStore na chamada), Mesa e estágios. */
function fakeServer(initial: Record<string, unknown> = {}) {
  const prefs = new Map<string, unknown>(Object.entries(initial));
  const userKey = () => useAuthStore.getState().user?.sub as string;
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === PREF_URL) return { data: prefs.get(userKey()) ?? {} };
    if (url === '/service-desks') return { data: [{ id: 'desk-1', name: 'Suporte N1' }] };
    if (url === '/service-desks/desk-1/stages') return { data: deskStages };
    throw new Error(`Unexpected GET ${url}`);
  }) as never);
  vi.mocked(api.put).mockImplementation((async (url: string, body: unknown) => {
    if (url === PREF_URL) prefs.set(userKey(), body);
    return { data: body };
  }) as never);
  return prefs;
}

function renderKanban(props: { tickets: Ticket[]; initialServiceDeskId?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TicketKanban {...props} isLoading={false} isError={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Espera o quadro de verdade (não o esqueleto): há coluna ou faixa recolhida de um rótulo conhecido. */
const boardReady = () => waitFor(() => expect(screen.getAllByTestId(/^collapse-column-/).length).toBeGreaterThan(0));
const strip = (name: RegExp) => screen.queryByRole('button', { name });
const ticketVisible = (protocol: string) => screen.queryByText(new RegExp(protocol)) !== null;
/** Clica na faixa recolhida (nome acessível com o rótulo, AC-07 do ticket 1); falha por asserção se ela não existir. */
const clickStrip = (name: RegExp) => {
  const button = strip(name);
  expect(button).toBeInTheDocument();
  fireEvent.click(button as HTMLElement);
};
const collapseButton = (id: string) => screen.getByTestId(`collapse-column-${id}`);
const savedCollapsed = () => {
  const calls = vi.mocked(api.put).mock.calls.filter(([url]) => url === PREF_URL);
  return (calls.at(-1)?.[1] as { collapsed?: Record<string, boolean> } | undefined)?.collapsed;
};
const waitForSave = () => waitFor(() => expect(vi.mocked(api.put)).toHaveBeenCalled(), { timeout: 2000 });

describe('TicketKanban com preferências no servidor (DMTE-527 T2)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    Object.keys(capturedDroppables).forEach((key) => delete capturedDroppables[key]);
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.patch).mockReset();
    setUser('user-1');
  });

  describe('AC-14: a tela espera a leitura antes de desenhar', () => {
    it('AC-14: com a leitura pendente mostra o esqueleto (sem colunas); depois da resposta desenha o quadro', async () => {
      let answer!: (value: { data: unknown }) => void;
      fakeServer();
      vi.mocked(api.get).mockImplementation(((url: string) => {
        if (url === PREF_URL) return new Promise((resolve) => { answer = resolve as typeof answer; });
        if (url === '/service-desks') return Promise.resolve({ data: [] });
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      }) as never);
      renderKanban({ tickets: statusTickets });

      expect(vi.mocked(api.get)).toHaveBeenCalledWith(PREF_URL);
      expect(screen.getByText('Carregando...')).toBeInTheDocument();
      expect(screen.queryAllByTestId('kanban-column')).toHaveLength(0);
      expect(screen.queryAllByTestId(/^collapse-column-/)).toHaveLength(0);

      answer({ data: {} });
      await boardReady();
      expect(screen.queryByText('Carregando...')).not.toBeInTheDocument();
      expect(ticketVisible('AP-2026-0001')).toBe(true);
    });

    it('AC-14: o recolhimento não passa pelo localStorage: grava no servidor e não deixa chave no navegador', async () => {
      fakeServer();
      renderKanban({ tickets: statusTickets });
      await boardReady();

      fireEvent.click(collapseButton('OPEN'));
      await waitForSave();
      expect(savedCollapsed()).toEqual({ OPEN: true });
      expect(Object.keys(localStorage).filter((k) => k.startsWith('aponta_screen_config_'))).toEqual([]);
    });
  });

  describe('AC-17: recolhimento salvo e relido por usuário (mapa collapsed)', () => {
    it('AC-17: o mapa do servidor vence o padrão; coluna sem entrada usa o padrão (Resolvido e Fechado recolhidos)', async () => {
      fakeServer({ 'user-1': { collapsed: { OPEN: true, RESOLVED: false } } });
      renderKanban({ tickets: statusTickets });
      await boardReady();

      expect(strip(/Aberto/)).toBeInTheDocument();
      expect(ticketVisible('AP-2026-0001')).toBe(false);
      expect(capturedDroppables['OPEN'].isDropDisabled).toBe(true);

      expect(ticketVisible('AP-2026-0002')).toBe(true);
      expect(capturedDroppables['RESOLVED'].isDropDisabled).toBe(false);

      expect(strip(/Fechado/)).toBeInTheDocument();
      expect(ticketVisible('AP-2026-0003')).toBe(false);
      expect(capturedDroppables['IN_PROGRESS'].isDropDisabled).toBe(false);
    });

    it('AC-17: expandir Resolvido e recolher Aberto grava só o que o usuário mexeu, com espera de 400 ms', async () => {
      fakeServer();
      renderKanban({ tickets: statusTickets });
      await boardReady();

      clickStrip(/Resolvido/);
      expect(ticketVisible('AP-2026-0002')).toBe(true);
      fireEvent.click(collapseButton('OPEN'));
      expect(ticketVisible('AP-2026-0001')).toBe(false);
      expect(vi.mocked(api.put)).not.toHaveBeenCalled();

      await waitForSave();
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(vi.mocked(api.put)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.put)).toHaveBeenCalledWith(PREF_URL, expect.objectContaining({ collapsed: { RESOLVED: false, OPEN: true } }));
    });

    it('AC-17: o recolhimento gravado é relido igual ao abrir o Kanban de novo', async () => {
      fakeServer();
      const first = renderKanban({ tickets: statusTickets });
      await boardReady();
      clickStrip(/Resolvido/);
      fireEvent.click(collapseButton('IN_PROGRESS'));
      await waitForSave();
      first.unmount();

      renderKanban({ tickets: statusTickets });
      await boardReady();
      expect(ticketVisible('AP-2026-0002')).toBe(true);
      expect(strip(/Em Andamento|Em andamento/)).toBeInTheDocument();
      expect(strip(/Fechado/)).toBeInTheDocument();
    });

    it('AC-17: com Mesa selecionada, o mapa vale por estágio e o id de estágio inexistente é ignorado', async () => {
      fakeServer({
        'user-1': { groupBy: 'stage', collapsed: { 's-n1': true, 's-aguardando-cliente': false, 's-que-nao-existe-mais': true } },
      });
      renderKanban({ tickets: stageTickets, initialServiceDeskId: 'desk-1' });
      await waitFor(() => expect(screen.getByTestId('collapse-column-s-n2')).toBeInTheDocument());

      expect(strip(/N1/)).toBeInTheDocument();
      expect(ticketVisible('AP-2026-0001')).toBe(false);
      expect(capturedDroppables['s-n1'].isDropDisabled).toBe(true);

      expect(screen.getByTestId('collapse-column-s-aguardando-cliente')).toBeInTheDocument();
      expect(screen.queryByText('Final')).toBeInTheDocument();
      expect(capturedDroppables['s-aguardando-cliente'].isDropDisabled).toBe(false);

      expect(screen.queryByTestId('collapse-column-s-que-nao-existe-mais')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('expand-column')).toHaveLength(1);
    });

    it('AC-17: com Mesa selecionada e sem entrada no mapa, o estágio final abre recolhido (padrão do AC-07)', async () => {
      fakeServer({ 'user-1': { groupBy: 'stage', collapsed: { 's-n2': true } } });
      renderKanban({ tickets: stageTickets, initialServiceDeskId: 'desk-1' });
      await waitFor(() => expect(screen.getByTestId('collapse-column-s-n1')).toBeInTheDocument());

      expect(strip(/N2/)).toBeInTheDocument();
      expect(strip(/Aguardando Cliente/)).toBeInTheDocument();
      expect(capturedDroppables['s-aguardando-cliente'].isDropDisabled).toBe(true);
    });

    it('AC-17: o recolhimento de um usuário não afeta o de outro', async () => {
      fakeServer();
      const first = renderKanban({ tickets: statusTickets });
      await boardReady();
      clickStrip(/Resolvido/);
      fireEvent.click(collapseButton('OPEN'));
      await waitForSave();
      await new Promise((resolve) => setTimeout(resolve, 600));
      first.unmount();

      setUser('user-2');
      renderKanban({ tickets: statusTickets });
      await boardReady();
      expect(ticketVisible('AP-2026-0001')).toBe(true);
      expect(strip(/Resolvido/)).toBeInTheDocument();
      expect(ticketVisible('AP-2026-0002')).toBe(false);
      expect(savedCollapsed()).toEqual({ RESOLVED: false, OPEN: true });
    });
  });

  describe('AC-16: falha de leitura ou gravação não trava o Kanban', () => {
    it('AC-16: se a leitura falhar, o quadro abre com os padrões, sem alerta, e a escolha fica em memória', async () => {
      fakeServer();
      vi.mocked(api.get).mockImplementation(((url: string) => {
        if (url === '/service-desks') return Promise.resolve({ data: [] });
        return Promise.reject(new Error('Network Error'));
      }) as never);
      renderKanban({ tickets: statusTickets });
      await boardReady();

      expect(vi.mocked(api.get)).toHaveBeenCalledWith(PREF_URL);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(strip(/Resolvido/)).toBeInTheDocument();
      expect(ticketVisible('AP-2026-0001')).toBe(true);

      clickStrip(/Resolvido/);
      expect(ticketVisible('AP-2026-0002')).toBe(true);
    });

    it('AC-16: se a gravação falhar, a escolha continua, sem alerta, e a próxima mudança tenta gravar de novo', async () => {
      fakeServer();
      vi.mocked(api.put).mockRejectedValue(new Error('Network Error'));
      renderKanban({ tickets: statusTickets });
      await boardReady();

      clickStrip(/Resolvido/);
      await waitFor(() => expect(vi.mocked(api.put)).toHaveBeenCalledTimes(1), { timeout: 2000 });
      expect(ticketVisible('AP-2026-0002')).toBe(true);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      fireEvent.click(collapseButton('OPEN'));
      await waitFor(() => expect(vi.mocked(api.put)).toHaveBeenCalledTimes(2), { timeout: 2000 });
      expect(savedCollapsed()).toEqual({ RESOLVED: false, OPEN: true });
      expect(ticketVisible('AP-2026-0001')).toBe(false);
    });
  });
});
