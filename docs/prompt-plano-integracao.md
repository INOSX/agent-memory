# Prompt — Plano de integração e utilização do `@inosx/agent-memory`

Este ficheiro serve para **copiar e colar noutra IA** (ou adaptar num chat). O bloco **«Prompt para a IA»** é o texto principal; a secção **«Contexto do projeto»** é para **preencher à mão** antes de enviar, para a outra IA personalizar o plano.

---

## Como usar

1. Preencha **Contexto do projeto** (stack, repositório, restrições).
2. Copie **tudo** desde `## Prompt para a IA` até ao fim do bloco de instruções (incluindo o inventário da biblioteca).
3. Cole noutra conversa. Se a plataforma suportar, anexe também o `README.md` ou o `user-guide.md` deste repositório como referência.

---

## Contexto do projeto *(preencher antes de enviar)*

- **Nome / descrição do produto:**
- **Stack:** (ex.: Node, Next.js, Python bridge, desktop, etc.)
- **Onde corre o agente:** (servidor, edge, worker, CLI local)
- **IDs de agentes:** (como são nomeados hoje; BMAD / personas / um só agente)
- **Restrições:** (sem escrita em disco; apenas leitura; compliance; path fixo)
- **Objetivo da integração:** (ex.: injetar contexto no system prompt; checkpoint de chat; operação só por CLI)
- **Links úteis:** (repo, ADRs existentes)

---

## Prompt para a IA

**Papel.** És um arquiteto de software a elaborar um **plano de integração e utilização** da biblioteca npm **`@inosx/agent-memory`** num projeto de software que te será descrito abaixo (secção «Contexto do projeto» do utilizador).

**Objetivo do entregável.** Produz um **documento de planeamento** claro e acionável — não código de produção — que uma equipa possa seguir para integrar e operar a memória de agentes de forma consistente.

### Inventário mínimo da biblioteca (não ignores)

`@inosx/agent-memory` é um sistema de memória **baseado em ficheiros Markdown** (sem base de dados). Ponto de montagem típico: diretório **`.memory`** (ou outro via `dir` / `AGENT_MEMORY_DIR` / `--dir` na CLI).

**Instalação:** `npm install @inosx/agent-memory`. Expõe o binário **`agent-memory`** (ou `npx @inosx/agent-memory`). Requer **Node.js ≥ 18**.

**API principal:** `createMemory({ dir, ... })` devolve um objeto com:

| Módulo | Função |
|--------|--------|
| **`vault`** | Persistência por agente e categoria (`decisions`, `lessons`, `tasks`, `projects`, `handoffs`); leitura, append, update, remove. |
| **`search`** | Pesquisa texto completo **BM25** (MiniSearch); índice sincronizado com o vault. |
| **`inject`** | `buildContext(agentId, command)` + `buildTextBlock(ctx)` — monta bloco Markdown para prompts com orçamento de tokens; inclui `_project.md`, handoff, decisões/lições relevantes, tarefas abertas, checkpoint recuperável. |
| **`session`** | Checkpoints de sessão (`checkpoint`, `recover`, `sleep`) com expiração configurável. |
| **`compact`** | Manutenção: limpar/concentrar conversas, extrair insights, limitar entradas do vault, reconstruir índice. |
| **`migrate`** | Migração one-way de layouts antigos (ficheiros planos) para o formato vault. |

**CLI:** comandos como `agents`, `project show|edit`, `vault list|get|add|edit|delete`, `search`, `inject preview`, `compact`, `migrate`; opções `--dir`, `AGENT_MEMORY_DIR`, `--json`.

**Ficheiros relevantes:** `_project.md` (contexto partilhado); por agente, ficheiros por categoria; `conversations/`, `.vault/` (checkpoints, índice, logs de compactação). Documentação detalhada: README e `docs/user-guide.md` do pacote.

### Padrão de ativação de agentes (crítico — não ignores)

Cada agente **deve ler o seu vault na ativação** — antes de cumprimentar o utilizador ou executar qualquer tarefa. Sem este passo, o agente perde contexto de sessões anteriores (decisões, lições, regras, handoffs) e pode contradizer instruções já registadas na memória.

**Fluxo de ativação recomendado (por agente):**

1. Carregar configuração (IDs, idioma, paths).
2. **Ler ficheiros do vault** — `<dir>/<agentId>/decisions.md`, `lessons.md`, `tasks.md`, `projects.md`, `handoffs.md` (os que existirem). Tratar este conteúdo como **autoritativo** durante toda a sessão.
3. Carregar contexto partilhado (`_project.md`).
4. Saudação e apresentação de capacidades ao utilizador.

> **Porquê?** Se o passo 2 for omitido, o agente comporta-se como se fosse a sua primeira sessão — ignora decisões tomadas, lições aprendidas e até regras explícitas gravadas no vault. Este problema foi identificado em produção: um agente violou uma regra registada na sua própria memória porque o skill de ativação não incluía a leitura do vault.

O plano de integração **deve garantir** que toda definição de agente (skill, prompt, system message ou orquestrador) inclua este passo de leitura obrigatória.

### O que deves produzir (estrutura obrigatória)

1. **Resumo executivo** — O que muda no produto e porquê (2–5 frases).
2. **Encaixe com o contexto do projeto** — Stack, runtime, e se a abordagem ficheiro-em-disco é aceitável; alternativas se houver bloqueio (ex.: só CLI no dev, volume montado em produção).
3. **Arquitetura de integração** — Onde `createMemory` é instanciado (um singleton vs por pedido); como alinhar **cwd** / paths com o diretório `.memory`; mapeamento **IDs de agentes** entre orquestração e ficheiros.
4. **Fluxos de dados** — Quando escrever no vault; quando chamar `buildContext` / `buildTextBlock` antes do LLM; quando guardar checkpoints; política de **compaction** (agendada, manual, após N mensagens).
5. **Ativação de agentes e carregamento de memória** — Definir o hook de ativação que cada agente executa ao iniciar sessão: leitura obrigatória do vault (`.memory/<agentId>/`) antes de qualquer interação; como garantir que o conteúdo lido é tratado como autoritativo; como lidar com vaults vazios (primeira sessão); integração com `inject.buildContext` ou leitura direta dos ficheiros Markdown.
6. **Superfície de uso** — Proposta **biblioteca vs CLI vs híbrido** para este projeto; o que operadores ou devs fazem no dia a dia.
7. **Configuração** — Valores recomendados para `tokenBudget`, expiração de checkpoints, limites de compactação; customização opcional de `insightExtractor` e categorias.
8. **Segurança e operações** — `.gitignore` / segredos em `_project.md`; backups; ambientes (dev/staging/prod); risco de path traversal se `agentId` vier de input externo.
9. **Plano de rollout** — Fases (MVP → completo): o que entrega cada fase e critérios de "feito".
10. **Riscos e mitigações** — Tabela breve.
11. **Critérios de sucesso** — Mensuráveis ou verificáveis (ex.: "injeção presente em 100% dos pedidos ao agente X"; "leitura de vault em 100% das ativações"; "compactação semanal").
12. **Perguntas em aberto** — Lista o que ainda falta decidir no projeto alvo.

**Tom:** Português (ou o idioma do «Contexto do projeto»), técnico mas legível. Usa listas e tabelas onde ajude. **Não inventes APIs** que não constem do inventário acima; se precisares de detalhe, indica «confirmar na documentação do pacote» com o nome do símbolo.

**Se o contexto for insuficiente**, começa por **até 5 perguntas objetivas**; só depois entrega o plano completo.

---

## Referências no repositório (para anexar à outra IA)

| Ficheiro | Uso |
|----------|-----|
| [README.md](../README.md) | Instalação, API, CLI, formato de armazenamento |
| [user-guide.md](user-guide.md) | Conceitos, integração BMAD-style, troubleshooting |
| [memory-system.md](memory-system.md) | Arquitetura e fluxos técnicos |

---

## Licença do texto deste prompt

O texto do prompt pode ser copiado livremente junto com o projeto `agent-memory` (MIT).
