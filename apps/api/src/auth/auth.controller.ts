import { Body, CallHandler, Controller, ExecutionContext, Get, HttpCode, HttpStatus, NestInterceptor, Optional, Patch, Post, Request, UnauthorizedException, UseGuards, UseInterceptors } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService, SafeUser } from '../users/users.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RegisterDto } from '../users/dto/register.dto';
import { ChangePasswordDto } from '../users/dto/change-password.dto';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { PasswordFlowService } from '../users/password-flow.service';
import { PasswordFlowFlagGuard } from '../users/password-flow-flag.guard';
import { ForgotPasswordDto, SetPasswordDto } from '../users/dto/password-flow.dto';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { LoginTwoFactorDto } from '../two-factor/two-factor.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

interface AuthenticatedRequest {
  user: SafeUser;
}

/**
 * Role assigned to every account created via the public, unauthenticated
 * registration endpoint. RegisterDto has no `role` field at all, so this is
 * the only role a self-registered user can ever get — never client-supplied.
 */
const DEFAULT_REGISTRATION_ROLE = Role.CLIENT;

/** Respostas das rotas de senha nunca ficam em cache (DMTE-550); roda antes da validação, então vale também para 400. */
const noStore: NestInterceptor = {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return next.handle();
  },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly permissionsService: PermissionsService,
    private readonly twoFactor: TwoFactorService,
    // @Optional: os testes que montam só o AuthController (sem e-mail nem flag) seguem construindo; em produção o UsersModule sempre o provê.
    @Optional() private readonly passwordFlow?: PasswordFlowService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Request() req: AuthenticatedRequest) {
    // Quem ativou o segundo fator recebe um desafio no lugar do JWT (DMTE-551).
    return (await this.twoFactor.challengeFor(req.user)) ?? this.authService.login(req.user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/2fa')
  async loginTwoFactor(@Body() dto: LoginTwoFactorDto) {
    const userId = await this.twoFactor.completeChallenge(dto.challengeToken, dto.code);
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Código inválido.');
    return this.authService.login(this.usersService.toSafeUser(user));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.usersService.create({
      ...registerDto,
      role: DEFAULT_REGISTRATION_ROLE,
    });
  }

  // Públicas (DMTE-550). O limite por origem é do throttler; o por e-mail do "esqueci" fica no serviço.
  @UseInterceptors(noStore)
  @UseGuards(PasswordFlowFlagGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/set')
  async setPassword(@Body() dto: SetPasswordDto) {
    await this.passwordFlow!.setPassword(dto.token, dto.password);
    return { ok: true };
  }

  @UseInterceptors(noStore)
  @UseGuards(PasswordFlowFlagGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK) // não cria recurso: o e-mail sai depois da resposta
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.passwordFlow!.forgot(dto.email);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    const user = await this.usersService.changePassword(
      req.user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
    // Token novo para a sessão que trocou a senha; os emitidos antes deixam de valer.
    return { message: 'Password updated successfully', ...(await this.authService.login(user)) };
  }

  // Backs useHasPermission on the frontend (DMTE-84, Tarefa 4): the JWT only
  // carries `role`, never the granular PermissionGroup keys, so the client
  // needs this round-trip to know which Configurações > Usuários submenu
  // items to render. ADMIN mirrors PermissionsGuard's bypass — isAdmin=true
  // regardless of PermissionGroup links, never computed from `permissions`.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: AuthenticatedRequest) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      return null;
    }
    const safeUser = this.usersService.toSafeUser(user);
    const isAdmin = user.role === Role.ADMIN;
    const permissions = isAdmin
      ? []
      : Array.from(await this.permissionsService.getEffectivePermissions(user.id));
    const canViewTicketValues = await this.permissionsService.canViewTicketValues(user.id);
    const canEditWorklogStartTime = await this.permissionsService.canEditWorklogStartTime(user.id);
    const canReleaseWorklogWithoutSchedule = await this.permissionsService.canReleaseWorklogWithoutSchedule(user.id);
    const canReleaseWorklogs = await this.permissionsService.canReleaseWorklogs(user.id);
    const canDeleteTickets = await this.permissionsService.canDeleteTickets(user.id);
    return { ...safeUser, isAdmin, permissions, canViewTicketValues, canEditWorklogStartTime, canReleaseWorklogWithoutSchedule, canReleaseWorklogs, canDeleteTickets };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(
    @Request() req: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.id, updateProfileDto);
  }
}
