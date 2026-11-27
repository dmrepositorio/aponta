import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError } from 'axios';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { VaultAuditPage } from './VaultAuditPage';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const agents = [
  { id: 'agent-1', name: 'Ana Admin', email: 'ana@aponta.com', role: 'ADMIN' },
  { id: 'agent-2', name: 'Bruno Agente', email: 'bruno@aponta.com', role: 'AGENT' },
];

const auditLogs = [
  {
    id: 'log-1',
    organizationId: 'org-1',
    action: 'REVEAL_CREDENTIAL',
    folderId: null,
    credentialId: 'cred-1',
    targetName: 'Servidor FTP',
    actorId: 'agent-2',
    actorName: 'Bruno Agente',
    ipAddress: '10.0.0.5',
    createdAt: '2026-01-10T12:00:00.000Z',
  },
];

function mockGets() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/users/agents') return { data: agents };
    if (url === '/vault/audit') {
      return { data: { data: auditLogs, meta: { total: 1, page: 1, limit: 20, totalPages: 1 } } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/vault/audit']}>
        <VaultAuditPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VaultAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the notice (IP and horário are displayed) and the filters, without querying the audit log yet', async () => {
    mockGets();
    renderPage();

    expect(screen.getByText(/o endereço ip de origem e o horário de cada ação são registrados e exibidos/i)).toBeInTheDocument();
    expect(screen.getByText(/defina os filtros e clique em exibir/i)).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Atendente' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ação' })).toBeInTheDocument();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/users/agents');
    });
    expect(api.get).not.toHaveBeenCalledWith('/vault/audit', expect.anything());
  });

  it('queries the audit log with the selected filters once "Exibir" is clicked', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('combobox', { name: 'Atendente' });

    await user.type(screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i), 'FTP');
    await user.click(screen.getByRole('button', { name: /exibir/i }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/vault/audit',
        expect.objectContaining({ params: expect.objectContaining({ query: 'FTP', page: 1 }) }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });
    expect(within(screen.getByRole('table')).getByText('Bruno Agente')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Revelou a senha')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument();
  });

  it('shows an empty state when no audit entries match the filters', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') return { data: [] };
      if (url === '/vault/audit') {
        return { data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));

    await waitFor(() => {
      expect(screen.getByText(/nenhum registro de auditoria encontrado/i)).toBeInTheDocument();
    });
  });

  it('shows an error state when the audit request fails', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') return { data: [] };
      if (url === '/vault/audit') throw new Error('network error');
      throw new Error(`Unexpected GET ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));

    await waitFor(() => {
      expect(screen.getByText(/erro ao carregar a auditoria/i)).toBeInTheDocument();
    });
  });
});

describe('VaultAuditPage — header and table at the app scale (DMTE-546)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title inside EzPageHeader, at the app scale, without the decorative icon (AC-01)', () => {
    mockGets();
    renderPage();

    const heading = screen.getByRole('heading', { name: 'Auditoria do Cofre de Senhas' });
    expect(heading.tagName).toBe('H1');
    expect(heading).toHaveClass('text-[20px]', 'font-semibold');
    expect(heading.querySelector('svg')).not.toBeInTheDocument();
  });

  it('wraps the audit table in a horizontal-scroll container, same fix as the Cofre (AC-03 parity)', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('combobox', { name: 'Atendente' });
    await user.click(screen.getByRole('button', { name: /exibir/i }));

    await waitFor(() => {
      expect(screen.getByText('Servidor FTP')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });
});

function auditCalls() {
  return vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => url === '/vault/audit')
    .map(([, config]) => (config as { params: Record<string, unknown> }).params);
}

function mockPagedGets() {
  vi.mocked(api.get).mockImplementation(async (url: string, config?: unknown) => {
    if (url === '/users/agents') return { data: agents };
    if (url === '/vault/audit') {
      const page = (config as { params: { page: number } }).params.page;
      return { data: { data: auditLogs, meta: { total: 40, page, limit: 20, totalPages: 2 } } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

async function chooseOption(user: ReturnType<typeof userEvent.setup>, field: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: field }));
  await user.click(screen.getByRole('option', { name: option }));
}

describe('VaultAuditPage — filtro de datas em Brasília (AUD-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rotula os campos como Data (de) e Data (até), pois só aceitam o dia', () => {
    mockGets();
    renderPage();

    expect(screen.queryByLabelText('Data (de)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Data (até)')).toBeInTheDocument();
  });

  it('envia o início do dia de Brasília em from e o fim do dia final em to', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    fireEvent.change(screen.getByLabelText(/data.*\(de\)/i), { target: { value: '2025-03-10' } });
    fireEvent.change(screen.getByLabelText(/data.*\(até\)/i), { target: { value: '2025-03-10' } });
    await user.click(screen.getByRole('button', { name: /exibir/i }));

    await waitFor(() => expect(auditCalls()).toHaveLength(1));
    expect(auditCalls()[0].from).toBe('2025-03-10T03:00:00.000Z');
    expect(auditCalls()[0].to).toBe('2025-03-11T02:59:59.999Z');
  });
});

describe('VaultAuditPage — formulário de filtros (AUD-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('consulta ao pressionar Enter no campo Buscar', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i), 'FTP{Enter}');

    await waitFor(() => expect(auditCalls()).toHaveLength(1));
    expect(auditCalls()[0].query).toBe('FTP');
  });

  it('Limpar filtros zera os campos e volta ao estado inicial sem nova consulta', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await user.type(screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i), 'FTP');
    await screen.findByText('Servidor FTP');

    const clear = screen.queryByRole('button', { name: /limpar filtros/i });
    expect(clear).toBeInTheDocument();
    await user.click(clear as HTMLElement);

    expect(screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i)).toHaveValue('');
    expect(screen.getByText(/defina os filtros e clique em exibir/i)).toBeInTheDocument();
    expect(screen.queryByText('Servidor FTP')).not.toBeInTheDocument();
    expect(auditCalls()).toHaveLength(1);
  });
});

describe('VaultAuditPage — filtros aplicados x rascunho (AUD-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a paginação usa os filtros aplicados, não o que foi digitado depois', async () => {
    mockPagedGets();
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i);
    await user.type(search, 'a');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('Servidor FTP');

    await user.clear(search);
    await user.type(search, 'b');
    expect(auditCalls()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Página 2' }));

    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1]).toEqual(expect.objectContaining({ query: 'a', page: 2 }));
  });

  it('mudar um campo depois da consulta não consulta de novo até Exibir, e indica os filtros aplicados', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i);
    await user.type(search, 'FTP');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('Servidor FTP');
    expect(screen.queryByText(/filtros aplicados/i)).toHaveTextContent('FTP');

    await user.type(search, 'x');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(auditCalls()).toHaveLength(1);
    expect(screen.queryByText(/filtros aplicados/i)).not.toHaveTextContent('FTPx');
  });
});

describe('VaultAuditPage — Atendente e Ação de seleção única (AUD-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Ação é uma lista de seleção única com a opção Todas e envia action', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('combobox', { name: 'Ação' }));
    expect(screen.getByRole('listbox', { name: 'Ação' })).not.toHaveAttribute('aria-multiselectable');
    expect(screen.getByRole('option', { name: /todas/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await user.click(screen.getByRole('option', { name: 'Revelou a senha' }));

    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await waitFor(() => expect(auditCalls()).toHaveLength(1));
    expect(auditCalls()[0].action).toBe('REVEAL_CREDENTIAL');
  });

  it('Atendente é de seleção única e envia actorId; voltar a Todos remove o filtro', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/agents'));
    await user.click(await screen.findByRole('combobox', { name: 'Atendente' }));
    expect(screen.getByRole('listbox', { name: 'Atendente' })).not.toHaveAttribute('aria-multiselectable');
    await user.click(await screen.findByRole('option', { name: 'Ana Admin' }));
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await waitFor(() => expect(auditCalls()).toHaveLength(1));
    expect(auditCalls()[0].actorId).toBe('agent-1');

    await chooseOption(user, 'Atendente', 'Todos os atendentes');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));
    expect(auditCalls()[1].actorId).toBeUndefined();
  });
});

describe('VaultAuditPage — erro com causa e nova tentativa (AUD-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403 mostra que só administradores acessam a auditoria', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') return { data: [] };
      throw new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        statusText: 'Forbidden',
        data: {},
        headers: {},
        config: {} as never,
      });
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));

    expect(await screen.findByText(/apenas administradores acessam a auditoria/i)).toBeInTheDocument();
    expect(screen.queryByText(/erro ao carregar a auditoria/i)).not.toBeInTheDocument();
  });

  it('falha genérica oferece Tentar novamente, que consulta de novo', async () => {
    let failing = true;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') return { data: [] };
      if (failing) throw new Error('network error');
      return { data: { data: auditLogs, meta: { total: 1, page: 1, limit: 20, totalPages: 1 } } };
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText(/erro ao carregar a auditoria/i);
    const retry = screen.queryByRole('button', { name: /tentar novamente/i });
    expect(retry).toBeInTheDocument();

    failing = false;
    await user.click(retry as HTMLElement);

    expect(await screen.findByText('Servidor FTP')).toBeInTheDocument();
    expect(auditCalls()).toHaveLength(2);
  });
});

describe('VaultAuditPage — fuso, total e aviso (AUD-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mostra Data/Hora no fuso de Brasília e o total de registros', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') return { data: agents };
      return {
        data: {
          data: [{ ...auditLogs[0], createdAt: '2025-03-10T02:00:00Z' }],
          meta: { total: 3, page: 1, limit: 20, totalPages: 1 },
        },
      };
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));

    expect(await screen.findByText('09/03/2025 23:00')).toBeInTheDocument();
    expect(screen.queryByText('3 registros')).toBeInTheDocument();
    expect(screen.queryByText(/não exibidos|não são exibidos/i)).not.toBeInTheDocument();
  });

  it('usa o singular com 1 registro', async () => {
    mockGets();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('Servidor FTP');

    expect(screen.queryByText('1 registro')).toBeInTheDocument();
  });
});

describe('VaultAuditPage — paginação sem piscar (AUD-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ao ir para a página 2 mantém linhas e paginação anteriores, sem spinner de tela cheia', async () => {
    let releasePage2: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/users/agents') return { data: agents };
      const page = (config as { params: { page: number } }).params.page;
      if (page === 2) {
        return new Promise((resolve) => {
          releasePage2 = resolve;
        });
      }
      return { data: { data: auditLogs, meta: { total: 40, page: 1, limit: 20, totalPages: 2 } } };
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('Servidor FTP');
    await user.click(screen.getByRole('button', { name: 'Página 2' }));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));

    expect(screen.queryByText('Servidor FTP')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeInTheDocument();
    expect(screen.queryByText(/carregando auditoria/i)).not.toBeInTheDocument();

    releasePage2({ data: { data: auditLogs, meta: { total: 40, page: 2, limit: 20, totalPages: 2 } } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page'));
  });
});

describe('VaultAuditPage — rótulo e total acompanham os dados exibidos (QA B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockControlled() {
    const pending: Record<string, (value: unknown) => void> = {};
    vi.mocked(api.get).mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/users/agents') return { data: agents };
      const params = (config as { params: { query?: string; page: number } }).params;
      if (params.query === 'a' && params.page === 1) {
        return { data: { data: auditLogs, meta: { total: 40, page: 1, limit: 20, totalPages: 2 } } };
      }
      return new Promise((resolve) => {
        pending[`${params.query}-${params.page}`] = resolve;
      });
    });
    return pending;
  }

  it('com filtro novo pendente, não mostra o rótulo e o total do filtro novo sobre os dados antigos', async () => {
    const pending = mockControlled();
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i);
    await user.type(search, 'a');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('40 registros');

    await user.clear(search);
    await user.type(search, 'b');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));

    expect(screen.queryByText('Servidor FTP')).toBeInTheDocument();
    expect(screen.queryByText(/busca "b"/)).not.toBeInTheDocument();
    expect(screen.queryByText('40 registros')).not.toBeInTheDocument();

    pending['b-1']({ data: { data: auditLogs, meta: { total: 7, page: 1, limit: 20, totalPages: 1 } } });
    expect(await screen.findByText(/busca "b"/)).toBeInTheDocument();
    expect(screen.getByText('7 registros')).toBeInTheDocument();
  });

  it('durante a paginação pendente não afirma filtros nem total para dados que ainda não chegaram', async () => {
    const pending = mockControlled();
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i), 'a');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('40 registros');

    await user.click(screen.getByRole('button', { name: 'Página 2' }));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));

    expect(screen.queryByText(/filtros aplicados/i)).not.toBeInTheDocument();
    expect(screen.queryByText('40 registros')).not.toBeInTheDocument();

    pending['a-2']({ data: { data: auditLogs, meta: { total: 40, page: 2, limit: 20, totalPages: 2 } } });
    expect(await screen.findByText(/filtros aplicados/i)).toHaveTextContent('busca "a"');
    expect(screen.getByText('40 registros')).toBeInTheDocument();
  });

  it('Limpar filtros durante a transição não deixa rótulo nem total na tela', async () => {
    mockControlled();
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByLabelText(/buscar \(cofre, pasta ou senha\)/i);
    await user.type(search, 'a');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await screen.findByText('40 registros');
    await user.clear(search);
    await user.type(search, 'b');
    await user.click(screen.getByRole('button', { name: /exibir/i }));
    await waitFor(() => expect(auditCalls()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: /limpar filtros/i }));

    expect(screen.queryByText(/filtros aplicados/i)).not.toBeInTheDocument();
    expect(screen.queryByText('40 registros')).not.toBeInTheDocument();
    expect(screen.queryByText('Servidor FTP')).not.toBeInTheDocument();
  });
});

describe('VaultAuditPage — auditoria de design P3-I (AUD-09, AUD-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AUD-09: ação fora do mapa aparece como "Ação desconhecida (CÓDIGO)", nunca só o código cru', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/users/agents') return { data: agents };
      if (url === '/vault/audit') {
        return {
          data: {
            data: [{ ...auditLogs[0], id: 'log-2', action: 'NEW_ACTION' }],
            meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
          },
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('combobox', { name: 'Atendente' }, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: /exibir/i }));

    const table = await screen.findByRole('table', undefined, { timeout: 5000 });
    expect(within(table).getByText('Ação desconhecida (NEW_ACTION)')).toBeInTheDocument();
  });

  it('AUD-10: o cabeçalho tem Voltar que leva ao Cofre', async () => {
    mockGets();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/vault/audit']}>
          <Routes>
            <Route path="/vault/audit" element={<VaultAuditPage />} />
            <Route path="/vault" element={<div>Tela do cofre</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(await screen.findByText('Tela do cofre', undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it('AUD-10: o aviso de IP e horário é texto de apoio, não um alerta de status permanente', () => {
    mockGets();
    renderPage();

    const notice = screen.getByText(/o endereço ip de origem e o horário de cada ação são registrados/i);
    expect(notice.closest('[role="status"], [role="alert"]')).toBeNull();
  });
});
