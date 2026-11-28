import { DeskAccess } from './desk-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyDeskAccess = () =>
  new DeskAccess({ isRbacPermissionOnly: () => false } as any, { getEffectivePermissions: async () => new Set<string>() } as any);
