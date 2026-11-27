// Dinheiro em centavos inteiros (CTR-07). Nada aqui usa ponto flutuante para valores: reais e centavos são
// lidos como dígitos e combinados com aritmética inteira exata (até 13 dígitos de reais, abaixo de 2^53).
export interface ParsedMoney {
  /** Centavos inteiros; null quando o campo está vazio. */
  cents: number | null;
  /** Texto a mostrar enquanto o usuário digita. */
  text: string;
}

const MAX_INTEGER_DIGITS = 13;
const GROUPED = /^\d{1,3}(\.\d{3})+$/;

const groupThousands = (digits: string) =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Formata centavos inteiros como "R$ 1.234,56". Vazio para null e para o que não é centavo inteiro >= 0. */
export function formatCents(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) return '';
  const reais = Math.floor(cents / 100);
  const rest = cents % 100;
  return `R$ ${groupThousands(String(reais))},${String(rest).padStart(2, '0')}`;
}

function split(
  body: string,
  mode: 'typing' | 'paste',
  deleting: boolean,
): { int: string; frac: string | null } | null {
  if (body.includes(',')) {
    const parts = body.split(',');
    if (parts.length !== 2) return null;
    const [intPart, fracPart] = parts;
    if (!/^[\d.]*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
    if (mode === 'paste') {
      // Colado: vem pronto de outro lugar. Agrupamento torto ou 3+ casas são ambíguos: recusar, não adivinhar.
      if (intPart.includes('.') && !GROUPED.test(intPart)) return null;
      if (fracPart.length > 2) return null;
    }
    // Digitando, a terceira casa é descartada (não arredondada).
    return { int: intPart.replace(/\./g, ''), frac: fracPart.slice(0, 2) };
  }
  // Sem vírgula, um único ponto com 1 ou 2 dígitos depois só pode ser decimal (milhar tem 3 dígitos),
  // exceto ao apagar: aí o ponto é o de milhar da máscara ("R$ 1.500" sem o último dígito vira "1.50",
  // que são 150 reais, não 1,50).
  const decimalPoint = deleting ? null : /^(\d*)\.(\d{1,2})$/.exec(body);
  if (decimalPoint) return { int: decimalPoint[1], frac: decimalPoint[2] };
  if (mode === 'paste' && body.includes('.') && !GROUPED.test(body))
    return null;
  return { int: body.replace(/\./g, ''), frac: null };
}

/**
 * Lê o texto de um campo de dinheiro pt-BR. `typing` é tolerante (o campo se reformata a cada tecla);
 * `paste` é estrito; `deleting` marca uma edição que encurtou o texto (o ponto é sempre de milhar). Devolve null quando o texto deve ser recusado (negativo, letra, "e", formato ambíguo).
 * `cents` null = vazio.
 */
export function parseMoney(
  raw: string,
  mode: 'typing' | 'paste',
  options: { deleting?: boolean } = {},
): ParsedMoney | null {
  // R e $ soltos somem: apagar dentro do prefixo da máscara não pode rejeitar nem corromper o valor.
  const body = raw.replace(/[R$]/g, '').replace(/\s/g, '');
  if (/[^\d.,]/.test(body)) return null;
  const parts = split(body, mode, options.deleting === true);
  if (!parts) return null;
  const hasComma = parts.frac !== null;
  const reais = parts.int.replace(/^0+(?=\d)/, '');
  if (reais === '' && !hasComma) return { cents: null, text: '' };
  if (reais.length > MAX_INTEGER_DIGITS) return null;
  const intText = reais === '' ? '0' : reais;
  const frac = parts.frac ?? '';
  const cents = Number(intText) * 100 + Number(frac.padEnd(2, '0') || '0');
  const typedText = `R$ ${groupThousands(intText)}${hasComma ? `,${frac}` : ''}`;
  return { cents, text: mode === 'paste' ? formatCents(cents) : typedText };
}
