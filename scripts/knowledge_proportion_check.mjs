#!/usr/bin/env node
// DMTE-535: mede em Chromium (1440×900 e 390×844) a proporção, o contraste e o foco da tela de Conhecimento:
// alturas de cada linha de controles, alinhamento das ações terciárias e de "+ Novo item de catálogo",
// contraste dos primários e de "N artigos", anel de foco por teclado e ausência de rolagem horizontal.
// API interceptada no navegador com dados SINTÉTICOS (sem backend), perfil ADMIN.
// Uso: node scripts/knowledge_proportion_check.mjs [--out <pasta>] [--url <app já no ar>]
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
const CONTROL_HEIGHT = 42;
const MIN_CONTRAST = 4.5;
const TOLERANCE = 1;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(option('--out') ?? 'knowledge-proportion-out');

const folders = [
  { id: 'f1', name: 'Suporte', description: 'Artigos de suporte', icon: '🛟', _count: { articles: 2 } },
  { id: 'f2', name: 'Financeiro', description: null, icon: '💰', _count: { articles: 0 } },
];
const articles = [
  {
    id: 'a1',
    title: 'Como redefinir a senha do portal',
    content: '<p>Abra o portal e use a opção de recuperação de senha.</p><ol><li>Informe o e-mail</li><li>Siga o link</li></ol>',
    visibility: 'PRIVATE',
    tags: ['senha', 'acesso', 'portal'],
    author: { id: 'u1', name: 'Ana Silva' },
    updatedAt: '2026-11-10T10:00:00.000Z',
    attachments: [],
  },
  {
    id: 'a2',
    title: 'Configurar o e-mail corporativo',
    content: '<p>Passo a passo para configurar o e-mail no celular.</p>',
    visibility: 'PUBLIC',
    tags: ['email'],
    author: { id: 'u2', name: 'Bruno Costa' },
    updatedAt: '2026-11-09T10:00:00.000Z',
    attachments: [],
  },
];

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'sintetico@example.com', role: 'ADMIN' })}.x`;
}

function respond(url) {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  if (p === '/knowledge-folders') return folders;
  if (p === '/articles') return articles;
  return /s$/.test(p) || p.endsWith('-items') ? [] : {};
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

const box = (locator) =>
  locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });

/** Caixa do texto do botão (o conteúdo do rótulo), não a do botão: é o texto que precisa alinhar à borda do conteúdo. */
const labelBox = (locator) =>
  locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('span') ?? el);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });

/** Razão de contraste WCAG entre a cor do texto e o fundo opaco do elemento (sobe os ancestrais até achar um fundo). */
const contrast = (locator) =>
  locator.evaluate((el) => {
    const parse = (value) => value.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let node = el;
    let bg = [255, 255, 255];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if ((c[3] ?? 1) > 0.99) {
        bg = c.slice(0, 3);
        break;
      }
      node = node.parentElement;
    }
    const fg = parse(getComputedStyle(el.querySelector('span') ?? el).color).slice(0, 3);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  });

const textContrast = (locator) =>
  locator.evaluate((el) => {
    const parse = (value) => value.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color).slice(0, 3);
    const [hi, lo] = [lum(fg), lum([255, 255, 255])].sort((a, b) => b - a);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  });

/** Foca o elemento por teclado (Tab até ele) e devolve boxShadow e outline-style antes e depois. */
async function focusByKeyboard(page, locator) {
  const read = () => locator.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, outline: getComputedStyle(el).outlineStyle }));
  const before = await read();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 120; i += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement)) return { before, after: await read() };
  }
  return { before, after: null };
}

async function run(baseUrl) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  const check = (label, problems, notes) => {
    report.push({ label, ok: problems.length === 0, problems, notes });
  };
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

      // ---- grade de pastas
      {
        const problems = [];
        const notes = [];
        await page.goto(`${baseUrl}/knowledge`);
        await page.getByText('Financeiro').first().waitFor();
        const nova = page.getByRole('button', { name: '+ Nova pasta' });
        const h = (await box(nova)).height;
        notes.push(`+ Nova pasta: ${h} px`);
        if (Math.abs(h - CONTROL_HEIGHT) > TOLERANCE) problems.push(`+ Nova pasta com ${h} px (esperado ${CONTROL_HEIGHT})`);
        const c1 = await contrast(nova);
        notes.push(`contraste de + Nova pasta: ${c1}:1`);
        if (c1 < MIN_CONTRAST) problems.push(`+ Nova pasta com contraste ${c1}:1`);
        const count = await textContrast(page.getByText('2 artigos'));
        notes.push(`contraste de "2 artigos": ${count}:1`);
        if (count < MIN_CONTRAST) problems.push(`"2 artigos" com contraste ${count}:1`);
        const editar = page.getByRole('button', { name: 'Editar' }).first();
        const folderCard = page.locator('h2', { hasText: 'Suporte' }).locator('xpath=ancestor::div[contains(@class,"rounded-[16px]")][1]');
        const cardBox = await box(folderCard);
        const editarBox = await labelBox(editar);
        const padding = await folderCard.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
        notes.push(`Editar: texto a ${Math.round(editarBox.left - cardBox.left)} px da borda do cartão (padding ${padding})`);
        if (Math.abs(editarBox.left - cardBox.left - padding - 1) > TOLERANCE) problems.push(`Editar da pasta não alinha com o conteúdo do cartão (${Math.round(editarBox.left - cardBox.left)} px, padding ${padding})`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) problems.push(`rolagem horizontal da página: +${overflow} px`);
        await page.screenshot({ path: path.join(outDir, `pastas-${width}.png`) });
        check(`Pastas ${width} px`, problems, notes);
      }

      // ---- lista de artigos
      {
        const problems = [];
        const notes = [];
        await page.getByText('Suporte').first().click();
        await page.getByRole('heading', { name: articles[0].title }).waitFor();

        const novo = page.getByRole('button', { name: '+ Novo artigo' });
        const search = page.getByTitle('busca por palavra-chave');
        const searchWrap = search.locator('xpath=ancestor::div[contains(@class,"rounded-[12px]")][1]');
        const sort = page.getByLabel('Ordenar por').locator('xpath=ancestor::div[contains(@class,"rounded-[12px]") or contains(@class,"relative")][1]');
        const toggle = page.getByRole('button', { name: 'Exibir em lista' }).locator('xpath=..');
        for (const [name, locator] of [['busca', searchWrap], ['+ Novo artigo', novo], ['alternador Lista/Grade', toggle]]) {
          const h = (await box(locator)).height;
          notes.push(`${name}: ${h} px`);
          if (Math.abs(h - CONTROL_HEIGHT) > TOLERANCE) problems.push(`${name} com ${h} px (esperado ${CONTROL_HEIGHT})`);
        }
        const sortHeight = (await box(sort)).height;
        notes.push(`ordenar: ${sortHeight} px`);
        if (Math.abs(sortHeight - CONTROL_HEIGHT) > TOLERANCE) problems.push(`ordenar com ${sortHeight} px (esperado ${CONTROL_HEIGHT})`);

        const c2 = await contrast(novo);
        notes.push(`contraste de + Novo artigo: ${c2}:1`);
        if (c2 < MIN_CONTRAST) problems.push(`+ Novo artigo com contraste ${c2}:1`);

        // ações terciárias do card alinhadas ao conteúdo
        const card = page.getByRole('heading', { name: articles[0].title }).locator('xpath=ancestor::article[1]');
        const title = await box(page.getByRole('heading', { name: articles[0].title }));
        const ler = await labelBox(card.getByRole('button', { name: 'Ler artigo completo' }));
        const lerButton = await box(card.getByRole('button', { name: 'Ler artigo completo' }));
        const excluir = await labelBox(card.getByRole('button', { name: 'Excluir' }));
        notes.push(`Ler artigo completo: borda esquerda ${Math.round(ler.left)} px, título ${Math.round(title.left)} px; Excluir: borda direita ${Math.round(excluir.right)} px, título ${Math.round(title.right)} px; alvo ${lerButton.height} px`);
        if (Math.abs(ler.left - title.left) > TOLERANCE) problems.push(`Ler artigo completo recuado ${Math.round(ler.left - title.left)} px em relação ao título`);
        if (Math.abs(excluir.right - title.right) > TOLERANCE) problems.push(`Excluir recuado ${Math.round(title.right - excluir.right)} px da borda direita do conteúdo`);
        if (lerButton.height < 24) problems.push(`alvo de Ler artigo completo com ${lerButton.height} px`);

        // foco por teclado
        const tag = card.getByRole('button', { name: /#senha/ });
        for (const [name, locator] of [
          ['tag clicável', tag],
          ['Exibir em lista', page.getByRole('button', { name: 'Exibir em lista' })],
          ['Exibir em grade', page.getByRole('button', { name: 'Exibir em grade' })],
        ]) {
          const focus = await focusByKeyboard(page, locator);
          if (focus.after === null) problems.push(`${name}: Tab não chegou`);
          else {
            notes.push(`foco em ${name}: box-shadow ${focus.after.shadow === 'none' ? 'none' : 'presente'}, outline ${focus.after.outline}`);
            if (focus.after.shadow === focus.before.shadow) problems.push(`${name}: sem anel de foco (box-shadow ${focus.after.shadow})`);
            if (focus.after.outline !== 'none') problems.push(`${name}: contorno padrão do navegador (${focus.after.outline})`);
          }
        }
        await tag.click();
        const remove = page.getByRole('button', { name: 'Remover filtro de tag senha' });
        await remove.waitFor();
        const focusX = await focusByKeyboard(page, remove);
        if (focusX.after === null) problems.push('× do filtro: Tab não chegou');
        else if (focusX.after.shadow === focusX.before.shadow) problems.push('× do filtro: sem anel de foco');
        else notes.push('foco no × do filtro: anel presente');
        await remove.click();
        await page.getByRole('heading', { name: articles[0].title }).waitFor();

        // formulário: botão fixo, foco no título, item de catálogo à esquerda
        await novo.click();
        const titleField = page.getByLabel('Título');
        if (!(await titleField.evaluate((el) => el === document.activeElement))) problems.push('foco não foi ao campo Título ao abrir o formulário');
        if ((await novo.count()) === 0) problems.push('+ Novo artigo sumiu com o formulário aberto');
        else if (!(await novo.isDisabled())) problems.push('+ Novo artigo deveria ficar desabilitado com o formulário aberto');
        const item = page.getByRole('button', { name: '+ Novo item de catálogo' });
        const itemBox = await labelBox(item);
        const fieldBox = await box(titleField.locator('xpath=ancestor::div[contains(@class,"rounded-[12px]")][1]'));
        notes.push(`+ Novo item de catálogo: borda esquerda ${Math.round(itemBox.left)} px, campos ${Math.round(fieldBox.left)} px`);
        if (Math.abs(itemBox.left - fieldBox.left) > TOLERANCE) problems.push(`+ Novo item de catálogo desalinhado ${Math.round(itemBox.left - fieldBox.left)} px dos campos`);
        const salvar = await contrast(page.getByRole('button', { name: 'Salvar' }));
        notes.push(`contraste de Salvar: ${salvar}:1`);
        if (salvar < MIN_CONTRAST) problems.push(`Salvar com contraste ${salvar}:1`);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) problems.push(`rolagem horizontal da página: +${overflow} px`);
        await page.screenshot({ path: path.join(outDir, `artigos-${width}.png`), fullPage: true });
        check(`Artigos ${width} px`, problems, notes);
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
  console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${row.label}${(row.notes ?? []).map((n) => `\n       . ${n}`).join('')}${row.problems.map((p) => `\n       - ${p}`).join('')}`);
}
console.log(`Capturas em ${outDir}`);
process.exit(report.every((row) => row.ok) ? 0 : 1);
