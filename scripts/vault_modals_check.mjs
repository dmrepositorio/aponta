#!/usr/bin/env node
// DMTE-545 AC-07: mede, em Chromium a 1440×900 e 390×844, o modal do Cofre quando a API recusa o salvar (rodapé visível,
// erro dentro do modal, campos mantidos) e o botão "Tentar de novo" do erro de carga.
// A API é interceptada no navegador com dados SINTÉTICOS (sem backend). jsdom não mede layout.
// Uso: node scripts/vault_modals_check.mjs [--out <pasta>] [--url <app já no ar>] [--no-assert]
// Sai com 1 se alguma medição falhar (exceto com --no-assert, usado para capturar a base "antes").
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'vault-modals-out');
const noAssert = args.includes('--no-assert');
const REFUSAL = 'Sem permissão para salvar esta senha.';

const folders = [{ id: 'f1', name: 'Servidores', organizationId: 'o1', credentialCount: 1, createdAt: '', updatedAt: '' }];
const credentials = [
  { id: 'c0', name: 'Servidor FTP', url: null, hasUsername: true, hasPassword: true },
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

const settle = (page) => page.waitForTimeout(400);

/** Retângulo do elemento dentro da janela e se ele recebe o clique no centro (nada o cobre). */
const inView = (el) => {
  const r = el.getBoundingClientRect();
  const hit = el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  return { inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5, hit, width: Math.round(r.width), height: Math.round(r.height) };
};

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
      let foldersFail = true;
      await page.route('**/api/**', (route) => {
        const request = route.request();
        const p = new URL(request.url()).pathname.replace(/^\/api/, '');
        if (request.method() === 'POST' && p === '/vault/credentials') {
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: REFUSAL }) });
        }
        if (p === '/vault/folders' && foldersFail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        const body = p === '/vault/folders' ? folders
          : p === '/vault/credentials' ? { data: credentials, meta: { total: 1, page: 1, limit: 10, totalPages: 1 } }
          : {};
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      // EzTextInput não liga label e campo por id: sobe da label ao input irmão.
      const field = (dialog, label) => dialog.locator('label').filter({ hasText: new RegExp(`^${label}\\*?$`) }).locator('xpath=..').locator('input');
      const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });

      // Erro de carga: "Tentar de novo" visível e clicável; com a API de volta, o cofre aparece
      await page.goto(`${baseUrl}/vault`);
      const retry = page.getByRole('button', { name: 'Tentar de novo' });
      const load = [];
      try {
        await retry.waitFor({ timeout: 20000 }); // o app tenta 3 vezes (~7 s) antes do erro
        await settle(page);
        const m = await retry.evaluate(inView);
        if (!m.inside || !m.hit) load.push('"Tentar de novo" fora da janela ou coberto');
        await shot('erro-carga');
        foldersFail = false;
        await retry.click();
        await page.locator('tbody tr').first().waitFor({ timeout: 20000 });
      } catch {
        load.push('"Tentar de novo" não apareceu ou não trouxe o cofre de volta');
      }
      check(`Erro de carga ${width} px (Tentar de novo visível, clicável e funcional)`, load);
      if (load.length) {
        await context.close();
        continue;
      }

      // Modal com recusa da API: rodapé visível, erro dentro do modal, campos mantidos
      await page.getByTestId('app-content').getByRole('button', { name: 'Ações', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Nova senha' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nova senha' });
      await dialog.waitFor();
      await field(dialog, 'Nome').fill('Novo Serviço');
      await field(dialog, 'Senha').fill('senha-sintetica-123');
      await dialog.getByRole('button', { name: 'Salvar' }).click();
      const alert = dialog.getByRole('alert');
      const modal = [];
      try {
        await alert.waitFor({ timeout: 4000 });
      } catch {
        modal.push('o erro não apareceu dentro do modal');
      }
      await settle(page);
      await shot('modal-erro');
      if (modal.length === 0) {
        if (!(await alert.innerText()).includes(REFUSAL)) modal.push('o erro não traz a mensagem da API');
        const a = await alert.evaluate(inView);
        if (!a.inside) modal.push('o alerta está fora da janela');
        const d = await dialog.evaluate(inView);
        if (!d.inside) modal.push('o modal não cabe na janela');
        for (const name of ['Salvar', 'Cancelar']) {
          const m = await dialog.getByRole('button', { name }).evaluate(inView);
          if (!m.inside || !m.hit) modal.push(`"${name}" fora da janela ou coberto`);
        }
        if ((await field(dialog, 'Nome').inputValue()) !== 'Novo Serviço') modal.push('o nome digitado se perdeu');
        if ((await field(dialog, 'Senha').inputValue()) !== 'senha-sintetica-123') modal.push('a senha digitada se perdeu');
        if (await dialog.getByRole('button', { name: 'Salvar' }).isDisabled()) modal.push('"Salvar" continua desabilitado');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) modal.push(`rolagem horizontal da página: +${overflow} px`);
      }
      check(`Modal com recusa da API ${width} px (rodapé e erro visíveis, campos mantidos)`, modal);
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
