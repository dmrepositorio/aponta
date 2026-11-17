import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsInt, Min, Max, Matches, ValidateIf } from 'class-validator';
import { DocumentType } from '@prisma/client';
import { BlankToNull, CNPJ_MESSAGE, CnpjDigits } from './blank-document.transform';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  // ValidateIf no lugar de IsOptional: este deixaria passar `null`, que limparia o CNPJ.
  @ValidateIf((o) => o.cnpj !== undefined)
  @Matches(/^\d{14}$/, { message: CNPJ_MESSAGE })
  @CnpjDigits()
  cnpj?: string;

  @IsOptional()
  @IsString()
  @BlankToNull()
  cpf?: string;

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  municipalRegistration?: string;

  @IsOptional()
  @IsString()
  stateRegistration?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  serviceType?: string;

  @IsOptional()
  @IsString()
  healthStatus?: string;

  @IsOptional()
  @IsString()
  workFolder?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  visibleToClients?: boolean;

  /** Tiflux-parity (#58): faturamento quarteirizado e preferências */
  @IsOptional()
  @IsBoolean()
  quarterlyBilling?: boolean;

  @IsOptional()
  @IsString()
  billingEmails?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billingDueDay?: number;

  @IsOptional()
  @IsString()
  billingMethod?: string;

  @IsOptional()
  @IsString()
  billingNotes?: string;
}
