import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { PasswordFlowService } from './password-flow.service';
import { PasswordFlowFlagGuard } from './password-flow-flag.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UpdateUserActiveDto } from './dto/update-user-active.dto';
import { UpdateUsersActiveDto } from './dto/update-users-active.dto';
import { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

interface AuthenticatedRequest {
  user: CurrentUserPayload;
}

// D16: erro de filtro com mensagem fixa. A mensagem padrão do `forbidNonWhitelisted` devolve o nome da chave
// recebida (ex.: `roles[$ne]`); por isso o param é `object` (o pipe global não o valida) e este pipe valida
// como UserQueryDto. shortcut: o Swagger perde o esquema desta query; declarar `@ApiQuery` se for preciso.
const userQueryPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  expectedType: UserQueryDto,
  exceptionFactory: () => new BadRequestException('Parâmetros de busca inválidos.'),
});

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordFlow: PasswordFlowService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermission('MANAGE_USERS')
  async findAll(@Query(userQueryPipe) query: object) {
    return this.usersService.findAll(query as UserQueryDto);
  }

  @Post()
  @RequirePermission('CREATE_USERS')
  async create(@Body() dto: AdminCreateUserDto) {
    return this.usersService.createByAdmin(dto);
  }

  // Agent-assignment dropdown: any user who can work tickets needs to see
  // who tickets can be assigned to, so this rides VIEW_AND_OPEN_TICKETS
  // rather than MANAGE_USERS (which would wrongly require admin-grade
  // access just to populate an assignee picker).
  @Get('agents')
  @RequirePermission('VIEW_AND_OPEN_TICKETS')
  async getAgents(@Req() req: AuthenticatedRequest) {
    return this.usersService.findAgents(req.user);
  }

  // Declarada antes de ':id' para "active" não ser lido como id.
  @Patch('active')
  @RequirePermission('ACTIVATE_DEACTIVATE_USERS')
  async setActiveMany(@Req() req: AuthenticatedRequest, @Body() dto: UpdateUsersActiveDto) {
    return this.usersService.setActiveMany(dto.ids, dto.active, req.user.id);
  }

  @Get(':id')
  @RequirePermission('MANAGE_USERS')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_USERS')
  async update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    // Trocar o tipo exige também CHANGE_USER_ROLE; ADMIN tem o bypass do guard.
    const canChangeRole =
      dto.role === undefined || req.user.role === Role.ADMIN || (await this.permissions.hasPermission(req.user.id, 'CHANGE_USER_ROLE'));
    return this.usersService.update(id, dto, canChangeRole);
  }

  @Patch(':id/active')
  @RequirePermission('ACTIVATE_DEACTIVATE_USERS')
  async setActive(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateUserActiveDto) {
    return this.usersService.setActive(id, dto.active, req.user.id);
  }

  @Post(':id/invite')
  @UseGuards(PasswordFlowFlagGuard)
  @RequirePermission('SEND_USER_INVITES_AND_RESETS')
  async invite(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.passwordFlow.sendInvite(id, req.user.id);
    return { ok: true };
  }

  @Post(':id/password-reset')
  @UseGuards(PasswordFlowFlagGuard)
  @RequirePermission('SEND_USER_INVITES_AND_RESETS')
  async passwordReset(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.passwordFlow.sendReset(id, req.user.id);
    return { ok: true };
  }
}
