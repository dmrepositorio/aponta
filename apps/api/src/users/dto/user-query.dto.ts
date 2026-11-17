import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'PENDING'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export class UserQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou e-mail' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Filtra por grupo de atendentes (TechnicalGroup)' })
  @IsOptional()
  @IsUUID()
  technicalGroupId?: string;

  @ApiPropertyOptional({ description: 'Filtra por grupo de permissões (PermissionGroup)' })
  @IsOptional()
  @IsUUID()
  permissionGroupId?: string;

  @ApiPropertyOptional({ description: 'Tipos separados por vírgula, ex.: AGENT,ADMIN', example: 'AGENT,ADMIN' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value,
  )
  @IsOptional()
  @IsArray({ message: 'roles inválido' })
  @ArrayMaxSize(Object.keys(Role).length, { message: 'roles inválido' })
  // Mensagem fixa: a padrão do class-validator lista valores e a rota não ecoa a entrada.
  @IsIn(Object.values(Role), { each: true, message: 'roles inválido' })
  roles?: Role[];

  @ApiPropertyOptional({ description: 'Situação: ACTIVE, INACTIVE ou PENDING (convite pendente)', enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES, { message: 'status inválido' })
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Página da paginação', example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Quantidade de itens por página', example: '20' })
  @IsOptional()
  @IsString()
  pageSize?: string;
}
