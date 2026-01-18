# Portal Pérola Rara - Sistema Integrado de Gestão (v1.2.0)

> *"Onde a arte se encontra com o amor em cada detalhe."*

## 📖 Visão Geral do Produto

O **Portal Pérola Rara** é uma aplicação web progressiva (PWA/SPA) desenvolvida sob medida para a gestão de um ateliê de artesanato de luxo. O sistema centraliza a operação de ponta a ponta: desde a precificação técnica de insumos até a venda final e controle de produção.

**Perfil de Uso:** Single-User (Usuário Único/Admin).
**Foco:** Otimização do tempo da artesã, precisão financeira e segurança de dados.

---

## 🏗️ Arquitetura Técnica

O projeto utiliza uma arquitetura **Serverless** baseada em microsserviços no frontend (Módulos ES6) conectada a um Backend-as-a-Service (BaaS).

### Stack Tecnológico
*   **Frontend:** HTML5 Semântico, CSS3 (Variáveis/Flexbox/Grid), JavaScript Moderno (ES6 Modules).
*   **Backend / Database:** Google Firebase (Firestore Database & Authentication).
*   **Bibliotecas Auxiliares:**
    *   `SheetJS (xlsx)`: Exportação de relatórios.
    *   `Google Fonts`: Tipografia (Roboto & Dancing Script).

### Estrutura de Arquivos (File System)

```text
/
├── index.html                  # Core da Aplicação (SPA Router & Layout Base)
├── manifest.json               # Configurações de PWA
├── assets/
│   ├── css/
│   │   ├── main.css            # Design System Global, Login, Hub
│   │   ├── orcamentos.css      # Estilos de Vendas e Produção
│   │   └── precificacao.css    # Estilos de Engenharia de Produto
│   │
│   └── js/
│       ├── firebase-config.js  # Singleton de conexão & Exports do Firestore
│       ├── utils.js            # [v1.2.0] Biblioteca de utilitários globais (Formatação, Datas)
│       ├── main.js             # Controlador de Rotas, Auth e Inicialização
│       ├── changelog.js        # Histórico de Versões e Modais
│       │
│       ├── orcamentos.js       # Módulo de Vendas (CRUD Orçamentos, Geração de Pedidos)
│       ├── pedidos.js          # Módulo de Produção (Checklist, Relatórios Financeiros)
│       ├── estoque.js          # [v1.2.0] Módulo Transacional de Estoque e Venda Rápida
│       │
│       ├── precificacao.js     # Controlador Mestre de Precificação
│       ├── precificacao-insumos.js  # CRUD de Matéria-Prima
│       └── precificacao-produtos.js # Montagem de Receitas de Produtos
```

---

## 🧩 Módulos e Funcionalidades Detalhadas

### 1. Núcleo (Core & Auth)
*   **Autenticação:** Login persistente via Firebase Auth.
*   **Roteamento:** Navegação SPA (Single Page Application) sem recarregamento de página.
*   **Hub Central:** Dashboard de acesso rápido aos módulos.

### 2. Módulo de Precificação (Engenharia de Produto)
O cérebro financeiro do ateliê. Garante que nenhuma peça seja vendida com prejuízo.
*   **Gestão de Insumos:** Cadastro de materiais com conversão automática de unidades (Metro, Quilo, Litro, Unidade, Área m²).
*   **Cálculo de Mão de Obra:** Define o valor da hora da artesã baseada no salário desejado e horas trabalhadas.
*   **Custos Fixos (Indiretos):** Rateio de despesas (luz, internet, depreciação) por hora produzida.
*   **Montagem de Produto:** Interface para selecionar materiais + tempo de produção. O sistema calcula automaticamente o **Custo Base**.
*   **Formação de Preço:** Aplicação de Markup (Margem de Lucro) e taxas de cartão para sugerir o preço final de venda.

### 3. Módulo de Orçamentos (CRM de Vendas)
Focado na negociação e formalização.
*   **Gerador de Propostas:** Criação de orçamentos com validade definida.
*   **Impressão Profissional:** Gera PDF formatado com termos de serviço e logo da marca.
*   **Conversão:** Botão "Gerar Pedido" que transforma um orçamento aprovado em um item de produção, migrando todos os dados automaticamente.

### 4. Módulo de Pedidos (Produção e Financeiro)
Focado no "chão de fábrica" e no fluxo de caixa.
*   **Checklist de Produção:** Impressão de lista de tarefas técnica para a confecção.
*   **Nota de Pedido:** Documento financeiro para o cliente (Entrada + Restante).
*   **Demonstrativo Financeiro (Interno):** Cada pedido salvo armazena separadamente:
    *   🔴 Custos (Reposição de material)
    *   🔵 Mão de Obra (Salário da artesã)
    *   🟢 Lucro (Caixa da empresa)
*   **Relatórios:** Gráficos visuais (KPIs) de faturamento mensal.

### 5. Módulo de Estoque (v1.2.0 - Gestão Transacional)
Focado em produtos à pronta entrega e vendas rápidas.
*   **Catálogo de Produtos:** Cadastro de itens prontos com quantidade definida.
*   **Controle de Duplicidade:** Impede o cadastro de produtos com nomes idênticos.
*   **Venda Rápida (POS):** Botão "Vender" que realiza baixa automática no estoque e gera um pedido financeiro instantaneamente.
*   **Segurança Transacional:** Utiliza **Firebase Transactions**. Se a internet cair durante a venda, o sistema reverte a baixa do estoque para evitar inconsistências.

---

## 🗄️ Modelo de Dados (Firestore Schema)

O banco de dados NoSQL é estruturado nas seguintes coleções principais:

| Coleção | Documento (Exemplo) | Descrição |
| :--- | :--- | :--- |
| `configuracoes` | `contadores { ultimoPedido: 150 }` | **[v1.2.0]** Contador centralizado atômico para numeração sequencial única. |
| `estoque` | `{ produto: "Fralda", quantidade: 5, valorVenda: 50.00 }` | Itens de pronta entrega. |
| `Orcamento-Pedido` | `{ tipo: "orcamento" \| "pedido", numero: "0150/2025", ... }` | Coleção unificada. O campo `tipo` define o status. Contém array de `produtos` e dados financeiros. |
| `materiais-insumos` | `{ nome: "Tecido", tipo: "area", custo: 15.00 }` | Matéria-prima base. |
| `produtos` | `{ nome: "Kit Berço", materiais: [...], tempo: 2.5 }` | Receita técnica do produto (não é o item de estoque, é o "molde"). |
| `precificacoes-geradas` | `{ produto: "Kit Berço", data: "2025-01-01", ... }` | Histórico de cálculos de preço realizados. |

---

## 🚀 Melhorias da Versão 1.2.0 (Contexto para Desenvolvedores)

Esta versão introduziu robustez corporativa ao sistema de usuário único:

1.  **Centralização de Lógica (`utils.js`):**
    *   Todas as conversões monetárias e formatações de data agora passam por um arquivo único.
    *   *Regra de Ouro:* Nunca formate moeda manualmente (`"R$ " + valor`). Use `utils.formatarMoeda(valor)`.

2.  **Transações Atômicas (Atomic Transactions):**
    *   No módulo de estoque, a venda executa 3 operações simultâneas: `Baixa Estoque` + `Incremento Contador` + `Criação Pedido`.
    *   Se qualquer uma falhar, todas são canceladas. Isso garante integridade total dos dados.

3.  **Contador Centralizado:**
    *   A numeração dos pedidos (ex: 0150/2025) não é mais calculada lendo a lista inteira (o que era lento). Agora, lê-se apenas o documento `configuracoes/contadores`.

---

## 🛠️ Instalação e Execução Local

Como o projeto utiliza **ES6 Modules**, ele não funciona abrindo o arquivo `html` diretamente (devido a políticas de CORS do navegador).

1.  **Clone o Repositório:**
    ```bash
    git clone https://github.com/seu-repo/portal-perola-rara.git
    ```

2.  **Configure o Firebase:**
    *   Edite `assets/js/firebase-config.js`.
    *   Insira suas chaves de API do Firebase Console.

3.  **Execute via Servidor Local:**
    *   **Opção A (VS Code):** Instale a extensão "Live Server", clique com botão direito no `index.html` e escolha "Open with Live Server".
    *   **Opção B (Python):** Abra o terminal na pasta e rode `python -m http.server 8000`.
    *   **Opção C (Node):** Use `npx serve`.

---

## 🔮 Roadmap (Sugestões Futuras)

Com base na arquitetura atual, estas são as próximas evoluções naturais:

1.  **Backup Automático:** Script para exportar todas as coleções do Firestore para um JSON local periodicamente.
2.  **Dashboard Analytics:** Uma tela inicial no Hub com gráficos de vendas dos últimos 6 meses (usando Chart.js).
3.  **Gestão de Clientes:** Extrair os dados de clientes dos pedidos e criar uma coleção única `clientes` para CRM (histórico de compras por pessoa).

---

*Documentação atualizada em: Janeiro/2026 - Versão 1.2.0*
```
