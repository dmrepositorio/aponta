#!/usr/bin/env node
// DMTE-528 AC-07: mede em Chromium (1440×900 e 390×844) os alvos de "Mais ações" e "Recolher coluna",
// o anel de foco por teclado nesses botões e nos avatares do filtro, e a palavra curta nos chips de SLA
// (sem estourar o cartão). API interceptada no navegador com dados SINTÉTICOS (sem backend).
// Uso: node scripts/kanban_targets_check.mjs [--out <pasta>] [--url <app já no ar>]
// Evidência técnica: jsdom não aplica CSS e o aceite visual é humano.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const MIN_TARGET = 24;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'kanban-targets-out');

const agents = [
  { id: 'a1', name: 'Ana Silva' },
  { id: 'a2', name: 'Bruno Costa' },
];
const stages = [
  { id: 's-n1', name: 'N1', position: 1, isInitial: true, isFinal: false, transitionToIds: ['s-n2'] },
  { id: 's-n2', name: 'N2', position: 2, isInitial: false, isFinal: false, transitionToIds: ['s-n1'] },
];
const inHours = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const tickets = Array.from({ length: 8 }, (_, i) => ({
  id: `t${i}`,
  protocol: `AP-2026-${String(i + 1).padStart(4, '0')}`,
  title: `Ticket sintético ${i + 1}`,
  description: 'Descrição sintética',
  status: i % 2 === 0 ? 'OPEN' : 'IN_PROGRESS',
  priority: 'MEDIUM',
  requesterId: 'r1',
  requester: { id: 'r1', name: 'Solicitante', email: 'solicitante@example.com', organizationId: 'o1', organization: { id: 'o1', name: 'Alfa Tecnologia' } },
  agentId: agents[i % 2].id,
  agent: agents[i % 2],
  serviceDeskId: 'sd0',
  stageId: i % 2 === 0 ? 's-n1' : 's-n2',
  responseDeadline: inHours(i % 3 === 0 ? -1 : 2),
  resolveDeadline: inHours(30),
  responseSlaStatus: i % 3 === 0 ? 'BREACHED' : 'ON_TRACK',
  resolveSlaStatus: 'ON_TRACK',
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
}));

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  if (p === '/tickets') return { data: tickets, meta: { total: tickets.length, page: 1, limit: 100, totalPages: 1 } };
  if (p === '/service-desks') return [{ id: 'sd0', name: 'Suporte N1' }];
  if (p === '/service-desks/sd0/stages') return stages;
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

const size = (locator) => locator.evaluate((el) => {
  const rect = el.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
});
const ring = (locator) => locator.evaluate((el) => getComputedStyle(el).boxShadow);

/** Foca o botão por teclado (Tab até ele) e devolve o boxShadow antes e depois. */
async function focusByKeyboard(page, locator) {
  const before = await ring(locator);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement)) return { before, after: await ring(locator) };
  }
  return { before, after: null };
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const check = (label, problems) => report.push({ label, ok: problems.length === 0, problems });
  try {
    for (const { width, height } of SIZES) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 640 });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().url())) }));
      for (const [view, query] of [['por status', ''], ['por estágio (Mesa)', '&serviceDeskId=sd0']]) {
      await page.goto(`${baseUrl}/tickets?view=kanban${query}`);
      await page.getByTestId('kanban-board').waitFor();
      await page.getByRole('button', { name: /^Recolher coluna / }).first().waitFor();

      const more = page.getByRole('button', { name: 'Mais ações' }).first();
      const collapse = page.getByRole('button', { name: /^Recolher coluna / }).first();
      const avatar = page.getByRole('button', { name: /^Filtrar por / }).first();
      const problems = [];
      for (const [name, locator] of [['Mais ações', more], ['Recolher coluna', collapse], ['avatar do filtro', avatar]]) {
        const box = await size(locator);
        if (box.width < MIN_TARGET || box.height < MIN_TARGET) problems.push(`${name}: alvo de ${box.width}×${box.height} px (mínimo ${MIN_TARGET})`);
        else console.log(`     ${name}: ${box.width}×${box.height} px`);
        const focus = await focusByKeyboard(page, locator);
        if (focus.after === null) problems.push(`${name}: Tab não chegou ao botão`);
        else if (focus.after === focus.before) problems.push(`${name}: sem mudança visível no foco (boxShadow ${focus.after})`);
      }
      // o cabeçalho do cartão (protocolo + menu) não pode crescer com o alvo de 32 px (base medida: 24 px; com o alvo, 25 px)
      const headerHeight = await more.evaluate((el) => el.closest('.justify-between').getBoundingClientRect().height);
      if (headerHeight > 26) problems.push(`cabeçalho do cartão com ${Math.round(headerHeight)} px (base 24, tolerância de 2 px)`);
      const chips = await page.locator('[aria-label^="Resposta:"], [aria-label^="Resolução:"]').evaluateAll((els) =>
        els.map((el) => {
          const card = el.closest('[data-rfd-draggable-id]')?.getBoundingClientRect();
          const chip = el.getBoundingClientRect();
          return { text: el.textContent.trim(), overflow: !card || chip.right > card.right + 0.5 };
        }),
      );
      const bad = chips.filter((chip) => !/^(Resp\.|Solução)/.test(chip.text));
      if (chips.length === 0) problems.push('nenhum chip de SLA na tela');
      if (chips.some((chip) => chip.overflow)) problems.push(`${chips.filter((chip) => chip.overflow).length} chip(s) estourando o cartão`);
      if (bad.length > 0) problems.push(`${bad.length} chip(s) sem a palavra curta: ${bad.slice(0, 2).map((c) => c.text).join(' | ')}`);
      console.log(`     chips: ${chips.length}, exemplo "${chips[0]?.text}"`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`rolagem horizontal da página: +${overflow} px`);
      await page.screenshot({ path: path.join(outDir, `kanban-${view.startsWith('por status') ? 'status' : 'estagio'}-${width}.png`) });
      check(`Kanban ${view} ${width} px: alvos, foco e chips`, problems);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return report;
}

const external = option('--url');
const server = external ? { url: external, stop: () => undefined } : await startVite();
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
process.exit(report.every((row) => row.ok) ? 0 : 1);
