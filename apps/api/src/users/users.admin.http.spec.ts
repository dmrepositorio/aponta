import { ROLE_GROUP_NAME } from '../permission-groups/default-permission-groups';
import { buildHarness, Harness, ID, names, OLD_PASSWORD } from '../testing/users-http-harness';
import * as bcrypt from 'bcryptjs';

/**
 * Seam 1 (HTTP): UsersController real, PermissionsGuard real com PermissionsService simulado,
 * Prisma em memória, ValidationPipe global. Quem chama é identificado pelo cabeçalho x-test-user.
 */
describe('Usuários: HTTP do cadastro (DMTE-550)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); });

  const userCount = () => h.prisma.tables.user.length;

  describe('GET /users (AC-02, AC-20)', () => {
    it('AC-02: sem permissão MANAGE_USERS responde 403', async () => {
      const res = await h.as('get', '/users?status=ACTIVE', ID.ana);
      expect(res.status).toBe(403);
    });

    it('AC-02: roles aceita lista separada por vírgula e filtra no servidor pelo valor exato do enum', async () => {
      const res = await h.as('get', '/users?roles=AGENT,ADMIN');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Admin Aponta', 'Ana Souza', 'Bruno Lima', 'Diego Alves', 'Elisa Prado', 'Fábio Reis']);
    });

    it('AC-02: status ACTIVE exclui inativos e pendentes; combina com roles', async () => {
      const res = await h.as('get', '/users?roles=AGENT,ADMIN&status=ACTIVE');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Admin Aponta', 'Ana Souza', 'Bruno Lima', 'Fábio Reis']);
    });

    it('AC-02: status INACTIVE lista active=false, inclusive quem não tem senha', async () => {
      const res = await h.as('get', '/users?status=INACTIVE');
      expect(names(res)).toEqual(['Diego Alves', 'Gabi Rocha']);
    });

    it('AC-02: combina com q, grupo de atendentes e grupo de permissões', async () => {
      expect(names(await h.as('get', '/users?q=ana&roles=AGENT'))).toEqual(['Ana Souza']);
      expect(names(await h.as('get', `/users?technicalGroupId=${ID.tgUm}`))).toEqual(['Ana Souza']);
      expect(names(await h.as('get', `/users?permissionGroupId=${ID.pgA}&status=ACTIVE`))).toEqual(['Ana Souza', 'Bruno Lima']);
    });

    it('AC-02: page e pageSize valem junto com os filtros e meta traz o total', async () => {
      const res = await h.as('get', '/users?status=ACTIVE&pageSize=2&page=2');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Bruno Lima', 'Carla Nunes']);
      expect(res.body.meta).toEqual({ total: 6, page: 2, pageSize: 2, totalPages: 3 });
    });

    it.each([
      ['roles com valor fora do enum', 'roles=AGENT,HACKER', 'HACKER'],
      ['roles com HTML', 'roles=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '<script>'],
      ['status fora do enum', 'status=BOGUS', 'BOGUS'],
      ['status repetido vira lista', 'status=ACTIVE&status=INACTIVE', 'INACTIVE'],
      ['status em minúsculas', 'status=active', 'active'],
    ])('AC-02: %s responde 400 sem eco da entrada nem consulta ao banco', async (_label, query, echo) => {
      expect((await h.as('get', '/users?status=ACTIVE')).body.data).toBeDefined(); // controle: o filtro válido funciona
      h.prisma.calls.length = 0;
      const res = await h.as('get', `/users?${query}`);
      expect(res.status).toBe(400);
      expect(res.text).not.toContain(echo);
      expect(h.prisma.calls).toEqual([]);
    });

    it('AC-20: status PENDING lista só quem tem senha nula e está ativo, com pending=true', async () => {
      const res = await h.as('get', '/users?status=PENDING');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Elisa Prado']);
      expect(res.body.data[0].pending).toBe(true);
    });

    it('AC-20: usuário com senha vem com pending=false, na lista e no detalhe', async () => {
      const list = await h.as('get', '/users?status=ACTIVE');
      const flags = (list.body.data ?? []).map((u: { pending: boolean }) => u.pending);
      expect(flags).toEqual([false, false, false, false, false, false]);
      expect((await h.as('get', `/users/${ID.ana}`)).body.pending).toBe(false);
      expect((await h.as('get', `/users/${ID.elisa}`)).body.pending).toBe(true);
    });
  });

  describe('POST /users (AC-06)', () => {
    const body = () => ({
      name: 'Maria Teste', email: 'maria.teste@aponta.test', role: 'AGENT', phone: '11999990000', extension: '123',
      permissionGroupIds: [ID.pgB],
    });
    const create = (payload: unknown, userId = ID.gestor) => h.as('post', '/users', userId).send(payload as object);

    it('AC-06: sem CREATE_USERS responde 403 e nada é criado, mesmo com MANAGE_USERS', async () => {
      const before = userCount();
      expect((await create(body())).status).toBe(403);
      expect((await create(body(), ID.ana)).status).toBe(403);
      expect(userCount()).toBe(before);
    });

    it('AC-06: com CREATE_USERS cria sem senha, pendente, com o grupo padrão do tipo e os grupos escolhidos', async () => {
      h.grant(ID.gestor, 'CREATE_USERS');
      const res = await create(body());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Maria Teste', email: 'maria.teste@aponta.test', role: 'AGENT', active: true, pending: true });
      expect(res.body.permissionGroups.map((g: { name: string }) => g.name).sort()).toEqual([ROLE_GROUP_NAME.AGENT, 'Grupo B'].sort());
      const stored = h.prisma.tables.user.find((u) => u.email === 'maria.teste@aponta.test')!;
      expect(stored.password).toBeNull();
    });

    it('AC-06: ADMIN cria sem precisar da chave (bypass do guard)', async () => {
      const res = await create(body(), ID.admin);
      expect(res.status).toBe(201);
    });

    it('AC-06: apara o nome e grava o e-mail em minúsculas', async () => {
      h.grant(ID.gestor, 'CREATE_USERS');
      const res = await create({ ...body(), name: '  Maria Teste  ', email: 'MARIA.Teste@Aponta.TEST' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Maria Teste', email: 'maria.teste@aponta.test' });
    });

    it('AC-06: e-mail já cadastrado responde 409 com mensagem fixa, sem diferença de caixa', async () => {
      h.grant(ID.gestor, 'CREATE_USERS');
      h.row(ID.bruno).email = 'Bruno.Lima@Aponta.test'; // dado legado com caixa mista
      const before = userCount();

      for (const email of ['ana@aponta.test', 'ANA@Aponta.Test', 'bruno.lima@aponta.test']) {
        const res = await create({ ...body(), email });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('E-mail já cadastrado');
      }
      expect(userCount()).toBe(before);
    });

    it.each([
      ['senha no corpo (campo proibido)', { password: 'Senha#Qualquer1' }],
      ['sem nome', { name: undefined }],
      ['sem e-mail', { email: undefined }],
      ['e-mail inválido', { email: 'nao-e-um-email' }],
      ['tipo fora do enum', { role: 'SUPER' }],
      ['nome como objeto', { name: { $ne: '' } }],
      ['e-mail como lista', { email: ['a@b.com'] }],
      ['nome enorme', { name: 'a'.repeat(10_000) }],
      ['grupos como texto', { permissionGroupIds: 'abc' }],
      ['grupo que não é UUID', { permissionGroupIds: ['nao-uuid'] }],
      ['campo desconhecido', { isAdmin: true }],
    ])('AC-06: %s responde 400 e não cria', async (_label, patch) => {
      h.grant(ID.gestor, 'CREATE_USERS');
      expect((await create({ ...body(), email: 'controle@aponta.test' })).status).toBe(201); // controle: corpo válido passa
      const before = userCount();
      const res = await create({ ...body(), ...patch });
      expect(res.status).toBe(400);
      expect(userCount()).toBe(before);
    });

    it('AC-06: grupo de permissões que não existe responde 400 ou 404 e não cria o usuário', async () => {
      h.grant(ID.gestor, 'CREATE_USERS');
      expect((await create({ ...body(), email: 'controle@aponta.test' })).status).toBe(201); // controle: corpo válido passa
      const before = userCount();
      const res = await create({ ...body(), permissionGroupIds: [ID.missing] });
      expect([400, 404]).toContain(res.status);
      expect(userCount()).toBe(before);
    });
  });

  describe('PATCH /users/:id (AC-09)', () => {
    const patch = (id: string, payload: unknown, userId = ID.gestor) => h.as('patch', `/users/${id}`, userId).send(payload as object);

    it('AC-09: sem MANAGE_USERS responde 403', async () => {
      expect((await patch(ID.bruno, { name: 'Novo Nome' }, ID.ana)).status).toBe(403);
      expect(h.row(ID.bruno).name).toBe('Bruno Lima');
    });

    it('AC-09: edita nome, e-mail, telefone, ramal, cliente, grupo de atendentes e grupos de permissões', async () => {
      const res = await patch(ID.ana, {
        name: 'Ana Maria', email: 'Ana.Maria@Aponta.test', phone: '11988887777', extension: '456',
        organizationId: ID.org, technicalGroupId: ID.tgDois, permissionGroupIds: [ID.pgB],
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Ana Maria', email: 'ana.maria@aponta.test', phone: '11988887777', extension: '456',
        organizationId: ID.org, technicalGroup: { id: ID.tgDois, name: 'Time 2' },
      });
      expect(res.body.permissionGroups).toEqual([{ id: ID.pgB, name: 'Grupo B' }]);
    });

    it('AC-09: corpo parcial só muda o que veio', async () => {
      const res = await patch(ID.ana, { phone: '11977776666' });
      expect(res.status).toBe(200);
      expect(h.row(ID.ana)).toMatchObject({ phone: '11977776666', name: 'Ana Souza', email: 'ana@aponta.test', technicalGroupId: ID.tgUm });
    });

    it('AC-09: null limpa o cliente e o grupo de atendentes', async () => {
      expect((await patch(ID.carla, { organizationId: null })).status).toBe(200);
      expect((await patch(ID.ana, { technicalGroupId: null })).status).toBe(200);
      expect(h.row(ID.carla).organizationId).toBeNull();
      expect(h.row(ID.ana).technicalGroupId).toBeNull();
    });

    it('AC-09: alterar o tipo exige também CHANGE_USER_ROLE (403 sem ela)', async () => {
      const res = await patch(ID.ana, { role: 'AGENT_MASTER' });
      expect(res.status).toBe(403);
      expect(h.row(ID.ana).role).toBe('AGENT');
    });

    it('AC-09: com CHANGE_USER_ROLE troca o tipo e não mexe nos grupos de permissões', async () => {
      h.grant(ID.gestor, 'CHANGE_USER_ROLE');
      const res = await patch(ID.ana, { role: 'AGENT_MASTER' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('AGENT_MASTER');
      expect(res.body.permissionGroups).toEqual([{ id: ID.pgA, name: 'Grupo A' }]);
    });

    it('AC-09: e-mail de outro usuário responde 409, sem diferença de caixa; o próprio e-mail em outra caixa é aceito', async () => {
      const clash = await patch(ID.bruno, { email: 'ANA@aponta.test' });
      expect(clash.status).toBe(409);
      expect(h.row(ID.bruno).email).toBe('bruno@aponta.test');

      const own = await patch(ID.ana, { email: 'ANA@Aponta.test' });
      expect(own.status).toBe(200);
      expect(h.row(ID.ana).email).toBe('ana@aponta.test');
    });

    it.each([
      ['cliente', { organizationId: ID.missing }],
      ['grupo de atendentes', { technicalGroupId: ID.missing }],
      ['grupo de permissões', { permissionGroupIds: [ID.missing] }],
    ])('AC-09: %s inexistente responde 400 ou 404 e não altera o usuário', async (_label, payload) => {
      expect((await patch(ID.ana, { phone: '11900001111' })).status).toBe(200); // controle: edição válida passa
      const res = await patch(ID.ana, { name: 'Nome Que Não Pode Ficar', ...payload });
      expect([400, 404]).toContain(res.status);
      expect(h.row(ID.ana).name).toBe('Ana Souza');
    });

    it('AC-09: usuário inexistente responde 404', async () => {
      expect((await patch(ID.bruno, { name: 'Bruno Lima Filho' })).status).toBe(200); // controle
      expect((await patch(ID.missing, { name: 'X' })).status).toBe(404);
    });

    it.each([
      ['nome vazio', { name: '' }],
      ['nome como objeto', { name: { a: 1 } }],
      ['nome enorme', { name: 'a'.repeat(10_000) }],
      ['e-mail inválido', { email: 'x' }],
      ['tipo fora do enum', { role: 'BOGUS' }],
      ['grupos que não são UUID', { permissionGroupIds: ['x'] }],
      ['senha no corpo', { password: 'Senha#Qualquer1' }],
      ['campo desconhecido', { isAdmin: true }],
    ])('AC-09: %s responde 400', async (_label, payload) => {
      h.grant(ID.gestor, 'CHANGE_USER_ROLE');
      expect((await patch(ID.ana, { phone: '11900001111' })).status).toBe(200); // controle: edição válida passa
      const res = await patch(ID.ana, payload);
      expect(res.status).toBe(400);
      expect(h.row(ID.ana).name).toBe('Ana Souza');
    });
  });

  describe('PATCH /users/:id/active (AC-11)', () => {
    const setActive = (id: string, active: unknown, userId = ID.gestor) => h.as('patch', `/users/${id}/active`, userId).send({ active } as object);

    it('AC-11: exige ACTIVATE_DEACTIVATE_USERS; MANAGE_USERS sozinha responde 403', async () => {
      expect((await setActive(ID.bruno, false)).status).toBe(403);
      expect((await setActive(ID.bruno, false, ID.ana)).status).toBe(403);
      expect(h.row(ID.bruno).active).toBe(true);
    });

    it('AC-11: com a chave inativa e reativa', async () => {
      h.grant(ID.gestor, 'ACTIVATE_DEACTIVATE_USERS');
      const off = await setActive(ID.bruno, false);
      const on = await setActive(ID.diego, true);

      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ id: ID.bruno, active: false });
      expect(on.body).toMatchObject({ id: ID.diego, active: true });
      expect(h.row(ID.bruno).active).toBe(false);
      expect(h.row(ID.diego).active).toBe(true);
    });

    it('AC-11: ninguém inativa a si mesmo (409)', async () => {
      h.grant(ID.gestor, 'ACTIVATE_DEACTIVATE_USERS');
      const res = await setActive(ID.gestor, false);
      expect(res.status).toBe(409);
      expect(h.row(ID.gestor).active).toBe(true);
    });

    it('AC-11: não inativa o último ADMIN ativo (409), mas inativa um de dois', async () => {
      h.grant(ID.gestor, 'ACTIVATE_DEACTIVATE_USERS');
      expect((await setActive(ID.fabio, false)).status).toBe(200);

      const last = await setActive(ID.admin, false);
      expect(last.status).toBe(409);
      expect(h.row(ID.admin).active).toBe(true);
    });

    it('AC-11: usuário inexistente responde 404 e valor que não é booleano responde 400', async () => {
      h.grant(ID.gestor, 'ACTIVATE_DEACTIVATE_USERS');
      expect((await setActive(ID.missing, false)).status).toBe(404);
      expect((await setActive(ID.bruno, 'false')).status).toBe(400);
      expect(h.row(ID.bruno).active).toBe(true);
    });
  });

  describe('PATCH /users/active em lote (AC-11)', () => {
    const batch = (payload: unknown, userId = ID.gestor) => h.as('patch', '/users/active', userId).send(payload as object);
    beforeEach(() => h.grant(ID.gestor, 'ACTIVATE_DEACTIVATE_USERS'));

    it('AC-11: sem a chave responde 403', async () => {
      expect((await batch({ ids: [ID.diego], active: true })).status).toBe(200); // controle: com a chave passa
      expect((await batch({ ids: [ID.bruno], active: false }, ID.ana)).status).toBe(403);
      expect(h.row(ID.bruno).active).toBe(true);
    });

    it('AC-11: inativa e ativa vários de uma vez', async () => {
      expect((await batch({ ids: [ID.bruno, ID.ana], active: false })).status).toBe(200);
      expect([h.row(ID.bruno).active, h.row(ID.ana).active]).toEqual([false, false]);

      expect((await batch({ ids: [ID.bruno, ID.diego], active: true })).status).toBe(200);
      expect([h.row(ID.bruno).active, h.row(ID.diego).active]).toEqual([true, true]);
    });

    it('AC-11: aceita até 100 usuários por chamada', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`);
      ids.forEach((id, i) =>
        h.prisma.tables.user.push({ id, name: `Em Lote ${i}`, email: `lote${i}@aponta.test`, password: 'x', role: 'CLIENT', active: true }),
      );

      expect((await batch({ ids, active: false })).status).toBe(200);
      expect(h.prisma.tables.user.filter((u) => ids.includes(u.id) && u.active)).toHaveLength(0);
    });

    it('AC-11: tudo ou nada: um item inválido (último ADMIN) derruba o lote inteiro com 409', async () => {
      h.row(ID.fabio).active = false;
      const res = await batch({ ids: [ID.bruno, ID.admin], active: false });
      expect(res.status).toBe(409);
      expect(h.row(ID.bruno).active).toBe(true);
      expect(h.row(ID.admin).active).toBe(true);
    });

    it('AC-11: a regra do último ADMIN vale sobre o conjunto: inativar os dois ADMINs ativos de uma vez é 409', async () => {
      const res = await batch({ ids: [ID.admin, ID.fabio], active: false });
      expect(res.status).toBe(409);
      expect([h.row(ID.admin).active, h.row(ID.fabio).active]).toEqual([true, true]);
    });

    it('AC-11: o próprio usuário dentro do lote responde 409 e nada muda', async () => {
      const res = await batch({ ids: [ID.bruno, ID.gestor], active: false });
      expect(res.status).toBe(409);
      expect([h.row(ID.bruno).active, h.row(ID.gestor).active]).toEqual([true, true]);
    });

    it('AC-11: id inexistente no lote responde 400 ou 404 e nada muda', async () => {
      expect((await batch({ ids: [ID.diego], active: true })).status).toBe(200); // controle: lote válido passa
      const res = await batch({ ids: [ID.bruno, ID.missing], active: false });
      expect([400, 404]).toContain(res.status);
      expect(h.row(ID.bruno).active).toBe(true);
    });

    it.each([
      ['lista vazia', { ids: [], active: false }],
      ['mais de 100 ids', { ids: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(2000 + i).padStart(12, '0')}`), active: false }],
      ['id que não é UUID', { ids: ['abc'], active: false }],
      ['ids como texto', { ids: ID.bruno, active: false }],
      ['sem active', { ids: [ID.bruno] }],
      ['active como texto', { ids: [ID.bruno], active: 'false' }],
      ['campo desconhecido', { ids: [ID.bruno], active: false, role: 'ADMIN' }],
    ])('AC-11: %s responde 400', async (_label, payload) => {
      expect((await batch({ ids: [ID.diego], active: true })).status).toBe(200); // controle: lote válido passa
      const res = await batch(payload);
      expect(res.status).toBe(400);
      expect(h.row(ID.bruno).active).toBe(true);
    });
  });

  describe('GET /users/agents (AC-13)', () => {
    it('AC-13: não lista inativos nem usuários com convite pendente', async () => {
      const res = await h.as('get', '/users/agents');
      expect(res.status).toBe(200);
      expect(res.body.map((u: { name: string }) => u.name)).toEqual(['Admin Aponta', 'Ana Souza', 'Bruno Lima', 'Fábio Reis', 'Gestor Aponta']);
    });

    it('AC-13: o inativo continua legível pelo detalhe (nome do atendente em ticket antigo)', async () => {
      const res = await h.as('get', `/users/${ID.diego}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Diego Alves', active: false });
    });
  });

  describe('AC-28: nenhuma resposta da API de usuários traz senha nem hash', () => {
    it('AC-28: lista, detalhe, criação, edição, ativação, lote e atendentes', async () => {
      h.grant(ID.gestor, 'CREATE_USERS', 'ACTIVATE_DEACTIVATE_USERS');
      const responses = [
        await h.as('get', '/users'),
        await h.as('get', '/users?status=ACTIVE&page=1'),
        await h.as('get', `/users/${ID.ana}`),
        await h.as('post', '/users', ID.gestor).send({ name: 'Nova Pessoa', email: 'nova@aponta.test', role: 'AGENT' }),
        await h.as('patch', `/users/${ID.ana}`, ID.gestor).send({ phone: '11900000000' }),
        await h.as('patch', `/users/${ID.bruno}/active`, ID.gestor).send({ active: false }),
        await h.as('patch', '/users/active', ID.gestor).send({ ids: [ID.diego], active: true }),
        await h.as('get', '/users/agents'),
      ];

      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
        expect(res.text).not.toMatch(/"password"/);
        expect(res.text).not.toContain('$2');
        expect(res.text).not.toContain(OLD_PASSWORD);
      }
      expect(bcrypt.compareSync(OLD_PASSWORD, h.row(ID.ana).password)).toBe(true);
    });
  });
});
