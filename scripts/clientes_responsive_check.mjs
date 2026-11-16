#!/usr/bin/env node
// DMTE-541 AC-13: mede Clientes, Mesa, Contratos e as 7 páginas do cabeçalho compacto em Chromium,
// a 1440×900, 1024×768 e 390×844. A API é interceptada no navegador com dados SINTÉTICOS (sem backend).
// Uso: node scripts/clientes_responsive_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert]
// Sai com 1 se alguma medição falhar (exceto com --no-assert, usado para capturar a base "antes").
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
const HEADER_PAGES = [
  ['Clientes', '/organizations'],
  ['Usuários', '/settings/users'],
  ['Contratos', '/contracts'],
  ['Mesa', '/service-desks'],
  ['Grupos técnicos', '/settings/technical-groups'],
  ['Grupos de permissão', '/settings/permission-groups'],
  ['Tarefas agendadas', '/settings/scheduled-jobs'],
];
const HEADER_MAX = 56;
const TOUCH_MIN = 44;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'clientes-responsive-out');
const noAssert = args.includes('--no-assert');

const longName = 'Associação Beneficente dos Moradores e Amigos do Bairro Jardim das Acácias Ltda';
const organizations = [
  { id: 'o1', name: 'Alfa Tecnologia', legalName: 'Alfa Tecnologia da Informação Ltda', cnpj: '19131243000197', documentType: 'CNPJ', active: true, _count: { users: 7 } },
  { id: 'o2', name: 'Beta Comércio', legalName: 'Beta Comércio de Alimentos ME', cpf: '12345678901', documentType: 'CPF', active: false, _count: { users: 3 } },
  { id: 'o3', name: longName, legalName: longName, cnpj: '11222333000181', documentType: 'CNPJ', active: true, _count: { users: 0 } },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `o${i + 4}`, name: `Cliente ${i + 4}`, legalName: `Cliente ${i + 4} Serviços Ltda`, cnpj: `1122233300${String(i + 10).padStart(4, '0')}`, documentType: 'CNPJ', active: i % 4 !== 0, _count: { users: i },
  })),
];
const contracts = Array.from({ length: 4 }, (_, i) => ({
  id: `c${i}`, organizationId: `o${i + 1}`, organization: { name: organizations[i].name }, type: i % 2 ? 'COVERAGE' : 'HOURS_LIMIT', active: i !== 1,
  monthlyValue: 5000 + i * 100, hoursLimit: 40, adjustmentDate: '2026-01-15T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z',
}));
const serviceDesks = ['Suporte N1', 'Infraestrutura com um nome bem comprido para testar a quebra', 'Financeiro'].map((name, i) => ({
  id: `sd${i}`, name, createdAt: '2026-09-29T10:00:00.000Z', active: i !== 2, receiving: true, ticketSections: [],
}));
const users = [
  { id: 'u1', name: 'Ana Silva', email: 'ana@example.com', role: 'AGENT', active: true, organizationId: null, technicalGroup: { id: 'tg', name: 'Suporte N1' }, permissionGroups: [] },
  { id: 'u2', name: 'Bruno Costa', email: 'bruno@example.com', role: 'CLIENT', active: false, organizationId: 'o1', technicalGroup: null, permissionGroups: [] },
];

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const { pathname, search } = new URL(url);
  const p = pathname.replace(/^\/api/, '');
  if (p === '/organizations') return organizations;
  if (p.startsWith('/organizations/')) return { ...organizations[0], users: [], addresses: [], contacts: [], serviceDesks: [], agentGroups: [] };
  if (p === '/users') return search ? { data: users, meta: { total: 2, page: 1, pageSize: 20, totalPages: 1 } } : users;
  if (p === '/contracts') return contracts;
  if (p === '/service-desks') return serviceDesks;
  return /s$/.test(p) || search ? [] : {};
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

/** Roda na página: devolve cabeçalho e rolagem horizontal. */
function measurePage() {
  const doc = document.documentElement;
  const h1 = document.querySelector('h1');
  const header = h1?.closest('div.border-b');
  return {
    overflow: doc.scrollWidth - window.innerWidth,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
  };
}

/** Roda na página de Clientes (lista): linhas, colunas e alvos de toque. */
function measureClientes({ narrow }) {
  const rows = Array.from(document.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('td'));
  const heights = rows.map((tr) => Math.round(tr.getBoundingClientRect().height));
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const visibleCell = (selector) => {
    const el = document.querySelector(selector);
    const r = rect(el);
    return !!r && r.width > 0 && r.right <= window.innerWidth + 1 && r.left >= -1;
  };
  const headers = Array.from(document.querySelectorAll('th')).map((th) => ({ text: th.textContent.trim(), shown: getComputedStyle(th).display !== 'none' }));
  const toolbar = document.querySelector('[data-testid="ez-entity-toolbar"]');
  const buttons = toolbar ? Array.from(toolbar.querySelectorAll('button')).map((b) => rect(b)) : [];
  return {
    heights,
    headers,
    nameInView: visibleCell('tbody tr td button[aria-label^="Abrir cadastro"]'),
    // a pílula de status inteira dentro da área rolável da grade, não só da janela
    statusInView: Array.from(document.querySelectorAll('tbody tr td')).every((td) => {
      if (!/^(Ativo|Inativo)$/.test(td.textContent.trim())) return true;
      let scroller = td.parentElement;
      while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
      const pill = rect(td.firstElementChild);
      return pill.width > 0 && pill.right <= rect(scroller).right + 1;
    }),
    toolbarHeight: toolbar ? Math.round(rect(toolbar).height) : null,
    smallTargets: narrow ? buttons.filter((r) => r.width < 43.5 || r.height < 43.5).length : 0,
  };
}

async function gridWidth(page) {
  return page.getByTestId('organizations-grid-content').evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const check = (label, problems) => report.push({ label, ok: problems.length === 0, problems });
  try {
    for (const { width, height } of SIZES) {
      const narrow = width < 640;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: narrow });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().url())) }),
      );
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });

      // Clientes: lista e painel de filtros
      await page.goto(`${baseUrl}/organizations`);
      await page.getByText('Alfa Tecnologia').first().waitFor();
      let problems = [];
      const list = await page.evaluate(measureClientes, { narrow });
      const page0 = await page.evaluate(measurePage);
      if (page0.overflow > 0) problems.push(`rolagem horizontal da página: +${page0.overflow} px`);
      if (new Set(list.heights).size > 1) problems.push(`linhas com alturas diferentes: ${[...new Set(list.heights)].join(', ')} px`);
      if (narrow) {
        if (!list.nameInView) problems.push('Nome fora da tela');
        if (!list.statusInView) problems.push('Status fora da tela');
        for (const name of ['#', 'Razão Social', 'CPF / CNPJ']) {
          if (list.headers.find((h) => h.text === name)?.shown) problems.push(`coluna "${name}" deveria estar escondida`);
        }
        if (list.toolbarHeight > 64) problems.push(`toolbar em mais de uma linha: ${list.toolbarHeight} px`);
        if (list.smallTargets > 0) problems.push(`${list.smallTargets} botões da toolbar abaixo de 44 px`);
      }
      await shot('clientes');
      check(`Clientes ${width} px`, problems);

      if (narrow) {
        // o menu "Ações" abre como folha na base da tela e não é cortado pela toolbar que rola
        const menuProblems = [];
        await page.getByTestId('ez-toolbar-actions-button').scrollIntoViewIfNeeded();
        await page.getByTestId('ez-toolbar-actions-button').click();
        const menu = page.getByTestId('ez-toolbar-actions-dropdown');
        await menu.waitFor();
        const box = await menu.boundingBox();
        if (!box || box.x < -0.5 || box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5) menuProblems.push('menu Ações fora da tela');
        await shot('clientes-menu-acoes');
        await page.keyboard.press('Escape');
        await page.mouse.click(5, 5);
        check(`Menu Ações ${width} px`, menuProblems);
      }

      problems = [];
      const before = await gridWidth(page);
      await page.getByTestId('ez-toolbar-filter-panel-button').click();
      await page.getByTestId('ez-filter-drawer').waitFor();
      const after = await gridWidth(page);
      const withPanel = await page.evaluate(measurePage);
      if (withPanel.overflow > 0) problems.push(`rolagem horizontal com o painel aberto: +${withPanel.overflow} px`);
      if (width < 1280 && Math.abs(before - after) > 1) problems.push(`o painel estreitou a grade: ${before} → ${after} px`);
      if (width >= 1280 && after >= before) problems.push('a partir de xl o painel deveria ficar ao lado da grade');
      await shot('clientes-filtros');
      check(`Clientes com painel ${width} px (grade ${before} → ${after} px)`, problems);

      // Mesa e Contratos com o painel aberto
      for (const [name, route] of [['Mesa', '/service-desks'], ['Contratos', '/contracts']]) {
        await page.goto(`${baseUrl}${route}`);
        await page.getByTestId('ez-toolbar-filter-panel-button').waitFor();
        await page.getByTestId('ez-toolbar-filter-panel-button').click();
        await page.getByTestId('ez-filter-drawer').waitFor();
        const m = await page.evaluate(measurePage);
        await shot(`${name.toLowerCase()}-filtros`);
        check(`${name} com painel ${width} px`, m.overflow > 0 ? [`rolagem horizontal: +${m.overflow} px`] : []);
      }

      // Cabeçalho compacto nas 7 páginas
      for (const [name, route] of HEADER_PAGES) {
        await page.goto(`${baseUrl}${route}`);
        await page.locator('h1').first().waitFor();
        await page.waitForTimeout(150);
        const m = await page.evaluate(measurePage);
        const issues = [];
        if (m.overflow > 0) issues.push(`rolagem horizontal: +${m.overflow} px`);
        if (m.headerHeight === null) issues.push('cabeçalho não encontrado');
        else if (m.headerHeight > HEADER_MAX) issues.push(`cabeçalho com ${m.headerHeight} px (máximo ${HEADER_MAX})`);
        await shot(`pagina-${route.replace(/\//g, '-').slice(1)}`);
        check(`Cabeçalho ${name} ${width} px (${m.headerHeight} px)`, issues);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return report;
}

const external = option('--url');
const server = external ? { url: external, stop: () => {} } : await startVite();
let report;
try {
  report = await run(server.url);
} finally {
  server.stop();
}
for (const row of report) {
  console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${row.label}${row.problems.map((p) => `\n       - ${p}`).join('')}`);
}
console.log(`Capturas em ${outDir}`);
process.exit(noAssert || report.every((row) => row.ok) ? 0 : 1);
