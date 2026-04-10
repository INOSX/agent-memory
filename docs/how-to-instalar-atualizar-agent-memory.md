# Como instalar ou atualizar o `@inosx/agent-memory` (0.5.x)

Guia prático para projetos que já usam o pacote ou estão a integrá-lo pela primeira vez. A versão **0.5.0** afinou a automação de transcripts no Cursor/VS Code: **só o watcher corre ao abrir a pasta**; o comando **`process`** passou a ser **opcional e manual**.

---

## Requisitos

- **Node.js ≥ 18**
- Projeto com **`package.json`** na raiz (o postinstall só corre em projetos “consumidores”, não ao instalar o pacote em modo global).
- **Cursor** ou **VS Code** se quiseres tarefas automáticas ao abrir a pasta.

---

## Instalação (projeto novo)

Na raiz do teu projeto:

```bash
npm install @inosx/agent-memory
```

O que acontece de seguida:

1. **Regras Cursor** — ficheiros `.mdc` do pacote são copiados para **`.cursor/rules/`** (inclui o protocolo de memória).
2. **Tarefas do editor** — o script **postinstall** funde **`.vscode/tasks.json`**: fica uma tarefa **`agent-memory: watch transcripts`** com **`runOn: folderOpen`**.
3. **Permissão de tarefas** — se **`.vscode/settings.json`** não tinha `task.allowAutomaticTasks`, o postinstall define **`"on"`** para as tarefas ao abrir pasta poderem correr.

Abre a pasta do projeto no Cursor/VS Code. Se o editor pedir, **aceita tarefas automáticas**. A tarefa do watcher fica a correr em painel dedicado (muitas vezes em silêncio): espera até existir a pasta de transcripts do Cursor e depois mantém-se ativa.

---

## Atualização a partir de 0.4.x (ou mais antigo)

1. **Atualiza a dependência**

   ```bash
   npm install @inosx/agent-memory@latest
   ```

   Isto volta a executar o **postinstall**, que:
   - atualiza as regras em **`.cursor/rules/`**;
   - **atualiza** a tarefa do **watch** no `tasks.json`;
   - **remove** a tarefa antiga **`agent-memory: process transcript backlog`** se ainda existir (em 0.5.x o `process` **não** é disparado ao abrir a pasta).

2. **Reabre a pasta** do workspace (ou recarrega a janela do editor) para a nova tarefa do watcher arrancar sem ficares com duas instâncias confusas.

3. **Opcional:** confere **`.vscode/tasks.json`**. Deves ver **apenas** a tarefa do **watch** com `node node_modules/@inosx/agent-memory/dist/cli.js watch --wait-for-transcripts` (no repositório do próprio pacote usa-se `node dist/cli.js` após `npm run build`).

4. Se personalizaste `tasks.json` à mão, faz merge cuidadoso: preserva as tuas alterações e mantém a linha de comando do watch alinhada com a documentação atual.

---

## Novo funcionamento (o que mudou e como pensar nisto)

### Antes (0.4.x)

Ao abrir a pasta, muitas instalações tinham **duas** tarefas: um **`process`** (passe único) e o **`watch`** (contínuo). O estado partilhado (`.memory/.vault/processed-transcripts.json`) fazia com que o **`process`** mostrasse muitas vezes **zeros** — não era erro, era “nada novo para importar” porque o watcher já tinha consumido as linhas. Essa mensagem parecia falha.

### Agora (0.5.x)

| Peça | Papel |
|------|--------|
| **`watch`** (tarefa ao abrir pasta) | Processo **long-lived**. Monitoriza os ficheiros **`.jsonl`** do Cursor em `~/.cursor/projects/<slug>/agent-transcripts/`. Após cada alteração, espera o **debounce** (predefinição ~30 s), lê só as **linhas novas**, extrai decisões/lições por padrões heurísticos (PT+EN) e grava no **vault**. Em **sessão idle** (predefinição ~3 min sem atividade), pode gerar **handoff** automático. O estado fica em **`.memory/.vault/processed-transcripts.json`**. |
| **`process`** (CLI manual) | **Um único passe** sobre todas as sessões de transcript: útil para **catch-up** (por exemplo sem o daemon), CI, ou depois de copiar `.memory` de lado. A saída em modo humano explica se as sessões já estão **sincronizadas** com o ficheiro de estado (em vez de listar só zeros sem contexto). |
| **Correção macOS** | Em sistemas onde o `fs.watch` reporta caminhos no formato **`uuid/uuid.jsonl`**, o watcher resolve o ficheiro corretamente (em versões anteriores o append podia não ser processado). |

Em resumo: **a fonte de verdade contínua é o watcher**. O **`process`** é uma ferramenta complementar, não concorre com o watcher ao abrir o projeto.

---

## Comandos úteis

```bash
# Watcher manual (terminal)
npx agent-memory watch --wait-for-transcripts

# Passe único de histórico / catch-up
npx agent-memory process

# Contexto para o agente (regra Cursor recomenda no início da sessão)
npx agent-memory inject preview default "a tua primeira mensagem"
```

Opções globais: `--dir <pasta>` ou variável **`AGENT_MEMORY_DIR`** para outro root que não `.memory`.

---

## Desativar partes do postinstall (referência)

| Variável | Efeito no `npm install` |
|----------|-------------------------|
| `AGENT_MEMORY_SKIP_CURSOR_RULE=1` | Não copia regras para `.cursor/rules/`. |
| `AGENT_MEMORY_SKIP_VSCODE_AUTOMATION=1` | Não altera `.vscode/tasks.json` nem `task.allowAutomaticTasks`. |
| `AGENT_MEMORY_VERBOSE=1` | Mostra logs do postinstall. |

---

## Verificar que está a funcionar

1. Abre o projeto no Cursor e **inicia ou continua um chat** nesse workspace (para existir pasta de transcripts).
2. Confirma que a tarefa **watch** está em execução (Terminal → Tarefas em execução, ou painel dedicado).
3. Depois de conversares e passar o debounce, verifica **`.memory/default/decisions.md`** (ou outras categorias) e/ou corre **`npx agent-memory search "..." --agent default`**.

Para quem desenvolve o próprio pacote **agent-memory** no GitHub: corre **`npm run build`** antes de confiar nas tarefas com `dist/cli.js`, ou usa **`npm test`** (que compila antes dos testes).

---

## Mais documentação

- [User Guide (EN)](user-guide.md) — instalação, CLI, biblioteca, problemas comuns.
- [README do repositório](../README.md) — visão geral e tabela de variáveis de ambiente.
- [Memória explicada para leigos (PT)](memoria-explicada-leigos.md) — visão não técnica.
