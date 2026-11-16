#!/usr/bin/env node
// DMTE-527 AC-09: mede a tela de Tickets (Kanban por status, Kanban com Mesa e Lista) em Chromium,
// a 1440×900, 1024×768 e 390×844: alturas dos controles, tags sem quebra, largura do quadro contra a
// área visível, faixas recolhidas visíveis na borda, alvos de 44 px a 390 px e o teste de arrastar um
// cartão até a borda a 1440 px. A API é interceptada no navegador com dados SINTÉTICOS (sem backend).
// Uso: node scripts/tickets_responsive_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert]
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
const TOUCH_MIN = 44;
const TOOLBAR = 36;
const COMPACT = 32;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'tickets-responsive-out');
const noAssert = args.includes('--no-assert');

const STATUSES = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'PENDING_CUSTOMER', 'PENDING_APPROVAL', 'ON_HOLD', 'PENDING_SANKHYA', 'RESOLVED', 'CLOSED'];
const agents = [
  { id: 'a1', name: 'Ana Silva' },
  { id: 'a2', name: 'Bruno Costa' },
  { id: 'a3', name: 'Carla Dias' },
];
const stages = [
  { id: 's-n1', name: 'N1', position: 1, isInitial: true, isFinal: false, transitionToIds: ['s-n2', 's-aguardando'] },
  { id: 's-n2', name: 'N2', position: 2, isInitial: false, isFinal: false, transitionToIds: ['s-n1', 's-aguardando'] },
  { id: 's-aguardando', name: 'Aguardando Cliente', position: 3, isInitial: false, isFinal: true, transitionToIds: [] },
];
const inHours = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const tickets = Array.from({ length: 36 }, (_, i) => {
  const status = STATUSES[i % STATUSES.length];
  const agent = agents[i % agents.length];
  return {
    id: `t${i}`,
    protocol: `AP-2026-${String(i + 1).padStart(4, '0')}`,
    title: i % 5 === 0 ? `Impressora fiscal sem comunicação após atualização do sistema na filial ${i}` : `Ticket sintético ${i + 1}`,
    description: 'Descrição sintética',
    status,
    priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4],
    requesterId: 'r1',
    requester: { id: 'r1', name: 'Solicitante', email: 'solicitante@example.com', organizationId: 'o1', organization: { id: 'o1', name: i % 3 === 0 ? 'Associação dos Moradores do Jardim' : 'Alfa Tecnologia' } },
    agentId: i % 7 === 6 ? null : agent.id,
    agent: i % 7 === 6 ? null : agent,
    serviceDeskId: 'sd0',
    stageId: stages[i % stages.length].id,
    responseDeadline: inHours(2),
    resolveDeadline: inHours(30),
    responseSlaStatus: i % 3 === 0 ? 'AT_RISK' : 'ON_TRACK',
    resolveSlaStatus: i % 4 === 0 ? 'BREACHED' : 'ON_TRACK',
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };
});
const serviceDesks = [{ id: 'sd0', name: 'Suporte N1' }, { id: 'sd1', name: 'Infraestrutura' }];

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const { pathname } = new URL(url);
  const p = pathname.replace(/^\/api/, '');
  if (p === '/tickets') return { data: tickets, meta: { total: tickets.length, page: 1, limit: 100, totalPages: 1 } };
  if (p === '/service-desks') return serviceDesks;
  if (/^\/service-desks\/[^/]+\/stages$/.test(p)) return stages;
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

/** Roda na página: altura (px) de cada controle pedido, pelo seletor; `box` mede o pai (caixa do EzSelect). */
function measureHeights(controls) {
  // o menu lateral também tem "Configurações": medir só dentro do conteúdo da página
  const root = document.querySelector('[data-testid="app-content"]');
  return controls.map(({ name, selector, text, box }) => {
    const found = text ? Array.from(root.querySelectorAll('button')).find((b) => b.textContent.includes(text)) : root.querySelector(selector);
    const el = box ? found?.parentElement : found;
    return { name, height: el ? Math.round(el.getBoundingClientRect().height) : null };
  });
}

/** Roda na página: tags de status e prioridade com mais de uma linha (altura de pílula acima de 32 px). */
function measureTags() {
  const tags = Array.from(document.querySelectorAll('[data-ticket-tag]'));
  return { total: tags.length, broken: tags.filter((tag) => tag.getBoundingClientRect().height > 32).length };
}

/** Roda na página: o quadro, a área visível e as faixas recolhidas (botões "Expandir coluna ..."). */
function measureBoard() {
  const board = document.querySelector('[data-testid="kanban-board"]');
  const box = board.getBoundingClientRect();
  const strips = Array.from(board.querySelectorAll('button[aria-label^="Expandir coluna"]')).map((button) => {
    const r = (button.closest('[data-rfd-droppable-id]') ?? button).getBoundingClientRect();
    return { label: button.getAttribute('aria-label'), inView: r.left >= box.left - 1 && r.right <= box.right + 1, left: Math.round(r.left), right: Math.round(r.right) };
  });
  return {
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    boardScrollWidth: board.scrollWidth,
    boardVisibleWidth: board.clientWidth,
    scrollSnapType: getComputedStyle(board).scrollSnapType,
    columns: board.querySelectorAll('[data-testid="kanban-column"]').length,
    strips,
  };
}

const KANBAN_CONTROLS = [
  { name: 'título', selector: 'h1' },
  { name: 'busca', selector: '#tickets-header-search' },
  { name: 'Busca avançada', text: 'Busca avançada' },
  { name: 'Lista/Kanban', selector: '[role="group"][aria-label="Visualização"]' },
  { name: 'Mesa', selector: '[role="combobox"][aria-label="Mesa"]', box: true },
  { name: 'Ordenar', text: 'Ordenar' },
  { name: 'Configurações', text: 'Configurações' },
];
const LIST_CONTROLS = [
  { name: 'título', selector: 'h1' },
  { name: 'busca', selector: '#tickets-header-search' },
  { name: 'Busca avançada', text: 'Busca avançada' },
  { name: 'Lista/Kanban', selector: '[role="group"][aria-label="Visualização"]' },
];
const COMPACT_CONTROLS = [
  { name: 'Exibir colunas', text: 'Exibir colunas' },
  { name: 'Agrupar por', selector: '[role="combobox"][aria-label="Agrupar por"]', box: true },
  { name: 'atalho Autorizações', text: 'Autorizações' },
  { name: 'atalho Tickets fechados', text: 'Tickets fechados' },
];

function heightProblems(heights, width, kind) {
  const expected = kind === 'compact' ? COMPACT : TOOLBAR;
  return heights.flatMap(({ name, height }) => {
    if (height === null) return [`${name}: não encontrado`];
    if (width < 640) return name === 'título' || height >= TOUCH_MIN ? [] : [`${name}: ${height} px (mínimo ${TOUCH_MIN} abaixo de 640 px)`];
    return height === expected ? [] : [`${name}: ${height} px (esperado ${expected})`];
  });
}

/** O teste de arrastar: um cartão da primeira coluna até a borda direita do quadro e solto na última coluna aberta. */
async function dragToEdge(page, shot) {
  const patches = [];
  page.on('request', (request) => request.method() === 'PATCH' && patches.push(request.url() + ' ' + request.postData()));
  const board = page.getByTestId('kanban-board');
  const card = page.locator('[data-rfd-draggable-id]').first();
  const cardBox = await card.boundingBox();
  const boardBox = await board.boundingBox();
  const start = { x: cardBox.x + cardBox.width / 2, y: cardBox.y + 24 };
  const edge = boardBox.x + boardBox.width - 24;
  const maxScroll = await board.evaluate((el) => el.scrollWidth - el.clientWidth);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
  await page.mouse.move(edge, start.y + 12, { steps: 30 });
  let scrollLeft = 0;
  for (let i = 0; i < 80 && scrollLeft < maxScroll - 2; i += 1) {
    await page.mouse.move(edge - (i % 2), start.y + 12);
    await page.waitForTimeout(60);
    scrollLeft = await board.evaluate((el) => el.scrollLeft);
  }
  await shot('arrastar-1440-na-borda');
  const target = page.getByRole('heading', { name: 'Aguardando Sankhya' }).locator('xpath=ancestor::*[@data-testid="kanban-column"]');
  const targetBox = await target.boundingBox();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, { steps: 15 });
  await page.waitForTimeout(150);
  await shot('arrastar-1440-sobre-ultima-coluna');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const stripsAfter = await page.evaluate(measureBoard);
  return { patches, scrollLeft, maxScroll, stripsAfter, targetBox };
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const check = (label, problems) => report.push({ label, ok: problems.length === 0, problems });
  const info = (label) => report.push({ label, ok: true, problems: [] });
  try {
    for (const { width, height } of SIZES) {
      const narrow = width < 640;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: narrow });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) => {
        const method = route.request().method();
        const body = method === 'PATCH' ? tickets[0] : respond(route.request().url());
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
      const shotAt = (name) => shot(`${name}-${width}`);

      // Kanban por status (sem Mesa)
      await page.goto(`${baseUrl}/tickets?view=kanban`);
      await page.getByTestId('kanban-board').waitFor();
      await page.getByText('Ticket sintético 2').first().waitFor();
      let problems = heightProblems(await page.evaluate(measureHeights, KANBAN_CONTROLS), width, 'toolbar');
      const board = await page.evaluate(measureBoard);
      if (board.pageOverflow > 0) problems.push(`rolagem horizontal da página: +${board.pageOverflow} px`);
      await shotAt('kanban-status');
      check(`Kanban por status ${width} px: alturas da barra`, problems);
      info(`Kanban por status ${width} px: quadro ${board.boardScrollWidth} px contra ${board.boardVisibleWidth} px visíveis, ${board.columns} colunas abertas, scroll-snap ${board.scrollSnapType}`);

      problems = [];
      if (width >= 1024 && board.strips.length > 0) {
        const hidden = board.strips.filter((s) => !s.inView);
        if (hidden.length > 0) problems.push(`faixas fora da área visível: ${hidden.map((s) => s.label).join(', ')}`);
      }
      if (width >= 1024) {
        check(`Faixas recolhidas ${width} px: ${board.strips.length} faixa(s), ${board.strips.filter((s) => s.inView).length} visível(is) na borda`, board.strips.length === 0 ? ['nenhuma faixa recolhida (Resolvido e Fechado abrem recolhidos)'] : problems);
      }
      if (narrow) {
        const small = (await page.locator('button[aria-label^="Expandir coluna"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))).filter((r) => r.width < 43.5 || r.height < 43.5);
        check(`Faixas recolhidas ${width} px: alvos de ${TOUCH_MIN} px`, small.length > 0 ? [`${small.length} faixa(s) abaixo de ${TOUCH_MIN} px`] : []);
      }

      // "Agrupar por" do Kanban e seus 32 px / 44 px
      await page.getByTestId('app-content').getByRole('button', { name: 'Configurações' }).click();
      await page.getByRole('combobox', { name: 'Agrupar por' }).waitFor();
      check(
        `Kanban ${width} px: Agrupar por (Configurações)`,
        heightProblems(await page.evaluate(measureHeights, [{ name: 'Agrupar por', selector: '[role="combobox"][aria-label="Agrupar por"]', box: true }]), width, 'compact'),
      );
      await shotAt('kanban-configuracoes');
      await page.keyboard.press('Escape');

      // Kanban com Mesa: tags de status e estágio final recolhido
      await page.goto(`${baseUrl}/tickets?view=kanban&serviceDeskId=sd0`);
      await page.getByText('Aguardando Cliente').first().waitFor();
      await page.getByText('Ticket sintético 1', { exact: false }).first().waitFor();
      const mesaTags = await page.evaluate(measureTags);
      const mesaBoard = await page.evaluate(measureBoard);
      await shotAt('kanban-mesa');
      check(`Kanban com Mesa ${width} px: ${mesaTags.total} tags, estágio final em faixa (${mesaBoard.strips.length})`, [
        ...(mesaTags.broken > 0 ? [`${mesaTags.broken} tag(s) quebrando em duas linhas`] : []),
        ...(mesaBoard.pageOverflow > 0 ? [`rolagem horizontal da página: +${mesaBoard.pageOverflow} px`] : []),
      ]);

      // Lista
      await page.goto(`${baseUrl}/tickets?view=list`);
      await page.getByRole('button', { name: 'Exibir colunas' }).waitFor();
      await page.getByText('AP-2026-0001').first().waitFor();
      const listHeights = [
        ...heightProblems(await page.evaluate(measureHeights, LIST_CONTROLS), width, 'toolbar'),
        ...heightProblems(await page.evaluate(measureHeights, COMPACT_CONTROLS), width, 'compact'),
      ];
      const listTags = await page.evaluate(measureTags);
      const listOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shotAt('lista');
      check(`Lista ${width} px: alturas dos controles e ${listTags.total} tags`, [
        ...listHeights,
        ...(listTags.broken > 0 ? [`${listTags.broken} tag(s) quebrando em duas linhas`] : []),
        ...(listOverflow > 0 ? [`rolagem horizontal da página: +${listOverflow} px`] : []),
      ]);

      // Arrastar até a borda: só a 1440 px
      if (width === 1440) {
        await page.goto(`${baseUrl}/tickets?view=kanban`);
        await page.locator('[data-rfd-draggable-id]').first().waitFor();
        const drag = await dragToEdge(page, shotAt);
        const dragProblems = [];
        if (drag.maxScroll <= 0) dragProblems.push('o quadro não rola: nada a testar na borda');
        if (drag.scrollLeft < drag.maxScroll - 2) dragProblems.push(`a rolagem automática parou em ${Math.round(drag.scrollLeft)} de ${Math.round(drag.maxScroll)} px`);
        if (!drag.patches.some((p) => p.includes('/tickets/') && p.includes('PENDING_SANKHYA'))) dragProblems.push(`o cartão não foi solto em Aguardando Sankhya (PATCH: ${drag.patches.join(' | ') || 'nenhum'})`);
        const hiddenAfter = drag.stripsAfter.strips.filter((s) => !s.inView);
        if (hiddenAfter.length > 0) dragProblems.push(`faixas fora da área visível depois de arrastar: ${hiddenAfter.map((s) => s.label).join(', ')}`);
        check(`Arrastar até a borda ${width} px (rolagem ${Math.round(drag.scrollLeft)} de ${Math.round(drag.maxScroll)} px, ${drag.patches.length} PATCH)`, dragProblems);
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
process.exit(noAssert || report.every((row) => row.ok) ? 0 : 1);
