#!/usr/bin/env node
// DMTE-550 AC-30: mede a tela Usuários (grade, painel de filtros, formulário e Novo usuário), o modal
// "Esqueci minha senha" do /login e a página /definir-senha em Chromium, a 1440×900, 1024×768 e 390×844.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend, sem e-mail, sem token real).
// Uso: node scripts/users_responsive_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert] [--only-users]
// Sai com 1 se alguma medição falhar (exceto com --no-assert, usado para capturar a base "antes").
// --only-users mede só a grade e o painel de filtros de /settings/users (a base "antes" ainda não tem o resto).
// Evidência técnica: jsdom não mede layout e o aceite visual é humano.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const TOUCH_MIN = 44; // alvo da toolbar do DS a 390 px
const BUTTON_MIN = 42; // botão `medium` do DS (EzButton h-[42px]); abaixo disso o botão foi encolhido
const FLAG = 'convite-e-redefinicao-usuario';
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'users-responsive-out');
const noAssert = args.includes('--no-assert');
const onlyUsers = args.includes('--only-users');

const longName = 'Maria Aparecida de Albuquerque Nascimento Figueiredo Sobrinha dos Santos Pereira';
const longEmail = 'maria.aparecida.albuquerque.nascimento.figueiredo.sobrinha@empresa-com-dominio-muito-comprido.com.br';
const technicalGroups = [
  { id: 'tg1', name: 'Suporte N1' },
  { id: 'tg2', name: 'Infraestrutura com um nome bem comprido para testar a quebra' },
];
const permissionGroups = [
  { id: 'pg1', name: 'Atendimento' },
  { id: 'pg2', name: 'Administração de usuários e de convites' },
  { id: 'pg3', name: 'Financeiro' },
];
const base = { phone: '11 99999-0000', extension: '204', organizationId: null };
const users = [
  { ...base, id: 'u1', name: 'Ana Silva', email: 'ana@example.com', role: 'AGENT', active: true, pending: false, technicalGroup: technicalGroups[0], permissionGroups: [permissionGroups[0], permissionGroups[1]] },
  { ...base, id: 'u2', name: 'Bruno Costa', email: 'bruno@example.com', role: 'CLIENT', active: false, pending: false, organizationId: 'o1', technicalGroup: null, permissionGroups: [] },
  { ...base, id: 'u3', name: 'Carla Dias', email: 'carla@example.com', role: 'AGENT_MASTER', active: true, pending: true, technicalGroup: technicalGroups[1], permissionGroups: [permissionGroups[2]] },
  { ...base, id: 'u4', name: longName, email: longEmail, role: 'CLIENT_MASTER', active: true, pending: false, organizationId: 'o1', technicalGroup: null, permissionGroups: [] },
];
const organizations = [{ id: 'o1', name: 'Alfa Tecnologia' }, { id: 'o2', name: 'Beta Comércio' }];
const TOKEN = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const { pathname } = new URL(url);
  const p = pathname.replace(/^\/api/, '');
  if (p === '/feature-flags') return { [FLAG]: true };
  if (p === '/auth/me') return { id: 'u1', isAdmin: true, permissions: [], canViewTicketValues: false };
  if (p === '/users') return { data: users, meta: { total: users.length, page: 1, pageSize: 20, totalPages: 1 } };
  if (p.startsWith('/users/')) return users.find((u) => p === `/users/${u.id}`) ?? users[0];
  if (p === '/technical-groups') return technicalGroups;
  if (p === '/permission-groups') return permissionGroups;
  if (p === '/organizations') return organizations;
  if (p.startsWith('/me/screen-preferences/')) return {};
  return /s$/.test(p) ? [] : {};
}

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startVite() {
  const port = await freePort();
  // vite direto (não via pnpm) e em grupo próprio: matar o grupo derruba só o servidor que subimos aqui.
  const child = spawn(path.resolve('node_modules/.bin/vite'), ['--port', String(port), '--strictPort'], {
    cwd: path.resolve('apps/web'),
    env: { ...process.env, WEB_PORT: String(port) },
    stdio: 'ignore',
    detached: true,
  });
  const stop = () => process.kill(-child.pid);
  const url = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return { url, stop };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stop();
  throw new Error('Vite did not start');
}

/** Roda na página: rolagem horizontal da página inteira. */
function measurePage() {
  const doc = document.documentElement;
  return { overflow: Math.max(doc.scrollWidth - window.innerWidth, 0), scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
}

/** Roda na página: o elemento (por texto de botão) está dentro da janela e qual o tamanho do alvo. */
function measureButton({ text, scope }) {
  const root = scope ? document.querySelector(scope) : document;
  const button = Array.from(root?.querySelectorAll('button') ?? []).find((b) => b.textContent.trim() === text);
  if (!button) return null;
  const r = button.getBoundingClientRect();
  return {
    width: Math.round(r.width),
    height: Math.round(r.height),
    inView: r.left >= -0.5 && r.right <= window.innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5,
    disabled: button.disabled,
  };
}

/** Roda na página de Usuários (grade): colunas visíveis, status e alvos de toque da toolbar. */
function measureGrid({ narrow, touchMin }) {
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const headers = Array.from(document.querySelectorAll('th')).map((th) => ({ text: th.textContent.trim(), shown: getComputedStyle(th).display !== 'none' && th.getBoundingClientRect().width > 0 }));
  const scrollerOf = (el) => {
    let scroller = el.parentElement;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    return scroller;
  };
  // Nome visível: o começo de cada nome está dentro da área rolável da grade (e esta dentro da janela).
  const nameButtons = Array.from(document.querySelectorAll('tbody tr td button')).filter((b) => /Silva|Costa|Dias|Maria/.test(b.textContent));
  const nameInView = nameButtons.length > 0 && nameButtons.every((b) => {
    const r = rect(b);
    const s = rect(scrollerOf(b));
    return r.width > 0 && r.left >= s.left - 1 && r.left <= s.right - 24 && s.right <= window.innerWidth + 1;
  });
  // O nome longo alarga a coluna além do `size` dela? (a coluna Nome não tem `meta.truncate`)
  const nameCellMax = Math.max(...Array.from(document.querySelectorAll('tbody tr td')).filter((td) => td.querySelector('button')).map((td) => Math.round(rect(td).width)));
  const tags = ['Ativo', 'Inativo', 'Convite pendente'].map((text) => ({
    text,
    count: Array.from(document.querySelectorAll('tbody tr td')).filter((td) => td.textContent.trim() === text).length,
  }));
  const statusInView = Array.from(document.querySelectorAll('tbody tr td')).every((td) => {
    if (!/^(Ativo|Inativo|Convite pendente)$/.test(td.textContent.trim())) return true;
    const pill = rect(td.firstElementChild);
    return pill.width > 0 && pill.right <= rect(scrollerOf(td)).right + 1;
  });
  // Limite aceito a 390 px: a coluna Status pode ficar cortada, mas precisa começar à vista com pelo menos 24 px.
  const statusStartsInView = Array.from(document.querySelectorAll('tbody tr td')).every((td) => {
    if (!/^(Ativo|Inativo|Convite pendente)$/.test(td.textContent.trim())) return true;
    return rect(td.firstElementChild).left + 24 <= rect(scrollerOf(td)).right;
  });
  const toolbar = document.querySelector('[data-testid="ez-entity-toolbar"]');
  const buttons = toolbar ? Array.from(toolbar.querySelectorAll('button')).map((b) => rect(b)) : [];
  return {
    headers,
    nameInView,
    statusInView,
    statusStartsInView,
    tags,
    rows: document.querySelectorAll('tbody tr').length,
    nameCellMax,
    // botões da toolbar na mesma linha (o contador "1 - 4 de 4" fica numa linha à parte abaixo de 640 px, DMTE-531)
    toolbarRows: new Set(buttons.filter((r) => r.width > 0).map((r) => Math.round(r.top / 8))).size,
    smallTargets: narrow ? buttons.filter((r) => r.width < touchMin - 0.5 || r.height < touchMin - 0.5).length : 0,
  };
}

async function gridWidth(page) {
  return page.getByTestId('users-grid-content').evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const notes = [];
  const check = (label, problems) => report.push({ label, ok: problems.length === 0, problems });
  const pageOverflow = (m, where = '') => (m.overflow > 0 ? [`rolagem horizontal${where}: +${m.overflow} px (scrollWidth ${m.scrollWidth} > ${m.innerWidth})`] : []);
  try {
    for (const { width, height } of SIZES) {
      const narrow = width < 640;
      const newContext = async (token) => {
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: narrow });
        if (token) {
          await context.addInitScript((t) => {
            window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token: t }, version: 0 }));
          }, fakeJwt());
        }
        const page = await context.newPage();
        await page.route('**/api/**', (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().url())) }),
        );
        return { context, page };
      };

      // ---- Usuários (autenticado) ----
      {
        const { context, page } = await newContext(true);
        const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });

        // (1) grade
        await page.goto(`${baseUrl}/settings/users`);
        await page.getByText('Ana Silva').first().waitFor();
        await page.waitForTimeout(200);
        let problems = [];
        const grid = await page.evaluate(measureGrid, { narrow, touchMin: TOUCH_MIN });
        problems.push(...pageOverflow(await page.evaluate(measurePage)));
        for (const tag of grid.tags) if (tag.count < 1) problems.push(`a grade não mostra nenhum "${tag.text}"`);
        if (!grid.nameInView) problems.push('Nome fora da tela');
        if (narrow && !grid.statusStartsInView) problems.push('Status fora da tela (a coluna Status nem começa na área visível da grade)');
        if (narrow && grid.statusStartsInView && !grid.statusInView) notes.push(`${width} px: a coluna Status aparece cortada; o resto só rolando a grade (limite aceito)`);
        if (!narrow && !grid.statusInView) notes.push(`${width} px: a coluna Status fica além da área visível da grade (rolagem interna da grade, não da página)`);
        if (grid.nameCellMax > 170 + 1) notes.push(`${width} px: a coluna Nome (size 170) chegou a ${grid.nameCellMax} px com nome e e-mail longos (o cabeçalho com ordenar, filtrar e menu já fixa uma largura mínima)`);
        if (narrow) {
          for (const name of ['Nome', 'Status']) {
            if (!grid.headers.find((h) => h.text === name)?.shown) problems.push(`coluna "${name}" deveria aparecer a 390 px`);
          }
          if (grid.toolbarRows > 1) problems.push('botões da toolbar em mais de uma linha');
          if (grid.smallTargets > 0) problems.push(`${grid.smallTargets} botões da toolbar abaixo de ${TOUCH_MIN} px`);
        }
        await shot('usuarios-grade');
        check(`Usuários grade ${width} px (${grid.rows} linhas)`, problems);

        // (2) painel de filtros (a base "antes" da DMTE-550 ainda não tem a toolbar do DS: só a grade é medida)
        if (onlyUsers && (await page.getByTestId('ez-toolbar-filter-panel-button').count()) === 0) {
          notes.push(`${width} px: esta versão da tela não tem painel de filtros; medida só a grade`);
          await context.close();
          continue;
        }
        problems = [];
        const before = await gridWidth(page);
        await page.getByTestId('ez-toolbar-filter-panel-button').click();
        await page.getByTestId('ez-filter-drawer').waitFor();
        await page.waitForTimeout(300);
        const after = await gridWidth(page);
        problems.push(...pageOverflow(await page.evaluate(measurePage), ' com o painel aberto'));
        if (width < 1280 && Math.abs(before - after) > 1) problems.push(`o painel estreitou a grade: ${before} → ${after} px`);
        if (width >= 1280 && after >= before) problems.push('a partir de xl o painel deveria ficar ao lado da grade');
        // as opções de Tipo formam uma lista vertical: duas na mesma linha estão coladas uma na outra
        const panel = await page.evaluate(() => {
          const boxes = Array.from(document.querySelectorAll('[id^="filter-role-"]')).map((el) => (el.closest('label') ?? el.parentElement).getBoundingClientRect());
          const drawer = document.querySelector('[data-testid="ez-filter-drawer"]');
          return {
            roleRows: new Set(boxes.map((r) => Math.round(r.top / 6))).size,
            roles: boxes.length,
            drawerScrolls: drawer ? Array.from(drawer.querySelectorAll('*')).some((el) => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) || drawer.scrollHeight > drawer.clientHeight + 1 : null,
          };
        });
        if (panel.roleRows < panel.roles) problems.push(`opções de Tipo do painel em ${panel.roleRows} linhas para ${panel.roles} opções (duas coladas na mesma linha)`);
        await shot('usuarios-filtros');
        check(`Usuários com painel de filtros ${width} px (grade ${before} → ${after} px)`, problems);

        if (!onlyUsers) {
          // (3) formulário de um usuário existente: abas Geral e Segurança (nome comprido: pior caso)
          await page.goto(`${baseUrl}/settings/users`);
          await page.getByText('Ana Silva').first().waitFor();
          await page.getByText('Ana Silva').first().click();
          await page.getByRole('tab', { name: 'Geral' }).waitFor();
          await page.waitForTimeout(200);
          problems = [];
          problems.push(...pageOverflow(await page.evaluate(measurePage)));
          const save = await page.evaluate(measureButton, { text: 'Salvar' });
          if (!save) problems.push('botão Salvar não encontrado');
          await shot('usuario-formulario-geral');
          check(`Formulário do usuário, aba Geral ${width} px`, problems);

          await page.getByRole('tab', { name: 'Segurança' }).click();
          await page.getByText('Situação').waitFor();
          await page.waitForTimeout(150);
          problems = pageOverflow(await page.evaluate(measurePage));
          await shot('usuario-formulario-seguranca');
          check(`Formulário do usuário, aba Segurança ${width} px`, problems);

          // formulário do usuário com convite pendente e nome/e-mail compridos
          await page.goto(`${baseUrl}/settings/users`);
          await page.getByText(longName).first().waitFor();
          await page.getByText(longName).first().click();
          await page.getByRole('tab', { name: 'Geral' }).waitFor();
          await page.waitForTimeout(150);
          problems = pageOverflow(await page.evaluate(measurePage));
          await shot('usuario-formulario-nome-longo');
          check(`Formulário do usuário com nome e e-mail longos ${width} px`, problems);

          // botão primário do formulário: dentro da janela depois de rolar até ele
          await page.getByRole('button', { name: 'Salvar', exact: true }).scrollIntoViewIfNeeded();
          const saveBtn = await page.evaluate(measureButton, { text: 'Salvar' });
          problems = [];
          if (!saveBtn) problems.push('botão Salvar não encontrado');
          else {
            if (!saveBtn.inView) problems.push('botão Salvar fora da janela mesmo depois de rolar até ele');
            if (saveBtn.height < BUTTON_MIN) problems.push(`botão Salvar com ${saveBtn.height} px de altura (mínimo do DS ${BUTTON_MIN})`);
            if (narrow && saveBtn.height < TOUCH_MIN) notes.push(`${width} px: botão primário Salvar do formulário tem ${saveBtn.height} px de altura (EzButton medium = 42 px; a toolbar do DS exige ${TOUCH_MIN} px)`);
          }
          check(`Botão Salvar acessível ${width} px (${saveBtn?.width}×${saveBtn?.height} px)`, problems);

          // Novo usuário
          await page.goto(`${baseUrl}/settings/users`);
          await page.getByText('Ana Silva').first().waitFor();
          await page.getByTestId('ez-toolbar-insert-button').scrollIntoViewIfNeeded();
          await page.getByTestId('ez-toolbar-insert-button').click();
          await page.getByRole('heading', { name: 'Novo usuário' }).waitFor();
          await page.waitForTimeout(200);
          problems = pageOverflow(await page.evaluate(measurePage));
          await shot('usuario-novo');
          check(`Novo usuário ${width} px`, problems);
        }
        await context.close();
      }

      if (onlyUsers) continue;

      // ---- Login com o modal "Esqueci minha senha" (público, flag ligada por interceptação) ----
      {
        const { context, page } = await newContext(false);
        const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
        await page.goto(`${baseUrl}/login`);
        await page.getByRole('button', { name: 'Esqueci minha senha' }).waitFor();
        let problems = pageOverflow(await page.evaluate(measurePage));
        await shot('login');
        check(`Login ${width} px`, problems);

        await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
        await page.getByRole('dialog').waitFor();
        await page.waitForTimeout(300);
        problems = pageOverflow(await page.evaluate(measurePage), ' com o modal aberto');
        const dialog = await page.getByRole('dialog').boundingBox();
        if (!dialog || dialog.x < -0.5 || dialog.x + dialog.width > width + 0.5 || dialog.y < -0.5 || dialog.y + dialog.height > height + 0.5) {
          problems.push('modal fora da janela');
        }
        const send = await page.evaluate(measureButton, { text: 'Enviar', scope: '[role="dialog"]' });
        if (!send) problems.push('botão Enviar do modal não encontrado');
        else {
          if (!send.inView) problems.push('botão Enviar fora da janela');
          if (send.height < BUTTON_MIN) problems.push(`botão Enviar com ${send.height} px de altura (mínimo do DS ${BUTTON_MIN})`);
          if (narrow && send.height < TOUCH_MIN) notes.push(`${width} px: botão primário Enviar do modal tem ${send.height} px de altura (EzButton medium = 42 px; a toolbar do DS exige ${TOUCH_MIN} px)`);
        }
        await shot('login-esqueci-senha');
        check(`Login com modal Esqueci minha senha ${width} px (Enviar ${send?.width}×${send?.height} px)`, problems);
        await context.close();
      }

      // ---- /definir-senha (público): formulário e link inválido ----
      {
        const { context, page } = await newContext(false);
        const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
        await page.goto(`${baseUrl}/definir-senha#t=${TOKEN}`);
        await page.getByLabel('Nova senha').waitFor();
        await page.waitForTimeout(200);
        let problems = pageOverflow(await page.evaluate(measurePage));
        const urlAfter = page.url();
        if (urlAfter.includes('#') || urlAfter.includes(TOKEN) || urlAfter.includes('t=')) problems.push(`o fragmento #t= continua na URL: ${urlAfter.replace(TOKEN, '<token>')}`);
        const hash = await page.evaluate(() => window.location.hash);
        if (hash !== '') problems.push(`window.location.hash = "${hash}" (esperado vazio)`);
        const btn = await page.evaluate(measureButton, { text: 'Definir senha' });
        if (!btn) problems.push('botão Definir senha não encontrado');
        else {
          if (!btn.inView) problems.push('botão Definir senha fora da janela');
          if (btn.height < BUTTON_MIN) problems.push(`botão Definir senha com ${btn.height} px de altura (mínimo do DS ${BUTTON_MIN})`);
          if (narrow && btn.height < TOUCH_MIN) notes.push(`${width} px: botão primário Definir senha tem ${btn.height} px de altura (EzButton medium = 42 px; a toolbar do DS exige ${TOUCH_MIN} px)`);
        }
        await shot('definir-senha-formulario');
        check(`/definir-senha formulário ${width} px (fragmento apagado: ${!urlAfter.includes('#')}; botão ${btn?.width}×${btn?.height} px)`, problems);

        // link inválido: fragmento mal formado (o token também é apagado da URL)
        // about:blank antes: o mesmo caminho só com outro fragmento seria navegação no mesmo documento, sem recarregar.
        await page.goto('about:blank');
        await page.goto(`${baseUrl}/definir-senha#t=curto`);
        await page.getByText('Link inválido ou expirado.').waitFor();
        problems = pageOverflow(await page.evaluate(measurePage));
        if (page.url().includes('#') || page.url().includes('t=')) problems.push(`o fragmento continua na URL: ${page.url()}`);
        await shot('definir-senha-invalido');
        check(`/definir-senha link inválido ${width} px`, problems);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { report, notes };
}

const external = option('--url');
const server = external ? { url: external, stop: () => {} } : await startVite();
let result;
try {
  result = await run(server.url);
} finally {
  server.stop();
}
for (const row of result.report) {
  console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${row.label}${row.problems.map((p) => `\n       - ${p}`).join('')}`);
}
for (const note of result.notes) console.log(`NOTA ${note}`);
console.log(`Capturas em ${outDir}`);
process.exit(noAssert || result.report.every((row) => row.ok) ? 0 : 1);
