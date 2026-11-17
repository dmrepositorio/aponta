import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsUUID } from 'class-validator';

/** Ativar/inativar em lote (DMTE-550): tudo ou nada, até 100 usuários. */
export class UpdateUsersActiveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];

  @IsBoolean()
  active!: boolean;
}
