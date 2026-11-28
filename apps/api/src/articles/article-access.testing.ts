import { ArticleAccess } from './article-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyArticleAccess = () =>
  new ArticleAccess({ isRbacPermissionOnly: () => false } as any, { hasPermission: async () => false } as any);
