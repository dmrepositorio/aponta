import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { CommentsService } from '../../comments/comments.service';
import { CommercialReportsService } from '../../reports/commercial-reports.service';
import { TicketsService } from '../../tickets/tickets.service';
import { WorklogsService } from '../../worklogs/worklogs.service';
import { ScopeAccess } from './scope-access';

/**
 * Lote 2e2 (#584): o `ScopeAccess` e `@Optional()` nos services de chamados, entao um provider esquecido
 * nao da erro, so faz o service decidir por perfil mesmo com a flag ligada. Compila o AppModule real e
 * prova que cada service afetado recebeu a dependencia.
 */
describe('injecao do ScopeAccess (chamados) no AppModule real', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  const previous = process.env.JWT_SECRET;
  beforeAll(async () => {
    process.env.JWT_SECRET = 'valor-de-teste-sem-segredo-real';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });
  afterAll(async () => {
    await moduleRef?.close();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });

  it.each([
    ['TicketsService', TicketsService],
    ['CommentsService', CommentsService],
    ['WorklogsService', WorklogsService],
    ['CommercialReportsService', CommercialReportsService],
  ] as const)('%s recebe o ScopeAccess', (_name, token) => {
    const service = moduleRef.get(token as any, { strict: false }) as Record<string, unknown>;
    expect(service['scope']).toBeInstanceOf(ScopeAccess);
  });
});
