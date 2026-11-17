import { Transform } from 'class-transformer';

// DMTE-554: cnpj/cpf são @unique; o formulário manda '' quando vazio e '' colide com outro cliente sem documento.
const blankTo = (empty: undefined | null) =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? empty : value));

/** Criação: documento em branco = não informado. */
export const BlankToUndefined = () => blankTo(undefined);
/** Atualização: documento em branco = limpar o documento. */
export const BlankToNull = () => blankTo(null);
