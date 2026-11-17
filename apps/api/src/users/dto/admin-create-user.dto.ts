import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Trim, TrimLower, TrimOrNull } from './transforms';

/** Cadastro pelo administrador (DMTE-550): sem senha; o usuário nasce com convite pendente. */
export class AdminCreateUserDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @TrimLower()
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

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
