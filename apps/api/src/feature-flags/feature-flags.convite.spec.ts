import { FEATURE_FLAGS, flagProblems, resolveFlags } from './feature-flags';

describe('AC-21: flag convite-e-redefinicao-usuario (DMTE-550)', () => {
  const flag = () => FEATURE_FLAGS.find((f) => f.key === 'convite-e-redefinicao-usuario');

  it('AC-21: está registrada, dono alfredo, desligada por padrão, remoção em 2027-01-15', () => {
    expect(flag()).toMatchObject({ owner: 'alfredo', defaultValue: false, removeBy: '2027-01-15' });
    expect(flag()?.description).toBeTruthy();
  });

  it('AC-21: sem variável de ambiente fica desligada; FEATURE_CONVITE_E_REDEFINICAO_USUARIO=true liga', () => {
    expect(resolveFlags(FEATURE_FLAGS, {})['convite-e-redefinicao-usuario']).toBe(false);
    expect(resolveFlags(FEATURE_FLAGS, { FEATURE_CONVITE_E_REDEFINICAO_USUARIO: 'true' })['convite-e-redefinicao-usuario']).toBe(true);
  });

  it('AC-21: o registro não tem problema na data de hoje', () => {
    expect(flag()).toBeDefined();
    expect(flagProblems(FEATURE_FLAGS, new Date('2026-11-17T12:00:00Z'))).toEqual([]);
  });
});
