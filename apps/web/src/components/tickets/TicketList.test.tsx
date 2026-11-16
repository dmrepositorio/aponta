import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import type { Ticket } from '../../hooks/useTickets';
import { TicketList } from './TicketList';
import { heightContractProblems } from '../../test-utils/controlHeight';

const ticketA: Ticket = {
  id: 't1',
  protocol: 'AP-2026-0001',
  title: 'Printer broken',
  description: 'desc',
  status: 'OPEN',
  priority: 'HIGH',
  requesterId: 'r1',
  requester: {
    id: 'r1',
    name: 'Maria Souza',
    email: 'maria@acme.com',
    organizationId: 'org-1',
    organization: { id: 'org-1', name: 'Acme' },
  },
  agentId: 'agent-1',
  agent: { id: 'agent-1', name: 'Agente Silva' },
  serviceDeskId: 'desk-1',
  serviceDesk: { id: 'desk-1', name: 'Suporte N1' },
  stageId: 'stage-1',
  stage: { id: 'stage-1', name: 'Triagem', isInitial: true, isFinal: false },
  responseDeadline: '2026-01-01T10:00:00.000Z',
  resolveDeadline: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ticketB: Ticket = {
  ...ticketA,
  id: 't2',
  protocol: 'AP-2026-0002',
  title: 'Email down',
  status: 'IN_PROGRESS',
  priority: 'MEDIUM',
  requester: {
    id: 'r2',
    name: 'João Pereira',
    email: 'joao@beta.com',
    organizationId: 'org-2',
    organization: { id: 'org-2', name: 'Beta' },
  },
};

function renderList(props: Partial<Parameters<typeof TicketList>[0]> = {}) {
  const defaults: Parameters<typeof TicketList>[0] = {
    tickets: [ticketA, ticketB],
    isLoading: false,
    isError: false,
  };
  return render(
    <MemoryRouter>
      <TicketList {...defaults} {...props} />
    </MemoryRouter>,
  );
}

describe('TicketList (D5: Lista agrupável)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      token: null,
      user: { sub: 'u1', email: 'a@x.com', role: 'ADMIN', organizationId: null } as any,
    });
  });

  it('shows a loading indicator when isLoading is true', () => {
    renderList({ tickets: [], isLoading: true });
    expect(screen.getByRole('status')).toHaveTextContent(/carregando chamados/i);
  });

  it('shows an error message when isError is true', () => {
    renderList({ tickets: [], isError: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/falha ao carregar os chamados/i);
  });

  it('shows an empty-state message when there are no tickets', () => {
    renderList({ tickets: [] });
    expect(screen.getByText(/nenhum chamado encontrado/i)).toBeInTheDocument();
  });

  it('renders status and priority with the new tags', () => {
    const { container } = renderList();
    expect(container.querySelectorAll('[data-ticket-tag="status"] [data-glyph]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-ticket-tag="priority"] [data-glyph^="bars-"]')).toHaveLength(2);
  });

  it('renders the default columns: Número, Título, Cliente, Origem, Prioridade, Status, Estágio (AC6)', () => {
    renderList();
    const headerRow = screen.getAllByRole('columnheader');
    const headerLabels = headerRow.map((h) => h.textContent);
    for (const label of ['Número', 'Título', 'Cliente', 'Origem', 'Prioridade', 'Status', 'Estágio']) {
      expect(headerLabels.some((h) => h?.includes(label))).toBe(true);
    }
    // Optional columns start hidden
    expect(headerLabels.some((h) => h?.includes('Responsável'))).toBe(false);
  });

  it('DMTE-490 AC-05: shows the Aguardando Sankhya label for a ticket in that status', () => {
    renderList({ tickets: [{ ...ticketA, status: 'PENDING_SANKHYA' }] });
    expect(screen.getByText('Aguardando Sankhya')).toBeInTheDocument();
  });

  it('renders a row per ticket with its data, ungrouped by default', () => {
    renderList();
    expect(screen.getByText('AP-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Printer broken')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('groups by the chosen field, with a collapsible group row showing a count (AC6)', async () => {
    const user = userEvent.setup();
    renderList();

    await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'organization');

    const acmeGroup = screen.getByText(/Acme.*\(1\)|Acme — 1|Acme \(1\)/i);
    expect(acmeGroup).toBeInTheDocument();
    // Collapsed by default: rows hidden until the group is expanded
    expect(screen.queryByText('AP-2026-0001')).not.toBeInTheDocument();

    await user.click(acmeGroup);
    expect(await screen.findByText('AP-2026-0001')).toBeInTheDocument();
    expect(screen.queryByText('AP-2026-0002')).not.toBeInTheDocument();
  });

  it('AC-09: the group header exposes aria-expanded and flips it when toggled', async () => {
    const user = userEvent.setup();
    renderList();

    await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'organization');
    const header = screen.getByRole('button', { name: /Acme \(1\)/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('AP-2026-0001')).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('AP-2026-0001')).not.toBeInTheDocument();
  });

  it('"Nenhum" removes grouping and shows every row flat', async () => {
    const user = userEvent.setup();
    renderList();

    await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'organization');
    await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'none');

    expect(screen.getByText('AP-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('AP-2026-0002')).toBeInTheDocument();
  });

  it('toggles an optional column on via "Exibir colunas" and it persists after remount (D5 persistence)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderList();

    await user.click(screen.getByRole('button', { name: /exibir colunas/i }));
    await user.click(screen.getByRole('checkbox', { name: /responsável/i }));

    expect(screen.getAllByRole('columnheader').some((h) => h.textContent?.includes('Responsável'))).toBe(
      true,
    );

    unmount();
    renderList();
    expect(screen.getAllByRole('columnheader').some((h) => h.textContent?.includes('Responsável'))).toBe(
      true,
    );
  });

  it('shows the R1 warning when grouping with more than one page of results', async () => {
    const user = userEvent.setup();
    renderList({ totalPages: 3 });

    await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'organization');

    expect(screen.getByText(/agrupando os 2 chamados desta página/i)).toBeInTheDocument();
  });

  it('clicking a sortable column header calls onSortChange, toggling direction on repeated clicks', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    renderList({ onSortChange });

    await user.click(screen.getByRole('button', { name: 'Título' }));
    expect(onSortChange).toHaveBeenCalledWith('title', 'asc');

    await user.click(screen.getByRole('button', { name: 'Título' }));
    expect(onSortChange).toHaveBeenCalledWith('title', 'desc');
  });

  describe('DMTE-502: controles na lista vazia e colunas do solicitante', () => {
    const ticketWithContact: Ticket = {
      ...ticketA,
      requester: { ...ticketA.requester!, phone: '(11) 99999-0000', extension: '4321' },
      resourceGroup: 'Financeiro',
    };
    const columnNames = ['E-mail do solicitante', 'Telefone do solicitante', 'Ramal do solicitante', 'Grupo de recursos'];
    const headers = () => screen.queryAllByRole('columnheader').map((h) => h.textContent ?? '');

    it('AC-01: keeps "Agrupar por" and "Exibir colunas" next to the empty state, with no table', () => {
      renderList({ tickets: [] });

      expect(screen.getByLabelText(/agrupar por/i, { selector: 'select' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /exibir colunas/i })).toBeInTheDocument();
      expect(screen.getByText(/nenhum chamado encontrado/i)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('AC-02: with an empty list, the column menu lists every column and a toggle persists for the next non-empty render', async () => {
      const user = userEvent.setup();
      const first = renderList({ tickets: [] });

      await user.click(screen.getByRole('button', { name: /exibir colunas/i }));
      expect(screen.getAllByRole('checkbox')).toHaveLength(14 + columnNames.length);
      await user.click(screen.getByRole('checkbox', { name: /responsável/i }));
      first.unmount();

      renderList();
      expect(headers().some((h) => h.includes('Responsável'))).toBe(true);
    });

    it('AC-03: loading and error states still render without the controls', () => {
      const loading = renderList({ tickets: [], isLoading: true });
      expect(screen.queryByRole('button', { name: /exibir colunas/i })).not.toBeInTheDocument();
      loading.unmount();

      renderList({ tickets: [], isError: true });
      expect(screen.queryByRole('button', { name: /exibir colunas/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/agrupar por/i, { selector: 'select' })).not.toBeInTheDocument();
    });

    it('AC-04: offers the four new columns hidden by default and shows their values (or "—") once enabled', async () => {
      const user = userEvent.setup();
      renderList({ tickets: [ticketWithContact, ticketB] });

      expect(headers().some((h) => columnNames.includes(h))).toBe(false);
      await user.click(screen.getByRole('button', { name: /exibir colunas/i }));
      for (const name of ['Número', 'Título', 'Cliente', 'Origem', 'Prioridade', 'Status', 'Estágio']) {
        expect(screen.getByRole('checkbox', { name })).toBeChecked();
      }
      for (const name of columnNames) {
        expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
        await user.click(screen.getByRole('checkbox', { name }));
      }

      expect(headers()).toEqual(expect.arrayContaining(columnNames));
      const rows = screen.getAllByRole('row');
      const first = rows[1].textContent ?? '';
      expect(first).toContain('maria@acme.com');
      expect(first).toContain('(11) 99999-0000');
      expect(first).toContain('4321');
      expect(first).toContain('Financeiro');
      const second = within(rows[2]).getAllByRole('cell').map((c) => c.textContent);
      expect(second.filter((c) => c === '—')).toHaveLength(3);
      expect(second).toContain('joao@beta.com');
    });

    it('AC-04: a configuration saved before the new columns existed keeps them hidden', () => {
      localStorage.setItem(
        'aponta_screen_config_u1_tickets-list',
        JSON.stringify({ grid: { columnVisibility: { number: true, title: true, agent: true }, density: 'compact' } }),
      );
      renderList({ tickets: [ticketWithContact] });

      expect(headers().some((h) => h.includes('Responsável'))).toBe(true);
      expect(headers().some((h) => columnNames.includes(h))).toBe(false);
    });

    it('AC-06: without a known role the phone and extension columns are not offered', async () => {
      useAuthStore.setState({ user: null });
      const user = userEvent.setup();
      renderList();

      await user.click(screen.getByRole('button', { name: /exibir colunas/i }));
      expect(screen.queryByRole('checkbox', { name: 'Telefone do solicitante' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Ramal do solicitante' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'E-mail do solicitante' })).toBeInTheDocument();
    });

    it('AC-01: the page-grouping note is not shown when the list is empty', async () => {
      const user = userEvent.setup();
      renderList({ tickets: [], totalPages: 3 });

      await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'organization');

      expect(screen.queryByText(/agrupando os/i)).not.toBeInTheDocument();
    });

    it.each(['ADMIN', 'AGENT_MASTER', 'AGENT'])('AC-06: %s sees the phone and extension columns in the menu', async (role) => {
      useAuthStore.setState({ user: { sub: 'u1', email: 'a@x.com', role, organizationId: null } as any });
      const user = userEvent.setup();
      renderList();

      await user.click(screen.getByRole('button', { name: /exibir colunas/i }));
      expect(screen.getByRole('checkbox', { name: 'Telefone do solicitante' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Ramal do solicitante' })).toBeInTheDocument();
    });

    it.each(['CLIENT', 'CLIENT_MASTER'])('AC-06: %s does not get the phone and extension columns, and keeps the others', async (role) => {
      useAuthStore.setState({ user: { sub: 'u1', email: 'a@x.com', role, organizationId: 'org-1' } as any });
      const user = userEvent.setup();
      renderList();

      await user.click(screen.getByRole('button', { name: /exibir colunas/i }));
      expect(screen.queryByRole('checkbox', { name: 'Telefone do solicitante' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Ramal do solicitante' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'E-mail do solicitante' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Grupo de recursos' })).toBeInTheDocument();
    });
  });
});

describe('DMTE-526: abrir a linha por teclado e nova aba, e estado da ordenação', () => {
  // Cada navegação gera uma `key` nova, então o vetor mostra quantas vezes o app navegou.
  const visits: string[] = [];
  function LocationProbe() {
    const location = useLocation();
    visits.push(location.pathname);
    return <div data-testid="location-probe">{location.pathname}</div>;
  }
  function renderWithProbe(props: Partial<Parameters<typeof TicketList>[0]> = {}) {
    return render(
      <MemoryRouter>
        <TicketList tickets={[ticketA, ticketB]} isLoading={false} isError={false} {...props} />
        <LocationProbe />
      </MemoryRouter>,
    );
  }
  const protocolLink = (protocol: string) => screen.getByRole('link', { name: protocol });
  const headerOf = (name: string) => screen.getByRole('columnheader', { name });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    visits.length = 0;
    useAuthStore.setState({
      token: null,
      user: { sub: 'u1', email: 'a@x.com', role: 'ADMIN', organizationId: null } as any,
    });
  });

  it('AC-01: the Número cell is a link to the ticket, focusable, and Enter opens it', async () => {
    const user = userEvent.setup();
    renderWithProbe();

    const link = protocolLink('AP-2026-0001');
    expect(link).toHaveAttribute('href', '/tickets/t1');
    expect(protocolLink('AP-2026-0002')).toHaveAttribute('href', '/tickets/t2');
    const tbody = screen.getAllByRole('rowgroup')[1];
    expect(within(tbody).getAllByRole('link')).toHaveLength(2);

    link.focus();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets/t1');
  });

  it('AC-02: a plain click opens the ticket once; Ctrl, Meta, Shift and middle click are left to the browser', () => {
    renderWithProbe();
    const link = protocolLink('AP-2026-0001');
    const before = visits.length;

    expect(fireEvent.click(link)).toBe(false);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets/t1');
    expect(visits.length - before).toBe(1);

    visits.length = 0;
    const other = protocolLink('AP-2026-0002');
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(fireEvent.click(other, modifier)).toBe(true);
    }
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets/t1');
    expect(visits).toHaveLength(0);
  });

  it('AC-03: clicking another cell still opens the ticket, and the group header does not', async () => {
    const user = userEvent.setup();
    renderWithProbe();
    await user.click(screen.getByText('Email down'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets/t2');

    visits.length = 0;
    await user.selectOptions(screen.getByLabelText(/agrupar por/i, { selector: 'select' }), 'organization');
    await user.click(screen.getByRole('button', { name: /Acme/ }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets/t2');
    expect(visits).toHaveLength(0);
  });

  it('AC-04: only the sorted column carries aria-sort and a direction arrow, and both follow the clicks', async () => {
    const user = userEvent.setup();
    renderWithProbe({ sortBy: 'title', sortDir: 'desc' });

    expect(headerOf('Título')).toHaveAttribute('aria-sort', 'descending');
    const sorted = screen.getAllByRole('columnheader').filter((th) => th.hasAttribute('aria-sort'));
    expect(sorted).toHaveLength(1);
    expect(headerOf('Título').querySelector('svg[aria-hidden="true"]')).toHaveClass('lucide-arrow-down');
    expect(headerOf('Número').querySelector('svg')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Título' }));
    expect(headerOf('Título')).toHaveAttribute('aria-sort', 'ascending');
    expect(headerOf('Título').querySelector('svg')).toHaveClass('lucide-arrow-up');

    await user.click(screen.getByRole('button', { name: 'Número' }));
    expect(headerOf('Número')).toHaveAttribute('aria-sort', 'ascending');
    expect(headerOf('Título')).not.toHaveAttribute('aria-sort');
    expect(headerOf('Título').querySelector('svg')).toBeNull();
  });

  it('AC-04: without sortBy no header has aria-sort', () => {
    renderWithProbe();
    expect(screen.getAllByRole('columnheader').some((th) => th.hasAttribute('aria-sort'))).toBe(false);
  });

  it('AC-05: the row uses the grid-row-hover token and the controls show a focus ring', () => {
    renderWithProbe();
    const row = protocolLink('AP-2026-0001').closest('tr') as HTMLElement;
    expect(row).toHaveClass('hover:bg-grid-row-hover', 'focus-within:bg-grid-row-hover');
    expect(row).not.toHaveClass('hover:bg-gray-80');
    for (const control of [protocolLink('AP-2026-0001'), screen.getByRole('button', { name: 'Título' })]) {
      expect(control).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-brand-500');
    }
  });

  it('AC-06: the protocol link text reaches 4.5:1 over white and over grid-row-hover', () => {
    renderWithProbe();
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
    const textToken = Array.from(protocolLink('AP-2026-0001').classList)
      .find((name) => /^text-(brand|gray)-\d+$/.test(name))
      ?.slice('text-'.length);
    expect(textToken).toBeDefined();
    const text = hex(textToken as string);
    expect(contrast(text, 'ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, hex('grid-row-hover'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('DMTE-527 ticket 1: Lista com altura por faixa e tags sem quebra', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      token: null,
      user: { sub: 'u1', email: 'a@x.com', role: 'ADMIN', organizationId: null } as any,
    });
  });

  it('AC-01: "Exibir colunas" usa 32 px a partir de sm e no mínimo 44 px abaixo', () => {
    renderList();
    expect(heightContractProblems(screen.getByRole('button', { name: 'Exibir colunas' }).className, 'compact')).toEqual([]);
  });

  it('AC-01: "Agrupar por" usa o controle compacto (32 px a partir de sm, 44 px abaixo)', () => {
    renderList();
    const box = screen.getByRole('combobox', { name: 'Agrupar por' }).parentElement as HTMLElement;
    expect(heightContractProblems(box.className, 'compact')).toEqual([]);
  });

  it('AC-06: as tags de status e de prioridade da Lista não quebram em duas linhas (whitespace-nowrap)', () => {
    const { container } = renderList();
    const tags = container.querySelectorAll('[data-ticket-tag]');
    expect(tags.length).toBe(4);
    tags.forEach((tag) => expect(tag).toHaveClass('whitespace-nowrap'));
  });

  it('AC-06: a Lista segue com os nomes completos dos status, sem renomear', () => {
    renderList({
      tickets: [
        { ...ticketA, status: 'PENDING_APPROVAL' },
        { ...ticketB, status: 'PENDING_SANKHYA' },
      ],
    });
    expect(screen.getByText('Aguardando Aprovação')).toBeInTheDocument();
    expect(screen.getByText('Aguardando Sankhya')).toBeInTheDocument();
  });
});
