import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { TrimLower } from './transforms';

export class ForgotPasswordDto {
  @TrimLower()
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email!: string;
}

/** Só `token` e `password`: o servidor acha o dono pelo hash, nunca por e-mail ou id vindos do cliente. */
export class SetPasswordDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
