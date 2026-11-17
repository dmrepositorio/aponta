import { Injectable } from '@nestjs/common';

export type PasswordTokenPurpose = 'INVITE' | 'RESET';

/** STUB (DMTE-550, fase A): assinatura do contrato, sem comportamento. */
@Injectable()
export class PasswordTokensService {
  async issue(
    _userId: string,
    _purpose: PasswordTokenPurpose,
    _ttlMs: number,
    _now: Date = new Date(),
    _createdById?: string,
  ): Promise<string> {
    return '';
  }

  async consume(
    _rawToken: string,
    _now: Date = new Date(),
  ): Promise<{ userId: string; purpose: PasswordTokenPurpose } | null> {
    return null;
  }
}
