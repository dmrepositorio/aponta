import { canRemoveWorklogs } from './ticket-deletion';

/**
 * Lote 2a2 (#542), tracker #523: quem remove apontamento ao excluir ticket ou cliente.
 * A permissão (DELETE_ANY_WORKLOG) é resolvida por quem chama e chega como booleano;
 * a função não olha o perfil.
 */
const ticket = (authors: string[], voided: string[] = [], pre: string[] = []) => ({
  worklogs: [
    ...authors.map((authorId) => ({ authorId, voidedAt: null })),
    ...voided.map((authorId) => ({ authorId, voidedAt: new Date('2026-10-01') })),
  ],
  preAppointments: pre.map((authorId) => ({ authorId })),
});

describe('canRemoveWorklogs', () => {
  const me = { id: 'me' };

  it('quem pode remover qualquer apontamento remove, mesmo de outro autor', () => {
    expect(canRemoveWorklogs(ticket(['other']), me, true)).toBe(true);
    expect(canRemoveWorklogs(ticket(['other'], [], ['other2']), me, true)).toBe(true);
  });

  it('sem a permissão, só remove se todos os apontamentos e pré-apontamentos forem dele', () => {
    expect(canRemoveWorklogs(ticket(['me', 'me'], [], ['me']), me, false)).toBe(true);
    expect(canRemoveWorklogs(ticket(['me', 'other']), me, false)).toBe(false);
    expect(canRemoveWorklogs(ticket(['me'], [], ['other']), me, false)).toBe(false);
  });

  it('apontamento anulado de outro autor não conta contra quem não tem a permissão', () => {
    expect(canRemoveWorklogs(ticket(['me'], ['other']), me, false)).toBe(true);
  });

  it('ticket sem apontamento é removível por qualquer um', () => {
    expect(canRemoveWorklogs(ticket([]), me, false)).toBe(true);
  });

  it('o perfil não decide: usuário com perfil ADMIN sem a permissão não remove apontamento alheio', () => {
    expect(canRemoveWorklogs(ticket(['other']), { id: 'me', role: 'ADMIN' } as never, false)).toBe(false);
  });

  it('o perfil não decide: usuário com perfil AGENT com a permissão remove apontamento alheio', () => {
    expect(canRemoveWorklogs(ticket(['other']), { id: 'me', role: 'AGENT' } as never, true)).toBe(true);
  });
});
