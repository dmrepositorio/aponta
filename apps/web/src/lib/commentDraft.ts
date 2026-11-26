// GH-448 DET-14: rascunho de comentário por usuário e ticket, em sessionStorage (por viewer/aba).
// A chave inclui o id do usuário para que outro login na mesma aba nunca leia o rascunho alheio, e o
// logout apaga todos (clearCommentDrafts). Storage indisponível nunca quebra a tela.
const PREFIX = 'aponta:comment-draft:';

const keyFor = (userId: string, ticketId: string) => `${PREFIX}${userId}:${ticketId}`;

export function readCommentDraft(userId: string | undefined, ticketId: string): string {
  if (!userId) return '';
  try {
    return window.sessionStorage.getItem(keyFor(userId, ticketId)) ?? '';
  } catch {
    return '';
  }
}

export function writeCommentDraft(userId: string | undefined, ticketId: string, content: string) {
  if (!userId) return;
  try {
    if (content) window.sessionStorage.setItem(keyFor(userId, ticketId), content);
    else window.sessionStorage.removeItem(keyFor(userId, ticketId));
  } catch {
    // sem storage: o rascunho só não é preservado.
  }
}

export function clearCommentDrafts() {
  try {
    const storage = window.sessionStorage;
    for (const key of Object.keys(storage)) {
      if (key.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch {
    // sem storage: nada a limpar.
  }
}
