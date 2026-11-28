import { Test } from '@nestjs/testing';
import { PermissionGroupsModule } from './permission-groups.module';
import { PermissionGroupsService } from './permission-groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserAccess } from '../users/user-access';

/** Lote 2h (#578): o modulo injeta o UserAccess de verdade; sem ele a guarda ficaria desligada em silencio. */
describe('PermissionGroupsModule: guarda do ultimo administrador', () => {
  it('injeta o UserAccess no PermissionGroupsService', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PermissionGroupsModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    const service = moduleRef.get(PermissionGroupsService) as unknown as { access?: UserAccess };
    expect(service.access).toBeInstanceOf(UserAccess);
    await moduleRef.close();
  });
});
