# Memória para agentes de IA — explicado de forma simples

**Para quem é este texto:** equipas de produto, decisores, curiosos e qualquer pessoa que queira entender **o que** o framework `@inosx/agent-memory` faz **sem** mergulhar em código.  
**O que não é:** manual de instalação. Para isso existem o [README](../README.md) e o [guia do utilizador](user-guide.md).

---

## O problema que quase toda a gente já sentiu

Quando conversa com um assistente de IA, **cada conversa nova costuma começar do zero**. O modelo não traz consigo, por defeito, o histórico das decisões da semana passada, a lista de tarefas em aberto nem o que ficou combinado na última sessão. Isso é cansativo: há que repetir contexto, e a IA pode contradizer o que já tinha sido alinhado antes.

**A pergunta que este framework responde é:** como dar às nossas ferramentas com IA uma **memória persistente e organizada**, para o trabalho continuar de onde parou — sem depender de copiar e colar conversas inteiras?

---

## O que é, numa frase

**`@inosx/agent-memory` é um sistema de memória para agentes de IA que grava informação em ficheiros de texto simples** (como notas), organizados por agente e por tipo de conteúdo, e que **volta a injetar** o que importa quando se inicia uma nova conversa ou tarefa.

Não é um produto com interface própria obrigatória: é uma **peça de engenharia** que equipas integram em aplicações, dashboards ou scripts — mas o *conceito* é acessível a qualquer pessoa.

---

## Analogia rápida: caderno partilhado da equipa

Imagine um **caderno por projeto** onde:

- Cada “persona” ou agente tem as suas secções;
- Há uma página comum com o que **toda a gente** precisa de saber (stack, regras do projeto);
- Outras páginas guardam **decisões**, **lições aprendidas**, **tarefas em aberto** e **resumos do que ficou feito**.

Quando alguém (ou um agente) volta a trabalhar, **não lê o caderno inteiro**: lê primeiro o essencial e depois os trechos mais ligados ao assunto atual. Esse “ler o essencial e o relevante” é o papel da memória no dia a dia — só que feito de forma automática e repetível.

---

## O que a memória guarda (em linguagem humana)

Sem entrar em nomes técnicos de ficheiros, o sistema está preparado para categorias como:

| Tipo de informação | Para que serve, na prática |
|--------------------|----------------------------|
| **Contexto do projeto** | O que é comum a todos os agentes: tecnologias, regras, objetivos gerais. |
| **Decisões** | “Combinámos fazer desta forma…” — para não reabrir o mesmo debate. |
| **Lições** | Erros, soluções e descobertas — para não repetir o mesmo problema. |
| **Tarefas** | Lista de pendências que a equipa (e o agente) devem ver em cada sessão. |
| **Resumos de sessão** | O que ficou feito e o que vem a seguir — continuidade entre um dia e o seguinte. |

Isto ajuda a que a IA **não invente** um passado diferente do que a equipa já registou.

---

## Como funciona, sem servidor de bases de dados obrigatório

Muitas soluções de memória pedem **bases de dados**, **serviços na nuvem** ou **contas pagas** só para guardar texto. Aqui a ideia base é outra:

- A informação vive em **ficheiros no disco** (formato legível por humanos, em grande parte em Markdown);
- **Não é obrigatório** montar uma base de dados só para isto;
- A equipa pode **versionar**, **fazer cópia de segurança** e **inspecionar** o que foi gravado — transparência em vez de caixa negra.

Isso simplifica operações, auditoria e integração em projetos que já usam repositórios Git ou pipelines simples.

---

## O que acontece quando se “abre uma sessão nova”

Em termos simples:

1. **Antes** de o agente responder, o sistema **junta** o contexto partilhado, resumos recentes e trechos relevantes à pergunta ou tarefa atual.
2. **Durante** o trabalho, a conversa pode ser **guardada** de forma periódica, para recuperação ou continuidade.
3. **Depois**, ao fechar ou ao fazer manutenção, pode haver **limpeza** e **extração de ideias** para não deixar tudo crescer sem controlo.

Adicionalmente, para utilizadores de **Cursor** ou **VS Code**, ao instalar o pacote o projeto pode ficar com tarefas que **arrancam ao abrir a pasta** (`process` + `watch`), para o observador trabalhar sem comandos manuais. Em alternativa, pode correr-se `agent-memory watch` à mão — lê as conversas em tempo real e extrai decisões, lições e resumos sem fechar a sessão de forma especial.

O utilizador final pode nem ver estes passos — mas é isto que permite que a **próxima** conversa não comece “vazia”.

---

## Benefícios que importam para negócio e equipa

- **Continuidade:** menos retrabalho e menos repetição do mesmo contexto.
- **Alinhamento:** decisões e lições ficam **registadas**, não só na cabeça de uma pessoa.
- **Transparência:** ficheiros legíveis em vez de memória opaca dentro do modelo.
- **Flexibilidade:** integra-se em fluxos próprios (ferramentas internas, agentes na linha de comando, etc.).
- **Custo operacional:** evita infraestrutura pesada só para guardar texto estruturado.

---

## O que este framework **não** é (expectativas certas)

- **Não substitui** políticas de produto, revisão humana nem validação de código por si só.
- **Não é** um “cérebro” com compreensão humana: trabalha com **texto guardado e pesquisa** sobre esse texto.
- **Não elimina** a necessidade de **integrar** a biblioteca numa aplicação — é uma peça técnica para equipas de desenvolvimento.

Ser honesto aqui evita desilusões e ajuda a vender o valor **real**: continuidade e organização, com controlo da equipa.

---

## Em resumo

| Pergunta | Resposta curta |
|----------|------------------|
| Que problema resolve? | Agentes de IA que “esquecem” o contexto entre sessões. |
| Como resolve? | Memória persistente em ficheiros, categorizada e reutilizada nas novas conversas. |
| Por que é diferente? | Simplicidade de armazenamento, legibilidade e integração em produtos próprios. |
| Quem implementa? | Desenvolvedores, usando o pacote npm e a documentação técnica. |

---

## Próximo passo para quem vai implementar

- **Pacote:** [`@inosx/agent-memory`](https://www.npmjs.com/package/@inosx/agent-memory) no npm.  
- **Documentação técnica:** [README](../README.md) (inclui **postinstall**, tarefas ao abrir pasta e variáveis de ambiente), [User Guide](user-guide.md) e [índice](README.md).

Se quiser comparar com outras abordagens de memória no mercado, veja [Memory System Comparison](memory-system-comparison.md) (em inglês, mais detalhado).

---

*Documento orientado a leigos e decisores. Para precisão de API e comportamento exato, use sempre a documentação técnica e o código-fonte.*
