import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfirmTwoFactorDto, DisableTwoFactorDto } from './two-factor.dto';
import { TwoFactorService } from './two-factor.service';

@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get('status')
  async status(@Request() req: { user: { id: string } }) {
    return { enabled: await this.twoFactor.isEnabled(req.user.id) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('setup')
  setup(@Request() req: { user: { id: string } }) {
    return this.twoFactor.begin(req.user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('confirm')
  confirm(@Request() req: { user: { id: string } }, @Body() body: ConfirmTwoFactorDto) {
    return this.twoFactor.confirm(req.user.id, body.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('disable')
  async disable(@Request() req: { user: { id: string } }, @Body() body: DisableTwoFactorDto) {
    await this.twoFactor.disable(req.user.id, body.password, body.code);
    return { ok: true };
  }
}
