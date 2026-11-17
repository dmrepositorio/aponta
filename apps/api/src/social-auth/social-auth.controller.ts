import { Body, Controller, Get, Headers, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../auth/auth.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { UsersService } from '../users/users.service';
import { ExchangeSocialCodeDto } from './social-auth.dto';
import { OAUTH_COOKIE, SocialAuthService } from './social-auth.service';

interface Reply {
  redirect(url: string): void;
  cookie(name: string, value: string, options: Record<string, unknown>): void;
}

@Controller('auth/social')
export class SocialAuthController {
  constructor(
    private readonly social: SocialAuthService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Get('providers')
  providers() {
    return { providers: this.social.providers() };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':provider/start')
  start(@Param('provider') provider: string, @Res() res: Reply) {
    const { location, cookie } = this.social.start(provider);
    res.cookie(cookie.name, cookie.value, { httpOnly: true, sameSite: 'lax', secure: cookie.secure, path: '/api/auth/social', maxAge: cookie.maxAgeSeconds * 1000 });
    res.redirect(location);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: { code?: unknown; state?: unknown; error?: unknown },
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() res: Reply,
  ) {
    const cookie = new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE}=([0-9a-f]+)`).exec(cookieHeader ?? '')?.[1];
    res.redirect(await this.social.callback(provider, query, cookie));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('exchange')
  async exchange(@Body() dto: ExchangeSocialCodeDto) {
    const userId = await this.social.exchange(dto.code);
    const user = await this.usersService.findById(userId);
    // Conta inativada entre o retorno do provedor e a troca não entra.
    if (!user || !user.active) throw new UnauthorizedException('Código inválido.');
    // Mesma regra do login por senha: quem tem segundo fator recebe o desafio, não o JWT.
    return (await this.twoFactor.challengeFor(user)) ?? this.authService.login(this.usersService.toSafeUser(user));
  }
}
