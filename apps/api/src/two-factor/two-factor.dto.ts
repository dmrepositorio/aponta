import { IsString, MaxLength } from 'class-validator';

export class ConfirmTwoFactorDto {
  @IsString()
  @MaxLength(32)
  code!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MaxLength(128)
  password!: string;

  @IsString()
  @MaxLength(32)
  code!: string;
}
