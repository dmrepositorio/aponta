import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Checked against the granular PermissionGroup catalog (DMTE-84, Tarefa 2)
 * instead of the coarse Role enum (the old role-based decorator was
 * removed). OR semantics: the request passes PermissionsGuard if the user
 * holds at least one of the listed keys.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
