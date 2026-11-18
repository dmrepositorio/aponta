# Aponta

Helpdesk em que consultores registram horas nos tickets contra a agenda e contratos do cliente.

## Language

**Agenda**:
Compromisso do tipo AGENDA de um consultor, com janela de início e fim, em geral ligado a um ticket.
_Avoid_: Calendário, escala

**Janela de atendimento**:
Intervalo em que um apontamento é aceito direto: de 1 dia antes do início da agenda até o fim dela.
_Avoid_: Horário permitido

**Apontamento**:
Registro de horas trabalhadas por um consultor num ticket, com início, fim e tipo de atendimento.
_Avoid_: Worklog, lançamento

**Pré-apontamento**:
Cronômetro aberto pelo PLAY que se torna apontamento ao ser parado.
_Avoid_: Timer

**Apontamento pendente**:
Apontamento que fugiu da regra da janela e aguarda aprovação; já conta como faturável.
_Avoid_: Apontamento em análise

**Apontamento travado**:
Apontamento encerrado por limite ou por pausa, ou depois do fim da janela, que só muda com aprovação.
_Avoid_: Apontamento bloqueado

**Liberação**:
Decisão de quem tem a permissão do tipo sobre um apontamento pendente: liberar o mantém, negar o estorna com motivo. Cada tipo (Lançamento, Cronômetro encerrado) tem a sua permissão.
_Avoid_: Aprovação, autorização

**Notificação**:
Aviso guardado dentro do sistema para um usuário e mostrado no sino, com destino interno; vem do mesmo evento do e-mail.
_Avoid_: Alerta, mensagem

**Fechamento automático**:
Encerramento do pré-apontamento pelo sistema quando o tempo trabalhado atinge a duração da agenda.
_Avoid_: Auto-stop

**Aguardando Sankhya**:
Status do ticket parado porque depende de um chamado aberto na Sankhya; pausa o SLA e conta como pausado.
_Avoid_: Aguardando Chamado Sankhya, Aguardando Terceiros (este é outro status, para terceiros em geral)

**Catálogo de serviços**:
Lista de categorias e itens oferecida na abertura de um chamado; cada item aponta para uma mesa de destino e uma prioridade padrão.
_Avoid_: Catálogo de atendimento, tipos de solicitação

**Item do catálogo**:
Serviço pré-definido do catálogo de serviços que, ao ser escolhido, fixa a mesa e a prioridade do chamado.
_Avoid_: Serviço cadastrado, tipo de chamado

**Chamado não catalogado**:
Chamado aberto sem item do catálogo, quando o solicitante declara que o problema não está catalogado.
_Avoid_: Chamado em branco, chamado avulso

**Catálogo de conhecimento**:
Classificação dos artigos da base de conhecimento por serviço; é outro recurso, sem relação com a mesa de destino de um chamado.
_Avoid_: Catálogo de serviços

**Atalho da lista**:
Botão da lista de Tickets que liga e desliga um filtro pronto, sem abrir a Busca avançada.
_Avoid_: Aba de estado, preset

**Autorização**:
Ticket em Aguardando Aprovação, que um perfil administrativo ou MASTER precisa liberar antes de seguir.
_Avoid_: Aprovação pendente

**Coluna recolhida**:
Coluna do Kanban de Tickets reduzida a uma faixa estreita com o nome e a contagem, que não aceita cartão solto sobre ela; o usuário a expande com um clique.
_Avoid_: Coluna oculta, coluna escondida

**Coluna final**:
Coluna do Kanban em que o ticket já terminou: Resolvido e Fechado por status, ou um estágio marcado como final na mesa.
_Avoid_: Última coluna

**Preferência de tela**:
Escolha de apresentação de um usuário numa tela (agrupar por, campos visíveis, colunas recolhidas); vale para aquele usuário em qualquer navegador.
_Avoid_: Configuração local, personalização

**Convite**:
E-mail com link de uso único em que a pessoa cadastrada pelo administrador define a própria senha pela primeira vez.
_Avoid_: Ativação, senha provisória

**Convite pendente**:
Situação de um usuário cadastrado que ainda não definiu a senha; ele aparece na lista, mas não entra no sistema nem recebe atribuições.
_Avoid_: Usuário não ativado, usuário provisório

**Segundo fator**:
Código de um aplicativo autenticador que o usuário informa depois da senha (ou do login social) quando ativou essa proteção em Minha Conta; é opcional.
_Avoid_: 2FA nas telas, verificação em duas etapas, MFA

**Código de recuperação**:
Um dos 10 códigos de uso único mostrados na ativação do segundo fator, que o substituem quando o aplicativo se perde.
_Avoid_: Código de backup, código de emergência

**Login social**:
Entrada com a conta Google ou GitHub de quem já tem conta ativa no Aponta, ligada pelo e-mail verificado do provedor; nunca cria usuário.
_Avoid_: Cadastro social, SSO

**Redefinição de senha**:
E-mail com link de uso único em que quem já tem senha define uma nova, pedida pelo administrador ou pelo próprio usuário na tela de login.
_Avoid_: Recuperação de senha, reset

**Cliente**:
Empresa ou pessoa atendida pelo helpdesk, cadastrada na tela Clientes; reúne solicitantes, contratos, mesas e cofre.
_Avoid_: Parceiro, organização, conta

**Exclusão de cliente**:
Remoção definitiva do cadastro do Cliente, permitida só quando ele não tem Vínculo que impede a exclusão; é diferente de inativar, que mantém o cadastro.
_Avoid_: Deleção, remoção lógica

**Vínculo que impede a exclusão**:
Registro de outra área ligado ao Cliente (ticket, mesa, contrato, usuário, cofre ou agenda) que bloqueia a Exclusão de cliente; cada vínculo diz se o usuário consegue resolvê-lo ou se a saída é inativar o Cliente.
_Avoid_: Dependência, restrição

**Exclusão de ticket**:
Remoção definitiva de um ticket, restrita a quem tem a permissão do grupo e negada quando há apontamento, sub-tickets ou solicitante que seja usuário de um Cliente.
_Avoid_: Cancelamento (cancelar fecha o ticket e o mantém)
