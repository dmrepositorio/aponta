import { ContractAccess } from './contract-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyContractAccess = () =>
  new ContractAccess({ isRbacPermissionOnly: () => false } as any, { hasPermission: async () => false } as any);
