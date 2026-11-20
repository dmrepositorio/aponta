---
name: aponta-tdd
description: Coletar ou auditar evidências RED/GREEN do Aponta como complemento ao método da skill test-driven-development.
---

# Evidências Aponta para TDD

O método é a skill test-driven-development, incluindo testes em seams confirmadas. Este perfil define somente captura e auditoria das evidências do projeto.

Para mudanças de comportamento, escreva o teste que demonstra o defeito ou novo comportamento e execute-o antes da implementação. RED deve falhar pela expectativa comportamental correta; erro de sintaxe, dependência ou ambiente não substitui a evidência de RED.

Se o módulo/função ainda não existe, crie primeiro apenas o stub com assinatura importável e comportamento neutro (por exemplo, retornar a entrada), sem satisfazer o critério. Confirme que o runner executou o teste e falhou na asserção do comportamento; só então conte o RED. `ModuleNotFoundError`, `ImportError`, arquivo ausente e falha de setup são preparação incompleta, não RED aceito.

Implemente o mínimo para GREEN e execute o mesmo teste; refatorações ocorrem na revisão conforme test-driven-development/code-review-and-quality. Use Jest/Nest TestingModule no backend e Vitest/Testing Library no frontend conforme o projeto existente; Playwright cobre integração e jornadas. Escolha a camada que prova o comportamento sem reproduzir detalhes internos desnecessários.

Registre no PR, para cada critério `AC`: o arquivo/teste, o comando e a saída resumida da falha por asserção (antes) e da passagem (depois), além do SHA final. Não escreva resultados à mão para substituir uma execução ausente; legado sem prova fica explicitamente pendente de revisão.

Guarde a saída integral em artefato local apropriado, sem credenciais. Teste existente que já falha pela regressão pode ser o RED; documente a sequência real, sem fabricar prova retroativa.

O QA confere que o teste cobre o critério, que falha por asserção sem a implementação e reproduz o GREEN no SHA entregue. RED por import/setup deve ser rejeitado como prova de TDD, mesmo que o GREEN final passe. Sem evidência comportamental, declare `TDD não comprovado` e peça a prova ou uma exceção explícita adequada ao escopo. Não trate presença de testes ou cobertura como prova de TDD.

Bug reproduzível ganha um teste de regressão antes da correção, e a correção cobre a classe do defeito: procure os outros pontos com o mesmo padrão em vez de consertar só o que foi relatado. Implemente o item aprovado e nada além dele: sem refatoração de carona, sem abstração para uso futuro, sem código morto ou comentado, sem TODO, sem formatação ampla. Não enfraqueça, pule nem apague teste para chegar ao GREEN; teste errado é corrigido com a justificativa registrada, antes do RED. Limpeza maior que a entrega vira entrega própria.

Documentação sem comportamento e alterações puramente mecânicas podem justificar `TDD não aplicável`, com validação proporcional ao risco. Não crie testes sem valor só para preencher o relatório.
