import { IsString, MaxLength } from 'class-validator';

export class ExchangeSocialCodeDto {
  @IsString()
  @MaxLength(128)
  code!: string;
}
