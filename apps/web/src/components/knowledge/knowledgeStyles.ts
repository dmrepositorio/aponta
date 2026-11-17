/**
 * Primário da tela de Conhecimento: `brand-600` com texto branco dá 4,64:1; o
 * `brand-500` do `EzButton` dá 3,94:1. shortcut: classe local, sem tocar no DS;
 * sai quando o primário do `EzButton` for corrigido para todas as telas.
 */
export const KNOWLEDGE_PRIMARY =
  'bg-brand-600 border-brand-600 hover:bg-brand-700 hover:border-brand-700';

/** Anel de foco do `EzButton`, para elementos clicáveis que não são `EzButton`. */
export const FOCUS_RING =
  'outline-none focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:ring-offset-2';
