import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateScreenPreference } from './screen-preference.validation';

export type ScreenPreferenceData = Record<string, unknown>;

const SCREENS = ['organizations', 'contracts', 'service-desks', 'tickets-list', 'tickets-kanban'];
const MAX_BODY_BYTES = 64 * 1024;

/** DMTE-527 T2: preferência de tela por usuário, uma linha por usuário e tela. */
@Injectable()
export class UserScreenPreferencesService {
  constructor(protected readonly prisma: PrismaService) {}

  async get(userId: string, screen: string): Promise<ScreenPreferenceData> {
    this.assertScreen(screen);
    const row = await this.prisma.userScreenPreference.findUnique({ where: { userId_screen: { userId, screen } } });
    return (row?.data as ScreenPreferenceData | undefined) ?? {};
  }

  async put(userId: string, screen: string, data: ScreenPreferenceData): Promise<ScreenPreferenceData> {
    this.assertScreen(screen);
    validateScreenPreference(data);
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_BODY_BYTES) {
      throw new BadRequestException('Preferência de tela acima de 64 KB');
    }
    const json = data as Prisma.InputJsonObject;
    const row = await this.prisma.userScreenPreference.upsert({
      where: { userId_screen: { userId, screen } },
      create: { userId, screen, data: json },
      update: { data: json },
    });
    return row.data as ScreenPreferenceData;
  }

  private assertScreen(screen: string) {
    if (!SCREENS.includes(screen)) throw new NotFoundException('Tela não encontrada');
  }
}
