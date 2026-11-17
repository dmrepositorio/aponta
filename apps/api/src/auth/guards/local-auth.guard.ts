import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from '../dto/login.dto';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  /**
   * DMTE-550: valida o corpo antes do passport-local e do banco. Guards rodam antes dos pipes, então
   * o ValidationPipe não alcança esta rota. A mensagem é fixa: nada digitado volta na resposta.
   */
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const body: unknown = req.body;
    const invalid = new BadRequestException('Dados de login inválidos.');
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid;
    const dto = plainToInstance(LoginDto, body);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) throw invalid;
    req.body = dto; // e-mail já em minúsculas
    return (await super.canActivate(context)) as boolean;
  }
}
