# Comparacao de Sistemas de Memoria: AITeam vs. ChatGPT vs. Claude vs. OpenClaw

**Pesquisa e analise:** 2026-03-17

---

## Sistemas analisados

| Sistema | Provedor | Tipo | Acesso |
|---------|----------|------|--------|
| **ChatGPT Memory** | OpenAI | Produto consumer | Cloud, proprietario |
| **Claude Consumer Memory** | Anthropic | Produto consumer | Cloud, proprietario |
| **Claude Memory Tool (API)** | Anthropic | Ferramenta para desenvolvedores | Self-hosted pelo dev |
| **OpenClaw Native Memory** | OpenClaw (open-source) | Framework de agentes | Local, open-source |
| **ClawVault** | Versatly (open-source) | Plugin para OpenClaw | Local, open-source |
| **AITeam Memory v2.1** | INOSX (este projeto) | Dashboard de agentes BMAD | Local, proprietario |

---

## 1. O que e armazenado

### ChatGPT

O ChatGPT armazena **6 categorias opacas**, pré-montadas e injetadas em toda conversa:

1. **Bio Tool (memorias salvas)** — fatos explicitamente pedidos pelo usuario
2. **Preferencias de resposta** — ~15 entradas inferidas automaticamente sobre estilo de comunicacao
3. **Topicos de conversas passadas** — ~8 resumos dos primeiros usos do usuario
4. **Insights sobre o usuario** — ~14 dados biograficos e profissionais extraidos automaticamente
5. **Historico recente** — ~40 conversas recentes com timestamp e **apenas as mensagens do usuario** (sem as respostas do modelo)
6. **Metadados de interacao** — dispositivo, horario local, frequencia de uso, scores de qualidade, tags de intencao

> O usuario so consegue ver e editar a categoria 1 (Bio Tool). As demais sao gerenciadas de forma opaca pela OpenAI.

### Claude Consumer Memory

O Claude armazena memorias organizadas em **4 categorias estruturadas**:

- **Role & Work** — cargo, industria, contexto profissional
- **Current Projects** — iniciativas ativas discutidas
- **Preferences** — estilo de comunicacao, formato preferido
- **Personal Content** — fatos pessoais compartilhados

Memorias sao **escopadas por Projeto** — nao ha memoria global entre projetos diferentes.

### Claude Memory Tool (API)

Armazenamento totalmente livre — o desenvolvedor define o schema. A documentacao oficial sugere evitar historico verbatim e favorece:

- Fatos e preferencias do usuario/cliente
- Decisoes historicas tomadas
- Estado e progresso do projeto
- Contexto de workflows recorrentes

Formato: arquivos Markdown, XML ou texto puro em um diretorio `/memories`. O modelo escreve e le esses arquivos autonomamente via tool calls.

### OpenClaw Native

Tres camadas de armazenamento em Markdown local:

1. **Notas diarias** (`memory/YYYY-MM-DD.md`) — log append-only de atividades e decisoes do dia
2. **Memoria de longo prazo** (`MEMORY.md`) — arquivo curado com conhecimento distilado: preferencias, fatos importantes, projetos em andamento, licoes aprendidas
3. **Transcripts de sessao** (`sessions/YYYY-MM-DD-<slug>.md`) — conversas completas com slug descritivo gerado por LLM

### ClawVault

Memorias tipadas e roteadas para **8 categorias estruturadas** em Markdown com YAML frontmatter:

| Categoria | O que armazena |
|-----------|---------------|
| `decisions/` | Escolhas estrategicas com racional |
| `lessons/` | Aprendizados de resultados |
| `people/` | Dados de contatos e relacionamentos |
| `tasks/` | Metas e itens de execucao |
| `projects/` | Rastreamento de iniciativas |
| `inbox/` | Capturas pendentes de triagem |
| `preferences/` | Preferencias do usuario |
| `progress/` | Marcos alcancados |

### AITeam Memory v2.1

Memorias estruturadas em **5 categorias** por agente, mais contexto global:

| Categoria | O que armazena |
|-----------|---------------|
| `decisions` | Escolhas tecnicas ou de projeto com contexto |
| `lessons` | Bugs resolvidos, insights, aprendizados |
| `handoffs` | Resumo da ultima sessao + proximo passo |
| `tasks` | Itens abertos em formato checklist `[ ]` |
| `projects` | Contexto geral do agente |
| `_project.md` | Contexto global compartilhado entre todos os agentes |

---

## 2. Como as memorias sao criadas

| Sistema | Automatico | Manual | Metodo de extracao |
|---------|-----------|--------|--------------------|
| **ChatGPT** | Sim (assincrono, fora da conversa) | Sim ("lembre-se de X") | Inferencia proprietaria pela OpenAI; detalhes nao publicados |
| **Claude Consumer** | Sim (sintese via LLM ao ativar toggle) | Sim ("lembre-se de X") | Claude sintetiza categorias a partir do historico |
| **Claude API Tool** | Sim (o proprio Claude decide o que escrever) | Sim (instrucoes no system prompt) | Claude escreve arquivos autonomamente via tool calls |
| **OpenClaw Native** | Sim (agent escreve durante a sessao + flush pre-compactacao) | Sim (instrucao explicita) | Agent-driven: Claude escreve notas diarias continuamente |
| **ClawVault** | Sim (`observe --compress session.jsonl`) | Sim (CLI: `remember decision "X"`) | LLM (Gemini Flash) ou rule-based extrai observacoes com score |
| **AITeam v2.1** | Sim (ao fechar janela de chat, via POST /sleep) | Sim (Memory Vault UI: + Nova entrada) | Cursor Agent CLI analisa transcript e retorna JSON estruturado |

**Diferenca chave:** ChatGPT e Claude Consumer extraem memorias de forma **assincrona e invisivel** — o usuario nao sabe exatamente quando e o que e extraido. O AITeam, ClawVault e Claude API Tool tornam a extracao **observavel e controlavel**, com janela de veto (AITeam) ou CLI explicito (ClawVault).

---

## 3. Como as memorias sao recuperadas (retrieval)

Esta e a maior diferenca arquitetural entre os sistemas:

| Sistema | Estrategia de retrieval | Busca semantica? | Busca por palavra-chave? |
|---------|------------------------|-----------------|--------------------------|
| **ChatGPT** | **Injecao total** — todas as 6 categorias pre-montadas em toda conversa. Sem busca em tempo real. | Nao | Nao (tudo e injetado) |
| **Claude Consumer** | **Leitura de arquivo** + toggle "referenciar historico de conversas". Nao e RAG vetorial. | Nao (consumer) | Nao |
| **Claude API Tool** | **Agente seleciona arquivos** — Claude lista `/memories`, raciocina sobre nomes e le os relevantes. Sem embeddings. | Nao | Nao (reasoning-based) |
| **OpenClaw Native** | **Hibrido BM25 + Vector** — SQLite com `sqlite-vec` e FTS5. Embeddings locais (gemma-300M) ou via API. Fusao com pesos configuraveis (70% vector + 30% BM25). | Sim | Sim |
| **ClawVault** | **Hibrido BM25 + Vector + Knowledge Graph** — RRF (Reciprocal Rank Fusion) reranking + traversal de grafo de wiki-links para recuperacao multi-hop. | Sim (opcional) | Sim |
| **AITeam v2.1** | **BM25 via MiniSearch** — busca por relevancia textual dentro do vault do agente selecionado. Sem embeddings. | Nao (apenas BM25) | Sim |

**Observacao sobre o AITeam:** O sistema atual usa BM25 puro (sem embeddings vetoriais). Isso e mais rapido e sem dependencias externas, mas perde correspondencias semanticas que embeddings capturam. OpenClaw e ClawVault tem retrieval mais sofisticado com suporte a busca semantica opcional.

---

## 4. Injecao de contexto

Como e quando as memorias sao entregues ao modelo:

| Sistema | Mecanismo | Budget / Limite |
|---------|-----------|-----------------|
| **ChatGPT** | Bloco `Model Set Context` pre-montado no system prompt. Injetado inteiro em toda conversa. | Nao publicado. ~40 conversas recentes. |
| **Claude Consumer** | Contexto do Projeto + historico de conversas injetados no inicio. | Nao publicado. |
| **Claude API Tool** | `view` tool calls leem arquivos sob demanda. Conteudo entra no context window como resultado de tool. | Proporcional ao numero de arquivos lidos. |
| **OpenClaw Native** | Notas diarias carregadas automaticamente + `memory_search` / `memory_get` MCP tools. | Configurable. |
| **ClawVault** | `clawvault inject "query"` — CLI retorna trechos relevantes para injetar antes da chamada ao modelo. | Configurable por profile (`default`, `planning`, `incident`, `handoff`). |
| **AITeam v2.1** | `injectContext()` em `lib/memory/inject.ts` chamado automaticamente em `/api/agents/command` antes de spawnar o CLI. | **2.000 tokens** com prioridade: handoff → tasks → decisions/lessons → projects. |

**Diferencas de design:**

- **ChatGPT** injeta *tudo* sempre — simples, mas desperdicador. Nao ha relevancia, nao ha budget.
- **Claude API Tool** e o oposto — o proprio modelo decide o que ler, com custo de tool calls extras por sessao.
- **AITeam** tem um budget explicito com ordem de prioridade deterministica. E mais previsivel que o ChatGPT e mais barato que o Claude API Tool.
- **ClawVault** tem profiles de contexto (planning, incident, handoff) que mudam o conjunto de memorias injetadas — conceito ausente nos outros sistemas.

---

## 5. Controle do usuario

| Sistema | Usuario pode ver? | Usuario pode editar? | Usuario pode deletar? | Transparencia |
|---------|-----------------|---------------------|----------------------|---------------|
| **ChatGPT** | Apenas Bio Tool | Apenas Bio Tool | Apenas Bio Tool | **Baixa** — categorias auto-inferidas sao completamente opacas |
| **Claude Consumer** | Sim (categorias curadas) | Parcialmente | Sim (por Projeto) | **Media** — categorias visiveis, mas sintese e automatica |
| **Claude API Tool** | Sim (arquivos no filesystem) | Sim (qualquer editor) | Sim | **Alta** — desenvolvedor controla tudo |
| **OpenClaw Native** | Sim (Markdown local) | Sim | Sim | **Alta** — arquivos plainos no disco |
| **ClawVault** | Sim (Markdown + YAML) | Sim | Sim | **Alta** — zero telemetria |
| **AITeam v2.1** | Sim (Memory Vault UI) | Sim (inline) | Sim | **Alta** — badge 🤖 llm identifica entradas automaticas, veto de 10min |

**Diferencial do AITeam:** A **janela de veto de 10 minutos** e unica entre os sistemas analisados. Nenhum outro oferece um periodo de graca onde o usuario pode revisar e descartar memorias extraidas automaticamente antes que entrem em producao. O ChatGPT nao tem isso — uma memoria errada fica la silenciosamente.

---

## 6. Armazenamento e arquitetura tecnica

| Sistema | Onde fica | Formato | Busca semantica | Grafo de conhecimento |
|---------|-----------|---------|----------------|----------------------|
| **ChatGPT** | Cloud OpenAI | Proprietario (SQL/KV interno) | Desconhecido | Nao |
| **Claude Consumer** | Cloud Anthropic | Categorias estruturadas | Nao (consumer) | Nao |
| **Claude API Tool** | Cliente (desenvolvedor) | Arquivos (MD, XML, texto) | Nao | Nao |
| **OpenClaw Native** | Local (filesystem + SQLite) | Markdown + SQLite-vec | Sim (embeddings locais ou API) | Nao |
| **ClawVault** | Local (filesystem + JSON) | Markdown + YAML frontmatter | Sim (opcional) | **Sim** (wiki-links + RRF) |
| **AITeam v2.1** | Local (filesystem + JSON) | Markdown + JSON por categoria | Nao (BM25 puro) | Nao |

---

## 7. Capacidades offline

| Sistema | Funciona offline? | Nota |
|---------|-----------------|------|
| **ChatGPT** | Nao | Requer cloud OpenAI |
| **Claude Consumer** | Nao | Requer cloud Anthropic |
| **Claude API Tool** | Sim (storage local) | Mas inferencia do Claude requer API |
| **OpenClaw Native** | Sim | Modelo local gemma-300M para embeddings |
| **ClawVault** | Sim (modo BM25) | Embeddings opcionais via API |
| **AITeam v2.1** | Parcial | Storage local, mas extracao LLM requer Cursor Agent CLI |

---

## 8. Tabela comparativa geral

| Dimensao | ChatGPT | Claude Consumer | Claude API Tool | OpenClaw Native | ClawVault | **AITeam v2.1** |
|----------|---------|----------------|-----------------|----------------|-----------|----------------|
| **Categorias de memoria** | 6 (opacas) | 4 | Livre | 3 camadas | 8 | **5 + global** |
| **Extracao automatica** | Sim | Sim | Sim (agent-driven) | Sim | Sim | **Sim** |
| **Retrieval semantico** | Nao | Nao | Nao | Sim | Sim | **Nao (BM25)** |
| **Budget de contexto** | Nao publicado | Nao publicado | Proporcional a leituras | Configuravel | Por profile | **2.000 tokens** |
| **Veto de memorias LLM** | Nao | Nao | N/A | Nao | Nao | **Sim (10 min)** |
| **Multi-agente** | Nao | Nao | Nao (single-tenant) | Nao | Nao | **Sim (vault por agente)** |
| **Memoria global compartilhada** | Nao | Nao | Nao | `MEMORY.md` (unico) | Nao | **Sim (`_project.md`)** |
| **Controle do usuario** | Baixo | Medio | Alto | Alto | Alto | **Alto** |
| **Transparencia** | Baixa | Media | Alta | Alta | Alta | **Alta** |
| **Offline** | Nao | Nao | Parcial | Sim | Sim | **Parcial** |
| **Cloud dependency** | Total | Total | Storage local | Nenhuma | Opcional | **CLI local** |
| **Grafo de conhecimento** | Nao | Nao | Nao | Nao | Sim | **Nao** |
| **UI visual** | Sim (settings) | Sim (settings) | Nao (codigo) | Nao (CLI) | Nao (CLI) | **Sim (Memory Vault)** |
| **Custo de operacao** | Incluso no plano | Incluso no plano | Paga por token | Zero (local) | Zero (local) | **Zero** |

---

## 9. Analise de posicionamento

### O que o AITeam faz diferente de todos os outros

**1. Multi-agente com vault isolado por agente**
Nenhum outro sistema analisado tem suporte nativo a multiplos agentes com memorias isoladas por agente. ChatGPT e Claude tem uma memoria por usuario. OpenClaw e ClawVault tem uma memoria por instancia do framework. O AITeam permite que BMad Master, Winston, Amelia e os demais 11 agentes tenham vaults completamente separados, com injecao de contexto especifica para cada um — mais a memoria global `_project.md` compartilhada.

**2. Janela de veto de memorias LLM**
O AITeam e o unico sistema com um mecanismo explicitp de revisao pre-persistencia. O badge 🤖 llm + veto de 10 minutos resolve o problema que todos os outros sistemas ignoram: o que acontece quando o LLM extrai uma memoria errada? No ChatGPT a memoria errada fica. No Claude ela fica. No AITeam, voce tem 10 minutos para descarta-la antes que seja injetada na proxima sessao.

**3. UI visual de gerenciamento**
ChatGPT e Claude tem paginas de configuracoes. OpenClaw e ClawVault tem CLI. O AITeam tem o **Memory Vault** — uma interface visual completa acessivel dentro do proprio dashboard, com categorias, busca, contagem de entradas, edicao inline e criacao manual. E o sistema mais acessivel para usuarios nao-tecnicos.

**4. Prioridade deterministica de injecao**
O budget de 2.000 tokens com ordem de prioridade explicita (handoff → tasks → decisions/lessons → projects) e documentado e previsivel. No ChatGPT e Claude consumer, o usuario nao sabe exatamente o que sera injetado quando o limite e atingido.

### Onde o AITeam pode evoluir

**1. Retrieval semantico (embeddings)**
OpenClaw Native e ClawVault tem busca hibrida BM25 + embeddings vetoriais. O AITeam usa apenas BM25 (MiniSearch). Isso significa que uma busca por "problema de autenticacao" nao vai encontrar uma memoria que usa o termo "login falhou" — mesmo que sejam semanticamente identicos. Adicionar embeddings locais (ex: `@xenova/transformers` ou integrar com `sqlite-vec`) aumentaria significativamente a qualidade do retrieval.

**2. Grafo de conhecimento**
ClawVault constroi um grafo de wiki-links e entidades que permite recuperacao multi-hop ("decisoes relacionadas a autenticacao" → "decisoes que afetam o modulo de usuarios" → etc). O AITeam nao tem isso. Para projetos com muitas memorias interconectadas, um grafo de conhecimento seria valioso.

**3. Perfis de contexto**
ClawVault tem perfis `planning`, `incident`, `handoff` que mudam o conjunto de memorias injetadas conforme o contexto da tarefa. O AITeam poderia ter algo similar — injetar mais decisoes arquiteturais quando o usuario faz uma pergunta de arquitetura, mais tarefas quando inicia uma sessao de desenvolvimento.

**4. Extracao mais granular**
A extracao LLM do AITeam tem limite de 3 itens por categoria. Para sessoes longas ou complexas, isso pode descartar informacao relevante. ClawVault usa scores de observacao para rankear e selecionar o que persiste — um mecanismo mais sofisticado de filtragem.

---

## 10. Tabela de pontos fortes e limitacoes

| | **Pontos Fortes** | **Limitacoes** |
|--|---|---|
| **ChatGPT** | Transparente para o usuario final (nao precisa configurar nada); profile detalhado de usuario | Completamente opaco; usuario nao controla auto-inferencias; so ~40 sessoes acessiveis; nao sabe o que sera esquecido |
| **Claude Consumer** | Escopamento por Projeto e elegante; incognito mode; categorias visiveis | Sem busca semantica; memory siloada por projeto (sem visao global); feature relativamente nova |
| **Claude API Tool** | Maximo controle para devs; self-hosted; qualquer schema; o modelo e seu proprio agente de retrieval | Sem busca semantica ou embeddings; depende do reasoning do Claude para selecionar arquivos; sem UI |
| **OpenClaw Native** | Busca hibrida madura (BM25 + vector + SQLite); offline; open-source; auto-flush pre-compactacao | Complexidade de setup; crescimento de ~500MB/ano; sem UI; framework especifico |
| **ClawVault** | Grafo de conhecimento; perfis de contexto; RRF reranking; CLI poderoso; zero telemetria | Sem UI; requer Node 18+; LLM para compressao requer API key; single-user |
| **AITeam v2.1** | Multi-agente nativo; veto de 10 min; UI visual completa; budget deterministico; memoria global compartilhada | Sem embeddings vetoriais; sem grafo de conhecimento; sem perfis de contexto; extracao limitada a 3 itens/categoria |

---

## Fontes

- [Memory and new controls for ChatGPT — OpenAI](https://openai.com/index/memory-and-new-controls-for-chatgpt/)
- [What is Memory? — OpenAI Help Center](https://help.openai.com/en/articles/8983136-what-is-memory)
- [How ChatGPT Remembers You: A Deep Dive — embracethered.com](https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/)
- [Memory tool — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic Brings Automatic Memory to Claude — MacRumors](https://www.macrumors.com/2025/10/23/anthropic-automatic-memory-claude/)
- [Memory — OpenClaw Official Docs](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Memory Architecture Guide — zenvanriel.com](https://zenvanriel.com/ai-engineer-blog/openclaw-memory-architecture-guide/)
- [GitHub — Versatly/clawvault](https://github.com/Versatly/clawvault)
- [ClawVault Official Site](https://clawvault.dev)
