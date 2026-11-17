#!/usr/bin/env node
// DMTE-544 AC-09: mede alvos, foco, retorno de cópia e revelar por campo do Cofre de Senha em Chromium, a 1440×900 e 390×844.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não resolve utilidade de contorno nem layout.
// Uso: node scripts/vault_actions_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert] [--json <arquivo>]
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
const MIN_TARGET = 32; // alvo mínimo (px) dos botões de ícone
// Altura da linha na base ca109a3 (px), medida com --no-assert por largura: a entrega não pode aumentá-la.
const ROW_BASE = { 1440: 48.5, 390: 66.5 };
const CREDENTIAL = 'Servidor FTP';
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'vault-actions-out');
const jsonOut = option('--json');
const noAssert = args.includes('--no-assert');

const folders = [{ id: 'f1', name: 'Servidores', organizationId: 'o1', credentialCount: 3, createdAt: '', updatedAt: '' }];
const credentials = [
  { id: 'c0', name: CREDENTIAL, url: 'https://ftp.example.com/arquivos/compartilhados', hasUsername: true, hasPassword: true },
  { id: 'c1', name: 'VPN Interna', url: null, hasUsername: false, hasPassword: true },
  { id: 'c2', name: 'Backup Interno', url: null, hasUsername: true, hasPassword: false },
].map((c) => ({ description: null, organizationId: 'o1', folderId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...c }));
const REVEALED = { username: 'usuario-sintetico', password: 'senha-sintetica-123' };

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
  if (/^\/vault\/credentials\/[^/]+\/reveal$/.test(p)) return { value: REVEALED[JSON.parse(request.postData() ?? '{}').field] ?? null };
  return /s$/.test(p) ? [] : {};
}

const settle = (page) => page.waitForTimeout(400);

/** Medidas de cada botão/link da primeira linha, na ordem do DOM. */
function rowControls() {
  const row = document.querySelector('tbody tr');
  const rowRect = row.getBoundingClientRect();
  return {
    rowHeight: Math.round(rowRect.height * 10) / 10,
    controls: Array.from(row.querySelectorAll('button, a')).map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.getAttribute('title') || '(sem nome)', hasAriaLabel: el.hasAttribute('aria-label'), width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    }),
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}

function focusStyle() {
  const cs = getComputedStyle(document.activeElement);
  return { label: document.activeElement.getAttribute('aria-label') || document.activeElement.getAttribute('title'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor };
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
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
      await context.addInitScript((token) => {
        window.localStorage.setItem('aponta-auth', JSON.stringify({ state: { token }, version: 0 }));
      }, fakeJwt());
      const page = await context.newPage();
      await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route)) }));
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
      const rowOf = () => page.locator('tbody tr').filter({ hasText: CREDENTIAL });

      await page.goto(`${baseUrl}/vault`);
      await page.locator('tbody tr').first().waitFor();
      await settle(page);

      // Alvos: cada botão/link da linha mede pelo menos 32x32 e tem nome acessível próprio; a linha não cresce
      const measured = await page.evaluate(rowControls);
      data[`alvos-${width}`] = measured;
      await shot('linha');
      const targets = [];
      for (const control of measured.controls) {
        if (control.width < MIN_TARGET || control.height < MIN_TARGET) targets.push(`${control.name}: ${control.width}x${control.height} px (mínimo ${MIN_TARGET})`);
        if (!control.hasAriaLabel) targets.push(`${control.name}: sem aria-label`);
      }
      if (measured.rowHeight > ROW_BASE[width]) targets.push(`altura da linha ${measured.rowHeight} px (base ${ROW_BASE[width]})`);
      if (measured.pageOverflow > 0) targets.push(`rolagem horizontal da página: +${measured.pageOverflow} px`);
      check(`Alvos e nomes da linha ${width} px (${measured.controls.length} controles, linha ${measured.rowHeight} px)`, targets);

      // Base "antes" (--no-assert): sem aria-label não há como localizar os controles; fica só a medição acima
      if (noAssert && measured.controls.some((control) => !control.hasAriaLabel)) {
        await context.close();
        continue;
      }

      // Alcance: cada controle chega à área visível do cartão (rola na horizontal se preciso) sem ficar cortado
      const reach = [];
      const count = await rowOf().locator('button, a').count();
      for (let i = 0; i < count; i += 1) {
        const control = rowOf().locator('button, a').nth(i);
        await control.scrollIntoViewIfNeeded();
        const hit = await control.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && r.right <= window.innerWidth + 0.5 && r.left >= -0.5;
        });
        if (!hit) reach.push(`${(await control.getAttribute('aria-label')) ?? i}: cortado ou fora da tela`);
      }
      check(`Controles da linha alcançáveis ${width} px`, reach);
      await page.evaluate(() => window.scrollTo(0, 0));

      // Foco por teclado: um Tab antes, para o navegador tratar o foco como de teclado (:focus-visible)
      await page.keyboard.press('Tab');
      const focusRows = [];
      const controlCount = await rowOf().locator('button, a').count();
      for (let i = 0; i < controlCount; i += 1) {
        await rowOf().locator('button, a').nth(i).focus();
        await settle(page);
        const f = await page.evaluate(focusStyle);
        data[`foco-${width}-${f.label}`] = f;
        if (f.outlineStyle !== 'solid' || f.outlineWidth !== '2px' || f.outlineColor !== FOCUS) focusRows.push(`${f.label}: ${f.outlineStyle} ${f.outlineWidth} ${f.outlineColor} (esperado solid 2px ${FOCUS})`);
      }
      await shot('foco');
      check(`Foco por teclado ${width} px (contorno 2 px ${FOCUS})`, focusRows);

      // Cópia: confirmação visível e o valor nunca aparece na tela
      await rowOf().getByRole('button', { name: `Copiar senha de ${CREDENTIAL}` }).click();
      const status = page.getByRole('status');
      const copied = [];
      try {
        await status.getByText('Senha copiada').waitFor({ timeout: 3000 });
      } catch {
        copied.push('"Senha copiada" não apareceu');
      }
      if (copied.length === 0 && !(await status.getByText('Senha copiada').isVisible())) copied.push('confirmação fora da área visível');
      if (await page.getByText(REVEALED.password).count()) copied.push('o valor copiado apareceu na tela');
      await shot('copiado');
      if (copied.length === 0) {
        try {
          await status.getByText('Senha copiada').waitFor({ state: 'detached', timeout: 6000 });
        } catch {
          copied.push('a confirmação não sumiu em 6 s');
        }
      }
      check(`Confirmação de cópia ${width} px (aparece e some)`, copied);

      // Revelar por campo: o olho da senha revela só a senha, com aria-pressed
      const eyePassword = rowOf().getByRole('button', { name: `Revelar senha de ${CREDENTIAL}` });
      const reveal = [];
      if ((await eyePassword.getAttribute('aria-pressed')) !== 'false') reveal.push('aria-pressed inicial diferente de false');
      await eyePassword.click();
      try {
        await rowOf().getByText(REVEALED.password).waitFor({ timeout: 3000 });
      } catch {
        reveal.push('a senha não foi revelada');
      }
      if (await page.getByText(REVEALED.username).count()) reveal.push('o usuário também foi revelado');
      if ((await eyePassword.getAttribute('aria-pressed')) !== 'true') reveal.push('aria-pressed não virou true');
      await shot('revelado');
      await eyePassword.click();
      if (await page.getByText(REVEALED.password).count()) reveal.push('a senha continuou visível depois de ocultar');
      check(`Olho por campo ${width} px (revela só a senha; oculta ao clicar de novo)`, reveal);
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
