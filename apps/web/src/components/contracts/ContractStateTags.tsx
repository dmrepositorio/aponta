// Stub neutro (RED): assinatura final, sem o comportamento.
export type ApprovalState = 'Aprovado' | 'Rascunho' | 'Regularização pendente';

export const contractStateTokenPairs: Record<string, [string, string]> = {};

export function approvalLabel(_state: { legacy: boolean; approved: boolean }): ApprovalState {
  return 'Rascunho';
}

export function ContractActiveTag(_props: { active: boolean }) {
  return null;
}

export function ContractApprovalTag(_props: { state: ApprovalState }) {
  return null;
}
