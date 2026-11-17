# Cadastro por CNPJ recusa CNPJ ativo na Receita

Identidade: DMTE-556, issue dmrepositorio/aponta#321, Tier 1, pai Multica `01a1e9d3-99f7-7278-a2fc-9a849d0fb893`. Origem: relato do usuário com dois prints (Clientes > Cadastrar Parceiro por CNPJ recusa o CNPJ 27.809.887/0002-09, filial com situação ATIVA no comprovante da Receita).

## Situação atual (código observado na base `fbb67df`)

- `apps/api/src/organizations/cnpj-lookup.service.ts` consulta só a BrasilAPI. Em 2026-11-17, `GET https://brasilapi.com.br/api/cnpj/v1/27809887000209` respondeu 404; publica.cnpj.ws, minhareceita.org, receitaws.com.br e open.cnpja.com devolveram o cadastro. Os dígitos verificadores do CNPJ estão corretos.
- `apps/web/src/pages/OrganizationsPage.tsx` (`catch` da consulta) mostra "CNPJ não encontrado ou inválido na Receita Federal." para qualquer falha, inclusive 502 (provedor fora do ar).
- Hipótese não provada: a base da BrasilAPI não tem esse estabelecimento, de forma permanente ou intermitente. A correção não depende de saber qual.

## Decisões

1. **Cadeia de provedores, nesta ordem:** BrasilAPI (atual) → ReceitaWS (`GET https://receitaws.com.br/v1/cnpj/<14 dígitos>`, indicada pelo responsável) → minhareceita.org (`GET https://minhareceita.org/<14 dígitos>`, proposta minha; mesmos campos da BrasilAPI). Verificado em 2026-11-17 para o CNPJ do relato: ReceitaWS e minhareceita.org devolvem o cadastro. ReceitaWS usa campos próprios (`nome`, `fantasia`, `cep` com pontuação, `status`) e limita a 3 consultas por janela (`x-ratelimit-limit: 3`); por isso fica atrás da BrasilAPI e só é chamada quando ela falha. O 429 da ReceitaWS conta como falha do provedor.
2. **API da própria Receita (Serpro, "Consulta CNPJ" do catálogo Conecta gov.br): fora desta entrega, pendência do responsável.** É contratada e exige credenciais; não encontrei página oficial que confirme trial, preço ou fluxo de token, e não há credencial no projeto. Para entrar na cadeia, o responsável precisa decidir a contratação e fornecer as credenciais pelo canal de segredos do projeto; vira ticket próprio.
3. **API.** `CnpjLookupService.lookup` percorre a cadeia e devolve o primeiro cadastro encontrado, sempre como `CnpjLookupResult` (CEP só com dígitos).
   - 400 de qualquer provedor (número inválido): para e lança `BadRequestException`, sem consultar os seguintes;
   - 404 ou falha (5xx, 429, rede) de um provedor: segue para o próximo; ReceitaWS 200 com `status: "ERROR"` conta como 404;
   - nenhum achou: `NotFoundException` só se todos responderam 404; se algum falhou, `BadGatewayException`, porque não dá para afirmar que o CNPJ não existe.
4. **Feature flag** `consulta-cnpj-alternativa` (owner `alfredo`, padrão `true`, remoção até 2026-12-18), porque os provedores reserva são chamadas externas novas (AGENTS.md). Desligada, o serviço consulta só a BrasilAPI, como hoje.
5. **Web.** O `catch` da consulta separa: 400 ou 404 mostram a frase atual; qualquer outro caso mostra "Não foi possível consultar a Receita Federal agora. Tente novamente em instantes." O modal continua aberto e mantém o CNPJ digitado.
6. **Fora do escopo:** API oficial do Serpro (item 2), validação local de dígitos verificadores, cache de consultas, troca do provedor principal, qualquer escrita em dados de cliente.

## Acceptance criteria

- AC-01: com a BrasilAPI respondendo 404 e a ReceitaWS respondendo 200, `lookup` devolve o cadastro mapeado para `CnpjLookupResult` (`cnpj` e CEP só com dígitos).
- AC-02: com a BrasilAPI respondendo 5xx ou falhando na rede, e a ReceitaWS falhando (429 ou rede), `lookup` devolve o cadastro da minhareceita.org.
- AC-03: com todos os provedores respondendo 404 (ou a ReceitaWS respondendo 200 com `status: "ERROR"`), `lookup` lança `NotFoundException`.
- AC-04: sem nenhum cadastro encontrado e com pelo menos um provedor falhando (5xx, 429 ou rede), `lookup` lança `BadGatewayException`.
- AC-05: com a BrasilAPI respondendo 200, nenhum outro provedor é chamado; com a BrasilAPI respondendo 400, os outros também não são chamados e `lookup` lança `BadRequestException`.
- AC-06: com a flag `consulta-cnpj-alternativa` desligada e a BrasilAPI respondendo 404, `lookup` lança `NotFoundException` sem chamar outro provedor.
- AC-07: o registro de flags traz `consulta-cnpj-alternativa` com owner, padrão e data de remoção.
- AC-08: no cadastro por CNPJ, quando a API responde 404 ou 400, o modal mostra "CNPJ não encontrado ou inválido na Receita Federal."; quando responde 502 ou falha sem resposta, mostra "Não foi possível consultar a Receita Federal agora. Tente novamente em instantes."; nos dois casos o modal segue aberto com o CNPJ digitado.

## Testes (seams: serviço com `fetch` simulado por URL, como em `cnpj-lookup.service.spec.ts`; página pela Testing Library)

- AC-01 a AC-06: `apps/api/src/organizations/cnpj-lookup.service.spec.ts`.
- AC-07: `apps/api/src/feature-flags/feature-flags.spec.ts`.
- AC-08: `apps/web/src/pages/OrganizationsPage.test.tsx`, junto dos testes de `/organizations/cnpj-lookup`.
- Sem fixture com dado real de cliente: os testes usam o CNPJ de referência já presente no spec atual. O CNPJ do relato aparece só nesta SPEC e na issue, como evidência de origem.
- Rede real: não entra no CI. A checagem contra os provedores reais foi feita à mão no planejamento (só leitura, uma chamada por provedor) e se repete na implementação.

## Avaliação de design

Sem componente, prop ou token novo; só troca o texto de erro do modal existente. Sem story nova.

## Riscos

- Limites de uso dos provedores reserva não são garantidos (serviços gratuitos de terceiros; a ReceitaWS declara 3 consultas por janela): só são chamados quando o anterior falha, a flag permite desligar, e a ordem põe a ReceitaWS atrás da BrasilAPI.
- O CNPJ consultado pode ir também aos provedores reserva. É dado público de pessoa jurídica; sem dado de usuário nem credencial.
- Sem impacto em RBAC nem tenant: a rota mantém `MANAGE_CLIENTS_AND_RESOURCE_GROUPS`.
