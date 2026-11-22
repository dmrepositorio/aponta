import { describe, expect, it } from 'vitest';
import { richTextToPlainText } from './richTextToPlainText';

describe('richTextToPlainText', () => {
  it('AC-01: remove as tags de um parágrafo e apara o texto', () => {
    expect(richTextToPlainText('<p>Erro no emissão da TOP 1100 </p>')).toBe('Erro no emissão da TOP 1100');
  });

  it('AC-02: parágrafos, br e itens de lista viram quebras de linha, sem tag', () => {
    const html =
      '<p>Primeira <strong>linha</strong> com <em>ênfase</em></p><p>Segunda<br>quebrada</p><ul><li>item um</li><li>item dois</li></ul>';
    expect(richTextToPlainText(html)).toBe('Primeira linha com ênfase\nSegunda\nquebrada\n- item um\n- item dois');
  });

  it('AC-02: colapsa mais de uma linha em branco seguida', () => {
    expect(richTextToPlainText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('AC-04: decodifica &amp;, &lt; e &nbsp;', () => {
    const r = richTextToPlainText('<p>A &amp; B &lt; C&nbsp;D</p>');
    expect(r).toBe('A & B < C D');
  });

  it('AC-03: acima de 2.000 pontos de código corta sobre o texto, com reticências e sem fragmento de tag ou entidade', () => {
    const html = `<p>${'a'.repeat(1990)}<strong>bbbb</strong> &amp; ${'c'.repeat(300)}</p>`;
    const r = richTextToPlainText(html);
    expect(r.endsWith('…')).toBe(true);
    expect(Array.from(r).length).toBeLessThanOrEqual(2001);
    expect(r).not.toContain('<');
    expect(r).not.toContain('&am');
    expect(r).toContain('bbbb');
  });

  it('AC-03: o teto conta pontos de código e não parte par substituto', () => {
    const html = `<p>${'x'.repeat(1999)}😀😀😀</p>`;
    const r = richTextToPlainText(html);
    expect(r).toBe(`${'x'.repeat(1999)}😀…`);
  });

  it('AC-03: HTML de 500 caracteres, abaixo do teto, entra inteiro e sem reticências', () => {
    const texto = 'd'.repeat(500);
    expect(richTextToPlainText(`<p>${texto}</p>`)).toBe(texto);
  });

  it('AC-05: texto puro curto é devolvido intacto', () => {
    expect(richTextToPlainText('Detalhe do chamado de teste')).toBe('Detalhe do chamado de teste');
  });

  it('AC-05: texto puro preserva quebras, < e & soltos e markdown de imagem', () => {
    expect(richTextToPlainText('linha 1\nlinha 2')).toBe('linha 1\nlinha 2');
    expect(richTextToPlainText('a < b & c')).toBe('a < b & c');
    expect(richTextToPlainText('![x](u)')).toBe('![x](u)');
  });

  it('AC-05: texto puro de 200 caracteres entra inteiro (sem o corte de 160)', () => {
    const texto = 'e'.repeat(200);
    expect(richTextToPlainText(texto)).toBe(texto);
  });

  it('AC-05: texto puro acima do teto de 2.000 é cortado com reticências', () => {
    const r = richTextToPlainText('f'.repeat(2100));
    expect(r).toBe(`${'f'.repeat(2000)}…`);
  });

  it('AC-06: descarta script e img, sem vazar alert(1) nem tag', () => {
    const r = richTextToPlainText(
      '<p>Ok</p><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)">',
    );
    expect(r).toBe('Ok');
  });
});
