import { ScopeAccess } from './scope-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyScopeAccess = () =>
  new ScopeAccess({ isRbacPermissionOnly: () => false } as any, { getEffectivePermissions: async () => new Set<string>() } as any);
