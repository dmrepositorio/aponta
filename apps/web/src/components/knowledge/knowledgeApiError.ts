/**
 * Mensagem de uma recusa da API (response.data.message, string ou lista de
 * validação) ou o texto padrão quando a falha não traz mensagem (rede, 5xx).
 */
export function knowledgeApiError(error: unknown, fallback: string): string {
  const message = (
    error as { response?: { data?: { message?: unknown } } } | null
  )?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message)) {
    const joined = message
      .filter((m): m is string => typeof m === 'string')
      .join(' ');
    if (joined.trim()) return joined;
  }
  return fallback;
}
