---
name: aponta-review
description: Revisar independentemente o SHA entregue pelo executor do Aponta e devolver aprovação, rejeição comprovada ou bloqueio operacional, como comentário no PR.
---

# Revisão independente

Receba base/head SHA, critérios de aceite, SPEC e as evidências de testes. Verifique o diff exato e o estado de trabalho. Não revise apenas o último commit por conveniência quando a entrega envolver vários commits.

Antes de executar qualquer coisa, olhe o diff inteiro em busca de mudança fora do que o pedido descreve: workflow, script de deploy, Dockerfile, dependência ou lockfile, migração, permissão, credencial, arquivo binário. Mudança desse tipo sem explicação impede a aprovação. Dependência segue `security-and-hardening` (origem e supply chain) e `deprecation-and-migration`.

Reproduza os testes relevantes com cache desativado, confira typecheck e build, e execute E2E (`scripts/e2e_isolated.sh`) quando o escopo ou o risco exigir. Examine RBAC, filtros entre tenants, validação de entrada e regressões nos consumidores. Para UI/DS, use `aponta-storybook`; para mudança de comportamento, confira que o teste novo falha por asserção sem a implementação e passa com ela.

Inspecione o motivo da falha do teste, não apenas o exit code. Se há `ModuleNotFoundError`/`ImportError` ou erro de setup, rejeite essa evidência de TDD mesmo com o teste passando depois. Dê vereditos separados para conformidade funcional e conformidade de TDD; uma aprovação funcional não esconde falta de prova de TDD. Teste obtido quebrando ou revertendo código pronto é evidência fabricada.

Publique o parecer como comentário no PR, com um resultado inequívoco e o SHA revisado:
- **aprovado**: todos os gates aplicáveis passaram (ou há exceção explícita documentada);
- **rejeitado**: defeito ou desconformidade comprovados, com achados (severidade, arquivo/localização e reprodução). Achado Important ou superior impede aprovação;
- **bloqueado**: avaliação impedida por requisito operacional ausente, com causa, pergunta e responsável.

Não implemente a correção nem altere o PR para aprovar o próprio achado. Na rejeição, o status volta a `desenvolvimento`; depois do novo SHA, revise de novo, sem repetir a mesma revisão se o diff não mudou.
