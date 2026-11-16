import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UserScreenPreferencesController } from './user-screen-preferences.controller';
import { UserScreenPreferencesService } from './user-screen-preferences.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UserScreenPreferencesController],
  providers: [UserScreenPreferencesService],
  exports: [UserScreenPreferencesService],
})
export class UserScreenPreferencesModule {}
