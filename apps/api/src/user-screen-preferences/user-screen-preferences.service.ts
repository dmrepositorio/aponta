import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ScreenPreferenceData = Record<string, unknown>;

/** DMTE-527 T2 (stub neutro, sem comportamento): preferência de tela por usuário, uma linha por usuário e tela. */
@Injectable()
export class UserScreenPreferencesService {
  constructor(protected readonly prisma: PrismaService) {}

  get(_userId: string, _screen: string): Promise<ScreenPreferenceData> {
    return Promise.resolve(undefined as never);
  }

  put(_userId: string, _screen: string, _data: ScreenPreferenceData): Promise<ScreenPreferenceData> {
    return Promise.resolve(undefined as never);
  }
}
