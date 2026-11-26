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

function mockGets(detail: unknown = GROUP_DETAIL, calls?: string[]) {
  vi.mocked(api.get).mockImplementation(((url: string) => {
    calls?.push(url);
    if (url === '/permission-groups') return Promise.resolve({ data: GROUP_LIST });
    if (url === '/permission-groups/pg-1') return Promise.resolve({ data: detail });
    if (url === '/permission-groups/catalog') return Promise.resolve({ data: CATALOG });
    if (url === '/users') return Promise.resolve({ data: ALL_USERS });
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
    vi.mocked(api.patch).mockResolvedValue({ data: GROUP_DETAIL });
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
      await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Descartar alterações?')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /editar tickets fechados/i })).toBeChecked();

      await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));
      await confirmDialog();
      expect(await screen.findByRole('button', { name: 'Novo grupo' })).toBeInTheDocument();
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
        return { data: saved };
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

    it('a aba Informações mostra "Alterações não salvas" ao editar e pede descarte ao voltar', async () => {
      renderPage();
      await userEvent.click(await screen.findByText('Atendente Padrão'));
      const name = await screen.findByLabelText('Nome');
      expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
      await userEvent.type(name, ' X');
      expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));
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
