# Métodos de engenharia do Aponta

O Dev Pipeline distribui o catálogo addyosmani/agent-skills por etapa conforme docs/agents/agent-skills.json. Abra a skill em .agents/skills no checkout da demanda. O status aciona o próximo responsável uma vez. Nos squads por menção, o líder mantém a coordenação descrita no contrato de entrega.

| Agente | Método |
|---|---|
| dev_triagem | interview-me |
| dev_arquiteto | spec-driven-development, planning-and-task-breakdown |
| dev_executor | incremental-implementation, test-driven-development, debugging-and-error-recovery, git-workflow-and-versioning |
| dev_qa | code-review-and-quality |
| dev_entrega | git-workflow-and-versioning, shipping-and-launch |

Triagem confirma escopo e critérios. Use entrevista quando houver dúvida material. Planejamento registra decisões e divide trabalho quando necessário. Publique a SPEC na issue canônica e espelhe o mesmo corpo em docs/specs/ para novas entregas. Preserve caminhos registrados nos manifestos anteriores. O executor reproduz defeitos e registra RED/GREEN para mudanças comportamentais. QA verifica o SHA em checkout independente. Entrega confere PR, CI e aprovação no mesmo SHA e segue a política de integração do projeto.

UI usa DS, tokens e Storybook do Aponta. Diferencie comparação com baseline, teste funcional e aceite visual humano. Preserve decisões, limites de escopo, exigências de tenant/RBAC e evidência de entrega.

### Memória no Dev Pipeline

No Aponta, use workspace default e projeto alfredo-maia-aponta nas chamadas MCP. Ao iniciar, consulte memory_query pela entrega e assunto. Ao concluir cada etapa, grave o resultado técnico com memory_write_page em deliveries/<identificador>/<etapa>.md. Inclua critérios, decisão ou achado, SHA quando houver e links para a evidência. Leia a página existente antes de atualizá-la e preserve decisões vigentes. Registre na issue o caminho retornado. Se a chamada falhar, registre a falha real e retome a sincronização antes de avançar. A memória contém resumos e referências, sem segredos ou saídas brutas.
