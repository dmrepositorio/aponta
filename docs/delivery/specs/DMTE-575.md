# Comparar o tempo de atendimento para a diretoria

A diretoria quer acompanhar a evolução do tempo até a primeira resposta pública e até a resolução dos tickets. O relatório agregado é entregue por GET /reports/response-time-comparison. A entrega no Multica é DMTE-575.

AC-01: comparar os dois últimos meses completos em UTC, inclusive na virada do ano.
AC-02: calcular a primeira resposta pública de autor diferente do solicitante e usar o fechamento do ticket para o tempo de resolução. Apresentar dados agregados, sem identificar atendentes.
AC-03: comparar as medianas, informar variação e veredito com limiar de 5%, tratar período sem dados e sinalizar menos de dez tickets em qualquer período.
AC-04: exigir a permissão VIEW_ADMIN_REPORTS para acessar o endpoint.
