import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { UsersModule } from '../users/users.module';
import { SocialAuthController } from './social-auth.controller';
import { OAUTH_FETCH, SocialAuthService } from './social-auth.service';

@Module({
  imports: [PrismaModule, ConfigModule, FeatureFlagsModule, UsersModule, TwoFactorModule, AuthModule],
  controllers: [SocialAuthController],
  providers: [SocialAuthService, { provide: OAUTH_FETCH, useValue: (url: string, init?: object) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) }],
})
export class SocialAuthModule {}
