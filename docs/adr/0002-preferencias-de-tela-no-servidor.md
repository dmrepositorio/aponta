---
status: accepted
---

# Preferências de tela guardadas no servidor, por usuário

As preferências de tela (agrupar por, campos visíveis, ordem de colunas, filtros salvos, colunas recolhidas do Kanban) viviam só no `localStorage` do navegador, chaveadas pelo id do usuário. Decidimos guardá-las no servidor, uma linha por usuário e por tela, porque o Alfredo quer que o estilo de cada usuário o acompanhe entre computadores e navegadores (DMTE-527, resposta ao Q12b). O `localStorage` deixa de ser a fonte: serve só para a importação única do que o usuário já tinha.

## Considered Options

- Manter o `localStorage` e só guardar o recolhimento no servidor: rejeitado, deixaria a tela com metade das preferências num lugar e metade no outro; decisão do Alfredo foi levar todas.
- Uma coluna em `User` com JSON: rejeitado, mistura configuração de tela com cadastro e cresce a cada tela nova.
- Uma tabela por tipo de preferência: rejeitado, uma tabela genérica (usuário + tela + JSON validado) atende as cinco telas de hoje sem migração nova a cada tela.

## Consequences

A API passa a validar o formato da preferência e a lista de telas aceitas; tela nova entra na lista e no validador. Duas abas ou dois computadores abertos ao mesmo tempo disputam a mesma linha, vale a última gravação. Quem já tinha preferência no navegador a importa na primeira leitura sem linha no servidor; depois disso o `localStorage` daquela tela não é mais lido.
