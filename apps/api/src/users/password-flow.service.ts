import { Injectable } from '@nestjs/common';

/** STUB (DMTE-550, fase A): assinaturas do contrato, sem comportamento. */
@Injectable()
export class PasswordFlowService {
  async sendInvite(_userId: string, _actorId: string): Promise<void> {
    return undefined;
  }

  async sendReset(_userId: string, _actorId: string): Promise<void> {
    return undefined;
  }

  async forgot(_email: string): Promise<void> {
    return undefined;
  }

  async setPassword(_token: string, _password: string): Promise<void> {
    return undefined;
  }
}
