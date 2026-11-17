import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

export interface CnpjLookupResult {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  address: {
    zipCode: string | null;
    street: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    complement: string | null;
  };
}

interface Provider {
  url: (digits: string) => string;
  /** Nomes dos campos de razão social e nome fantasia; os demais campos são iguais nos três provedores. */
  legalName: 'razao_social' | 'nome';
  tradeName: 'nome_fantasia' | 'fantasia';
}

/**
 * BrasilAPI primeiro; os outros só são consultados quando ela não acha o CNPJ ou falha
 * (a ReceitaWS limita a 3 consultas por janela).
 */
const PROVIDERS: readonly Provider[] = [
  { url: (d) => `https://brasilapi.com.br/api/cnpj/v1/${d}`, legalName: 'razao_social', tradeName: 'nome_fantasia' },
  { url: (d) => `https://receitaws.com.br/v1/cnpj/${d}`, legalName: 'nome', tradeName: 'fantasia' },
  { url: (d) => `https://minhareceita.org/${d}`, legalName: 'razao_social', tradeName: 'nome_fantasia' },
];

type Outcome = CnpjLookupResult | 'not-found' | 'invalid' | 'failed';

/**
 * Looks up company registration data by CNPJ in public providers sourced from Receita
 * Federal data (no API key). Mirrors Tiflux's "Preenchimento inteligente" CNPJ autofill
 * on client registration.
 */
@Injectable()
export class CnpjLookupService {
  constructor(private readonly flags: FeatureFlagsService) {}

  async lookup(cnpj: string): Promise<CnpjLookupResult> {
    const digits = cnpj.replace(/\D/g, '');
    const providers = this.flags.isEnabled('consulta-cnpj-alternativa') ? PROVIDERS : PROVIDERS.slice(0, 1);
    let failed = false;
    for (const provider of providers) {
      const outcome = await this.query(provider, digits);
      if (outcome === 'invalid') throw new BadRequestException(`CNPJ ${cnpj} inválido`);
      if (outcome === 'failed') failed = true;
      else if (outcome !== 'not-found') return outcome;
    }
    // Com algum provedor fora do ar não dá para afirmar que o CNPJ não existe.
    if (failed) throw new BadGatewayException('Falha ao consultar o CNPJ. Tente novamente mais tarde.');
    throw new NotFoundException(`CNPJ ${cnpj} não encontrado`);
  }

  private async query(provider: Provider, digits: string): Promise<Outcome> {
    let data: Record<string, string | null>;
    try {
      const response = await fetch(provider.url(digits), {
        headers: { 'User-Agent': 'Aponta-Helpdesk/1.0 (+https://aponta.dmtecnologia.cloud)' },
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 404) return 'not-found';
      if (response.status === 400) return 'invalid';
      if (!response.ok) return 'failed';
      data = (await response.json()) as Record<string, string | null>;
    } catch {
      return 'failed';
    }
    if (data.status === 'ERROR') return 'not-found';
    return {
      cnpj: digits,
      legalName: data[provider.legalName] as string,
      tradeName: data[provider.tradeName] || null,
      address: {
        zipCode: data.cep?.replace(/\D/g, '') || null,
        street: [data.logradouro, data.numero].filter(Boolean).join(', ') || null,
        neighborhood: data.bairro || null,
        city: data.municipio || null,
        state: data.uf || null,
        complement: data.complemento || null,
      },
    };
  }
}
