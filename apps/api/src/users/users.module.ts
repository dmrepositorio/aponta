import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersService } from './users.service';
import { UserAccess } from './user-access';
import { UsersController } from './users.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { MailModule } from '../mail/mail.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PasswordTokensService } from './password-tokens.service';
import { PasswordFlowService } from './password-flow.service';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { ScopeAccess } from '../core/security/scope-access';

@Module({
  imports: [PrismaModule, PermissionsModule, MailModule, FeatureFlagsModule, TwoFactorModule],
  controllers: [UsersController],
  providers: [UsersService, UserAccess, PasswordTokensService, PasswordFlowService, ScopeAccess],
  exports: [UsersService, PasswordFlowService],
})
export class UsersModule {}
