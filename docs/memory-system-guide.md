# Guia do Sistema de Memória — AITEAM-X

**Para:** Usuários do dashboard AITEAM-X
**Atualizado:** 2026-03-24
**Versão:** 3.0

---

## O que é o sistema de memória?

Por padrão, cada vez que você abre uma conversa com um agente, ele começa do zero — sem lembrar nada do que foi discutido antes. O sistema de memória resolve isso.

Ele registra automaticamente o que acontece em cada sessão e injeta esse contexto de volta no agente na próxima vez que você conversar com ele. O resultado: o agente lembra de decisões passadas, de tarefas abertas, de problemas que já foram resolvidos — sem você precisar explicar tudo de novo.

---

## O que o agente lembra?

Cada agente tem seu próprio vault de memória, organizado em cinco categorias:

| Categoria | O que guarda | Exemplos |
|-----------|-------------|---------|
| **Decisões** | Escolhas técnicas ou de projeto que foram tomadas | "Decidimos usar SSE em vez de WebSockets", "Padrão de nomenclatura: kebab-case para IDs de agente" |
| **Lições** | Bugs corrigidos, problemas resolvidos, insights descobertos | "O timeout do spawn() não funciona no Windows — usar setTimeout manual", "A tag precisa ficar embutida no texto para sobreviver a updateEntry()" |
| **Handoffs** | Resumo do que foi feito na última sessão e o que vem a seguir | "Implementamos o endpoint /sleep e o componente de badge. Próximo: testes de integração" |
| **Tarefas** | Itens abertos no formato de checklist | "- [ ] Revisar handoffs após sessões críticas", "- [x] Migrar fluxo de handoff" |
| **Projeto** | Contexto geral — stack, arquitetura, objetivos | "Next.js 15 App Router, sem Tailwind, VT323 pixel font, Cursor Agent CLI obrigatório" |

Além do vault individual de cada agente, existe um arquivo `_project.md` compartilhado, injetado em **todos os agentes**. É o lugar certo para informações que qualquer agente precisa saber.

---

## Como a memória é populada?

Existem três formas:

### 1. Automaticamente ao fechar uma sessão

Quando você fecha a janela de chat de um agente (botão **×** na bubble ou no drawer), o sistema:

1. Salva um checkpoint da conversa
2. Gera um handoff automático a partir das últimas 6 mensagens
3. Salva o handoff no vault com tags `auto-handoff` e `session-close`

Na próxima vez que você abrir uma sessão com aquele agente, ele receberá esse handoff como contexto.

### 2. Manualmente pelo Memory Vault

Clique no ícone **🧠** na barra superior para abrir o Memory Vault. De lá você pode:
- Ver todas as memórias de cada agente por categoria
- Criar novas entradas manualmente
- Editar ou deletar entradas existentes
- Buscar por texto livre (busca BM25)

### 3. Via script para conversas históricas

Para importar decisões e lições de conversas antigas que ainda não foram processadas:

```bash
node scripts/import-conversations.mjs
```

O script analisa o texto das conversas usando keywords e distribui os trechos relevantes nas categorias corretas do vault.

---

## Ciclo de vida de uma sessão

Entender o ciclo completo ajuda a saber o que o agente vai lembrar — e o que pode se perder.

```
Abrir chat
    │
    ├─ [auto-save 30s] → conversa salva em .memory/conversations/{agentId}.json
    │
    ├─ [checkpoint 30s] → snapshot salvo em .vault/checkpoints/{agentId}.json
    │
    ├─ [fechamento via ×]
    │       │
    │       ├─ 1. Checkpoint final salvo
    │       ├─ 2. Handoff gerado (últimas 6 mensagens)
    │       ├─ 3. Decisions e lessons extraídos da conversa (heurística PT+EN)
    │       └─ 4. Tudo salvo no vault → será injetado na próxima sessão
    │
    ├─ [fechamento inesperado (aba/navegador)]
    │       │
    │       └─ sendBeacon salva checkpoint + conversa (handoff NÃO é gerado)
    │
    └─ [próxima sessão]
            │
            └─ Injeção de contexto automática (ver seção abaixo)
```

**O checkpoint automático a cada 30s** protege o conteúdo da conversa. Mesmo que a janela feche de forma inesperada, o histórico fica preservado em disco por até 7 dias.

---

## Como o contexto é injetado na próxima sessão

Este é o mecanismo central do sistema: o que exatamente o agente recebe quando você inicia uma nova conversa.

### O que é injetado

1. **Contexto do projeto** — conteúdo completo de `_project.md`
2. **Handoff da última sessão** — o resumo mais recente, tem prioridade máxima
3. **Decisões relevantes** — até 3 decisões selecionadas por busca textual (BM25) baseada no que você está pedindo
4. **Lições relevantes** — até 2 lições selecionadas da mesma forma
5. **Todas as tarefas abertas** — itens com `[ ]` não marcados como concluídos
6. **Recovery snapshot** — se há checkpoint válido, as últimas 3 mensagens são incluídas

### Como a relevância é calculada

O sistema usa **BM25** (algoritmo de busca textual) para selecionar as entradas mais relevantes. BM25 compara o texto da sua mensagem com o conteúdo das memórias armazenadas e retorna as mais similares.

Na prática: se você pede "revise o fluxo de autenticação", o sistema vai injetar decisões e lições que mencionam autenticação, sessão, tokens — e não memórias sobre CSS ou deploy.

### Budget de tokens

O contexto injetado tem um limite de **2.000 tokens** (estimados como `comprimento_do_texto / 4`). Se as memórias selecionadas ultrapassarem esse limite, o sistema prioriza na seguinte ordem:

1. **Handoff** — sempre incluído, prioridade máxima
2. **Tarefas abertas** — sempre incluídas
3. **Decisões relevantes** — cortadas se necessário
4. **Lições relevantes** — cortadas primeiro
5. **Contexto do projeto** — incluído por último

### O que isso significa na prática

O agente não lembra de tudo — ele lembra do que é **mais relevante para a conversa atual**. Para assuntos específicos que você quer garantir que sejam lembrados, use a categoria correta no vault (ex: decisões importantes em "Decisões", não em "Projeto").

---

## O arquivo `_project.md` — memória compartilhada

O arquivo `.memory/_project.md` é especial: ele é injetado em **todos os agentes**, em todas as sessões.

### Quando usar

Use `_project.md` para informações que **qualquer agente precisa saber sem precisar perguntar**:
- Stack tecnológico do projeto
- Convenções de código adotadas pelo time
- Objetivos da sprint atual
- Decisões arquiteturais que afetam todos
- Restrições do ambiente (ex: "deploys só às sextas-feiras")

### O que não colocar

- Informações específicas de um agente — use o vault individual
- Tarefas — use a categoria "Tarefas" no vault de cada agente
- Histórico de conversas — isso fica nos checkpoints

### Exemplo de `_project.md` bem escrito

```markdown
# Projeto AITEAM-X

**Stack:** Next.js 15 App Router, React 19, TypeScript, sem Tailwind
**Fonte:** VT323 (pixel art), estilos em app/globals.css
**Runtime obrigatório:** Cursor Agent CLI

## Convenções
- IDs de agente: kebab-case (bmad-master, game-designer)
- API routes: REST para CRUD, SSE para streaming

## Sprint atual
- Foco: sistema de memória v3.0
- Documentação em /docs obrigatória para features novas
```

**Dica:** Mantenha o `_project.md` com menos de 500 palavras. Um arquivo longo pode causar truncamento no budget de tokens, empurrando informações mais relevantes (decisões, handoffs) para fora do contexto injetado.

---

## Memory Vault — interface visual

O Memory Vault (ícone 🧠 na barra superior) é a interface principal para gerenciar memórias.

### Navegação

- **Seletor de agente** (topo): escolha qual agente visualizar
- **Abas de categoria**: Decisões / Lições / Handoffs / Tarefas / Projeto
- **Campo de busca**: busca BM25 em tempo real (debounce de 300ms, retorna até 15 resultados)

### Criando entradas manualmente

1. Selecione o agente
2. Selecione a categoria
3. Clique em **+ Nova entrada**
4. Digite o conteúdo (suporta markdown)
5. Salve

Entradas manuais são permanentes até você deletar.

### Editando entradas

Clique no ícone de lápis ao lado da entrada. O conteúdo fica editável inline. Salve com Enter ou clique no ícone de check.

### Deletando entradas

Clique no **×** ao lado da entrada. Entradas deletadas não podem ser recuperadas.

---

## Tags — como funcionam

Cada entrada no vault pode ter **tags** associadas. As tags:

- São extraídas automaticamente do texto (palavras precedidas de `#`)
- Aparecem junto à entrada no Memory Vault
- **Afetam a busca BM25**: uma memória tagueada com `#auth` vai aparecer em buscas relacionadas a autenticação mesmo que o texto principal não mencione explicitamente

### Tags especiais do sistema

| Tag | Origem | Significado |
|-----|--------|------------|
| `#auto-handoff` | Frontend | Handoff gerado automaticamente ao fechar sessão |
| `#session-close` | Frontend | Marca entradas criadas no fechamento da sessão |
| `#compacted` | Compactação | Entrada gerada durante a compactação automática |
| `#auto-extract` | Compactação | Insight extraído por heurística de conversas recortadas |

---

## Boas práticas por categoria

### Decisões

- **Seja específico:** "Decidimos usar SSE" é vago. Melhor: "Adotar SSE em vez de WebSockets — ambiente de deploy não suporta conexões bidirecionais persistentes."
- **Inclua o motivo:** Uma decisão sem contexto é difícil de revisitar. Sempre explique o porquê.
- **Uma decisão por entrada:** Agrupar múltiplas decisões em uma entrada dificulta a busca BM25.
- **Use hashtags relevantes:** `#sse #architecture #deploy` ajudam a recuperar a decisão em contextos futuros.

### Lições

- **Foco no problema, não na solução:** Comece com o sintoma: "O spawn() no Windows não reporta código de saída confiável quando o processo é matado via timeout." Depois a solução.
- **Inclua onde ocorre:** "No Windows", "em ambiente de produção", "quando o arquivo de configuração está ausente" — contexto de quando a lição se aplica.
- **Registre anti-patterns:** Se você encontrou uma solução ruim, registre também para não repetir.

### Handoffs

- **O sistema gera automaticamente:** Ao fechar a sessão com o botão ×, um handoff é criado a partir das últimas 6 mensagens.
- **Crie manualmente para sessões críticas:** Se a sessão foi muito importante ou longa, abra o vault e crie um handoff manual mais detalhado.
- **Inclua o próximo passo:** "Implementamos X. Próximo: Y." é mais útil que só "Implementamos X."

### Tarefas

- **Use o formato padrão:** `- [ ] descrição da tarefa` (não concluída) / `- [x] descrição` (concluída)
- **Marque quando concluir:** Tarefas com `[ ]` aparecem em **todas as sessões futuras** daquele agente. Se ficou irrelevante, delete ou marque como `[x]`.
- **Uma ação por tarefa:** "Implementar X e Y e testar Z" deve ser três tarefas separadas.

### Projeto

- **Informações estáveis:** A categoria Projeto é para contexto que muda raramente.
- **Não duplique o `_project.md`:** Se algo é relevante para todos os agentes, coloque em `_project.md`. Se é específico a um agente, use a categoria Projeto do vault desse agente.

---

## Boas práticas para melhor desempenho

### 1. Mantenha o `_project.md` enxuto

O contexto do projeto é injetado em todas as sessões de todos os agentes. Um arquivo longo consome budget de tokens que poderia ser usado para decisões e lições mais relevantes. Objetivo: **menos de 500 palavras**.

### 2. Feche sessões pelo botão ×

O fechamento via botão × é o único caminho que gera handoffs automáticos. Fechar a aba ou o navegador salva apenas o checkpoint via `sendBeacon` — sem handoff.

### 3. Revise handoffs de sessões importantes

O handoff automático é baseado nas últimas 6 mensagens. Se a conversa foi longa e as decisões críticas aconteceram no meio, o handoff pode não capturá-las. Nesses casos, crie um handoff manual complementar no vault.

### 4. Use tags estrategicamente

Tags como `#api`, `#performance`, `#bug` conectam memórias de forma que a busca BM25 consegue recuperar. Quando o agente recebe "otimize a performance da API", memórias com `#api` e `#performance` têm mais chance de serem injetadas.

### 5. Limpe tarefas concluídas

Tarefas com `[ ]` são injetadas em todas as sessões. Uma lista longa de tarefas abertas consome tokens e polui o contexto. Marque como `[x]` ou delete quando concluir.

### 6. Uma ideia por entrada

Entradas granulares são recuperadas com mais precisão pelo BM25 do que entradas que misturam vários assuntos. "Decidimos usar SSE" e "Adotamos kebab-case para IDs" devem ser entradas separadas.

### 7. Deixe a compactação trabalhar

O sistema executa compactação automática a cada 10 minutos quando o dashboard está aberto. Ela cuida de:
- Limpar checkpoints com mais de 7 dias
- Recortar conversas longas (> 20 mensagens)
- Consolidar categorias com mais de 30 entradas

Se precisar forçar manualmente:

```bash
curl -X POST http://localhost:3000/api/memory/compact
```

### 8. Monitore o vault de agentes ativos

Agentes usados com frequência acumulam memórias rapidamente. Verifique periodicamente se:
- Há entradas duplicadas ou contraditórias
- Handoffs antigos ainda são relevantes
- Lições foram incorporadas no código (e podem ser removidas)

---

## Compactação automática

Com o tempo, o vault acumula muitas entradas, conversas ficam longas e checkpoints antigos ocupam espaço. A compactação automática resolve isso sem limpeza manual.

### O que a compactação faz

| Etapa | O que faz | Resultado |
|-------|----------|-----------|
| **Checkpoints expirados** | Remove checkpoints com mais de 7 dias | Espaço liberado |
| **Conversas longas** | Recorta conversas com mais de 20 mensagens, preserva apenas as mais recentes | Decisões e lições extraídas das mensagens removidas são salvas no vault |
| **Vault superlotado** | Consolida categorias com mais de 30 entradas — mantém as 20 mais recentes e gera um resumo das demais | Vault mais enxuto sem perda de informação |
| **Índice de busca** | Reconstrói o índice BM25 após as alterações | Busca atualizada |
| **Arquivos legados** | Remove `.bak` de migração e `.md` flat já migrados | Limpeza de disco |

### Frequência

O dashboard executa compactação automaticamente a cada 10 minutos. Também verifica ao carregar se a última compactação foi há mais de 10 minutos — se sim, executa imediatamente.

### O que acontece com as mensagens removidas de conversas longas?

O recorte não é destrutivo. Antes de remover mensagens antigas, o sistema:

1. **Analisa o texto** procurando padrões de decisão (ex: "decidimos", "vamos usar", "opted for") e de lição (ex: "aprendemos", "importante", "descobrimos")
2. **Salva os insights encontrados** como entradas no vault com tags `#compacted` e `#auto-extract`
3. **Gera um resumo** (handoff) das últimas mensagens removidas com tag `#auto-handoff`

Essas entradas ficam marcadas no vault para que você saiba que foram geradas pela compactação, não manualmente.

### Para verificar o resultado da última compactação

```bash
curl http://localhost:3000/api/memory/compact
```

### Segurança

A compactação só pode ser executada a partir de `localhost`. Requisições de IPs externos recebem `403 Forbidden`.

---

## Estudos de caso

### Caso 1: Bug corrigido ontem, esquecido hoje

**Situação:** Você passou uma hora na sexta-feira descobrindo que o `spawn()` do Node.js não dispara o evento `close` com código de saída confiável no Windows quando o processo é morto por timeout. Corrigiu usando um booleano `timedOut` + `setTimeout` manual + `proc.kill()`. Na segunda-feira, abre uma nova sessão e não lembra mais por que o código está escrito daquele jeito.

**Com o sistema de memória:**
- Ao fechar a sessão de sexta (botão ×), um handoff é gerado automaticamente
- Você percebe que a lição é importante e adiciona manualmente no vault: "O evento 'close' do spawn() no Windows não reporta código de saída confiável quando o processo é terminado via timeout. Solução: usar setTimeout manual + boolean timedOut + proc.kill()."
- Na segunda, ao abrir nova sessão sobre o mesmo código, essa lição é injetada via BM25
- O agente entende imediatamente o contexto sem você precisar explicar

**Dica:** Para lições técnicas importantes, registre manualmente no vault — é mais confiável do que depender apenas do handoff automático.

### Caso 2: Decisão de arquitetura esquecida

**Situação:** Três semanas atrás, o time decidiu não usar WebSockets e adotar SSE para streaming, porque o ambiente de deploy não suporta conexões bidirecionais persistentes. Hoje um novo desenvolvedor propõe usar WebSockets.

**Com o sistema de memória:**
- A decisão foi registrada em "Decisões" do agente bmad-master: "Adotar SSE em vez de WebSockets — ambiente de deploy não suporta conexões bidirecionais persistentes. #sse #architecture"
- Ao iniciar uma sessão sobre streaming, o BM25 recupera essa decisão e a injeta no contexto
- O agente proativamente menciona a restrição

### Caso 3: Tarefas que atravessam múltiplas sessões

**Situação:** Você está implementando um sistema grande que vai durar várias semanas. Cada sessão faz progresso parcial.

**Com o sistema de memória:**
- Cada sessão encerrada gera um handoff automático
- Tarefas abertas ficam visíveis: "- [ ] Implementar processPending() com retry", "- [ ] Adicionar flag --dry-run"
- Ao abrir a próxima sessão, o agente sabe exatamente onde parou e o que falta
- Ao concluir uma tarefa, marque como `[x]` — ela para de aparecer nas próximas sessões

### Caso 4: Contexto de projeto para um agente novo

**Situação:** Você precisa conversar com o agente `game-designer` pela primeira vez. Ele não sabe nada sobre o projeto.

**Com o sistema de memória:**
- O `_project.md` contém stack, convenções, restrições do projeto
- É injetado automaticamente na primeira sessão com qualquer agente
- O agente entende imediatamente o ambiente
- Você não precisa explicar o contexto em cada nova conversa

---

## Guia de solução de problemas

### O agente não está lembrando de algo importante

**Causa provável:** A memória não foi criada, ou não é relevante o suficiente para a busca BM25.

**O que fazer:**
1. Abra o Memory Vault (🧠)
2. Verifique se a memória existe na categoria correta
3. Se não existe: crie manualmente
4. Se existe mas o agente não usa: reformule o texto para incluir palavras-chave mais específicas ao contexto em que você espera que ela seja injetada
5. Adicione tags relevantes para ampliar a superfície de busca

### O handoff automático não foi gerado

**Causa provável:** A sessão foi encerrada de forma inesperada (não pelo botão ×).

**O que fazer:**
- Feche sessões sempre pelo botão ×
- Se a sessão já passou: crie um handoff manualmente no vault resumindo o que foi discutido

### O agente está recebendo informações desatualizadas

**Causa provável:** Uma memória antiga ainda está no vault com informação incorreta.

**O que fazer:**
1. Abra o Memory Vault
2. Busque o termo desatualizado
3. Edite ou delete a entrada antiga
4. Crie uma nova entrada com a informação correta

### O vault de um agente está muito pesado

**Causa provável:** Muitas sessões sem compactação recente.

**O que fazer:**
1. Verifique se o dashboard esteve aberto nos últimos dias (compactação automática requer dashboard ativo)
2. Force uma compactação: `curl -X POST http://localhost:3000/api/memory/compact`
3. Ou revise manualmente: delete handoffs antigos, consolide lições similares
4. Tarefas concluídas (`[x]`) podem ser deletadas — já não são injetadas, mas poluem a visualização

### O `_project.md` está sendo truncado

**Causa provável:** O arquivo ficou muito longo e ultrapassa o budget de 2.000 tokens.

**O que fazer:**
1. Revise o `_project.md` e remova informações que não são relevantes para todos os agentes
2. Mova contexto específico de agente para o vault desse agente
3. Mantenha o arquivo em **menos de 500 palavras** (~2.000 caracteres)

### A busca BM25 retorna resultados pouco relevantes

**Causa provável:** O índice pode estar desatualizado após operações manuais no filesystem.

**O que fazer:**
1. Force uma compactação (que reconstrói o índice): `curl -X POST http://localhost:3000/api/memory/compact`
2. Verifique se as entradas usam vocabulário consistente — BM25 é sensível às palavras exatas

---

## O que NÃO é armazenado automaticamente

- **Arquivos e imagens** enviados na conversa
- **Sessões encerradas sem o botão ×** — fechar a aba ou o navegador salva o checkpoint via `sendBeacon`, mas **não gera handoff**
- **Conteúdo de chamadas de ferramentas** — se o agente usou uma ferramenta, o resultado da ferramenta não é extraído como memória
- **Mensagens internas** — mensagens marcadas como `internal` (geradas pelo sistema) não são salvas em checkpoints nem usadas para handoffs

---

## Perguntas frequentes

**O agente não está lembrando de algo importante — o que faço?**
Abra o Memory Vault (🧠), vá à categoria correta e adicione a entrada manualmente. Ela será injetada na próxima sessão se for relevante para a busca BM25, ou sempre se for um handoff ou tarefa aberta.

**Posso apagar tudo e começar do zero?**
Sim — delete as entradas pelo Memory Vault. O `_project.md` pode ser editado diretamente em texto. Os checkpoints ficam em `.memory/.vault/checkpoints/` e podem ser deletados manualmente.

**As memórias de um agente afetam outros agentes?**
Não diretamente. Cada agente tem seu vault isolado. A única memória compartilhada é o `_project.md`.

**Como sei o que o agente vai receber na próxima sessão?**
O agente recebe: último handoff + decisões/lições relevantes ao seu comando + todas as tarefas abertas + `_project.md`. Você pode ver essas entradas no Memory Vault antes de iniciar a conversa.

**Quanto handoffs são mantidos?**
Apenas o handoff mais recente é injetado no contexto. Handoffs anteriores permanecem no vault para consulta, mas não são injetados automaticamente — apenas se forem relevantes na busca BM25.

**A compactação pode perder informações importantes?**
A compactação tenta extrair decisões e lições das mensagens removidas usando pattern matching. Para informações realmente críticas, registre-as manualmente no vault — é a forma mais confiável de garantir que o agente lembre.

**O que acontece quando o dashboard fica fechado por muito tempo?**
Checkpoints expiram após 7 dias. As memórias no vault (decisões, lições, handoffs, tarefas, projetos) persistem indefinidamente. A compactação só roda quando o dashboard está aberto — após períodos longos sem uso, a primeira abertura pode disparar uma compactação mais pesada.

**Posso editar o `_project.md` direto no editor de texto?**
Sim. O arquivo fica em `.memory/_project.md` e é plain text markdown. Alterações são refletidas imediatamente na próxima sessão de qualquer agente.
