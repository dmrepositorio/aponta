import { Transform } from 'class-transformer';

// DMTE-554: cnpj/cpf são @unique; o formulário manda '' quando vazio e '' colide com outro cliente sem documento.
const blankTo = (empty: undefined | null) =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? empty : value));

/** Criação: documento em branco = não informado. */
export const BlankToUndefined = () => blankTo(undefined);
/** Atualização: documento em branco = limpar o documento. */
export const BlankToNull = () => blankTo(null);

// DMTE-559: o CNPJ é obrigatório e fica só com dígitos (a coluna @unique compara o texto exato).
export const CNPJ_MESSAGE = 'CNPJ é obrigatório e deve ter 14 dígitos.';
const digitsOnly = (empty: undefined | '') =>
  Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') || empty : value));

/** Criação: sem dígitos = não informado (obrigatório para cliente CNPJ). */
export const CnpjDigitsOrUndefined = () => digitsOnly(undefined);
/** Atualização: sem dígitos continua '' e é recusado, para o CNPJ não ser limpo. */
export const CnpjDigits = () => digitsOnly('');
