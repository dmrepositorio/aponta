import { describe, expect, it } from 'vitest';
import { articleExcerpt } from './articleExcerpt';

describe('articleExcerpt', () => {
  it('returns only the text, without markup', () => {
    expect(articleExcerpt('<p>Veja o <strong>passo a passo</strong> abaixo.</p>')).toBe(
      'Veja o passo a passo abaixo.',
    );
  });

  it('separates adjacent blocks with a space so words do not glue together', () => {
    expect(articleExcerpt('<h2>Título</h2><p>Passo um</p><ul><li>a</li><li>b</li></ul>')).toBe(
      'Título Passo um a b',
    );
    expect(articleExcerpt('linha um<br>linha dois')).toBe('linha um linha dois');
  });

  it('collapses whitespace', () => {
    expect(articleExcerpt('<p>  muito \n   espaço  </p>')).toBe('muito espaço');
  });

  it('cuts at a word boundary within the limit and adds an ellipsis', () => {
    const excerpt = articleExcerpt('<p>alfa beta gama delta epsilon</p>', 16);
    expect(excerpt).toBe('alfa beta gama…');
    expect(excerpt.length).toBeLessThanOrEqual(16);
  });

  it('does not add an ellipsis when the text fits', () => {
    expect(articleExcerpt('<p>alfa beta</p>', 11)).toBe('alfa beta');
  });

  it('returns an empty string for empty or markup-only html', () => {
    expect(articleExcerpt('')).toBe('');
    expect(articleExcerpt('<p></p><img src="/a.png" alt="">')).toBe('');
  });
});
