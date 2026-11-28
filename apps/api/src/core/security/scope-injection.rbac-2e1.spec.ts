import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { AgendaService } from '../../agenda/agenda.service';
import { CommentsService } from '../../comments/comments.service';
import { ContractsService } from '../../contracts/contracts.service';
import { ReportsService } from '../../reports/reports.service';
import { ServiceDesksService } from '../../service-desks/service-desks.service';
import { DeskAccess } from '../../service-desks/desk-access';
import { TicketsService } from '../../tickets/tickets.service';
import { UsersService } from '../../users/users.service';
import { VaultService } from '../../vault/vault.service';
import { WorklogsService } from '../../worklogs/worklogs.service';
import { ScopeAccess } from './scope-access';

/**
 * Lote 2e1 (#549): as dependencias sao `@Optional()`, entao um provider esquecido nao da erro,
 * so faz o service decidir por perfil mesmo com a flag ligada. Compila o AppModule real e prova
 * que cada um dos 9 services recebeu a dependencia nova.
 */
describe('injecao do ScopeAccess e do DeskAccess no AppModule real', () => {
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
    ['AgendaService', AgendaService, 'scope', ScopeAccess],
    ['ContractsService', ContractsService, 'scope', ScopeAccess],
    ['ReportsService', ReportsService, 'scope', ScopeAccess],
    ['ServiceDesksService', ServiceDesksService, 'scope', ScopeAccess],
    ['UsersService', UsersService, 'scope', ScopeAccess],
    ['VaultService', VaultService, 'scope', ScopeAccess],
    ['TicketsService', TicketsService, 'deskAccess', DeskAccess],
    ['CommentsService', CommentsService, 'deskAccess', DeskAccess],
    ['WorklogsService', WorklogsService, 'deskAccess', DeskAccess],
  ] as const)('%s recebe a dependencia nova', (_name, token, field, expected) => {
    const service = moduleRef.get(token as any, { strict: false }) as Record<string, unknown>;
    expect(service[field]).toBeInstanceOf(expected);
  });
});
