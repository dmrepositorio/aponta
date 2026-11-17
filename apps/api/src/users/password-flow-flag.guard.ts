import { CanActivate, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PASSWORD_FLOW_FLAG } from './password-flow.service';

/** Flag desligada: a rota some (404) antes de a validação do corpo ou do id responder 400. */
@Injectable()
export class PasswordFlowFlagGuard implements CanActivate {
  // @Optional: módulos de teste que montam só o AuthController não têm as flags; sem elas a rota fica desligada.
  constructor(@Optional() private readonly flags?: FeatureFlagsService) {}

  canActivate(): boolean {
    if (!this.flags?.isEnabled(PASSWORD_FLOW_FLAG)) throw new NotFoundException();
    return true;
  }
}
