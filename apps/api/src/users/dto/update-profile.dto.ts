import { IsEmail, IsString, MinLength } from 'class-validator';
import { TrimLower } from './transforms';

export class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @TrimLower()
  @IsEmail()
  email!: string;
}
