# Isolar o catálogo do piloto Dev Pipeline no Aponta

AC-01: o checkout contém os catálogos dos squads e um catálogo independente para as cinco etapas do piloto.
AC-02: o CI confere as atribuições, a revisão e a integridade dos arquivos do piloto e continua executando o verificador dos squads.
AC-03: o ensaio do wrapper confirma o CLI nativo para os cinco agentes e detecta um controle positivo que passa pelo shim.

A publicação do catálogo e a avaliação de desempenho usam projeto e checkout dedicados. O piloto mede primeiro o fluxo anterior. O atalho de triagem será avaliado em uma rodada separada.
