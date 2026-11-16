#!/usr/bin/env node
// DMTE-531 AC-05/AC-06: mede a toolbar e as abas da Mesa em Chromium, a 1440×900, 1024×768 e 390×844.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não mede layout.
// Uso: node scripts/mesa_responsive_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert] [--json <arquivo>]
// Sai com 1 se alguma medição falhar (exceto com --no-assert, usado para capturar a base "antes").
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'mesa-responsive-out');
const jsonOut = option('--json');
const noAssert = args.includes('--no-assert');

const serviceDesks = ['Suporte N1', 'Infraestrutura', 'Financeiro', 'Comercial'].map((name, i) => ({
  id: `sd${i}`, name, createdAt: '2026-09-29T10:00:00.000Z', active: i !== 2, acceptingNewTickets: true, ticketSections: [], organizations: [], agentGroups: [],
}));
const contracts = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`, organizationId: `o${i}`, organization: { name: `Cliente ${i}` }, type: i % 2 ? 'COVERAGE' : 'HOURS_LIMIT', active: i !== 1,
  monthlyValue: 5000 + i * 100, hoursLimit: 40, adjustmentDate: '2026-01-15T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z',
}));
const organizations = Array.from({ length: 6 }, (_, i) => ({
  id: `o${i}`, name: `Cliente ${i}`, legalName: `Cliente ${i} Ltda`, cnpj: `1122233300${String(i + 10).padStart(4, '0')}`, documentType: 'CNPJ', active: true, _count: { users: i },
}));

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  if (p === '/service-desks') return serviceDesks;
  if (p === '/contracts') return contracts;
  if (p === '/organizations') return organizations;
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

/** Roda na página: toolbar (altura, linhas, contador) e retângulos dos botões. */
function measureToolbar() {
  const toolbar = document.querySelector('[data-testid="ez-entity-toolbar"]');
  const count = document.querySelector('[data-testid="ez-toolbar-record-count"]');
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
  };
  const cr = count?.getBoundingClientRect();
  return {
    height: Math.round(toolbar.getBoundingClientRect().height),
    countText: count ? count.textContent.trim() : null,
    // contador inteiro dentro da janela e sem precisar rolar a toolbar (sem contador, não há o que cortar)
    countFullyVisible: !count || (cr.left >= -0.5 && cr.right <= window.innerWidth + 0.5 && cr.width >= count.scrollWidth - 1),
    // linhas distintas ocupadas por botões e contador (cada linha = um top diferente)
    rows: new Set([...toolbar.querySelectorAll('button'), ...(count ? [count] : [])].map((el) => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) / 24))).size,
    rects: Object.fromEntries([...toolbar.querySelectorAll('[data-testid]')].map((el) => [el.dataset.testid, r(el)])),
  };
}

/** Roda na página de detalhe da Mesa: abas e início do formulário. */
function measureTabs() {
  const tablist = document.querySelector('[role="tablist"]:not([aria-label])');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const tops = new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)));
  const field = document.querySelector('#mesa-display-name');
  const active = tablist.querySelector('[aria-selected="true"]');
  const tr = tablist.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  return {
    tabCount: tabs.length,
    rows: tops.size,
    tablistHeight: Math.round(tr.height),
    scrollable: tablist.scrollWidth > tablist.clientWidth + 1,
    formFieldTop: field ? Math.round(field.getBoundingClientRect().top) : null,
    activeInside: ar.left >= tr.left - 1 && ar.right <= tr.right + 1,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const data = {};
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

      // Toolbar nas três telas que usam o EzEntityToolbar (lista) e no formulário da Mesa
      // Contratos e Clientes só mostram o contador ("1 de N") no formulário: medir também lá
      for (const [name, route, waitFor, openForm] of [
        ['mesa', '/service-desks', 'Suporte N1', null],
        ['contratos', '/contracts', 'Cliente 0', () => page.getByRole('button', { name: /Ver detalhes/ }).first().click()],
        ['clientes', '/organizations', 'Cliente 0', () => page.getByRole('button', { name: /Abrir cadastro/ }).first().click()],
      ]) {
        await page.goto(`${baseUrl}${route}`);
        await page.getByText(waitFor).first().waitFor();
        for (const stage of openForm ? ['lista', 'formulario'] : ['lista']) {
          if (stage === 'formulario') {
            await openForm();
            await page.getByTestId('ez-toolbar-record-count').waitFor();
          }
          const m = await page.evaluate(measureToolbar);
          data[`${name}-${stage}-${width}`] = m;
          const problems = [];
          if (narrow) {
            if (m.rows > 2) problems.push(`toolbar com ${m.rows} linhas (máximo 2)`);
            if (!m.countFullyVisible) problems.push(`contador "${m.countText}" cortado ou fora da tela`);
            if (stage === 'formulario' && m.countText === null) problems.push('contador ausente no formulário');
          }
          await shot(`toolbar-${name}-${stage}`);
          check(`Toolbar ${name} (${stage}) ${width} px (${m.rows} linha(s), ${m.height} px, contador ${m.countText ?? 'ausente'})`, problems);
        }
      }

      // Detalhe da Mesa: abas e início do formulário
      await page.goto(`${baseUrl}/service-desks`);
      await page.getByText('Suporte N1').first().waitFor();
      await page.getByRole('button', { name: 'Suporte N1' }).first().click();
      await page.locator('[role="tablist"]:not([aria-label])').waitFor();
      const t = await page.evaluate(measureTabs);
      data[`abas-${width}`] = t;
      const tb = await page.evaluate(measureToolbar);
      data[`mesa-form-toolbar-${width}`] = tb;
      const problems = [];
      if (t.pageOverflow > 0) problems.push(`rolagem horizontal da página: +${t.pageOverflow} px`);
      if (narrow) {
        if (t.rows !== 1) problems.push(`abas em ${t.rows} linhas (esperado 1)`);
        if (!t.scrollable) problems.push('abas sem rolagem horizontal');
        if (t.formFieldTop === null || t.formFieldTop > height) problems.push(`formulário começa em ${t.formFieldTop} px, fora da primeira tela (${height} px)`);
        if (!t.activeInside) problems.push('aba ativa fora da área visível das abas');
        if (tb.rows > 2) problems.push(`toolbar do formulário com ${tb.rows} linhas (máximo 2)`);
        if (!tb.countFullyVisible) problems.push(`contador "${tb.countText}" cortado no formulário`);
      }
      await shot('mesa-form');
      check(`Abas da Mesa ${width} px (${t.rows} linha(s), formulário em ${t.formFieldTop} px)`, problems);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (jsonOut) writeFileSync(path.resolve(jsonOut), `${JSON.stringify(data, null, 2)}\n`);
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
