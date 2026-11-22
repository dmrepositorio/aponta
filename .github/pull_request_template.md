Entrega: #REPLACE
Refs #SPEC

## Resultado

Descreva o problema e o comportamento entregue.

## Verificação

- Testes que provam o comportamento (o teste novo falhou antes da correção):
- Typecheck, testes unitários, build e E2E: verdes no CI
- Design system e stories, quando houver UI:
- Segurança/RBAC/tenant, quando aplicável:
- Limitações e verificações pendentes:

## Revisão do QA

Cole aqui o link do comentário de revisão do QA (`/review`) no SHA final. Commit novo que muda código invalida a revisão.

Não usar `Closes`/`Fixes`. A linha `Entrega:` lista os tickets que este PR entrega: eles fecham sozinhos depois do deploy em produção, e a SPEC pai fecha com a última sub-issue. `Refs` só referencia e nunca fecha. Apague a linha `Entrega:` se o PR não entrega nenhum ticket.
