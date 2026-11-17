# Cadastro por CNPJ recusa CNPJ ativo na Receita

Identidade: DMTE-556, issue dmrepositorio/aponta#321, Tier 1, pai Multica `01a1e9d3-99f7-7278-a2fc-9a849d0fb893`. Origem: relato do usuário com dois prints (Clientes > Cadastrar Parceiro por CNPJ recusa o CNPJ 27.809.887/0002-09, filial com situação ATIVA no comprovante da Receita).

## Situação atual (código observado na base `fbb67df`)

- `apps/api/src/organizations/cnpj-lookup.service.ts` consulta só a BrasilAPI. Em 2026-11-17, `GET https://brasilapi.com.br/api/cnpj/v1/27809887000209` respondeu 404; publica.cnpj.ws, minhareceita.org, receitaws.com.br e open.cnpja.com devolveram o cadastro. Os dígitos verificadores do CNPJ estão corretos.
- `apps/web/src/pages/OrganizationsPage.tsx` (`catch` da consulta) mostra "CNPJ não encontrado ou inválido na Receita Federal." para qualquer falha, inclusive 502 (provedor fora do ar).
- Hipótese não provada: a base da BrasilAPI não tem esse estabelecimento, de forma permanente ou intermitente. A correção não depende de saber qual.

## Decisões

1. **Provedor reserva: minhareceita.org** (`GET https://minhareceita.org/<14 dígitos>`). Fonte aberta, sem chave, mesmo formato de campos da BrasilAPI (`razao_social`, `nome_fantasia`, `cep`, `logradouro`, `numero`, `bairro`, `municipio`, `uf`, `complemento`), então o mapeamento atual serve aos dois. Verificado em 2026-11-17 para o CNPJ do relato (200), para um CNPJ inexistente (400) e para o CNPJ de referência do teste (200). Proposta minha; o responsável pode trocar o provedor antes da implementação.
2. **API.** `CnpjLookupService.lookup` consulta a BrasilAPI. Se ela responder 404, 5xx ou falhar na rede, consulta o provedor reserva. Resposta 400 da BrasilAPI (número inválido) não tem reserva e vira 400 para o cliente.
   - reserva 200: devolve o cadastro;
   - reserva 404 ou 400: 404 "CNPJ não encontrado";
   - reserva falha (5xx ou rede) depois de a BrasilAPI dar 404 ou falhar: 502, porque não dá para afirmar que o CNPJ não existe.
3. **Feature flag** `consulta-cnpj-alternativa` (owner `alfredo`, padrão `true`, remoção até 2026-12-18), porque a reserva é nova chamada externa (AGENTS.md). Desligada, o serviço volta a consultar só a BrasilAPI.
4. **Web.** O `catch` da consulta separa: 400 ou 404 mostram a frase atual; qualquer outro caso mostra "Não foi possível consultar a Receita Federal agora. Tente novamente em instantes." O modal continua aberto e mantém o CNPJ digitado.
5. **Fora do escopo:** validação local de dígitos verificadores, cache de consultas, troca de provedor principal, qualquer escrita em dados de cliente.

## Acceptance criteria

- AC-01: com a BrasilAPI respondendo 404 e o provedor reserva respondendo 200, `lookup` devolve o cadastro mapeado para `CnpjLookupResult` e o `cnpj` só com dígitos.
- AC-02: com a BrasilAPI respondendo 5xx ou falhando na rede e o reserva respondendo 200, `lookup` devolve o cadastro do reserva.
- AC-03: com a BrasilAPI e o reserva respondendo 404, `lookup` lança `NotFoundException`.
- AC-04: com a BrasilAPI respondendo 404 ou 5xx e o reserva falhando (5xx ou rede), `lookup` lança `BadGatewayException`.
- AC-05: com a BrasilAPI respondendo 200, o reserva não é chamado; com a BrasilAPI respondendo 400, o reserva também não é chamado e `lookup` lança `BadRequestException`.
- AC-06: com a flag `consulta-cnpj-alternativa` desligada e a BrasilAPI respondendo 404, `lookup` lança `NotFoundException` sem chamar o reserva.
- AC-07: o registro de flags traz `consulta-cnpj-alternativa` com owner, padrão e data de remoção.
- AC-08: no cadastro por CNPJ, quando a API responde 404 ou 400, o modal mostra "CNPJ não encontrado ou inválido na Receita Federal."; quando responde 502 ou falha sem resposta, mostra "Não foi possível consultar a Receita Federal agora. Tente novamente em instantes."; nos dois casos o modal segue aberto com o CNPJ digitado.

## Testes (seams: serviço com `fetch` simulado, como em `cnpj-lookup.service.spec.ts`; página pela Testing Library)

- AC-01 a AC-06: `apps/api/src/organizations/cnpj-lookup.service.spec.ts`.
- AC-07: `apps/api/src/feature-flags/feature-flags.spec.ts` (o teste existente de data de remoção cobre o registro; incluir a chave na checagem).
- AC-08: `apps/web/src/pages/OrganizationsPage.test.tsx`, junto dos testes de `/organizations/cnpj-lookup`.
- Sem fixture com dado real de cliente: os testes usam CNPJs sintéticos ou o de referência já presente no spec atual. O CNPJ do relato aparece só nesta SPEC e na issue, como evidência de origem.
- Rede real: não entra no CI. A checagem contra o provedor reserva real foi feita à mão no planejamento e se repete na implementação, só leitura, uma chamada.

## Avaliação de design

Sem componente, prop ou token novo; só troca o texto de erro do modal existente. Sem story nova.

## Riscos

- Limites de uso do provedor reserva não são garantidos (serviço gratuito de terceiros); por isso só é chamado quando a BrasilAPI falha, e a flag permite desligar.
- O CNPJ consultado passa a ir também ao provedor reserva. É dado público de pessoa jurídica; sem dado de usuário nem credencial.
- Sem impacto em RBAC nem tenant: a rota mantém `MANAGE_CLIENTS_AND_RESOURCE_GROUPS`.
