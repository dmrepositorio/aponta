import { Module } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { ArticlesController } from './articles.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ArticleAccess } from './article-access';
@Module({
  imports: [PrismaModule, PermissionsModule, FeatureFlagsModule],
  controllers: [ArticlesController],
  providers: [ArticlesService, ArticleAccess],
  exports: [ArticlesService],
})
export class ArticlesModule {}