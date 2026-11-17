#!/usr/bin/env node
// DMTE-532 AC-07: mede foco e semântica das abas da Mesa em Chromium, a 1440×900 e 390×844.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não resolve utilidade de contorno nem layout.
// Uso: node scripts/mesa_focus_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert] [--json <arquivo>]
// Sai com 1 se alguma medição falhar (exceto com --no-assert, usado para capturar a base "antes").
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const FOCUS = 'rgb(0, 133, 97)'; // brand-600 (#008561), token de foco do DS
const FIRST_TAB = 'Informações básicas';
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'mesa-focus-out');
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

// As abas e o checkbox têm `transition-colors` (150 ms): medir só depois da transição, senão a cor do contorno vem no meio do caminho.
const settle = (page) => page.waitForTimeout(400);

/** Estilo do indicador de foco do elemento focado (contorno do token e, na base antiga, o anel em box-shadow). */
function focusStyle() {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const list = el.closest('[role="tablist"]');
  const lr = list?.getBoundingClientRect();
  return {
    role: el.getAttribute('role'),
    label: (el.textContent || '').trim().slice(0, 40) || el.getAttribute('aria-label') || el.id,
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    boxShadow: cs.boxShadow,
    // anel por dentro da caixa da aba, dentro da lista que rola (nada cortado)
    insideList: lr ? r.top >= lr.top - 0.5 && r.bottom <= lr.bottom + 0.5 : null,
  };
}

function tabState() {
  const tablist = document.querySelector('[role="tablist"]:not([aria-label])');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const selected = tablist.querySelector('[aria-selected="true"]');
  return {
    tabs: tabs.length,
    tabpanels: document.querySelectorAll('[role="tabpanel"]').length,
    ariaControls: tabs.filter((t) => t.getAttribute('aria-controls')).length,
    tabIndexes: tabs.map((t) => t.getAttribute('tabindex')).join(','),
    selected: selected.textContent.trim(),
    panelLabelledBy: document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby') ?? null,
    selectedId: selected.id || null,
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
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 640 });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().url())) }),
      );
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
      const tabLocator = (name) => page.getByRole('tab', { name, exact: true });

      await page.goto(`${baseUrl}/service-desks`);
      await page.getByRole('button', { name: 'Suporte N1' }).first().click();
      await page.locator('[role="tablist"]:not([aria-label])').waitFor();

      // Foco por teclado na aba ativa: um Tab antes, para o navegador tratar o foco como de teclado (:focus-visible)
      await page.keyboard.press('Tab');
      await tabLocator(FIRST_TAB).focus();
      await settle(page);
      const tabFocus = await page.evaluate(focusStyle);
      await shot('foco-aba');
      const initial = await page.evaluate(tabState);
      data[`aba-${width}`] = { tabFocus, initial };
      const problems = [];
      if (tabFocus.outlineStyle !== 'solid') problems.push(`contorno da aba: ${tabFocus.outlineStyle} (esperado solid)`);
      if (tabFocus.outlineWidth !== '2px') problems.push(`largura do contorno da aba: ${tabFocus.outlineWidth} (esperado 2px)`);
      if (tabFocus.outlineColor !== FOCUS) problems.push(`cor do contorno da aba: ${tabFocus.outlineColor} (esperado ${FOCUS})`);
      if (tabFocus.insideList !== true) problems.push('aba focada ultrapassa a lista que rola (anel cortado)');
      if (initial.pageOverflow > 0) problems.push(`rolagem horizontal da página: +${initial.pageOverflow} px`);
      check(`Foco da aba ${width} px (${tabFocus.outlineWidth} ${tabFocus.outlineColor}, offset ${tabFocus.outlineOffset})`, problems);

      // Papéis e associação aba-painel
      const roles = [];
      if (initial.tabs !== 12) roles.push(`${initial.tabs} abas (esperado 12)`);
      if (initial.tabpanels !== 1) roles.push(`${initial.tabpanels} tabpanel (esperado 1)`);
      if (initial.ariaControls !== 12) roles.push(`${initial.ariaControls} abas com aria-controls (esperado 12)`);
      if (!initial.selectedId || initial.panelLabelledBy !== initial.selectedId) roles.push('tabpanel sem aria-labelledby da aba ativa');
      if (initial.tabIndexes.split(',').filter((v) => v === '0').length !== 1) roles.push(`tabindex das abas: ${initial.tabIndexes} (esperado uma aba com 0)`);
      check(`Papéis das abas ${width} px (${initial.tabs} tab, ${initial.tabpanels} tabpanel, ${initial.ariaControls} aria-controls)`, roles);

      // Teclado: ArrowRight troca a aba ativa e o foco segue
      await page.keyboard.press('ArrowRight');
      const afterArrow = await page.evaluate(() => ({ focused: document.activeElement.textContent.trim(), selected: document.querySelector('[role="tablist"]:not([aria-label]) [aria-selected="true"]').textContent.trim() }));
      data[`seta-${width}`] = afterArrow;
      const keys = [];
      if (afterArrow.selected !== 'Parâmetros') keys.push(`ArrowRight deixou "${afterArrow.selected}" ativa (esperado Parâmetros)`);
      if (afterArrow.focused !== 'Parâmetros') keys.push(`foco em "${afterArrow.focused}" depois da seta (esperado Parâmetros)`);
      // Tab sai da lista direto para o conteúdo do painel (um Tab, não 11)
      await page.keyboard.press('Tab');
      const afterTab = await page.evaluate(() => document.activeElement.getAttribute('role'));
      data[`tab-${width}`] = { roleAfterTab: afterTab };
      if (afterTab === 'tab') keys.push('Tab foi para outra aba em vez de sair da lista');
      check(`Teclado nas abas ${width} px (seta troca a aba; Tab sai da lista)`, keys);

      // Checkbox do EzCheck (flags da Mesa, aba Parâmetros): foco por teclado
      const checkbox = page.locator('input[type="checkbox"]').first();
      await checkbox.focus();
      await settle(page);
      const checkFocus = await page.evaluate(focusStyle);
      await shot('foco-checkbox');
      data[`checkbox-${width}`] = checkFocus;
      const cp = [];
      if (checkFocus.outlineStyle !== 'solid') cp.push(`contorno do checkbox: ${checkFocus.outlineStyle} (esperado solid)`);
      if (checkFocus.outlineWidth !== '2px') cp.push(`largura do contorno do checkbox: ${checkFocus.outlineWidth} (esperado 2px)`);
      if (checkFocus.outlineColor !== FOCUS) cp.push(`cor do contorno do checkbox: ${checkFocus.outlineColor} (esperado ${FOCUS})`);
      check(`Foco do checkbox ${width} px (${checkFocus.outlineWidth} ${checkFocus.outlineColor}, offset ${checkFocus.outlineOffset})`, cp);
      // End vai à última aba (fora da tela a 390 px): o foco a traz para a área visível da lista
      await tabLocator('Parâmetros').focus();
      await page.keyboard.press('End');
      const last = await page.evaluate(() => {
        const list = document.querySelector('[role="tablist"]:not([aria-label])');
        const selected = list.querySelector('[aria-selected="true"]');
        const lr = list.getBoundingClientRect();
        const sr = selected.getBoundingClientRect();
        return { selected: selected.textContent.trim(), focused: document.activeElement === selected, inside: sr.left >= lr.left - 1 && sr.right <= lr.right + 1 };
      });
      data[`fim-${width}`] = last;
      const endProblems = [];
      if (last.selected !== 'Expediente' || !last.focused) endProblems.push(`End deixou "${last.selected}" ativa (foco ${last.focused}); esperado Expediente com foco`);
      if (!last.inside) endProblems.push('última aba fora da área visível da lista depois do End');
      check(`End leva à última aba, visível na lista ${width} px`, endProblems);
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
