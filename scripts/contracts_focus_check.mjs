#!/usr/bin/env node
// DMTE-540 AC-09: mede o foco do EzButton e o diálogo de exclusão de Contratos em Chromium, a 1440×900 e 390×844.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não resolve utilidade de contorno nem layout.
// Uso: node scripts/contracts_focus_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert] [--json <arquivo>]
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
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'contracts-focus-out');
const jsonOut = option('--json');
const noAssert = args.includes('--no-assert');

const contracts = Array.from({ length: 7 }, (_, i) => ({
  id: `c${i}`, organizationId: `o${i}`, organization: { name: `Cliente ${i}` }, name: `Contrato ${i}`, type: i % 2 ? 'COVERAGE' : 'HOURS_LIMIT', active: true,
  monthlyValue: 5000 + i * 100, hoursLimit: 40, adjustmentDate: '2026-01-15T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z',
}));

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  if (p === '/contracts') return contracts;
  const detail = contracts.find((c) => p === `/contracts/${c.id}`);
  if (detail) return detail;
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

const settle = (page) => page.waitForTimeout(400);

function focusStyle() {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  return {
    label: (el.textContent || '').trim().slice(0, 40) || el.getAttribute('aria-label') || el.id,
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    boxShadow: cs.boxShadow,
  };
}

function dialogBox() {
  const dialog = document.querySelector('[role="dialog"]');
  const r = dialog.getBoundingClientRect();
  return {
    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    items: dialog.querySelectorAll('li').length,
    focused: (document.activeElement.textContent || '').trim(),
    labelledBy: dialog.getAttribute('aria-labelledby'),
    titleId: dialog.querySelector('span[id]')?.id ?? null,
    viewport: [window.innerWidth, window.innerHeight],
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

      await page.goto(`${baseUrl}/contracts`);
      await page.getByText('Cliente 0').first().waitFor();

      // Seleciona todos e abre o diálogo de exclusão (7 contratos: lista 5 e "e mais 2")
      await page.getByRole('checkbox').first().check();
      await page.getByTestId('ez-toolbar-delete-button').click();
      await page.getByRole('dialog').waitFor();
      await settle(page);
      const box = await page.evaluate(dialogBox);
      await shot('dialogo-exclusao');
      data[`dialogo-${width}`] = box;
      const d = [];
      if (box.left < 0 || box.right > box.viewport[0] || box.top < 0 || box.bottom > box.viewport[1]) d.push(`diálogo fora da tela: ${JSON.stringify(box)}`);
      if (box.pageOverflow > 0) d.push(`rolagem horizontal da página: +${box.pageOverflow} px`);
      if (box.items !== 5) d.push(`${box.items} contratos listados (esperado 5)`);
      if (box.focused !== 'Cancelar') d.push(`foco inicial em "${box.focused}" (esperado Cancelar)`);
      if (!box.labelledBy || box.labelledBy !== box.titleId) d.push('diálogo sem aria-labelledby do título');
      check(`Diálogo de exclusão ${width} px (dentro da tela, 5 nomes, foco em Cancelar)`, d);

      // Foco por teclado no EzButton (Confirmar): contorno do token, 2 px brand-600
      await page.keyboard.press('Tab');
      await settle(page);
      const confirmFocus = await page.evaluate(focusStyle);
      await shot('foco-confirmar');
      data[`confirmar-${width}`] = confirmFocus;
      const f = [];
      if (confirmFocus.label !== 'Confirmar') f.push(`foco em "${confirmFocus.label}" (esperado Confirmar)`);
      if (confirmFocus.outlineStyle !== 'solid') f.push(`contorno: ${confirmFocus.outlineStyle} (esperado solid)`);
      if (confirmFocus.outlineWidth !== '2px') f.push(`largura do contorno: ${confirmFocus.outlineWidth} (esperado 2px)`);
      if (confirmFocus.outlineColor !== FOCUS) f.push(`cor do contorno: ${confirmFocus.outlineColor} (esperado ${FOCUS})`);
      if (confirmFocus.boxShadow !== 'none' && !/rgba?\(0, 0, 0, 0\)/.test(confirmFocus.boxShadow)) f.push(`anel antigo em box-shadow: ${confirmFocus.boxShadow}`);
      check(`Foco do EzButton ${width} px (${confirmFocus.outlineWidth} ${confirmFocus.outlineColor}, offset ${confirmFocus.outlineOffset})`, f);

      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });

      // Formulário aberto: o Excluir da toolbar fica desabilitado
      await page.getByRole('button', { name: /Ver detalhes/ }).first().click();
      await page.getByTestId('ez-toolbar-record-count').waitFor();
      const disabled = await page.getByTestId('ez-toolbar-delete-button').isDisabled();
      check(`Excluir desabilitado no formulário aberto ${width} px`, disabled ? [] : ['botão Excluir habilitado com o formulário aberto']);
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
