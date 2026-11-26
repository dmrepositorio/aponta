// Dinheiro em centavos inteiros (CTR-07). Stub neutro: o comportamento entra no commit GREEN.
export interface ParsedMoney {
  /** Centavos inteiros; null quando o campo está vazio. */
  cents: number | null;
  /** Texto a mostrar enquanto o usuário digita. */
  text: string;
}

export function parseMoney(_raw: string, _mode: 'typing' | 'paste'): ParsedMoney | null {
  return null;
}

export function formatCents(_cents: number | null): string {
  return '';
}
