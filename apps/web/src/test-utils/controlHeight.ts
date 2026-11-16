/**
 * Contrato de altura por faixa (DMTE-527): jsdom não compila Tailwind nem mede layout,
 * então a altura é conferida pelas classes. Aceita as duas formas de escrever a faixa
 * abaixo de `sm` (`min-h-11` ou `h-11`, 44 px) e o token da faixa a partir de `sm`.
 */
export type HeightKind = 'toolbar' | 'compact';

const HEIGHT_TOKENS: Record<HeightKind, string[]> = {
  toolbar: ['h-[var(--control-height-toolbar)]'],
  compact: ['h-[var(--control-height-compact)]', 'h-[32px]'],
};

/** Classes do elemento e dos ancestrais até `stopAt` (exclusive), para controles pintados por variante do wrapper. */
export function classesUpTo(element: Element, stopAt?: Element | null): string {
  const found: string[] = [];
  for (let node: Element | null = element; node && node !== stopAt; node = node.parentElement) {
    found.push(node.getAttribute('class') ?? '');
  }
  return found.join(' ');
}

export function classTokens(classes: string): string[] {
  return classes.split(/\s+/).filter(Boolean);
}

/** Lista vazia = contrato cumprido; senão, o que falta (aparece na mensagem do `toEqual([])`). */
export function heightContractProblems(
  classes: string,
  kind: HeightKind,
  { touchFloor = true }: { touchFloor?: boolean } = {},
): string[] {
  const tokens = classTokens(classes);
  const ends = (suffix: string) => tokens.some((token) => token.endsWith(suffix));
  const fromSm = HEIGHT_TOKENS[kind].some((height) => ends(`sm:${height}`));
  const bare = HEIGHT_TOKENS[kind].some((height) =>
    tokens.some((token) => token.endsWith(height) && !token.endsWith(`sm:${height}`)),
  );
  const problems: string[] = [];
  if (!fromSm && !bare) problems.push(`falta a altura ${HEIGHT_TOKENS[kind][0]}`);
  const floor =
    ends('max-sm:min-h-11') ||
    ends('max-sm:h-11') ||
    (fromSm && (tokens.some((token) => /(^|:)h-11$/.test(token)) || (ends('min-h-11') && ends('sm:min-h-0'))));
  if (touchFloor && !floor) problems.push('falta o piso de 44 px abaixo de sm (min-h-11)');
  return problems;
}
