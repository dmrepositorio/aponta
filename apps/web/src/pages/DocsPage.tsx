import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Compass,
  Copy,
  HelpCircle,
  KeyRound,
  Bot,
  Search,
  Ticket,
  Lock,
  Briefcase,
  BarChart,
  BookMarked,
} from 'lucide-react';
import { EzButton, EzPageHeader, EzPageLayout, EzSelect, EzTextInput } from '../components/ds';
import { EzEmptyCard } from '../components/ds/EzEmptyCard';

type SectionId =
  | 'conceitos'
  | 'tickets'
  | 'relatorios'
  | 'cofre'
  | 'contratos'
  | 'conhecimento'
  | 'faq'
  | 'api'
  | 'mcp';

type Go = (id: SectionId) => void;

interface DocSection {
  id: SectionId;
  /** Título do cabeçalho da seção. */
  title: string;
  /** Rótulo do item no índice. */
  navLabel: string;
  icon: ReactNode;
  body: (go: Go) => ReactNode;
}

interface NavGroup {
  label: string;
  ids: SectionId[];
}

const NAV: NavGroup[] = [
  { label: 'Conceitos', ids: ['conceitos'] },
  { label: 'Módulos do Sistema', ids: ['tickets', 'relatorios', 'cofre', 'contratos', 'conhecimento'] },
  { label: 'FAQ', ids: ['faq'] },
  { label: 'Integrações', ids: ['api', 'mcp'] },
];

const NAV_ICONS: Record<SectionId, ReactNode> = {
  conceitos: <Compass className="h-4 w-4" />,
  tickets: <Ticket className="h-4 w-4" />,
  relatorios: <BarChart className="h-4 w-4" />,
  cofre: <Lock className="h-4 w-4" />,
  contratos: <Briefcase className="h-4 w-4" />,
  conhecimento: <BookMarked className="h-4 w-4" />,
  faq: <HelpCircle className="h-4 w-4" />,
  api: <KeyRound className="h-4 w-4" />,
  mcp: <Bot className="h-4 w-4" />,
};

const MCP_CONFIG = `{
  "mcpServers": {
    "aponta": {
      "command": "node",
      "args": ["/caminho/para/aponta/dist/apps/mcp/main.js"],
      "env": {
        "APONTA_API_URL": "https://sua-instancia.aponta.com/api",
        "APONTA_API_TOKEN": "apta_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}`;

/** Link interno de uma seção: um único scroll (o salto nativo do `#id` é cancelado). */
function DocLink({ to, go, children }: { to: SectionId; go: Go; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        go(to);
      }}
      className="text-brand-600 underline cursor-pointer"
    >
      {children}
    </a>
  );
}

function McpConfigBlock() {
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(''), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_CONFIG);
      setFeedback('Copiado');
    } catch {
      setFeedback('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  return (
    <div className="space-y-2">
      <pre className="rounded-[8px] bg-gray-80 p-3 text-sm overflow-x-auto">{MCP_CONFIG}</pre>
      <div className="flex items-center gap-3">
        <EzButton
          variant="secondary"
          size="small"
          leftIcon={Copy}
          label="Copiar configuração"
          onClick={() => void handleCopy()}
        />
        <span role="status" aria-live="polite" className="text-sm text-gray-700">
          {feedback}
        </span>
      </div>
    </div>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: 'conceitos',
    title: 'Visão geral do Aponta',
    navLabel: 'Visão geral do Aponta',
    icon: <Compass className="h-6 w-6" />,
    body: () => (
      <>
        <p>
          O <strong>Aponta</strong> é uma plataforma de Service Desk (gestão de tickets de
          atendimento) multitenant, pensada para organizar o fluxo entre clientes, agentes e
          administradores com total isolamento de dados por empresa (<em>Organização</em>).
        </p>
        <p>
          <strong>Papéis (Roles):</strong>
        </p>
        <ul className="list-disc pl-6">
          <li><strong>ADMIN</strong> — acesso global ao sistema.</li>
          <li><strong>AGENT_MASTER</strong> — vê todos os tickets das Mesas de Serviço em que atua.</li>
          <li><strong>AGENT</strong> — atende tickets das Mesas de Serviço às quais está vinculado.</li>
          <li><strong>CLIENT_MASTER</strong> — vê todos os tickets da sua Organização (empresa).</li>
          <li><strong>CLIENT</strong> — vê apenas os próprios chamados abertos.</li>
        </ul>
        <p>
          <strong>Ticket:</strong> unidade de atendimento (chamado), com protocolo único,
          prioridade, SLA de resposta/resolução e histórico de status.
        </p>
        <p>
          <strong>Mesa de Serviço (ServiceDesk):</strong> fila/departamento para onde um ticket é
          direcionado (ex: TI, Financeiro). Agentes são vinculados a uma ou mais Mesas.
        </p>
      </>
    ),
  },
  {
    id: 'tickets',
    title: 'Tickets & Kanban',
    navLabel: 'Tickets & Kanban',
    icon: <Ticket className="h-6 w-6" />,
    body: () => (
      <>
        <p>
          A <strong>Caixa de Entrada</strong> (página inicial para Agentes/Admin) exibe os tickets
          em um quadro Kanban por status (Aberto, Em Andamento, Pausado, Resolvido, Fechado).
          Arraste um card entre colunas para mudar seu status, ou use o seletor de status na tela
          de detalhe do ticket.
        </p>
        <p>
          Clientes veem a mesma lista filtrada para <strong>apenas os seus próprios chamados</strong>,
          na página <Link to="/" className="text-brand-600 underline">Meus Chamados</Link>, e podem
          abrir um novo chamado em <Link to="/tickets/new" className="text-brand-600 underline">Abrir Chamado</Link>.
        </p>
        <p>
          Cada ticket acompanha prazos de SLA (resposta e resolução) calculados a partir da Mesa de
          Serviço, com pausas automáticas quando o ticket aguarda retorno do cliente.
        </p>
      </>
    ),
  },
  {
    id: 'relatorios',
    title: 'Relatórios',
    navLabel: 'Relatórios',
    icon: <BarChart className="h-6 w-6" />,
    body: () => (
      <>
        <p>
          A aba <Link to="/reports" className="text-brand-600 underline">Relatórios</Link> reúne duas
          visões, separadas por abas:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <strong>Carga de Trabalho</strong> — minutos apontados (Worklogs) por agente. Um Agente
            comum só vê os próprios apontamentos; Admin e Agent Master veem a equipe inteira.
          </li>
          <li>
            <strong>Faturamento</strong> — horas faturáveis/não-faturáveis agregadas por
            organização. Visível apenas para <strong>ADMIN</strong> e{' '}
            <strong>CLIENT_MASTER</strong> — a API bloqueia a consulta para os demais papéis antes
            mesmo de tocar no banco de dados.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'cofre',
    title: 'Cofre de Senhas',
    navLabel: 'Cofre de Senhas',
    icon: <Lock className="h-6 w-6" />,
    body: () => (
      <p>
        O <Link to="/vault" className="text-brand-600 underline">Cofre de Senhas</Link> guarda
        credenciais de acesso a sistemas de clientes (usuário/senha, URL, notas), restrito a
        papéis internos (<strong>ADMIN</strong>, <strong>AGENT_MASTER</strong>,{' '}
        <strong>AGENT</strong>). Clientes <strong>nunca</strong> têm acesso a este módulo — a API
        retorna 403 mesmo que a URL seja acessada diretamente. Apenas <strong>ADMIN</strong> pode
        criar, editar ou excluir credenciais.
      </p>
    ),
  },
  {
    id: 'contratos',
    title: 'Contratos',
    navLabel: 'Contratos',
    icon: <Briefcase className="h-6 w-6" />,
    body: () => (
      <p>
        A tela de <Link to="/contracts" className="text-brand-600 underline">Contratos</Link> lista
        os contratos de cobertura/SLA vinculados a cada Organização. Campos financeiros (valor
        mensal, valor de última aditivo, data de reajuste) só são retornados pela API para{' '}
        <strong>ADMIN</strong> e <strong>CLIENT_MASTER</strong> — para Agentes e Agent Masters o
        próprio backend zera esses campos antes da resposta, nunca dependendo apenas da interface
        para escondê-los.
      </p>
    ),
  },
  {
    id: 'conhecimento',
    title: 'Base de Conhecimento',
    navLabel: 'Base de Conhecimento',
    icon: <BookMarked className="h-6 w-6" />,
    body: () => (
      <>
        <p>
          A <Link to="/knowledge" className="text-brand-600 underline">Base de Conhecimento</Link>{' '}
          funciona como uma Wiki/FAQ interna. Artigos podem ser marcados como{' '}
          <strong>públicos</strong> (visíveis a Clientes) ou <strong>internos</strong> (somente
          equipe).
        </p>
        <ul className="list-disc pl-6">
          <li><strong>ADMIN</strong> — cria, edita e exclui qualquer artigo.</li>
          <li><strong>AGENT / AGENT_MASTER</strong> — criam e editam, mas não podem excluir (evita perda de histórico).</li>
          <li><strong>CLIENT / CLIENT_MASTER</strong> — veem apenas artigos marcados como públicos.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq',
    title: 'Dúvidas Frequentes',
    navLabel: 'Dúvidas Frequentes',
    icon: <HelpCircle className="h-6 w-6" />,
    body: (go) => (
      <div className="space-y-4">
        <div>
          <p className="font-semibold">Como abro um novo chamado?</p>
          <p>
            Clique em <strong>Abrir Chamado</strong> / <strong>Novo Chamado</strong> no menu
            lateral, escolha a Mesa de Serviço de destino, descreva o problema e envie.
          </p>
        </div>
        <div>
          <p className="font-semibold">Por que não vejo o módulo de Contratos ou Cofre de Senhas?</p>
          <p>
            Esses módulos são restritos por papel (role). Clientes não têm acesso ao Cofre de
            Senhas; apenas Admin e Client Master veem valores financeiros de Contratos.
          </p>
        </div>
        <div>
          <p className="font-semibold">Como gero um token para integrar com outro sistema ou IA?</p>
          <p>
            Veja a seção <DocLink to="api" go={go}>API &amp; Tokens de Acesso</DocLink> abaixo.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'api',
    title: 'API & Tokens de Acesso',
    navLabel: 'API & Tokens de Acesso',
    icon: <KeyRound className="h-6 w-6" />,
    body: () => (
      <>
        <p>
          O Aponta expõe uma API REST completa (action-driven, documentada via Swagger/OpenAPI) que
          cobre todos os módulos do sistema. Para autenticar uma integração externa (automação,
          script, ou um assistente de IA via MCP), gere um{' '}
          <strong>Token de API pessoal</strong>:
        </p>
        <ol className="list-decimal pl-6 space-y-1">
          <li>
            Acesse <Link to="/my-account" className="text-brand-600 underline">Configurações &gt; Minha Conta</Link>.
          </li>
          <li>Clique na aba <strong>Tokens de API</strong>.</li>
          <li>Dê um nome claro ao token (ex: &quot;Integração n8n&quot;, &quot;MCP Claude Desktop&quot;).</li>
          <li>Clique em <strong>Gerar Novo Token</strong>.</li>
          <li>
            O valor completo do token é exibido <strong>uma única vez</strong>. Copie e guarde em
            local seguro — o Aponta não armazena o texto puro e não pode exibi-lo novamente.
          </li>
        </ol>
        <p>
          <strong>Importante sobre permissões:</strong> o token herda automaticamente o mesmo
          Role e Organização do usuário que o gerou. Um <strong>Client Master</strong> que gera um
          token só consegue acessar, via API, os mesmos dados que já vê na interface — nunca dados
          de outra empresa.
        </p>
        <p>
          Para revogar um token comprometido ou não utilizado, volte à mesma aba e clique em{' '}
          <strong>Revogar</strong> ao lado do token na lista.
        </p>
      </>
    ),
  },
  {
    id: 'mcp',
    title: 'MCP — Conectando Assistentes de IA',
    navLabel: 'MCP (Assistentes de IA)',
    icon: <Bot className="h-6 w-6" />,
    body: (go) => (
      <>
        <p>
          O Aponta possui um servidor <strong>MCP (Model Context Protocol)</strong> standalone, que
          permite que assistentes de IA (Claude Desktop, e outros clientes compatíveis) consultem e
          operem o sistema diretamente, usando linguagem natural.
        </p>
        <p>
          <strong>Passo 1 — Gerar o token:</strong> siga o passo a passo da seção{' '}
          <DocLink to="api" go={go}>API &amp; Tokens de Acesso</DocLink> acima.
        </p>
        <p><strong>Passo 2 — Configurar o cliente MCP</strong> (exemplo Claude Desktop):</p>
        <McpConfigBlock />
        <p><strong>Ferramentas (tools) disponíveis para a IA:</strong></p>
        <ul className="list-disc pl-6">
          <li><strong>Tickets</strong> — listar, buscar, criar, mudar status, atribuir a um agente.</li>
          <li><strong>Relatórios</strong> — carga de trabalho por agente, faturamento por organização.</li>
          <li><strong>Cofre de Senhas</strong> — listar e criar credenciais.</li>
          <li><strong>Contratos</strong> — listar contratos (valores financeiros respeitam o mesmo RBAC do token).</li>
          <li><strong>Base de Conhecimento</strong> — listar e criar artigos.</li>
        </ul>
        <p>
          Todas as regras de visibilidade (Role/Organização) são aplicadas pelo mesmo motor de
          segurança usado pela interface web — a IA nunca acessa mais dados do que o usuário que
          gerou o token teria acesso.
        </p>
        <p className="text-sm text-gray-700">
          Problemas comuns: se a IA relatar &quot;acesso negado&quot; ao tentar uma ação
          administrativa (ex: criar credencial no Cofre), confirme que o token foi gerado por um
          usuário com o papel (Role) necessário.
        </p>
      </>
    ),
  },
];

const SECTION_IDS = SECTIONS.map((section) => section.id);
const isSectionId = (value: string): value is SectionId => (SECTION_IDS as string[]).includes(value);

/** Tempo em que o observador não mexe no item ativo depois de um clique (scroll programático). */
const CLICK_LOCK_MS = 1000;

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Texto corrido de um nó React (o corpo de cada seção é JSX, então a busca lê as strings dele). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === McpConfigBlock) return MCP_CONFIG;
    return Children.toArray(node.props.children).map(textOf).join(' ');
  }
  return '';
}

const SEARCH_TEXT: Record<string, string> = Object.fromEntries(
  SECTIONS.map((section) => [
    section.id,
    normalize(`${section.title} ${section.navLabel} ${textOf(section.body(() => undefined))}`),
  ]),
);

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrollToSection(id: SectionId) {
  document
    .getElementById(id)
    ?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

export function DocsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const hashId = location.hash.replace(/^#/, '');
  const [active, setActive] = useState<SectionId>(isSectionId(hashId) ? hashId : 'conceitos');
  const [query, setQuery] = useState('');
  const lockUntil = useRef(0);
  const pendingScroll = useRef<SectionId | null>(null);

  const term = normalize(query.trim());
  const visible = SECTIONS.filter((section) => !term || SEARCH_TEXT[section.id].includes(term));
  const visibleKey = visible.map((section) => section.id).join(',');
  const activeVisible = visible.some((section) => section.id === active) ? active : visible[0]?.id;

  const go: Go = (id) => {
    lockUntil.current = Date.now() + CLICK_LOCK_MS;
    setActive(id);
    navigate({ hash: `#${id}` }, { replace: true });
    if (document.getElementById(id)) {
      scrollToSection(id);
      return;
    }
    // A seção está oculta pela busca: limpa o filtro e rola quando ela voltar ao DOM.
    pendingScroll.current = id;
    setQuery('');
  };

  // Abre na seção indicada pelo hash da URL (link direto para uma seção).
  useEffect(() => {
    if (isSectionId(hashId)) {
      lockUntil.current = Date.now() + CLICK_LOCK_MS;
      scrollToSection(hashId);
    }
    // Só na montagem: depois disso o hash é consequência dos cliques.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = pendingScroll.current;
    if (id && document.getElementById(id)) {
      pendingScroll.current = null;
      scrollToSection(id);
    }
  }, [visibleKey]);

  // O item ativo acompanha a seção que entra na faixa superior da área visível.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < lockUntil.current) return;
        const inView = entries
          .filter((entry) => entry.isIntersecting && isSectionId(entry.target.id))
          .map((entry) => entry.target.id as SectionId)
          .sort((a, b) => SECTION_IDS.indexOf(a) - SECTION_IDS.indexOf(b));
        if (inView[0]) setActive(inView[0]);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    visibleKey.split(',').forEach((id) => {
      const element = id ? document.getElementById(id) : null;
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [visibleKey]);

  return (
    <EzPageLayout header={<EzPageHeader title="Central de Documentação" />}>
      <div className="flex gap-8">
        <nav aria-label="Índice da documentação" className="hidden w-60 flex-shrink-0 lg:block">
          <div className="sticky top-0 space-y-6">
            <div className="flex items-center gap-2 text-lg font-bold">
              <BookOpen className="h-5 w-5" aria-hidden="true" /> Documentação
            </div>
            {NAV.map((group) => {
              const items = visible.filter((section) => group.ids.includes(section.id));
              if (items.length === 0) return null;
              return (
                <div key={group.label}>
                  <p className="mb-1 px-3 text-xs font-semibold uppercase text-gray-500">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {items.map((section) => (
                      <li key={section.id}>
                        <a
                          href={`#${section.id}`}
                          aria-current={activeVisible === section.id ? 'location' : undefined}
                          onClick={(event) => {
                            event.preventDefault();
                            go(section.id);
                          }}
                          className={
                            'flex items-center gap-3 px-3 py-2.5 rounded-[8px] transition-colors font-medium text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ' +
                            (activeVisible === section.id
                              ? 'bg-brand-100 text-brand-700'
                              : 'text-gray-700 hover:bg-gray-80 hover:text-gray-900')
                          }
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                            {NAV_ICONS[section.id]}
                          </span>
                          <span className="truncate flex-1 text-left">{section.navLabel}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 flex-1 pb-16">
          <div className="mb-6 space-y-3">
            <div className="sticky top-0 z-10 bg-gray-80 pb-1 lg:hidden">
              {visible.length > 0 && (
                <EzSelect
                  variant="compact"
                  label="Seção da documentação"
                  value={activeVisible}
                  onChange={(event) => go(event.target.value as SectionId)}
                >
                  {visible.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.navLabel}
                    </option>
                  ))}
                </EzSelect>
              )}
            </div>
            <EzTextInput
              type="search"
              size="slim"
              aria-label="Buscar na documentação"
              placeholder="Buscar na documentação"
              leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {visible.length === 0 ? (
            <EzEmptyCard
              icon={Search}
              title="Nenhuma seção encontrada"
              description="Tente outro termo, como “token” ou “contrato”."
              action={
                <EzButton variant="secondary" size="small" label="Limpar busca" onClick={() => setQuery('')} />
              }
            />
          ) : (
            visible.map((section) => (
              <section key={section.id} id={section.id} className="mb-10 scroll-mt-4">
                <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight mb-3">
                  {section.icon}
                  {section.title}
                </h2>
                <div className="max-w-none text-[15px] leading-relaxed text-gray-900 space-y-3">
                  {section.body(go)}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </EzPageLayout>
  );
}

export default DocsPage;
