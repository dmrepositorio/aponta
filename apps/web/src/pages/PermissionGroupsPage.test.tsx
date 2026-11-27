import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionGroupsPage } from './PermissionGroupsPage';
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
  { id: 'pg-1', name: 'Atendente Padrão', description: 'Grupo padrão', permissions: ['VIEW_AND_OPEN_TICKETS'] },
];

const GROUP_DETAIL = {
  ...GROUP_LIST[0],
  userMembers: [{ user: { id: 'user-1', name: 'Ana Silva', email: 'ana@aponta.com' } }],
  technicalGroupLinks: [],
};

const GROUP_DETAIL_WITH_TECH = {
  ...GROUP_DETAIL,
  technicalGroupLinks: [{ technicalGroup: { id: 'tg-1', name: 'Suporte N1' } }],
};

// O PATCH real (prisma.update sem include) devolve só a linha do grupo, sem userMembers nem technicalGroupLinks.
function bareRow<T extends { userMembers: unknown; technicalGroupLinks: unknown }>(detail: T) {
  const { userMembers: _members, technicalGroupLinks: _links, ...row } = detail;
  return row;
}

const TECH_GROUPS = [
  { id: 'tg-1', name: 'Suporte N1' },
  { id: 'tg-2', name: 'Suporte N2' },
];

const CATALOG = [
  { key: 'VIEW_AND_OPEN_TICKETS', category: 'MANAGEMENT', label: 'Visualizar e abrir tickets' },
  { key: 'EDIT_CLOSED_TICKETS', category: 'MANAGEMENT', label: 'Editar tickets fechados' },
  { key: 'MANAGE_USERS', category: 'ADMINISTRATIVE', label: 'Gerenciar usuários' },
];

const ALL_USERS = [
  { id: 'user-1', name: 'Ana Silva', email: 'ana@aponta.com', role: 'AGENT', organizationId: null },
  { id: 'user-2', name: 'Carlos Dias', email: 'carlos@aponta.com', role: 'AGENT', organizationId: null },
];

function apiError(message: string) {
  return Object.assign(new Error(message), { isAxiosError: true, response: { status: 400, data: { message } } });
}

interface UsersParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

// Procura como a API: `q` casa nome ou e-mail e a resposta paginada vem com `meta`.
function usersResponse(config?: { params?: UsersParams }) {
  const params = config?.params;
  if (!params) return { data: ALL_USERS };
  const q = (params.q ?? '').toLowerCase();
  const rows = ALL_USERS.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q));
  return { data: { data: rows, meta: { total: rows.length, page: 1, pageSize: params.pageSize ?? 20, totalPages: 1 } } };
}

function usersCalls() {
  return vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => url === '/users')
    .map(([, config]) => (config as { params?: UsersParams } | undefined)?.params);
}

function mockGets(detail: unknown = GROUP_DETAIL, calls?: string[]) {
  vi.mocked(api.get).mockImplementation(((url: string, config?: { params?: UsersParams }) => {
    calls?.push(url);
    if (url === '/permission-groups') return Promise.resolve({ data: GROUP_LIST });
    if (url === '/permission-groups/pg-1') return Promise.resolve({ data: detail });
    if (url === '/permission-groups/catalog') return Promise.resolve({ data: CATALOG });
    if (url === '/users') return Promise.resolve(usersResponse(config));
    if (url === '/technical-groups') return Promise.resolve({ data: TECH_GROUPS });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  }) as never);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PermissionGroupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPermissionsTab() {
  await userEvent.click(await screen.findByText('Atendente Padrão'));
  await userEvent.click(await screen.findByRole('tab', { name: /permissões/i }));
  await screen.findByText('Editar tickets fechados');
}

async function openLinksTab() {
  await userEvent.click(await screen.findByText('Atendente Padrão'));
  await userEvent.click(await screen.findByRole('tab', { name: /vínculos/i }));
}

async function confirmDialog(name = 'Confirmar') {
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }));
}

describe('PermissionGroupsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGets();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockResolvedValue({ data: bareRow(GROUP_DETAIL) });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('lists permission groups from GET /permission-groups', async () => {
    renderPage();
    expect(await screen.findByText('Atendente Padrão')).toBeInTheDocument();
  });

  it('renders the permission matrix grouped by category from the catalog', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Atendente Padrão'));
    await userEvent.click(await screen.findByRole('tab', { name: /permissões/i }));

    expect(await screen.findByText('Visualizar e abrir tickets')).toBeInTheDocument();
    expect(screen.getByText('Editar tickets fechados')).toBeInTheDocument();
    expect(screen.getByText('Gerenciar usuários')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /visualizar e abrir tickets/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).not.toBeChecked();
  });

  it('"Selecionar todos" checks every permission in that category only, and Save persists the result', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Atendente Padrão'));
    await userEvent.click(await screen.findByRole('tab', { name: /permissões/i }));
    await screen.findByText('Visualizar e abrir tickets');

    await userEvent.click(screen.getByRole('checkbox', { name: /selecionar todos \(permissões de gestão\)/i }));

    expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /gerenciar usuários/i })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
    await confirmDialog();

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/permission-groups/pg-1/permissions', {
        permissions: expect.arrayContaining(['VIEW_AND_OPEN_TICKETS', 'EDIT_CLOSED_TICKETS']),
      }),
    );
    const [, body] = vi.mocked(api.patch).mock.calls[0] as [string, { permissions: string[] }];
    expect(body.permissions).not.toContain('MANAGE_USERS');
  });

  it('adds a user link via POST /permission-groups/:id/users/:userId', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Atendente Padrão'));
    await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));

    await screen.findByText('Carlos Dias');
    await userEvent.click(screen.getAllByTitle('Adicionar')[0]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/permission-groups/pg-1/users/user-2'),
    );
  });

  describe('PG-08: busca remota de usuários na lista dupla', () => {
    const searchUsers = () => screen.getByRole('searchbox', { name: 'Buscar em Usuários disponíveis' });

    it('abre os vínculos pedindo só a primeira página, sem a lista completa de /users', async () => {
      renderPage();
      await openLinksTab();
      await screen.findByText('Carlos Dias', undefined, { timeout: 5000 });

      const calls = usersCalls();
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((params) => params?.page === 1 && params.pageSize === 20)).toBe(true);
    });

    it('digitar busca no servidor por q com pageSize, uma vez só depois da pausa', async () => {
      renderPage();
      await openLinksTab();
      await screen.findByText('Carlos Dias', undefined, { timeout: 5000 });

      await userEvent.type(searchUsers(), 'Carl');

      await waitFor(() => expect(usersCalls().at(-1)).toEqual({ q: 'Carl', page: 1, pageSize: 20 }), {
        timeout: 5000,
      });
      expect(usersCalls().filter((params) => params?.q === 'C' || params?.q === 'Ca')).toHaveLength(0);
    });

    it('os vinculados continuam na lista de membros mesmo fora da busca', async () => {
      renderPage();
      await openLinksTab();
      await screen.findByText('Carlos Dias', undefined, { timeout: 5000 });

      await userEvent.type(searchUsers(), 'Carlos');
      await waitFor(() => expect(usersCalls().at(-1)?.q).toBe('Carlos'), { timeout: 5000 });

      const linked = screen.getByRole('button', { name: 'Remover Ana Silva' });
      expect(linked).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Adicionar Ana Silva' })).not.toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' })).toBeInTheDocument();
    });

    it('vincular um resultado da busca envia o mesmo POST de antes', async () => {
      renderPage();
      await openLinksTab();
      await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar em Usuários disponíveis' }), 'carlos@');

      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }, { timeout: 5000 }));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/permission-groups/pg-1/users/user-2'));
    });

    it('busca sem resultado mostra o aviso de busca e falha da busca mostra o erro', async () => {
      renderPage();
      await openLinksTab();
      await screen.findByText('Carlos Dias', undefined, { timeout: 5000 });

      await userEvent.type(searchUsers(), 'zzz');
      expect(await screen.findByText('Nenhum resultado para a busca', undefined, { timeout: 5000 })).toBeInTheDocument();

      const original = vi.mocked(api.get).getMockImplementation()!;
      vi.mocked(api.get).mockImplementation(((url: string, config?: { params?: UsersParams }) =>
        url === '/users' ? Promise.reject(new Error('boom')) : original(url, config)) as never);
      await userEvent.clear(searchUsers());
      await userEvent.type(searchUsers(), 'ana');

      expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent(
        'Não foi possível carregar a lista',
      );
    });
  });

  describe('PG-01: confirmação e retorno ao salvar permissões', () => {
    it('Salvar abre o diálogo com o resumo +1 / -0 e o PATCH só ocorre depois de confirmar', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/\+1 \/ -0/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Editar tickets fechados/)).toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith('/permission-groups/pg-1/permissions', {
          permissions: expect.arrayContaining(['VIEW_AND_OPEN_TICKETS', 'EDIT_CLOSED_TICKETS']),
        }),
      );
      expect(api.patch).toHaveBeenCalledTimes(1);
    });

    it('o resumo conta as permissões removidas (-1) e as lista', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /visualizar e abrir tickets/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/\+0 \/ -1/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Visualizar e abrir tickets/)).toBeInTheDocument();
    });

    it('o diálogo informa quantos usuários diretos e grupos de atendentes o grupo afeta', async () => {
      mockGets(GROUP_DETAIL_WITH_TECH);
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/1 usuário vinculado diretamente/)).toBeInTheDocument();
      expect(within(dialog).getByText(/1 grupo de atendentes/)).toBeInTheDocument();
    });

    it('Cancelar no diálogo não chama o PATCH e mantém a seleção', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
      await confirmDialog('Cancelar');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
      expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).toBeChecked();
    });

    it('sem alterações o botão Salvar permissões fica desabilitado', async () => {
      renderPage();
      await openPermissionsTab();
      expect(screen.getByRole('button', { name: /salvar permissões/i })).toBeDisabled();
    });

    it('mostra o toast de sucesso depois de salvar', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
      await confirmDialog();

      expect(await screen.findByText('Permissões salvas')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('falha no PATCH mostra o toast de erro com a mensagem da API', async () => {
      vi.mocked(api.patch).mockRejectedValue(apiError('Sem permissão para alterar o grupo'));
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
      await confirmDialog();

      const message = await screen.findByText('Sem permissão para alterar o grupo');
      expect(message.closest('[role="alert"]')).not.toBeNull();
      expect(screen.queryByText('Permissões salvas')).not.toBeInTheDocument();
    });
  });

  describe('PG-02: alterações não salvas', () => {
    it('marcar uma permissão mostra "Alterações não salvas"; voltar ao estado salvo some', async () => {
      renderPage();
      await openPermissionsTab();
      expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    });

    it('Voltar com pendência pede descarte; Cancelar mantém a edição e Confirmar volta à lista', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByTitle('Voltar'));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Descartar alterações?')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).toBeChecked();

      await userEvent.click(screen.getByTitle('Voltar'));
      await confirmDialog();
      expect(await screen.findByRole('button', { name: 'Novo grupo' })).toBeInTheDocument();
    });

    it('PG-09: o detalhe tem um só Voltar (o do cabeçalho); o rodapé não repete', async () => {
      renderPage();
      await openPermissionsTab();

      expect(screen.getByTitle('Voltar')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /voltar para a lista/i })).not.toBeInTheDocument();
    });

    it('o Voltar do cabeçalho também pede descarte; sem pendência sai direto', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByTitle('Voltar'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      await confirmDialog('Cancelar');
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByTitle('Voltar'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Novo grupo' })).toBeInTheDocument();
    });

    it('trocar de aba com pendência pede descarte; confirmar descarta e troca, cancelar fica', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));

      await screen.findByRole('dialog');
      await confirmDialog('Cancelar');
      expect(screen.getByRole('tab', { name: /permissões/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).toBeChecked();

      await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));
      await confirmDialog();
      expect(await screen.findByText('Usuários vinculados diretamente')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: /permissões/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByRole('checkbox', { name: /editar tickets fechados/i })).not.toBeChecked();
    });

    it('sem pendência a troca de aba é direta', async () => {
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText('Usuários vinculados diretamente')).toBeInTheDocument();
    });

    it('depois de salvar o indicador some e a seleção segue o servidor atualizado', async () => {
      const saved = { ...GROUP_DETAIL, permissions: ['VIEW_AND_OPEN_TICKETS', 'EDIT_CLOSED_TICKETS'] };
      vi.mocked(api.patch).mockImplementation((async () => {
        mockGets(saved);
        return { data: bareRow(saved) };
      }) as never);
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
      await confirmDialog();

      await waitFor(() => expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument());
      expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).toBeChecked();
      expect(screen.getByRole('button', { name: /salvar permissões/i })).toBeDisabled();
    });

    it('logo depois do PATCH (refetch ainda pendente) trocar de aba não pede descarte', async () => {
      const saved = { ...GROUP_DETAIL, permissions: ['VIEW_AND_OPEN_TICKETS', 'EDIT_CLOSED_TICKETS'] };
      vi.mocked(api.patch).mockImplementation((async () => {
        vi.mocked(api.get).mockImplementation(((url: string) =>
          url === '/permission-groups/pg-1' ? new Promise(() => undefined) : Promise.resolve({ data: [] })) as never);
        return { data: bareRow(saved) };
      }) as never);
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
      await confirmDialog();
      await screen.findByText('Permissões salvas');

      await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText('Usuários vinculados diretamente')).toBeInTheDocument();
    });

    it('tolera detalhe sem userMembers/technicalGroupLinks (parcial) sem derrubar a página', async () => {
      const partial = { id: 'pg-1', name: 'Atendente Padrão', description: null, permissions: ['VIEW_AND_OPEN_TICKETS'] };
      mockGets(partial);
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      await userEvent.click(await screen.findByRole('tab', { name: /vínculos/i }));

      expect(await screen.findByText('Usuários vinculados diretamente')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Excluir grupo' }));
      expect(within(await screen.findByRole('dialog')).getByText(/0 usuários vinculados diretamente/)).toBeInTheDocument();
    });

    it('uma mudança externa no servidor depois de salvar reaparece na seleção (a baseline é o servidor)', async () => {
      const saved = { ...GROUP_DETAIL, permissions: ['VIEW_AND_OPEN_TICKETS', 'EDIT_CLOSED_TICKETS'] };
      vi.mocked(api.patch).mockImplementation((async () => {
        mockGets(saved);
        return { data: bareRow(saved) };
      }) as never);
      renderPage();
      await openPermissionsTab();
      await userEvent.click(screen.getByRole('checkbox', { name: /editar tickets fechados/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar permissões/i }));
      await confirmDialog();
      await waitFor(() => expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument());

      // Outro administrador concede MANAGE_USERS; o próximo refetch (vínculo adicionado) traz isso.
      mockGets({ ...saved, permissions: [...saved.permissions, 'MANAGE_USERS'] });
      await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));
      await screen.findByText('Usuário vinculado');
      await userEvent.click(screen.getByRole('tab', { name: /permissões/i }));

      await waitFor(() => expect(screen.getByRole('checkbox', { name: /gerenciar usuários/i })).toBeChecked());
      expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    });

    it('depois de salvar a aba Informações o indicador some e uma mudança externa do nome reaparece', async () => {
      const renamed = { ...GROUP_DETAIL, name: 'Atendente Padrão X' };
      vi.mocked(api.patch).mockImplementation((async () => {
        mockGets(renamed);
        return { data: bareRow(renamed) };
      }) as never);
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      await userEvent.type(await screen.findByLabelText('Nome'), ' X');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument());

      mockGets({ ...renamed, name: 'Nome externo' });
      await userEvent.click(screen.getByRole('tab', { name: /vínculos/i }));
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));
      await screen.findByText('Usuário vinculado');
      await userEvent.click(screen.getByRole('tab', { name: /informações/i }));

      await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('Nome externo'));
      expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    });

    it('a aba Informações mostra "Alterações não salvas" ao editar e pede descarte ao voltar', async () => {
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      const name = await screen.findByLabelText('Nome');
      expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
      await userEvent.type(name, ' X');
      expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();

      await userEvent.click(screen.getByTitle('Voltar'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('PG-03: confirmação e retorno nos vínculos', () => {
    it('remover usuário pede confirmação e o DELETE só ocorre depois, com toast de sucesso', async () => {
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Remover Ana Silva' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Ana Silva/)).toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/permission-groups/pg-1/users/user-1'));
      expect(await screen.findByText('Usuário desvinculado')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Cancelar na remoção de usuário não chama o DELETE', async () => {
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Remover Ana Silva' }));
      await confirmDialog('Cancelar');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('remover grupo de atendentes pede confirmação e o DELETE só ocorre depois, com toast', async () => {
      mockGets(GROUP_DETAIL_WITH_TECH);
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Remover Suporte N1' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Suporte N1/)).toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/permission-groups/pg-1/technical-groups/tg-1'));
      expect(await screen.findByText('Grupo de atendentes desvinculado')).toBeInTheDocument();
    });

    it('falha na remoção mostra toast de erro e fecha o diálogo', async () => {
      vi.mocked(api.delete).mockRejectedValue(apiError('Não foi possível remover o vínculo'));
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Remover Ana Silva' }));
      await confirmDialog('Remover');

      const message = await screen.findByText('Não foi possível remover o vínculo');
      expect(message.closest('[role="alert"]')).not.toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText('Usuário desvinculado')).not.toBeInTheDocument();
    });

    it('adicionar usuário segue imediato (sem diálogo) e mostra toast de sucesso', async () => {
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/permission-groups/pg-1/users/user-2'));
      expect(await screen.findByText('Usuário vinculado')).toBeInTheDocument();
    });

    it('adicionar grupo de atendentes mostra toast de sucesso; falha mostra toast de erro', async () => {
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Suporte N2' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/permission-groups/pg-1/technical-groups/tg-2'));
      expect(await screen.findByText('Grupo de atendentes vinculado')).toBeInTheDocument();

      vi.mocked(api.post).mockRejectedValue(apiError('Grupo de atendentes inválido'));
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Suporte N1' }));
      const message = await screen.findByText('Grupo de atendentes inválido');
      expect(message.closest('[role="alert"]')).not.toBeNull();
    });

    it('falha ao adicionar usuário mostra toast de erro', async () => {
      vi.mocked(api.post).mockRejectedValue(apiError('Usuário inválido'));
      renderPage();
      await openLinksTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Carlos Dias' }));

      const message = await screen.findByText('Usuário inválido');
      expect(message.closest('[role="alert"]')).not.toBeNull();
    });
  });

  describe('PG-04: excluir grupo', () => {
    it('Excluir grupo abre o diálogo com a contagem de usuários e grupos de atendentes e só então chama o DELETE', async () => {
      mockGets(GROUP_DETAIL_WITH_TECH);
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      await userEvent.click(await screen.findByRole('button', { name: 'Excluir grupo' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/1 usuário vinculado diretamente/)).toBeInTheDocument();
      expect(within(dialog).getByText(/1 grupo de atendentes/)).toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/permission-groups/pg-1'));
    });

    it('depois de excluir volta à lista recarregada e mostra o toast', async () => {
      const calls: string[] = [];
      mockGets(GROUP_DETAIL, calls);
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      await userEvent.click(await screen.findByRole('button', { name: 'Excluir grupo' }));
      await confirmDialog('Excluir');

      expect(await screen.findByText('Grupo excluído')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Novo grupo' })).toBeInTheDocument();
      await waitFor(() => expect(calls.filter((url) => url === '/permission-groups')).toHaveLength(2));
      expect(calls.filter((url) => url === '/permission-groups/pg-1')).toHaveLength(1);
    });

    it('Cancelar não chama o DELETE', async () => {
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      await userEvent.click(await screen.findByRole('button', { name: 'Excluir grupo' }));
      await confirmDialog('Cancelar');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('falha ao excluir mostra toast de erro e mantém o detalhe', async () => {
      vi.mocked(api.delete).mockRejectedValue(apiError('Grupo em uso'));
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      await userEvent.click(await screen.findByRole('button', { name: 'Excluir grupo' }));
      await confirmDialog('Excluir');

      const message = await screen.findByText('Grupo em uso');
      expect(message.closest('[role="alert"]')).not.toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Excluir grupo' })).toBeInTheDocument();
    });
  });
});
