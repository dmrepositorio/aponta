import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';
import { ScreenPreferenceData, UserScreenPreferencesService } from './user-screen-preferences.service';

interface AuthenticatedRequest {
  user: CurrentUserPayload;
}

/** DMTE-527 T2 (stub neutro, sem comportamento nem guard): rotas de preferência de tela do usuário autenticado. */
@Controller('me/screen-preferences')
export class UserScreenPreferencesController {
  constructor(protected readonly preferences: UserScreenPreferencesService) {}

  @Get(':screen')
  get(@Param('screen') _screen: string, @Req() _req: AuthenticatedRequest): Promise<ScreenPreferenceData> {
    return Promise.resolve(undefined as never);
  }

  @Put(':screen')
  put(
    @Param('screen') _screen: string,
    @Body() _body: ScreenPreferenceData,
    @Req() _req: AuthenticatedRequest,
  ): Promise<ScreenPreferenceData> {
    return Promise.resolve(undefined as never);
  }
}
