import { MaskAccess } from './mask-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyMaskAccess = () =>
  new MaskAccess({ isRbacPermissionOnly: () => false } as any, { hasPermission: async () => false } as any);
