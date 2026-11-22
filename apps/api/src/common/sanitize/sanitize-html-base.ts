import sanitizeHtml from 'sanitize-html';

/**
 * Opções do `sanitize-html` comuns a conteúdo rico (artigos e descrição de
 * ticket). Cada consumidor informa a sua lista de tags, atributos e tags com
 * `style`; o resto (esquemas, modo de descarte, estilos permitidos) é igual.
 */
export const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
export const RGB_COLOR =
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i;
export const TEXT_ALIGN = /^(left|right|center|justify)$/i;

export const allowedStyles: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    color: [HEX_COLOR, RGB_COLOR],
    'background-color': [HEX_COLOR, RGB_COLOR],
    'text-align': [TEXT_ALIGN],
  },
};

export interface SanitizeBaseConfig {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
  styledTags: string[];
}

export function buildSanitizeOptions(
  config: SanitizeBaseConfig,
): sanitizeHtml.IOptions {
  const allowedAttributes: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(config.allowedAttributes)) {
    allowedAttributes[tag] = [...attrs];
  }
  for (const tag of config.styledTags) {
    allowedAttributes[tag] = [...(allowedAttributes[tag] ?? []), 'style'];
  }
  return {
    allowedTags: config.allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    allowedStyles,
  };
}
