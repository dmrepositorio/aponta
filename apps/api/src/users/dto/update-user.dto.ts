import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Role } from '@prisma/client';
import { Trim, TrimLower, TrimOrNull } from './transforms';

/**
 * Edição pelo administrador (DMTE-550). Corpo parcial: o que não vem não muda.
 * `null` só limpa os campos opcionais (telefone, ramal, cliente e grupo de atendentes);
 * nome, e-mail e tipo são obrigatórios, então `ValidateIf` não deixa `null` escapar.
 */
export class UpdateUserDto {
  @ValidateIf((_, v) => v !== undefined)
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ValidateIf((_, v) => v !== undefined)
  @TrimLower()
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email?: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  extension?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  technicalGroupId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  permissionGroupIds?: string[];
}
