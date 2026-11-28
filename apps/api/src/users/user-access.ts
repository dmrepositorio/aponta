import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

/** Stub neutro (RED): ainda nao decide por permissao nem por grupo protegido. */
@Injectable()
export class UserAccess {
  constructor(private readonly flags: FeatureFlagsService) {}

  isPermissionOnly(): boolean {
    return this.flags.isRbacPermissionOnly();
  }

  agentsWhere(): Prisma.UserWhereInput {
    return {};
  }

  protectedAdminWhere(): Prisma.UserWhereInput | undefined {
    return undefined;
  }
}
