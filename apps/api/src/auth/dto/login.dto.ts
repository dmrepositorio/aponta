import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { TrimLower } from '../../users/dto/transforms';

export class LoginDto {
  @TrimLower()
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email!: string;

  // Sem aparar: espaços fazem parte da senha.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
