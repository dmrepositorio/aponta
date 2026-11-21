#!/usr/bin/env node
// DMTE-546 AC-03/AC-04: mede, em Chromium a 768, 1024 e 1440 px, se a tabela do Cofre de Senha corta a
// coluna Ações (a árvore de pastas empilha até `lg`; o cartão da tabela rola na horizontal, não a página).
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não resolve layout.
// Uso: node scripts/vault_layout_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert]
// Sai com 1 se alguma medição falhar (exceto com --no-assert, usado para capturar a base "antes").
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIZES = [
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
];
const CREDENTIAL = 'Servidor FTP';
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'vault-layout-out');
const noAssert = args.includes('--no-assert');

const folders = [{ id: 'f1', name: 'Servidores', organizationId: 'o1', credentialCount: 3, createdAt: '', updatedAt: '' }];
const credentials = [
  { id: 'c0', name: CREDENTIAL, url: 'https://ftp.example.com/arquivos/compartilhados-com-nome-bem-longo', hasUsername: true, hasPassword: true },
  { id: 'c1', name: 'VPN Interna', url: null, hasUsername: false, hasPassword: true },
  { id: 'c2', name: 'Backup Interno', url: null, hasUsername: true, hasPassword: false },
].map((c) => ({ description: null, organizationId: 'o1', folderId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...c }));

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

function respond(route) {
  const request = route.request();
  const p = new URL(request.url()).pathname.replace(/^\/api/, '');
  if (p === '/vault/folders') return folders;
  if (p === '/vault/credentials') return { data: credentials, meta: { total: credentials.length, page: 1, limit: 10, totalPages: 1 } };
  return /s$/.test(p) ? [] : {};
}

const settle = (page) => page.waitForTimeout(400);

/** Mede o wrapper da tabela e a última ação da primeira linha. */
function measureLayout() {
  const scroller = document.querySelector('table')?.parentElement;
  const row = document.querySelector('tbody tr');
  const lastAction = row ? Array.from(row.querySelectorAll('button, a')).pop() : null;
  const r = lastAction?.getBoundingClientRect();
  return {
    scrollerHasOverflowAuto: scroller ? getComputedStyle(scroller).overflowX === 'auto' : false,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    lastActionRect: r ? { left: Math.round(r.left), right: Math.round(r.right) } : null,
  };
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const check = (label, problems) => report.push({ label, ok: problems.length === 0, problems });
  try {
    for (const { width, height } of SIZES) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route)) }));
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`), fullPage: true });

      await page.goto(`${baseUrl}/vault`);
      await page.locator('tbody tr').first().waitFor();
      await settle(page);
      await shot('cofre');

      const measured = await page.evaluate(measureLayout);
      const problems = [];
      if (!noAssert) {
        if (measured.pageOverflow > 0) problems.push(`rolagem horizontal da página: +${measured.pageOverflow} px`);
        if (!measured.scrollerHasOverflowAuto) problems.push('o wrapper da tabela não tem overflow-x: auto');
        if (!measured.lastActionRect) problems.push('última ação (Excluir) não encontrada');
      }
      check(`Sem rolagem da página, wrapper com overflow-x-auto ${width} px`, problems);

      // Alcance: a última ação da primeira linha chega à área visível (rolando o cartão, não a página)
      const reach = [];
      if (!noAssert) {
        const row = page.locator('tbody tr').first();
        const lastAction = row.locator('button, a').last();
        await lastAction.scrollIntoViewIfNeeded();
        const hit = await lastAction.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) &&
            r.right <= window.innerWidth + 0.5 &&
            r.left >= -0.5
          );
        });
        if (!hit) reach.push('a última ação (Excluir) está cortada ou fora da tela mesmo após rolar o cartão');
      }
      await shot('rolado');
      check(`Última ação (Excluir) alcançável ${width} px`, reach);

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
