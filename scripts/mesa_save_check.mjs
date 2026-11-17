#!/usr/bin/env node
// DMTE-533 AC-10: mede o modelo único de salvamento da Mesa em Chromium, a 1440×900 e 390×844.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não mede sobreposição nem rolagem.
// Uso: node scripts/mesa_save_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert] [--json <arquivo>]
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
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'mesa-save-out');
const jsonOut = option('--json');
const noAssert = args.includes('--no-assert');

const serviceDesks = ['Suporte N1', 'Infraestrutura'].map((name, i) => ({
  id: `sd${i}`, name, createdAt: '2026-09-29T10:00:00.000Z', active: true, acceptingNewTickets: true, ticketSections: [], priorities: [], organizations: [], agentGroups: [],
}));

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  if (p === '/service-desks') return serviceDesks;
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

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

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
      let failSave = false;
      await page.route('**/api/**', (route) => {
        const request = route.request();
        if (request.method() === 'PATCH') {
          return route.fulfill(failSave ? { status: 500, contentType: 'application/json', body: '{"message":"erro sintético"}' } : { contentType: 'application/json', body: '{}' });
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(request.url())) });
      });
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
      const tab = (name) => page.getByRole('tab', { name, exact: true });
      const pending = page.getByText('Alterações não salvas nesta aba.');
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const flag = page.getByLabel('Permitir cancelar ticket');

      await page.goto(`${baseUrl}/service-desks`);
      await page.getByRole('button', { name: 'Suporte N1' }).first().click();
      await tab('Parâmetros').click();

      // Parâmetros agrupado por tema
      const groups = await page.evaluate(() => Array.from(document.querySelectorAll('fieldset')).map((f) => f.querySelector('legend')?.textContent?.trim()));
      data[`grupos-${width}`] = groups;
      await shot('parametros');
      check(`Parâmetros em 3 grupos ${width} px (${groups.join(', ')})`, groups.join('|') === 'Geral|SLA|Revisão e avaliação' ? [] : [`grupos: ${groups.join('|')}`]);

      // Edição pendente: linha de pendência e diálogo ao trocar de aba
      await flag.uncheck();
      const flow = [];
      await pending.waitFor({ timeout: 3000 }).catch(() => flow.push('linha de pendência não apareceu'));
      await tab('Prioridades').click();
      const dialog = page.getByRole('dialog');
      if (!(await dialog.isVisible())) flow.push('diálogo de descarte não abriu');
      await shot('descartar');
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      if ((await tab('Parâmetros').getAttribute('aria-selected')) !== 'true') flow.push('Cancelar não manteve a aba Parâmetros');
      if (await flag.isChecked()) flow.push('Cancelar não manteve a marcação');
      if (await dialog.count()) flow.push('diálogo continuou aberto depois de Cancelar');
      check(`Pendência e descarte ${width} px`, flow);

      // Salvar com sucesso: aviso de status que não cobre o botão nem cria rolagem horizontal
      const save = page.getByRole('button', { name: 'Salvar', exact: true });
      await save.scrollIntoViewIfNeeded();
      await save.click();
      const status = page.getByRole('status');
      await status.waitFor();
      const saved = [];
      const text = (await status.textContent()) ?? '';
      if (!text.includes('Alterações salvas.')) saved.push(`texto do aviso: ${text}`);
      const statusBox = await status.boundingBox();
      const saveBox = await save.boundingBox();
      if (statusBox && saveBox && overlaps({ left: statusBox.x, right: statusBox.x + statusBox.width, top: statusBox.y, bottom: statusBox.y + statusBox.height }, { left: saveBox.x, right: saveBox.x + saveBox.width, top: saveBox.y, bottom: saveBox.y + saveBox.height })) saved.push('o aviso cobre o botão Salvar');
      if ((await overflow()) > 0) saved.push(`rolagem horizontal: +${await overflow()} px`);
      await pending.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => saved.push('a linha de pendência continuou depois de salvar'));
      await shot('salvo');
      check(`Salvar com sucesso ${width} px (aviso sem cobrir o botão)`, saved);

      // Falha: alerta, marcação mantida
      await flag.check();
      failSave = true;
      await save.scrollIntoViewIfNeeded();
      await save.click();
      const alert = page.getByRole('alert');
      await alert.waitFor();
      const failed = [];
      const alertText = (await alert.textContent()) ?? '';
      if (!alertText.includes('Não foi possível salvar.') || !alertText.includes('Tente novamente.')) failed.push(`texto do alerta: ${alertText}`);
      if (!(await flag.isChecked())) failed.push('a marcação não foi mantida');
      await pending.waitFor({ timeout: 3000 }).catch(() => failed.push('a linha de pendência sumiu depois da falha'));
      if ((await overflow()) > 0) failed.push(`rolagem horizontal: +${await overflow()} px`);
      await shot('falha');
      check(`Falha ao salvar ${width} px (alerta, marcação mantida)`, failed);
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
