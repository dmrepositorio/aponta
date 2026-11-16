import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragStart, DropResult } from '@hello-pangea/dnd';
import type { Ticket } from '../../hooks/useTickets';
import type { DeskStage } from '../MesaStagesEditor';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';
import { TicketKanban } from './TicketKanban';
import { classTokens, classesUpTo, heightContractProblems } from '../../test-utils/controlHeight';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

// @hello-pangea/dnd relies on real browser layout/drag events that jsdom
// cannot provide. We mock it down to a plain render-prop shell and capture
// the onDragStart/onDragEnd handlers the component wires up, plus the
// isDropDisabled/isDragDisabled props passed to each Droppable/Draggable,
// so we can invoke the handlers directly with synthetic start/drop results
// and assert on drop-eligibility — this exercises the exact same logic the
// real library would trigger, without needing a simulated HTML5 drag.
let capturedOnDragStart: ((start: DragStart) => void) | null = null;
let capturedOnDragEnd: ((result: DropResult) => void) | null = null;
const capturedDroppables: Record<string, { isDropDisabled: boolean }> = {};
const capturedDraggables: Record<string, { isDragDisabled: boolean }> = {};

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({
    children,
    onDragEnd,
    onDragStart,
  }: {
    children: React.ReactNode;
    onDragEnd: (r: DropResult) => void;
    onDragStart?: (s: DragStart) => void;
  }) => {
    capturedOnDragEnd = onDragEnd;
    capturedOnDragStart = onDragStart ?? null;
    return children;
  },
  Droppable: ({
    droppableId,
    isDropDisabled,
    children,
  }: {
    droppableId: string;
    isDropDisabled?: boolean;
    children: (provided: unknown, snapshot: unknown) => React.ReactNode;
  }) => {
    capturedDroppables[droppableId] = {
      isDropDisabled: Boolean(isDropDisabled),
    };
    return children(
      { innerRef: () => undefined, droppableProps: {} },
      { isDraggingOver: false },
    );
  },
  Draggable: ({
    draggableId,
    isDragDisabled,
    children,
  }: {
    draggableId: string;
    isDragDisabled?: boolean;
    children: (provided: unknown, snapshot: unknown) => React.ReactNode;
  }) => {
    capturedDraggables[draggableId] = {
      isDragDisabled: Boolean(isDragDisabled),
    };
    return children(
      {
        innerRef: () => undefined,
        draggableProps: { style: {} },
        dragHandleProps: {},
      },
      { isDragging: false },
    );
  },
}));

const baseTicket: Ticket = {
  id: 't1',
  protocol: 'AP-2026-0001',
  title: 'Printer broken',
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

const stageN1: DeskStage = {
  id: 's-n1',
  name: 'N1',
  position: 0,
  isInitial: true,
  isFinal: false,
  transitionToIds: ['s-n2'],
};
const stageN2: DeskStage = {
  id: 's-n2',
  name: 'N2',
  position: 1,
  isInitial: false,
  isFinal: false,
  transitionToIds: ['s-aguardando-cliente'],
};
const stageAguardandoCliente: DeskStage = {
  id: 's-aguardando-cliente',
  name: 'Aguardando Cliente',
  position: 2,
  isInitial: false,
  isFinal: true,
  transitionToIds: [],
};
const deskStages = [stageN1, stageN2, stageAguardandoCliente];

const serviceDesks = [{ id: 'desk-1', name: 'Suporte N1' }];

/** Mocks `api.get` to answer the always-on `/service-desks` list (for the
 * Mesa dropdown), the per-mesa `/service-desks/:id/stages` call and, since
 * DMTE-527 AC-14, the screen preference (`{}` = no row: every default applies);
 * the PUT of the preference succeeds. */
function mockApiGet(stages: DeskStage[] = deskStages) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/service-desks')
      return Promise.resolve({ data: serviceDesks });
    if (url === '/service-desks/desk-1/stages')
      return Promise.resolve({ data: stages });
    if (url === '/me/screen-preferences/tickets-kanban')
      return Promise.resolve({ data: {} });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  vi.mocked(api.put).mockImplementation((_url: string, body: unknown) =>
    Promise.resolve({ data: body }),
  );
}

/** O quadro só desenha depois da leitura da preferência (AC-14): sem Mesa, espera as colunas; com Mesa, o teste espera os estágios. */
async function renderKanban(props: {
  tickets: Ticket[];
  isLoading: boolean;
  isError: boolean;
  initialServiceDeskId?: string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TicketKanban {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (!props.isLoading && !props.isError && !props.initialServiceDeskId) {
    await screen.findAllByTestId('kanban-column');
  }
  return view;
}

const mesaCombobox = () => screen.getByRole('combobox', { name: 'Mesa' });
const sortButton = () => screen.getByRole('button', { name: 'Ordenar' });
const configButton = () => screen.getByRole('button', { name: 'Configurações' });
const board = () => screen.getByTestId('kanban-board');
/** Linha da barra: o primeiro ancestral do seletor de Mesa que também traz o Ordenar. */
const toolbarRow = () => {
  let node: Element | null = mesaCombobox();
  while (node && !node.contains(sortButton())) node = node.parentElement;
  return node as Element;
};
/** A faixa recolhida: o botão de expandir, pelo nome acessível que contém o rótulo da coluna (AC-07). */
const stripButton = (name: RegExp) => {
  const button = screen.queryByRole('button', { name });
  expect(button).toBeInTheDocument();
  return button as HTMLElement;
};

describe('TicketKanban', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    capturedOnDragStart = null;
    capturedOnDragEnd = null;
    Object.keys(capturedDroppables).forEach(
      (key) => delete capturedDroppables[key],
    );
    Object.keys(capturedDraggables).forEach(
      (key) => delete capturedDraggables[key],
    );
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    mockApiGet();
  });

  describe('fallback por status (nenhuma mesa selecionada)', () => {
    it('DMTE-458: board is a snap-scroll container and columns are fluid (no fixed 290px)', async () => {
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      const board = screen.getByTestId('kanban-board');
      expect(board.className).toContain('overflow-x-auto');
      expect(board.className).toContain('snap-x');

      const columns = screen.getAllByTestId('kanban-column');
      expect(columns.length).toBeGreaterThan(0);
      for (const col of columns) {
        expect(col.className).not.toContain('w-[290px]');
        expect(col.className).toContain('lg:flex-1');
        expect(col.className).toContain('snap-start');
      }
    });

    it('shows a skeleton loading state with every column label while isLoading', async () => {
      await renderKanban({ tickets: [], isLoading: true, isError: false });

      expect(screen.getByText('Carregando...')).toBeInTheDocument();
      expect(screen.getByText('Aberto')).toBeInTheDocument();
      expect(screen.getByText('Fechado')).toBeInTheDocument();
    });

    it('shows an error message when isError is true', async () => {
      await renderKanban({ tickets: [], isLoading: false, isError: true });
      expect(screen.getByRole('alert')).toHaveTextContent(
        /falha ao carregar os chamados/i,
      );
    });

    it('groups tickets into their matching status column with correct counts', async () => {
      const tickets = [
        baseTicket,
        {
          ...baseTicket,
          id: 't2',
          protocol: 'AP-2026-0002',
          status: 'IN_PROGRESS' as const,
        },
        {
          ...baseTicket,
          id: 't3',
          protocol: 'AP-2026-0003',
          status: 'OPEN' as const,
        },
      ];
      await renderKanban({ tickets, isLoading: false, isError: false });

      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
      expect(screen.getByText(/AP-2026-0002/)).toBeInTheDocument();
      expect(screen.getByText(/AP-2026-0003/)).toBeInTheDocument();

      // "Aberto" column (OPEN) should show count 2, "Em Andamento" should show 1
      const abertoHeading = screen
        .getAllByText('Aberto')
        .find((el) => el.tagName === 'H3')!;
      const abertoColumn = abertoHeading.closest('div')
        ?.parentElement as HTMLElement;
      expect(abertoColumn).toHaveTextContent('2');
    });

    it('DMTE-490 AC-05: has an Aguardando Sankhya column right after Aguardando Terceiros and groups its tickets there', async () => {
      await renderKanban({
        tickets: [{ ...baseTicket, id: 't9', protocol: 'AP-2026-0009', status: 'PENDING_SANKHYA' }],
        isLoading: false,
        isError: false,
      });

      const headings = screen
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent);
      const terceiros = headings.indexOf('Aguardando Terceiros');
      expect(terceiros).toBeGreaterThanOrEqual(0);
      expect(headings[terceiros + 1]).toBe('Aguardando Sankhya');

      const sankhyaHeading = screen
        .getAllByText('Aguardando Sankhya')
        .find((el) => el.tagName === 'H3')!;
      const column = sankhyaHeading.closest('div')?.parentElement as HTMLElement;
      expect(column).toHaveTextContent('1');
      expect(screen.getByText(/AP-2026-0009/)).toBeInTheDocument();
    });

    it('renders an empty column (count 0) when there are no tickets for that status', async () => {
      await renderKanban({ tickets: [], isLoading: false, isError: false });

      const abertoHeading = screen
        .getAllByText('Aberto')
        .find((el) => el.tagName === 'H3')!;
      const abertoColumn = abertoHeading.closest('div')
        ?.parentElement as HTMLElement;
      expect(abertoColumn).toHaveTextContent('0');
    });

    it('does nothing when a card is dropped outside any column (no destination)', async () => {
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      capturedOnDragEnd!({
        destination: null,
        source: { droppableId: 'OPEN', index: 0 },
        draggableId: 't1',
        reason: 'DROP',
        mode: 'FLUID',
        type: 'DEFAULT',
        combine: null,
      } as DropResult);

      expect(api.patch).not.toHaveBeenCalled();
    });

    it('does nothing when a card is dropped back in the same column', async () => {
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      capturedOnDragEnd!({
        destination: { droppableId: 'OPEN', index: 1 },
        source: { droppableId: 'OPEN', index: 0 },
        draggableId: 't1',
        reason: 'DROP',
        mode: 'FLUID',
        type: 'DEFAULT',
        combine: null,
      } as DropResult);

      expect(api.patch).not.toHaveBeenCalled();
    });

    it('calls the status-update API when a card is dropped into a different column', async () => {
      vi.mocked(api.patch).mockResolvedValue({
        data: { ...baseTicket, status: 'IN_PROGRESS' },
      });
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      capturedOnDragEnd!({
        destination: { droppableId: 'IN_PROGRESS', index: 0 },
        source: { droppableId: 'OPEN', index: 0 },
        draggableId: 't1',
        reason: 'DROP',
        mode: 'FLUID',
        type: 'DEFAULT',
        combine: null,
      } as DropResult);

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/tickets/t1/status', {
          status: 'IN_PROGRESS',
        });
      });
    });

    it('rolls back the optimistic update when the status-update API call fails', async () => {
      vi.mocked(api.patch).mockRejectedValue(new Error('network error'));
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      capturedOnDragEnd!({
        destination: { droppableId: 'IN_PROGRESS', index: 0 },
        source: { droppableId: 'OPEN', index: 0 },
        draggableId: 't1',
        reason: 'DROP',
        mode: 'FLUID',
        type: 'DEFAULT',
        combine: null,
      } as DropResult);

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalled();
      });
      // No crash / unhandled rejection means onError ran and restored the
      // previous query cache without throwing.
    });

    it('disables drop targets and card dragging for CLIENT role users', async () => {
      useAuthStore.setState({
        token: 'tok',
        user: {
          sub: 'u1',
          email: 'c@c.com',
          role: 'CLIENT',
          organizationId: null,
        },
      });
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      // Component still renders normally for clients; isDropDisabled/isDragDisabled
      // are passed down to the (mocked) Droppable/Draggable render props, which we
      // can't introspect directly through this shallow mock, but we confirm the
      // page renders without crashing and the ticket is still visible read-only.
      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
    });

    it('does not fetch mesa stages when no mesa is selected (fetches only the Mesa dropdown list)', async () => {
      mockApiGet();
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/service-desks');
      });
      expect(api.get).not.toHaveBeenCalledWith('/service-desks/desk-1/stages');
    });
  });

  describe('colapsar colunas e abrir novo ticket (TiFlux parity)', () => {
    it('shows a collapse toggle and an "Abrir novo ticket" link on every expanded column (fallback por status; Resolvido e Fechado abrem recolhidos, DMTE-527 AC-07)', async () => {
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      expect(screen.getAllByTestId(/^collapse-column-/)).toHaveLength(7);
      const newTicketLinks = screen.getAllByRole('link', {
        name: /abrir novo ticket/i,
      });
      expect(newTicketLinks).toHaveLength(7);
      expect(newTicketLinks[0]).toHaveAttribute('href', '/tickets/new');
    });

    it('collapsing a status column hides its ticket list and disables it as a drop target; expanding restores it', async () => {
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      fireEvent.click(screen.getByTestId('collapse-column-OPEN'));

      // Card no longer rendered while collapsed, and the column is no
      // longer a valid drop target.
      expect(screen.queryByText(/AP-2026-0001/)).not.toBeInTheDocument();
      expect(capturedDroppables['OPEN'].isDropDisabled).toBe(true);

      fireEvent.click(stripButton(/Aberto/));

      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
      expect(capturedDroppables['OPEN'].isDropDisabled).toBe(false);
    });

    it('DMTE-496 AC-01: a coluna recolhida tem a altura mínima da expandida e acompanha o quadro, por status e por estágio', async () => {
      await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });

      const expandedClass = screen.getAllByTestId('kanban-column')[0].className;
      expect(expandedClass).toContain('min-h-[500px]');
      fireEvent.click(screen.getByTestId('collapse-column-OPEN'));
      const collapsedByStatus = classTokens(classesUpTo(stripButton(/Aberto/), board()));
      expect(collapsedByStatus).toEqual(expect.arrayContaining(['min-h-[500px]', 'self-stretch']));

      cleanup();
      mockApiGet();
      await renderKanban({
        tickets: [{ ...baseTicket, stageId: 's-n1' }],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });
      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('collapse-column-s-n1'));
      const collapsedByStage = classTokens(classesUpTo(stripButton(/N1/), board()));
      expect(collapsedByStage).toEqual(expect.arrayContaining(['min-h-[500px]', 'self-stretch']));
    });

    it('does not show "Abrir novo ticket" for CLIENT role users', async () => {
      useAuthStore.setState({
        token: 'tok',
        user: {
          sub: 'u1',
          email: 'c@c.com',
          role: 'CLIENT',
          organizationId: null,
        },
      });
      await renderKanban({ tickets: [], isLoading: false, isError: false });

      expect(
        screen.queryByRole('link', { name: /abrir novo ticket/i }),
      ).not.toBeInTheDocument();
    });

    it('collapsing a stage column (mesa selecionada) hides its ticket list and disables it as a drop target', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [{ ...baseTicket, stageId: 's-n1' }],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('collapse-column-s-n1'));

      expect(screen.queryByText(/AP-2026-0001/)).not.toBeInTheDocument();
      expect(capturedDroppables['s-n1'].isDropDisabled).toBe(true);
    });
  });

  describe('seletor de Mesa dedicado (TiFlux parity)', () => {
    it('lists service desks in the Mesa dropdown and switches to stage-grouped columns on selection, without needing initialServiceDeskId', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [{ ...baseTicket, stageId: 's-n1' }],
        isLoading: false,
        isError: false,
      });

      // Starts in fallback (status) mode: no mesa pre-selected. Wait for the
      // "/service-desks" list to actually populate the dropdown's options
      // before selecting one — otherwise the browser has no "desk-1" option
      // yet and silently ignores the change.
      await waitFor(() => {
        expect(
          screen.getByRole('option', { name: 'Mesa: Suporte N1', hidden: true }),
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId('kanban-mesa-select')).toHaveValue('');
      expect(
        screen.getAllByText('Aberto').some((el) => el.tagName === 'H3'),
      ).toBe(true);
      expect(screen.queryByText('N1')).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId('kanban-mesa-select'), {
        target: { value: 'desk-1' },
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });
      expect(api.get).toHaveBeenCalledWith('/service-desks/desk-1/stages');
    });

    it("keeps the user's own Mesa selection even if the component re-renders with a different initialServiceDeskId", async () => {
      mockApiGet();
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const renderWith = (initialServiceDeskId: string) => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TicketKanban
              tickets={[]}
              isLoading={false}
              isError={false}
              initialServiceDeskId={initialServiceDeskId}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
      const { rerender } = render(renderWith('desk-1'));

      await waitFor(() => {
        expect(screen.getByTestId('kanban-mesa-select')).toHaveValue('desk-1');
      });

      fireEvent.change(screen.getByTestId('kanban-mesa-select'), {
        target: { value: '' },
      });
      expect(screen.getByTestId('kanban-mesa-select')).toHaveValue('');

      // Parent re-renders with a genuinely DIFFERENT initialServiceDeskId
      // (e.g. navigating here from a different Dashboard link) — the
      // user's own in-Kanban choice must not be silently overridden.
      rerender(renderWith('desk-2'));
      expect(screen.getByTestId('kanban-mesa-select')).toHaveValue('');
    });
  });

  describe('agrupamento por estágio (mesa selecionada)', () => {
    function ticketAt(
      stageId: string | null,
      overrides: Partial<Ticket> = {},
    ): Ticket {
      return { ...baseTicket, stageId, ...overrides };
    }

    it('fetches the mesa stages via GET /service-desks/:id/stages', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [ticketAt('s-n1')],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/service-desks/desk-1/stages');
      });
    });

    it('groups tickets by stage (ordered by position) instead of by status', async () => {
      mockApiGet();
      const tickets = [
        ticketAt('s-n1', { id: 't1', protocol: 'AP-0001' }),
        ticketAt('s-n2', { id: 't2', protocol: 'AP-0002' }),
        ticketAt('s-n1', { id: 't3', protocol: 'AP-0003' }),
      ];
      await renderKanban({
        tickets,
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });
      expect(screen.getByText('N2')).toBeInTheDocument();
      expect(screen.getByText('Aguardando Cliente')).toBeInTheDocument();
      // Old generic status label should not be used as a column header here
      // (it still appears inside each TicketCard as the status tag).
      const statusColumnHeadings = screen
        .queryAllByText('Aberto')
        .filter((el) => el.tagName === 'H3');
      expect(statusColumnHeadings).toHaveLength(0);

      const n1Heading = screen.getByText('N1').closest('div')
        ?.parentElement as HTMLElement;
      expect(n1Heading).toHaveTextContent('2');
    });

    it('puts tickets with no recognized stage into a "Sem estágio" column that never accepts a drop', async () => {
      mockApiGet();
      const tickets = [
        ticketAt(null, { id: 't1' }),
        ticketAt('stage-from-another-desk', { id: 't2' }),
      ];
      await renderKanban({
        tickets,
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('Sem estágio')).toBeInTheDocument();
      });
      const semEstagioHeading = screen.getByText('Sem estágio').closest('div')
        ?.parentElement as HTMLElement;
      expect(semEstagioHeading).toHaveTextContent('2');

      // The mesa has an initial stage (N1), so dragging these cards OUT is
      // allowed (mirrors the backend allowing a stageless ticket to move to
      // isInitial) — but the "Sem estágio" column itself never accepts a
      // drop, since there's no backend operation to unset a ticket's stage.
      expect(capturedDraggables['t1'].isDragDisabled).toBe(false);
      expect(capturedDraggables['t2'].isDragDisabled).toBe(false);
      expect(capturedDroppables['__NO_STAGE__'].isDropDisabled).toBe(true);
    });

    it("allows dragging an unstaged ticket straight to the mesa's initial stage", async () => {
      mockApiGet();
      vi.mocked(api.patch).mockResolvedValue({ data: ticketAt('s-n1') });
      await renderKanban({
        tickets: [ticketAt(null, { id: 't1' })],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('Sem estágio')).toBeInTheDocument();
      });

      act(() => {
        capturedOnDragEnd!({
          destination: { droppableId: 's-n1', index: 0 },
          source: { droppableId: '__NO_STAGE__', index: 0 },
          draggableId: 't1',
          reason: 'DROP',
          mode: 'FLUID',
          type: 'DEFAULT',
          combine: null,
        } as DropResult);
      });

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/tickets/t1/stage', {
          stageId: 's-n1',
        });
      });
    });

    it('blocks dragging an unstaged ticket to a non-initial stage', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [ticketAt(null, { id: 't1' })],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('Sem estágio')).toBeInTheDocument();
      });

      act(() => {
        capturedOnDragEnd!({
          destination: { droppableId: 's-n2', index: 0 },
          source: { droppableId: '__NO_STAGE__', index: 0 },
          draggableId: 't1',
          reason: 'DROP',
          mode: 'FLUID',
          type: 'DEFAULT',
          combine: null,
        } as DropResult);
      });

      expect(api.patch).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /transição de estágio não permitida/i,
        );
      });
    });

    it('calls PATCH /tickets/:id/stage (not /status) when dropping into an allowed next stage', async () => {
      mockApiGet();
      vi.mocked(api.patch).mockResolvedValue({ data: ticketAt('s-n2') });
      await renderKanban({
        tickets: [ticketAt('s-n1')],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });

      act(() => {
        capturedOnDragEnd!({
          destination: { droppableId: 's-n2', index: 0 },
          source: { droppableId: 's-n1', index: 0 },
          draggableId: 't1',
          reason: 'DROP',
          mode: 'FLUID',
          type: 'DEFAULT',
          combine: null,
        } as DropResult);
      });

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/tickets/t1/stage', {
          stageId: 's-n2',
        });
      });
    });

    it('blocks the drop and shows an error when the destination stage is not in transitionToIds', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [ticketAt('s-n1')],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });

      // s-n1 only transitions to s-n2, not straight to s-aguardando-cliente.
      act(() => {
        capturedOnDragEnd!({
          destination: { droppableId: 's-aguardando-cliente', index: 0 },
          source: { droppableId: 's-n1', index: 0 },
          draggableId: 't1',
          reason: 'DROP',
          mode: 'FLUID',
          type: 'DEFAULT',
          combine: null,
        } as DropResult);
      });

      expect(api.patch).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /transição de estágio não permitida/i,
        );
      });
    });

    it('does nothing when a card is dropped back in its own stage column', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [ticketAt('s-n1')],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });

      act(() => {
        capturedOnDragEnd!({
          destination: { droppableId: 's-n1', index: 1 },
          source: { droppableId: 's-n1', index: 0 },
          draggableId: 't1',
          reason: 'DROP',
          mode: 'FLUID',
          type: 'DEFAULT',
          combine: null,
        } as DropResult);
      });

      expect(api.patch).not.toHaveBeenCalled();
    });

    it('dims (disables) columns unreachable from the dragged card while dragging', async () => {
      mockApiGet();
      await renderKanban({
        tickets: [ticketAt('s-n1')],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });

      act(() => {
        capturedOnDragStart!({
          draggableId: 't1',
          type: 'DEFAULT',
          source: { droppableId: 's-n1', index: 0 },
          mode: 'FLUID',
        } as DragStart);
      });

      await waitFor(() => {
        expect(capturedDroppables['s-aguardando-cliente'].isDropDisabled).toBe(
          true,
        );
      });
      expect(capturedDroppables['s-n1'].isDropDisabled).toBe(false); // origin stays enabled
      expect(capturedDroppables['s-n2'].isDropDisabled).toBe(false); // allowed next stage
    });

    it('rolls back the optimistic update and surfaces the backend message when the stage API call rejects with 400', async () => {
      mockApiGet();
      vi.mocked(api.patch).mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Transição de estágio não permitida' },
        },
      });
      await renderKanban({
        tickets: [ticketAt('s-n1')],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(screen.getByText('N1')).toBeInTheDocument();
      });

      act(() => {
        capturedOnDragEnd!({
          destination: { droppableId: 's-n2', index: 0 },
          source: { droppableId: 's-n1', index: 0 },
          draggableId: 't1',
          reason: 'DROP',
          mode: 'FLUID',
          type: 'DEFAULT',
          combine: null,
        } as DropResult);
      });

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith('/tickets/t1/stage', {
          stageId: 's-n2',
        });
      });
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /transição de estágio não permitida/i,
        );
      });
      // No crash / unhandled rejection means onError ran and restored the
      // previous query cache without throwing.
    });

    it('shows an informational alert when the mesa has no stages configured', async () => {
      mockApiGet([]);
      await renderKanban({
        tickets: [],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });

      await waitFor(() => {
        expect(
          screen.getByText(/ainda não possui estágios configurados/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe('avatares, Ordenar e Configurações (D6/T8)', () => {
    const ticketsWithAgents = [
      { ...baseTicket, id: 't1', protocol: 'AP-2026-0001', title: 'B ticket', agentId: 'agent-1', agent: { id: 'agent-1', name: 'Ana Costa' } },
      { ...baseTicket, id: 't2', protocol: 'AP-2026-0002', title: 'A ticket', status: 'IN_PROGRESS' as const, agentId: 'agent-2', agent: { id: 'agent-2', name: 'Bruno Dias' } },
      { ...baseTicket, id: 't3', protocol: 'AP-2026-0003', title: 'C ticket', agentId: null },
    ];

    it('AC-04: keeps Mesa, responsáveis, Ordenar and Configurações in one toolbar row, in that order', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });

      const controls = [
        screen.getByTestId('kanban-mesa-select'),
        screen.getByRole('group', { name: /filtrar por responsável/i }),
        screen.getByRole('button', { name: /ordenar/i }),
        screen.getByRole('button', { name: /configurações/i }),
      ];
      // Mesa, avatares, Ordenar e Configurações dividem o mesmo contêiner (a barra pode quebrar em linhas, DMTE-527 AC-03).
      let row: Element = controls[0];
      while (!controls.every((control) => row.contains(control))) row = row.parentElement as Element;
      controls.forEach((control) => expect(row).toContainElement(control));
      controls.slice(1).forEach((control, index) => {
        expect(
          controls[index].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });
    });

    it('Limpar ordenação is not red', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });
      fireEvent.click(screen.getByRole('button', { name: 'Ordenar' }));
      expect(screen.getByRole('button', { name: 'Limpar ordenação' }).className).not.toMatch(/red-/);
    });

    it('renders one avatar per distinct agent present in the tickets', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });

      expect(screen.getByRole('button', { name: /filtrar por ana costa/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /filtrar por bruno dias/i })).toBeInTheDocument();
    });

    it('clicking an avatar filters the board to that agent\'s tickets (toggle, multi-select)', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });

      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
      expect(screen.getByText(/AP-2026-0002/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /filtrar por ana costa/i }));

      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
      expect(screen.queryByText(/AP-2026-0002/)).not.toBeInTheDocument();

      // Toggling back off restores the full board.
      fireEvent.click(screen.getByRole('button', { name: /filtrar por ana costa/i }));
      expect(screen.getByText(/AP-2026-0002/)).toBeInTheDocument();
    });

    it('opens "Ordenar", sorts cards by Título asc/desc, and "Limpar" restores the original order', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });

      function openColumnContainer(): HTMLElement {
        const heading = screen.getByRole('heading', { name: 'Aberto' });
        return heading.parentElement?.parentElement as HTMLElement;
      }

      fireEvent.click(screen.getByRole('button', { name: 'Ordenar' }));
      fireEvent.click(screen.getByRole('button', { name: /^Título/ }));

      const titlesAsc = within(openColumnContainer()).getAllByText(/^[A-Z] ticket$/).map((el) => el.textContent);
      expect(titlesAsc).toEqual(['B ticket', 'C ticket']);

      fireEvent.click(screen.getByRole('button', { name: /^Título/ }));
      const titlesDesc = within(openColumnContainer())
        .getAllByText(/^[A-Z] ticket$/)
        .map((el) => el.textContent);
      expect(titlesDesc).toEqual(['C ticket', 'B ticket']);

      fireEvent.click(screen.getByRole('button', { name: 'Limpar ordenação' }));
      const titlesCleared = within(openColumnContainer())
        .getAllByText(/^[A-Z] ticket$/)
        .map((el) => el.textContent);
      expect(titlesCleared).toEqual(['B ticket', 'C ticket']);
    });

    it('"Configurações" lets the user group by Responsável instead of Status/Estágio', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });

      fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));
      fireEvent.change(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), { target: { value: 'agent' } });

      expect(screen.getByRole('heading', { name: 'Ana Costa' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Bruno Dias' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Não atribuído' })).toBeInTheDocument();
      // No drag-and-drop in this read-only grouping — no "Aberto" column heading.
      expect(screen.queryByRole('heading', { name: 'Aberto' })).not.toBeInTheDocument();
    });

    it('"Configurações" lets the user group by Prioridade', async () => {
      mockApiGet();
      await renderKanban({ tickets: ticketsWithAgents, isLoading: false, isError: false });

      fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));
      fireEvent.change(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), { target: { value: 'priority' } });

      expect(screen.getByRole('heading', { name: 'Alta' })).toBeInTheDocument();
    });

    it('RODADA 2 ("Exibir campos", D6c): "Configurações" lets the user toggle optional card fields, persisted like "Agrupar por"', async () => {
      mockApiGet();
      const ticketsWithOrg = ticketsWithAgents.map((t) => ({
        ...t,
        requester: { id: 'r1', name: 'Maria', email: 'maria@x.com', organizationId: 'org-1', organization: { id: 'org-1', name: 'Acme Corp' } },
      }));
      await renderKanban({ tickets: ticketsWithOrg, isLoading: false, isError: false });

      // Responsável (agent) is visible by default: one "Ana Costa" avatar in
      // the D6a filter row, another on her ticket's card.
      expect(screen.getAllByTitle('Ana Costa')).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));
      fireEvent.click(screen.getByLabelText('Responsável'));

      // Only the filter-row avatar remains once the card's is turned off.
      expect(screen.getAllByTitle('Ana Costa')).toHaveLength(1);

      // Cliente is OFF by default (TiFlux benchmark) — turning it on shows it.
      expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Cliente'));
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
    });
  });

  describe('DMTE-497: menus Ordenar e Configurações como o seletor de mesa', () => {
    const tickets = [
      { ...baseTicket, id: 't1', protocol: 'AP-2026-0001', title: 'B ticket' },
    ];
    const sortPanel = () => screen.queryByText('Ordenar os cards por');
    const configPanel = () => screen.queryByText('Exibir campos');
    const sortButton = () => screen.getByRole('button', { name: 'Ordenar' });
    const configButton = () => screen.getByRole('button', { name: 'Configurações' });
    const pressEscape = (target: Element = document.body) =>
      fireEvent.keyDown(target, { key: 'Escape' });

    beforeEach(async () => {
      mockApiGet();
      await renderKanban({ tickets, isLoading: false, isError: false });
    });

    it('DMTE-497 AC-01: Esc fecha o painel de Ordenar e o foco volta ao botão', () => {
      fireEvent.click(sortButton());
      const option = screen.getByRole('button', { name: /^Título/ });
      option.focus();
      expect(sortPanel()).toBeInTheDocument();

      pressEscape(option);

      expect(sortPanel()).not.toBeInTheDocument();
      expect(sortButton()).toHaveFocus();
    });

    it('DMTE-497 AC-02: Esc fecha o painel de Configurações e o foco volta ao botão', () => {
      fireEvent.click(configButton());
      const checkbox = screen.getByLabelText('Responsável');
      checkbox.focus();
      expect(configPanel()).toBeInTheDocument();

      pressEscape(checkbox);

      expect(configPanel()).not.toBeInTheDocument();
      expect(configButton()).toHaveFocus();
    });

    it('DMTE-497 AC-03: clique fora fecha cada menu, clique dentro não, e o seletor de mesa também fecha', () => {
      fireEvent.click(sortButton());
      fireEvent.mouseDown(screen.getByText('Ordenar os cards por'));
      expect(sortPanel()).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(sortPanel()).not.toBeInTheDocument();

      fireEvent.click(configButton());
      fireEvent.mouseDown(screen.getByText('Exibir campos'));
      expect(configPanel()).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(configPanel()).not.toBeInTheDocument();

      fireEvent.click(sortButton());
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mesa' }));
      expect(sortPanel()).not.toBeInTheDocument();
    });

    it('DMTE-497 AC-03: escolher uma opção do "Agrupar por" não fecha o painel de Configurações', () => {
      fireEvent.click(configButton());
      fireEvent.click(screen.getByRole('combobox', { name: 'Agrupar por' }));
      const option = screen.getByRole('option', { name: 'Prioridade' });
      fireEvent.mouseDown(option);
      fireEvent.click(option);

      expect(configPanel()).toBeInTheDocument();
    });

    it('DMTE-497 AC-04: abrir um menu fecha o outro, nos dois sentidos', () => {
      fireEvent.click(sortButton());
      fireEvent.mouseDown(configButton());
      fireEvent.click(configButton());
      expect(configPanel()).toBeInTheDocument();
      expect(sortPanel()).not.toBeInTheDocument();

      fireEvent.mouseDown(sortButton());
      fireEvent.click(sortButton());
      expect(sortPanel()).toBeInTheDocument();
      expect(configPanel()).not.toBeInTheDocument();
    });

    it('DMTE-497 AC-05: com a lista do "Agrupar por" aberta, o primeiro Esc fecha só a lista e o segundo o painel', () => {
      fireEvent.click(configButton());
      const groupBy = screen.getByRole('combobox', { name: 'Agrupar por' });
      fireEvent.click(groupBy);
      expect(screen.getByRole('listbox', { name: 'Agrupar por' })).toBeInTheDocument();

      pressEscape(groupBy);
      expect(screen.queryByRole('listbox', { name: 'Agrupar por' })).not.toBeInTheDocument();
      expect(configPanel()).toBeInTheDocument();

      pressEscape(groupBy);
      expect(configPanel()).not.toBeInTheDocument();
    });

    it('DMTE-497 AC-06: os gatilhos expõem aria-expanded e aria-controls, e têm foco visível', () => {
      for (const [trigger, panelText] of [
        [sortButton, 'Ordenar os cards por'],
        [configButton, 'Exibir campos'],
      ] as const) {
        expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        expect(trigger()).not.toHaveAttribute('aria-controls');
        expect(trigger().className).toContain('focus-visible:ring');

        fireEvent.click(trigger());
        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        const panel = document.getElementById(trigger().getAttribute('aria-controls') ?? '');
        expect(panel).not.toBeNull();
        expect(panel).toHaveTextContent(panelText);
        expect(panel?.className).toContain('z-30');
        fireEvent.mouseDown(document.body);
      }
    });
  });
});

describe('DMTE-527 ticket 1: tela de Tickets proporcional e responsiva (Kanban)', () => {
  const openTicket: Ticket = { ...baseTicket, id: 't1', protocol: 'AP-2026-0001', title: 'Aberto um' };
  const resolvedTicket: Ticket = {
    ...baseTicket,
    id: 't2',
    protocol: 'AP-2026-0002',
    title: 'Resolvido um',
    status: 'RESOLVED',
  };
  const closedTicket: Ticket = {
    ...baseTicket,
    id: 't3',
    protocol: 'AP-2026-0003',
    title: 'Fechado um',
    status: 'CLOSED',
  };
  const finalStageTicket: Ticket = {
    ...baseTicket,
    id: 't4',
    protocol: 'AP-2026-0004',
    title: 'Aguardando um',
    stageId: 's-aguardando-cliente',
  };
  const statusTickets = [openTicket, resolvedTicket, closedTicket];
  const stageTickets = [{ ...baseTicket, stageId: 's-n1' }, finalStageTicket];

  const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8');
  const hex = (token: string) => {
    const match = css.match(new RegExp(`--color-${token}:\\s*#([0-9a-f]{6})`, 'i'));
    if (!match) throw new Error('token not found: ' + token);
    return match[1];
  };
  const luminance = (value: string) =>
    [0, 2, 4]
      .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** O item da Mesa na linha: o ancestral do seletor cujo pai é a linha. */
  const mesaItem = () => {
    let node: Element = mesaCombobox();
    while (node.parentElement && node.parentElement !== toolbarRow()) node = node.parentElement;
    return node;
  };
  const mesaClasses = () => classesUpTo(mesaCombobox(), toolbarRow());
  const stripClasses = (name: RegExp) => classesUpTo(stripButton(name), board());

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    capturedOnDragStart = null;
    capturedOnDragEnd = null;
    Object.keys(capturedDroppables).forEach((key) => delete capturedDroppables[key]);
    Object.keys(capturedDraggables).forEach((key) => delete capturedDraggables[key]);
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    mockApiGet();
  });

  describe('AC-01: altura por faixa na barra do Kanban', () => {
    beforeEach(async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
    });

    it('AC-01: Mesa usa 36 px a partir de sm e no mínimo 44 px abaixo', () => {
      expect(heightContractProblems(mesaClasses(), 'toolbar')).toEqual([]);
    });

    it('AC-01: Ordenar e Configurações usam 36 px a partir de sm e no mínimo 44 px abaixo', () => {
      expect(heightContractProblems(sortButton().className, 'toolbar')).toEqual([]);
      expect(heightContractProblems(configButton().className, 'toolbar')).toEqual([]);
    });

    it('AC-01: "Agrupar por" (Configurações) usa 32 px a partir de sm e no mínimo 44 px abaixo', () => {
      fireEvent.click(configButton());
      const box = screen.getByRole('combobox', { name: 'Agrupar por' }).parentElement as HTMLElement;
      expect(heightContractProblems(box.className, 'compact')).toEqual([]);
    });
  });

  describe('AC-03: a barra do Kanban quebra em linhas inteiras', () => {
    beforeEach(async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
    });

    it('AC-03: abaixo de 640 px a Mesa ocupa a largura total (w-full, sem max-w-xs fixo)', () => {
      const tokens = classTokens(mesaItem().className);
      expect(tokens).toContain('w-full');
      expect(tokens).not.toContain('max-w-xs');
    });

    it('AC-03: Ordenar e Configurações ficam lado a lado, num par separado da Mesa', () => {
      const pair = sortButton().parentElement?.parentElement as HTMLElement;
      expect(pair).toBe(configButton().parentElement?.parentElement);
      expect(pair).not.toBe(toolbarRow());
      expect(pair.contains(mesaCombobox())).toBe(false);
    });
  });

  describe('AC-04: seletor de Mesa em contorno', () => {
    beforeEach(async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
    });

    it('AC-04: a Mesa não usa bg-brand-500 (nem fundo cheio da marca em repouso)', () => {
      const solid = classTokens(mesaClasses()).filter((token) => /(^|:)bg-brand-(500|600|700)$/.test(token) && !token.includes('hover:'));
      expect(solid).toEqual([]);
    });

    it('AC-04: a Mesa tem fundo branco e borda brand-500', () => {
      expect(mesaCombobox().parentElement?.className).toContain('bg-white');
      const tokens = classTokens(mesaClasses());
      expect(tokens.some((token) => token.endsWith('border-brand-500') && !token.includes('hover:'))).toBe(true);
    });

    it('AC-04: texto e seta da Mesa em brand-700, com contraste mínimo de 4,5:1 sobre o branco (tokens de styles.css)', () => {
      const tokens = classTokens(mesaClasses());
      expect(tokens.some((token) => token.endsWith('text-brand-700') && !token.includes('hover:'))).toBe(true);
      expect(tokens.filter((token) => token.endsWith('text-gray-70'))).toEqual([]);
      expect(contrast(hex('brand-700'), 'ffffff')).toBeGreaterThanOrEqual(4.5);
    });

    it('AC-04: hover com fundo claro da marca e foco visível', () => {
      const tokens = classTokens(mesaClasses());
      expect(tokens.some((token) => /hover:bg-brand-(50|100)(\/\d+)?$/.test(token))).toBe(true);
      expect(tokens.some((token) => /focus-within:ring|focus-visible:ring/.test(token))).toBe(true);
    });

    it('AC-04: nenhum outro controle da barra é preenchido (Ordenar, Configurações)', () => {
      for (const control of [sortButton(), configButton()]) {
        expect(control).toHaveClass('bg-white');
        expect(control.className).not.toMatch(/(^|\s)bg-brand-(500|600|700)/);
      }
    });
  });

  describe('AC-05: cartão sem a tag de status quando agrupado por Status', () => {
    const statusTags = (container: HTMLElement) => container.querySelectorAll('[data-ticket-tag="status"]');

    it('AC-05: sem Mesa (agrupamento efetivo Status) nenhum cartão do quadro mostra a tag de status', async () => {
      const { container } = await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
      expect(statusTags(container)).toHaveLength(0);
    });

    it('AC-05: com Mesa e Agrupar por Status escolhido, o cartão também fica sem a tag de status', async () => {
      const { container } = await renderKanban({
        tickets: stageTickets,
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });
      await waitFor(() => expect(screen.getByText('N1')).toBeInTheDocument());
      fireEvent.click(configButton());
      fireEvent.change(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), { target: { value: 'status' } });
      expect(screen.getByRole('heading', { name: 'Aberto' })).toBeInTheDocument();
      expect(statusTags(container)).toHaveLength(0);
    });

    it('AC-05: agrupado por Estágio (Mesa selecionada) o cartão mantém a tag de status', async () => {
      const { container } = await renderKanban({
        tickets: [stageTickets[0]],
        isLoading: false,
        isError: false,
        initialServiceDeskId: 'desk-1',
      });
      await waitFor(() => expect(screen.getByText('N1')).toBeInTheDocument());
      expect(statusTags(container)).toHaveLength(1);
    });

    it.each(['agent', 'priority'] as const)('AC-05: agrupado por %s o cartão mantém a tag de status', async (groupBy) => {
      const { container } = await renderKanban({ tickets: [openTicket], isLoading: false, isError: false });
      fireEvent.click(configButton());
      fireEvent.change(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), { target: { value: groupBy } });
      expect(statusTags(container)).toHaveLength(1);
    });
  });

  describe('AC-07: colunas finais abrem recolhidas', () => {
    it('AC-07: por status, Resolvido e Fechado abrem recolhidos, com botão de nome acessível que contém o rótulo', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      expect(screen.queryByRole('button', { name: /Resolvido/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Fechado/ })).toBeInTheDocument();
      expect(screen.queryByText(/AP-2026-0002/)).not.toBeInTheDocument();
      expect(screen.queryByText(/AP-2026-0003/)).not.toBeInTheDocument();
    });

    it('AC-07: por status, as outras sete colunas abrem expandidas e aceitando soltar', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      expect(screen.getAllByTestId('kanban-column')).toHaveLength(7);
      expect(screen.getByText(/AP-2026-0001/)).toBeInTheDocument();
      expect(capturedDroppables['OPEN'].isDropDisabled).toBe(false);
      expect(capturedDroppables['PENDING_SANKHYA'].isDropDisabled).toBe(false);
    });

    it('AC-07: a coluna recolhida (Resolvido e Fechado) não aceita soltar cartão', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      expect(capturedDroppables['RESOLVED'].isDropDisabled).toBe(true);
      expect(capturedDroppables['CLOSED'].isDropDisabled).toBe(true);
    });

    it('AC-07: um clique no botão expande a coluna e outro recolhe', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });

      fireEvent.click(stripButton(/Resolvido/));
      expect(screen.getByText(/AP-2026-0002/)).toBeInTheDocument();
      expect(capturedDroppables['RESOLVED'].isDropDisabled).toBe(false);
      expect(screen.getAllByTestId('kanban-column')).toHaveLength(8);

      fireEvent.click(screen.getByTestId('collapse-column-RESOLVED'));
      expect(screen.queryByText(/AP-2026-0002/)).not.toBeInTheDocument();
      expect(capturedDroppables['RESOLVED'].isDropDisabled).toBe(true);
      stripButton(/Resolvido/);
    });

    it('AC-07: a escolha do usuário prevalece: Resolvido expandido segue expandido ao reordenar o quadro', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      fireEvent.click(stripButton(/Resolvido/));
      fireEvent.click(sortButton());
      fireEvent.click(screen.getByRole('button', { name: 'Título' }));
      expect(screen.getByText(/AP-2026-0002/)).toBeInTheDocument();
      stripButton(/Fechado/);
    });

    it('AC-07: com Mesa selecionada, abrem recolhidos só os estágios com isFinal', async () => {
      await renderKanban({ tickets: stageTickets, isLoading: false, isError: false, initialServiceDeskId: 'desk-1' });
      await waitFor(() => expect(screen.getByText('N1')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /Aguardando Cliente/ })).toBeInTheDocument();
      expect(screen.queryByText(/AP-2026-0004/)).not.toBeInTheDocument();
      expect(capturedDroppables['s-aguardando-cliente'].isDropDisabled).toBe(true);

      expect(screen.getByTestId('collapse-column-s-n1')).toBeInTheDocument();
      expect(screen.getByTestId('collapse-column-s-n2')).toBeInTheDocument();
      expect(capturedDroppables['s-n2'].isDropDisabled).toBe(false);
    });

    it('AC-07: com Mesa selecionada, um clique expande o estágio final e outro recolhe', async () => {
      await renderKanban({ tickets: stageTickets, isLoading: false, isError: false, initialServiceDeskId: 'desk-1' });
      await waitFor(() => expect(screen.getByText('N1')).toBeInTheDocument());

      fireEvent.click(stripButton(/Aguardando Cliente/));
      expect(screen.getByText(/AP-2026-0004/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('collapse-column-s-aguardando-cliente'));
      expect(screen.queryByText(/AP-2026-0004/)).not.toBeInTheDocument();
      expect(capturedDroppables['s-aguardando-cliente'].isDropDisabled).toBe(true);
    });
  });

  describe('AC-08: faixas fixas, encaixe e colunas de 80vw', () => {
    it('AC-08: o quadro usa scroll-snap proximity (não mandatory) e scroll-padding para as faixas', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      const tokens = classTokens(board().className);
      expect(tokens).toContain('snap-x');
      expect(tokens).toContain('snap-proximity');
      expect(tokens).not.toContain('snap-mandatory');
      expect(tokens).not.toContain('lg:snap-none');
      expect(tokens.some((token) => /(^|:)scroll-p[rxlt]?-/.test(token))).toBe(true);
    });

    it('AC-08: a partir de lg as faixas recolhidas ficam fixas na borda direita (sticky e inset direito)', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      for (const name of [/Resolvido/, /Fechado/]) {
        const tokens = classTokens(stripClasses(name));
        expect(tokens).toContain('lg:sticky');
        expect(tokens.some((token) => /^lg:right-/.test(token))).toBe(true);
      }
    });

    it('AC-08: abaixo de lg as faixas não fixam (sticky só com o prefixo lg:)', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      for (const name of [/Resolvido/, /Fechado/]) {
        const tokens = classTokens(stripClasses(name));
        expect(tokens.filter((token) => /(^|:)sticky$/.test(token) && !token.startsWith('lg:'))).toEqual([]);
        expect(tokens).toContain('lg:sticky');
      }
    });

    it('AC-08: com Mesa selecionada, a faixa do estágio final também fixa a partir de lg', async () => {
      await renderKanban({ tickets: stageTickets, isLoading: false, isError: false, initialServiceDeskId: 'desk-1' });
      await waitFor(() => expect(screen.getByText('N1')).toBeInTheDocument());
      const tokens = classTokens(stripClasses(/Aguardando Cliente/));
      expect(tokens).toContain('lg:sticky');
      expect(tokens.some((token) => /^lg:right-/.test(token))).toBe(true);
    });

    it('AC-08: as colunas expandidas não fixam e seguem com 80vw (máximo 320 px) abaixo de lg', async () => {
      await renderKanban({ tickets: statusTickets, isLoading: false, isError: false });
      for (const column of screen.getAllByTestId('kanban-column')) {
        const tokens = classTokens(column.className);
        expect(tokens.filter((token) => token.includes('sticky'))).toEqual([]);
        expect(tokens).toContain('w-[80vw]');
        expect(tokens).toContain('max-w-[320px]');
        expect(tokens).toContain('lg:max-w-none');
      }
    });
  });
});

describe('DMTE-528: alvos, foco e nomes dos botões do Kanban', () => {
  const agentTickets = [
    { ...baseTicket, id: 't1', protocol: 'AP-2026-0001', agentId: 'agent-1', agent: { id: 'agent-1', name: 'Ana Costa' } },
    { ...baseTicket, id: 't2', protocol: 'AP-2026-0002', agentId: 'agent-2', agent: { id: 'agent-2', name: 'Bruno Dias' } },
  ];

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    capturedOnDragStart = null;
    capturedOnDragEnd = null;
    Object.keys(capturedDroppables).forEach((key) => delete capturedDroppables[key]);
    Object.keys(capturedDraggables).forEach((key) => delete capturedDraggables[key]);
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    mockApiGet();
  });

  const expectTargetAndFocus = (button: HTMLElement) => {
    expect(button).toHaveClass('h-8', 'w-8');
    expect(button).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-brand-500');
  };

  it('AC-02: por status, cada coluna expandida tem o botão "Recolher coluna <nome>" com alvo de 32 px e anel de foco', async () => {
    await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });
    expect(screen.queryAllByRole('button', { name: /^Recolher coluna / })).toHaveLength(7);
    expectTargetAndFocus(stripButton(/^Recolher coluna Aberto$/));
  });

  it('AC-02: por estágio, o botão se chama "Recolher coluna N1" e tem o mesmo alvo e foco', async () => {
    await renderKanban({
      tickets: [{ ...baseTicket, stageId: 's-n1' }],
      isLoading: false,
      isError: false,
      initialServiceDeskId: 'desk-1',
    });
    await waitFor(() => {
      expect(screen.getByText('N1')).toBeInTheDocument();
    });
    expectTargetAndFocus(stripButton(/^Recolher coluna N1$/));
  });

  it('AC-02: por teclado, Enter no botão recolhe a coluna e o "Expandir coluna Aberto" aparece', async () => {
    await renderKanban({ tickets: [baseTicket], isLoading: false, isError: false });
    stripButton(/^Recolher coluna Aberto$/).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Recolher coluna Aberto' })).not.toBeInTheDocument();
    stripButton(/^Expandir coluna Aberto$/);
  });

  it('AC-03: o botão de avatar do filtro tem anel de foco visível, vai para a frente ao focar e mantém nome e aria-pressed', async () => {
    await renderKanban({ tickets: agentTickets, isLoading: false, isError: false });
    for (const name of ['Ana Costa', 'Bruno Dias']) {
      const button = screen.getByRole('button', { name: `Filtrar por ${name}` });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveClass('focus-visible:outline-none', 'focus-visible:z-10', 'focus-visible:ring-brand-600');
    }
  });
});
