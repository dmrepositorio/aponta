import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { ScreenPreferenceData, UserScreenPreferencesService } from './user-screen-preferences.service';

interface AuthenticatedRequest {
  user: CurrentUserPayload;
}

/** DMTE-527 T2: cada rota age só com o id do usuário autenticado; o formato é validado no service. */
@UseGuards(JwtAuthGuard)
@Controller('me/screen-preferences')
export class UserScreenPreferencesController {
  constructor(private readonly preferences: UserScreenPreferencesService) {}

  @Get(':screen')
  get(@Param('screen') screen: string, @Req() req: AuthenticatedRequest): Promise<ScreenPreferenceData> {
    return this.preferences.get(req.user.id, screen);
  }

  @Put(':screen')
  put(
    @Param('screen') screen: string,
    @Body() body: ScreenPreferenceData,
    @Req() req: AuthenticatedRequest,
  ): Promise<ScreenPreferenceData> {
    return this.preferences.put(req.user.id, screen, body);
  }
}
