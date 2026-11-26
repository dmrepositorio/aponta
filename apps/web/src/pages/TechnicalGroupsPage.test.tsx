import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TechnicalGroupsPage } from './TechnicalGroupsPage';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const GROUP_LIST = [
  {
    id: 'tg-1',
    name: 'Suporte N1',
    description: 'Primeira linha',
    dailyWorklogEmailEnabled: false,
    scheduleEnabled: true,
  },
];

const GROUP_DETAIL = {
  ...GROUP_LIST[0],
  members: [{ id: 'user-1', name: 'Ana Silva', email: 'ana@aponta.com' }],
  organizationLinks: [{ organization: { id: 'org-1', name: 'Cliente A' } }],
  serviceDeskLinks: [],
  permissionGroupLinks: [],
};

const ALL_USERS = [
  { id: 'user-1', name: 'Ana Silva', email: 'ana@aponta.com', role: 'AGENT', organizationId: null },
  { id: 'user-2', name: 'Carlos Dias', email: 'carlos@aponta.com', role: 'AGENT', organizationId: null },
];

const ALL_ORGS = [
  { id: 'org-1', name: 'Cliente A' },
  { id: 'org-2', name: 'Cliente B' },
];

const ALL_DESKS = [{ id: 'desk-1', name: 'Mesa Principal' }];

function apiError(message: string) {
  return Object.assign(new Error(message), { isAxiosError: true, response: { status: 400, data: { message } } });
}

async function expectText(text: string | RegExp) {
  await waitFor(() => expect(screen.queryByText(text)).toBeInTheDocument());
}

async function expectDialog(name: string) {
  await waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeInTheDocument());
  return screen.getByRole('dialog', { name });
}

async function expectButton(name: string) {
  await waitFor(() => expect(screen.queryByRole('button', { name })).toBeInTheDocument());
}

async function openGroup(tab?: 'Equipe' | 'Acessos') {
  await userEvent.click(await screen.findByText('Suporte N1'));
  await screen.findByRole('tablist');
  if (tab) await userEvent.click(screen.getByRole('tab', { name: tab }));
}

function mockGroupDetail(detail: object) {
  const base = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((url: string) =>
    url === '/technical-groups/tg-1' ? Promise.resolve({ data: detail }) : base(url),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TechnicalGroupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TechnicalGroupsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/technical-groups') return Promise.resolve({ data: GROUP_LIST });
      if (url === '/technical-groups/tg-1') return Promise.resolve({ data: GROUP_DETAIL });
      if (url === '/users') return Promise.resolve({ data: ALL_USERS });
      if (url === '/organizations') return Promise.resolve({ data: ALL_ORGS });
      if (url === '/service-desks') return Promise.resolve({ data: ALL_DESKS });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('lists technical groups from GET /technical-groups', async () => {
    renderPage();
    expect(await screen.findByText('Suporte N1')).toBeInTheDocument();
  });

  it('opens a group detail with Informações, Equipe and Acessos tabs', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));

    const tabs = await screen.findByRole('tablist');
    expect(tabs).toHaveTextContent(/informações/i);
    expect(tabs).toHaveTextContent(/equipe/i);
    expect(tabs).toHaveTextContent(/acessos/i);
  });

  it('adds a member on the Equipe tab via POST /technical-groups/:id/members/:userId', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));
    await userEvent.click(screen.getByRole('tab', { name: /equipe/i }));

    await screen.findByText('Carlos Dias');
    await userEvent.click(screen.getAllByTitle('Adicionar')[0]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/technical-groups/tg-1/members/user-2'),
    );
  });

  it('removes a member on the Equipe tab via DELETE /technical-groups/:id/members/:userId', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));
    await userEvent.click(screen.getByRole('tab', { name: /equipe/i }));

    await screen.findByText('Ana Silva');
    await userEvent.click(screen.getAllByTitle('Remover')[0]);

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/technical-groups/tg-1/members/user-1'),
    );
  });

  it('adds an organization access on the Acessos tab via POST .../organizations/:id', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));
    await userEvent.click(screen.getByRole('tab', { name: /acessos/i }));

    await screen.findByText('Cliente B');
    const addButtons = screen.getAllByTitle('Adicionar');
    await userEvent.click(addButtons[0]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/technical-groups/tg-1/organizations/org-2'),
    );
  });

  it('adds a service desk access on the Acessos tab via POST .../service-desks/:id', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));
    await userEvent.click(screen.getByRole('tab', { name: /acessos/i }));

    await screen.findByText('Mesa Principal');
    const addButtons = screen.getAllByTitle('Adicionar');
    await userEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/technical-groups/tg-1/service-desks/desk-1'),
    );
  });
});

describe('TechnicalGroupsPage: feedback das mutações (TG-01)', () => {
  const DESK_LINKED = {
    ...GROUP_DETAIL,
    serviceDeskLinks: [{ serviceDesk: { id: 'desk-1', name: 'Mesa Principal' } }],
  };
  const CASES = [
    { tab: 'Equipe', button: 'Adicionar Carlos Dias', method: 'post', success: 'Membro adicionado', detail: GROUP_DETAIL },
    { tab: 'Equipe', button: 'Remover Ana Silva', method: 'delete', success: 'Membro removido', detail: GROUP_DETAIL },
    { tab: 'Acessos', button: 'Adicionar Cliente B', method: 'post', success: 'Cliente vinculado', detail: GROUP_DETAIL },
    { tab: 'Acessos', button: 'Remover Cliente A', method: 'delete', success: 'Cliente desvinculado', detail: GROUP_DETAIL },
    { tab: 'Acessos', button: 'Adicionar Mesa Principal', method: 'post', success: 'Mesa vinculada', detail: GROUP_DETAIL },
    { tab: 'Acessos', button: 'Remover Mesa Principal', method: 'delete', success: 'Mesa desvinculada', detail: DESK_LINKED },
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/technical-groups') return Promise.resolve({ data: GROUP_LIST });
      if (url === '/technical-groups/tg-1') return Promise.resolve({ data: GROUP_DETAIL });
      if (url === '/users') return Promise.resolve({ data: ALL_USERS });
      if (url === '/organizations') return Promise.resolve({ data: ALL_ORGS });
      if (url === '/service-desks') return Promise.resolve({ data: ALL_DESKS });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it.each(CASES)('mostra "$success" ao concluir "$button"', async ({ tab, button, method, success, detail }) => {
    mockGroupDetail(detail);
    renderPage();
    await openGroup(tab);
    await userEvent.click(await screen.findByRole('button', { name: button }));

    await waitFor(() => expect(api[method]).toHaveBeenCalledTimes(1));
    await expectText(success);
  });

  it.each(CASES)('mostra a mensagem da API quando "$button" falha', async ({ tab, button, method, detail }) => {
    mockGroupDetail(detail);
    vi.mocked(api[method]).mockRejectedValue(apiError('Falha da API: ' + button));
    renderPage();
    await openGroup(tab);
    await userEvent.click(await screen.findByRole('button', { name: button }));

    await expectText('Falha da API: ' + button);
  });

  it('mostra "Grupo salvo" depois de Salvar na aba Informações', async () => {
    renderPage();
    await openGroup();
    await userEvent.type(screen.getByLabelText('Nome'), ' B');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    await expectText('Grupo salvo');
  });

  it('mostra a mensagem da API quando Salvar falha', async () => {
    vi.mocked(api.patch).mockRejectedValue(apiError('Nome inválido'));
    renderPage();
    await openGroup();
    await userEvent.type(screen.getByLabelText('Nome'), ' B');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await expectText('Nome inválido');
    expect(screen.queryByText('Grupo salvo')).not.toBeInTheDocument();
  });

  it('usa um texto padrão quando a falha não traz mensagem da API', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Network Error'));
    renderPage();
    await openGroup('Equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));

    await expectText(/não foi possível/i);
  });

  it('o alerta de erro fecha e some na próxima ação bem-sucedida', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(apiError('Falha momentânea')).mockResolvedValue({ data: {} });
    renderPage();
    await openGroup('Equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));
    await expectText('Falha momentânea');

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar Carlos Dias' }));
    await expectText('Membro adicionado');
    expect(screen.queryByText('Falha momentânea')).not.toBeInTheDocument();
  });
});

describe('TechnicalGroupsPage: rascunho da aba Informações (TG-04, TG-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/technical-groups') return Promise.resolve({ data: GROUP_LIST });
      if (url === '/technical-groups/tg-1') return Promise.resolve({ data: GROUP_DETAIL });
      if (url === '/users') return Promise.resolve({ data: ALL_USERS });
      if (url === '/organizations') return Promise.resolve({ data: ALL_ORGS });
      if (url === '/service-desks') return Promise.resolve({ data: ALL_DESKS });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('não grava ao marcar "Agenda habilitada": um único patch com os 4 campos só no Salvar', async () => {
    renderPage();
    await openGroup();
    await userEvent.click(screen.getByLabelText('Agenda habilitada'));
    await userEvent.click(screen.getByLabelText('Enviar e-mail diário de apontamentos'));
    expect(api.patch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/technical-groups/tg-1', {
      name: 'Suporte N1',
      description: 'Primeira linha',
      dailyWorklogEmailEnabled: true,
      scheduleEnabled: false,
    });
  });

  it('Salvar começa desabilitado, sem aviso de alterações', async () => {
    renderPage();
    await openGroup();

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
  });

  it.each([
    ['o nome', () => userEvent.type(screen.getByLabelText('Nome'), ' B')],
    ['a descrição', () => userEvent.type(screen.getByLabelText('Descrição'), ' B')],
    ['o e-mail diário', () => userEvent.click(screen.getByLabelText('Enviar e-mail diário de apontamentos'))],
    ['a agenda', () => userEvent.click(screen.getByLabelText('Agenda habilitada'))],
  ])('alterar %s habilita Salvar e mostra "Alterações não salvas"', async (_label, change) => {
    renderPage();
    await openGroup();
    await change();

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    await expectText('Alterações não salvas');
  });

  it('desfazer a edição manual desabilita Salvar de novo', async () => {
    renderPage();
    await openGroup();
    await userEvent.click(screen.getByLabelText('Agenda habilitada'));
    await userEvent.click(screen.getByLabelText('Agenda habilitada'));

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
  });

  it('Voltar com alterações pendentes abre o diálogo de descarte e Cancelar mantém a edição', async () => {
    renderPage();
    await openGroup();
    await userEvent.type(screen.getByLabelText('Nome'), ' B');
    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    const dialog = await expectDialog('Descartar alterações?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('Suporte N1 B');
  });

  it('confirmar o descarte volta para a lista sem gravar', async () => {
    renderPage();
    await openGroup();
    await userEvent.type(screen.getByLabelText('Nome'), ' B');
    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));
    const dialog = await expectDialog('Descartar alterações?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await expectButton('Novo grupo');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('o botão Voltar do cabeçalho também pede confirmação com alterações pendentes', async () => {
    renderPage();
    await openGroup();
    await userEvent.type(screen.getByLabelText('Nome'), ' B');
    await userEvent.click(screen.getByTitle('Voltar'));

    await expectDialog('Descartar alterações?');
  });

  it('sem alterações, Voltar sai direto, sem diálogo', async () => {
    renderPage();
    await openGroup();
    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    await expectButton('Novo grupo');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ressincroniza o rascunho quando o servidor muda o grupo (sem edição pendente)', async () => {
    renderPage();
    await openGroup('Equipe');
    mockGroupDetail({ ...GROUP_DETAIL, name: 'Suporte N1 (v2)', description: 'Outra' });
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));
    await expectText('Membro adicionado');
    await userEvent.click(screen.getByRole('tab', { name: 'Informações' }));

    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('Suporte N1 (v2)'));
    expect(screen.getByLabelText('Descrição')).toHaveValue('Outra');
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
  });

  it('guarda: um refetch que não muda os campos preserva a edição pendente', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));
    await userEvent.type(await screen.findByLabelText('Nome'), ' B');
    await userEvent.click(screen.getByRole('tab', { name: 'Equipe' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));
    await expectText('Membro adicionado');
    await userEvent.click(screen.getByRole('tab', { name: 'Informações' }));

    expect(screen.getByLabelText('Nome')).toHaveValue('Suporte N1 B');
  });
});

describe('TechnicalGroupsPage: modal de criação (TG-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/technical-groups' ? Promise.resolve({ data: GROUP_LIST }) : Promise.reject(new Error(`Unexpected GET ${url}`)),
    );
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  async function openCreate() {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Novo grupo' }));
    return expectDialog('Novo grupo de atendentes');
  }

  it('o campo Nome recebe o foco ao abrir', async () => {
    const dialog = await openCreate();

    await waitFor(() => expect(within(dialog).getByLabelText(/^Nome/)).toHaveFocus());
  });

  it('Criar com nome vazio mostra "Informe o nome" no campo e não chama a API', async () => {
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(within(dialog).queryByText('Informe o nome')).toBeInTheDocument());
    expect(within(dialog).getByLabelText(/^Nome/)).toBeInvalid();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('nome só com espaços também mostra "Informe o nome"', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), '   {Enter}');

    await waitFor(() => expect(within(dialog).queryByText('Informe o nome')).toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Enter no campo Nome envia o formulário', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Suporte N2{Enter}');

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/technical-groups', { name: 'Suporte N2', description: undefined }),
    );
  });

  it('o erro some quando o usuário volta a digitar o nome', async () => {
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(within(dialog).queryByText('Informe o nome')).toBeInTheDocument());
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'A');

    expect(within(dialog).queryByText('Informe o nome')).not.toBeInTheDocument();
  });

  it('erro da API (duplicidade) aparece no modal e o modal continua aberto', async () => {
    vi.mocked(api.post).mockRejectedValue(apiError('Já existe um grupo com esse nome'));
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Suporte N1{Enter}');

    await waitFor(() => expect(within(dialog).queryByText('Já existe um grupo com esse nome')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Novo grupo de atendentes' })).toBeInTheDocument();
  });

  it('criação com sucesso fecha o modal e mostra "Grupo criado"', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Suporte N2{Enter}');

    await expectText('Grupo criado');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancelar não é submit: fecha sem chamar a API', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Suporte N2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('TechnicalGroupsPage: estados de erro e vazio (TG-07)', () => {
  function mockGets(overrides: Record<string, () => Promise<unknown>>) {
    const defaults: Record<string, () => Promise<unknown>> = {
      '/technical-groups': () => Promise.resolve({ data: GROUP_LIST }),
      '/technical-groups/tg-1': () => Promise.resolve({ data: GROUP_DETAIL }),
      '/users': () => Promise.resolve({ data: ALL_USERS }),
      '/organizations': () => Promise.resolve({ data: ALL_ORGS }),
      '/service-desks': () => Promise.resolve({ data: ALL_DESKS }),
    };
    vi.mocked(api.get).mockImplementation(((url: string) => ({ ...defaults, ...overrides }[url]?.() ?? Promise.reject(new Error(url)))) as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('falha em GET /technical-groups mostra erro com "Tentar novamente" que refaz a consulta', async () => {
    let calls = 0;
    mockGets({
      '/technical-groups': () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ data: GROUP_LIST })),
    });
    renderPage();

    await expectText('Não foi possível carregar os grupos.');
    expect(screen.queryByText('Nenhum grupo de atendentes cadastrado.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await expectText('Suporte N1');
    expect(screen.queryByText('Não foi possível carregar os grupos.')).not.toBeInTheDocument();
  });

  it('lista vazia oferece "Novo grupo" dentro do próprio vazio, que abre o modal', async () => {
    mockGets({ '/technical-groups': () => Promise.resolve({ data: [] }) });
    renderPage();

    const title = await screen.findByText('Nenhum grupo de atendentes cadastrado.');
    const emptyCard = title.parentElement as HTMLElement;
    await waitFor(() => expect(within(emptyCard).queryByRole('button', { name: 'Novo grupo' })).toBeInTheDocument());
    await userEvent.click(within(emptyCard).getByRole('button', { name: 'Novo grupo' }));

    await expectDialog('Novo grupo de atendentes');
  });

  it('falha em GET /technical-groups/:id mostra erro com "Tentar novamente"', async () => {
    let calls = 0;
    mockGets({
      '/technical-groups/tg-1': () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ data: GROUP_DETAIL })),
    });
    renderPage();
    await userEvent.click(await screen.findByText('Suporte N1'));

    await expectText('Não foi possível carregar o grupo.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('tablist');
  });

  it.each([
    ['/users', 'Equipe', 'Não foi possível carregar os usuários.'],
    ['/organizations', 'Acessos', 'Não foi possível carregar os clientes.'],
    ['/service-desks', 'Acessos', 'Não foi possível carregar as mesas de serviço.'],
  ] as const)('falha em GET %s avisa na aba %s', async (url, tab, message) => {
    mockGets({ [url]: () => Promise.reject(new Error('boom')) });
    renderPage();
    await openGroup(tab);

    await expectText(message);
  });

  it('o aviso da aba some quando a consulta volta a funcionar pelo "Tentar novamente"', async () => {
    let calls = 0;
    mockGets({
      '/users': () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ data: ALL_USERS })),
    });
    renderPage();
    await openGroup('Equipe');
    await expectText('Não foi possível carregar os usuários.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await expectButton('Adicionar Carlos Dias');
    expect(screen.queryByText('Não foi possível carregar os usuários.')).not.toBeInTheDocument();
  });

  it('um erro de /users não aparece na aba Acessos', async () => {
    mockGets({ '/users': () => Promise.reject(new Error('boom')) });
    renderPage();
    await openGroup('Acessos');
    await screen.findByText('Clientes disponíveis');

    expect(screen.queryByText('Não foi possível carregar os usuários.')).not.toBeInTheDocument();
  });
});
