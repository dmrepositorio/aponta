#!/usr/bin/env node
// DMTE-529 AC-07: mede a Dashboard em Chromium nas larguras 390, 768, 1024 e 1440 px.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend, sem dados de cliente).
// Uso: node scripts/dashboard_responsive_check.mjs [--out <pasta de capturas>] [--url <app já no ar>]
// Sai com 1 se alguma medição falhar. Evidência técnica: aceite visual é humano.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const WIDTHS = [390, 768, 1024, 1440];
const TABS = ['Tickets', 'Chats', 'Recurso', 'Horas'];
const TOUCH_MIN = 44;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'dashboard-responsive-out');

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

function syntheticSummary() {
  const today = new Date();
  const days = Array.from({ length: today.getDate() }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), i + 1);
    const logged = i === today.getDate() - 1 ? 3.5 : 5 + (i % 4);
    return { day: i + 1, date: iso(date), targetHours: 8, loggedHours: logged, remainingHours: Math.max(0, 8 - logged) };
  });
  const people = ['Atendente com um nome bem comprido para testar a quebra', 'Bia', 'Caio', 'Duda', 'Edu', 'Fabi', 'Gabi', 'Hugo'];
  return {
    openCount: 40, closedCount: 90, slaBreachedCount: 14, avgResolutionMinutes: 90,
    byStatus: { OPEN: 20, IN_PROGRESS: 15, ESCALATED: 5 },
    ticketSummary: { total: 130, mine: 12, unattended: 21, inProgress: 15, paused: 9, overdue: 14 },
    responseDeadlines: { total: 21, today: 5, tomorrow: 6, later: 10 },
    solutionDeadlines: { total: 31, today: 7, tomorrow: 8, later: 16 },
    unansweredTickets: { total: 13, mine: 3 },
    csatGeneral30d: { avg: 4.5, count: 10, satisfactionRate: 90 },
    csatMine30d: { avg: 4.2, count: 5, satisfactionRate: 80 },
    recentNotifications: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, protocol: `TK-${100 + i}`, title: 'Novo comentário num ticket com título razoavelmente longo' })),
    inProgressBreakdown: {
      byAssignee: people.map((name, i) => ({ name, count: 40 - i * 5 })),
      byServiceDesk: [{ name: 'Mesa Central', count: 10 }], byOrganization: [], byResource: [],
    },
    monthlyHours: { targetHoursTotal: 160, loggedHoursTotal: 96.5, remainingHoursTotal: 63.5, days },
    ticketsTrend30d: Array.from({ length: 30 }, (_, i) => ({ date: iso(daysAgo(29 - i)), created: 3 + (i % 7), closed: 2 + (i % 5), cancelled: i % 3 })),
    myChats: { inProgress: 1, waitingResponse: 2, avgWaitMinutes: 3, avgServiceMinutes: 18 },
    allChats: { inProgress: 2, waitingResponse: 1, avgWaitMinutes: 5, avgServiceMinutes: 20 },
    chatsByDepartment: [{ department: 'Suporte Técnico Nível 1 e Nível 2', total: 5, inProgress: 3, waitingQueue: 1, waitingResponse: 1, avgWait: '4m', avgService: '18m' }],
    chatsByAgent: ['online', 'busy', 'away', 'offline'].map((status, i) => ({ name: `Atendente ${i + 1}`, status, inProgress: i, group: 'N1' })),
    myAppointments: { total: 3, today: 1, week: 2, month: 5, items: [] },
    allAppointments: { total: 30, today: 4, week: 24, month: 147, items: [] },
  };
}

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
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

/** Runs in the page: returns the violations found in the Dashboard content. */
function measure({ touchMin, narrow }) {
  const problems = [];
  const root = document.querySelector('h1')?.closest('.space-y-5');
  if (!root) return ['Dashboard content not found'];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth) problems.push(`rolagem horizontal da página: scrollWidth ${doc.scrollWidth} > ${window.innerWidth}`);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const insideScroller = (el) => {
    for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) return true;
    }
    return false;
  };

  if (narrow) {
    for (const el of root.querySelectorAll('a, button, [role="tab"]')) {
      if (!visible(el) || el.closest('svg')) continue;
      const h = el.getBoundingClientRect().height;
      if (h < touchMin - 0.5) problems.push(`alvo de toque com ${h.toFixed(1)} px: ${(el.textContent ?? '').trim().slice(0, 30)}`);
    }
  }

  for (const el of root.querySelectorAll('*')) {
    if (!visible(el) || el.closest('svg') || el.classList.contains('sr-only')) continue;
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    const r = el.getBoundingClientRect();
    if (hasText && !insideScroller(el) && (r.right > window.innerWidth + 1 || r.left < -1)) {
      problems.push(`texto fora da tela: "${el.textContent.trim().slice(0, 30)}"`);
    }
    const style = getComputedStyle(el);
    if (['hidden', 'clip'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== 'ellipsis') {
      problems.push(`texto cortado na horizontal: "${el.textContent.trim().slice(0, 30)}"`);
    }
    if (['hidden', 'clip'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      problems.push(`conteúdo cortado na vertical: "${el.textContent.trim().slice(0, 30)}"`);
    }
    if (hasText && el.closest('[class*="max-h-"]') === null && style.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 1) {
      problems.push(`rolagem vertical não declarada: "${el.textContent.trim().slice(0, 30)}"`);
    }
  }

  for (const svg of root.querySelectorAll('svg')) {
    const texts = Array.from(svg.querySelectorAll('text')).filter(visible);
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i].getBoundingClientRect();
        const b = texts[j].getBoundingClientRect();
        const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        if (overlap) problems.push(`rótulos sobrepostos: "${texts[i].textContent}" e "${texts[j].textContent}"`);
      }
    }
  }
  return problems;
}

async function checkTooltip(page) {
  const points = page.getByTestId('card-tickets-nos-ultimos-30-dias').getByRole('button');
  if ((await points.count()) < 15) return ['gráfico de 30 dias sem pontos na aba Tickets'];
  await points.nth(14).scrollIntoViewIfNeeded();
  const box = await points.nth(14).boundingBox();
  if (!box) return ['gráfico de 30 dias sem pontos'];
  const problems = [];
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const tooltip = page.getByRole('tooltip');
  if (!(await tooltip.isVisible())) return ['tooltip não abre por toque'];
  const t = await tooltip.boundingBox();
  const viewport = page.viewportSize();
  if (t.x < -0.5 || t.x + t.width > viewport.width + 0.5) problems.push('tooltip fora da tela');
  await page.touchscreen.tap(8, 8);
  if (await tooltip.isVisible()) problems.push('tooltip não fecha com toque fora');
  return problems;
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) => {
        const url = route.request().url();
        const body = url.includes('/reports/summary') ? syntheticSummary() : url.includes('?') || /s(\?|$)/.test(url) ? [] : {};
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${baseUrl}/dashboard`);
      await page.getByText(/bom te ver de volta/i).waitFor();
      for (const tab of TABS) {
        await page.getByRole('main').getByRole('tab', { name: tab }).click();
        await page.waitForTimeout(250);
        const problems = await page.evaluate(measure, { touchMin: TOUCH_MIN, narrow: width < 1024 });
        if (tab === 'Tickets') problems.push(...(await checkTooltip(page)));
        await page.screenshot({ path: path.join(outDir, `dashboard-${tab.toLowerCase()}-${width}.png`), fullPage: true });
        report.push({ width, tab, ok: problems.length === 0, problems });
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
  console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${String(row.width).padStart(4)} px  ${row.tab}${row.problems.map((p) => `\n       - ${p}`).join('')}`);
}
console.log(`Capturas em ${outDir}`);
process.exit(report.every((row) => row.ok) ? 0 : 1);
