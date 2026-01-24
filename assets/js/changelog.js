// assets/js/changelog.js

/**
 * Dados do Histórico de Versões
 * Adicione novas versões no topo do array.
 */
const changeLogData = [
    {
        version: "1.2.3",
        date: "28/01/2026",
        changes: [
            "🔐 **Isolamento de Dados (Multi-inquilinato):** Implementamos uma 'parede virtual' entre as contas. Agora, o que é cadastrado ou vendido no 'Usuário de Teste' fica visível apenas para ele, sem poluir os relatórios e estoques da conta Oficial (Karina).",
            "🛡️ **Segurança de Acesso:** Cada Orçamento, Pedido, Produto e item de Estoque agora recebe um 'carimbo digital' de propriedade (`ownerId`) no momento da criação. O sistema usa isso para filtrar automaticamente o que deve aparecer na tela de cada usuário.",
            "🧹 **Limpeza Automática de Visão:** Ao fazer login, o sistema agora ignora qualquer dado que não pertença ao seu usuário. Isso permite testar novas funcionalidades à vontade, com a garantia de que o ambiente de produção real permanecerá intocado e limpo."
        ]
    },
    {
        version: "1.2.2",
        date: "26/01/2026",
        changes: [
            "💸 **Cascata de Descontos (Saneamento Financeiro):** Acabamos com a ilusão do 'lucro falso'. Agora, se você der um desconto ao cliente no fechamento do pedido, o sistema abate esse valor automaticamente primeiro da Margem de Lucro, e depois do seu Salário. O relatório financeiro agora reflete a dura realidade, não apenas o cenário ideal.",
            "🛑 **Trava de Prejuízo:** Implementamos um alerta de segurança crítica. Se o valor da venda for reduzido a ponto de não cobrir nem os custos dos materiais, o sistema emite um aviso vermelho e exige confirmação extra, evitando que você 'pague para trabalhar'.",
            "🎨 **Feedback Visual na Edição:** Ao editar um pedido existente, os campos de 'Meu Salário' mudam de cor em tempo real. Ficará Laranja se o desconto estiver comendo parte do seu salário, e Vermelho se estiver gerando prejuízo.",
            "🧠 **Cérebro Financeiro Unificado:** Centralização da lógica matemática. Tanto a geração de novos pedidos a partir de orçamentos quanto a edição manual agora usam a mesma regra de distribuição financeira, garantindo consistência total nos dados."
        ]
    },
    {
        version: "1.2.1",
        date: "25/01/2026",
        changes: [
            "🔍 **Busca Ágil (Quick Clear):** Implementamos um botão de limpeza rápida (ícone 'X') dentro de todas as barras de pesquisa. Agora, apagar termos digitados é instantâneo, agilizando a navegação entre consultas diferentes.",
            "🎨 **Polimento de UI:** Correção de refinamento visual nos campos de input. O alinhamento vertical dos ícones foi ajustado matematicamente para garantir simetria perfeita em relação ao texto, eliminando deslocamentos visuais.",
            "🗂️ **Interatividade de Tabelas:** Os cabeçalhos das listas (ex: Cliente, Produto) receberam indicadores visuais de clique, preparando a interface para a funcionalidade de ordenação alfabética dinâmica.",
            "🛠️ **Otimização de Código:** Centralização da lógica de controle de inputs no arquivo `utils.js`. Isso reduz a repetição de código nos módulos e garante que o comportamento da busca seja consistente em todo o sistema."
        ]
    },
    {
        version: "1.2.0",
        date: "20/01/2026",
        changes: [
            "🛡️ **Venda Blindada (Transações):** Implementamos um protocolo de segurança nível bancário nas vendas de Pronta Entrega. Agora, a atualização do estoque, a criação do pedido e a numeração ocorrem simultaneamente. Se a internet cair no meio do processo, o sistema cancela tudo para evitar furos no estoque.",
            "🔢 **Contador Centralizado Inteligente:** O sistema parou de 'adivinhar' o próximo número de pedido contando listas antigas. Agora ele consulta um registro oficial no banco de dados. Isso torna o sistema muito mais rápido e previne erros de numeração duplicada.",
            "🚫 **Detector de Duplicidade:** No cadastro de estoque, o sistema agora alerta em tempo real se você tentar cadastrar um produto com um nome que já existe, evitando bagunça no catálogo.",
            "🧰 **Arquitetura Unificada (Utils):** Criamos uma 'caixa de ferramentas' central (`utils.js`). Todas as formatações de moeda (R$) e datas agora vêm de um único lugar, garantindo que o sistema inteiro fale a mesma língua."
        ]
    },
    {
        version: "1.1.9",
        date: "14/01/2026",
        changes: [
            "📦 **Novo Módulo de Estoque:** Separação estratégica entre a gestão (Cadastro) e a operação (Venda). Agora existe um menu exclusivo para 'Controle de Estoque' onde você define quantidades e preços.",
            "🔢 **Controle Quantitativo Real:** Adeus ao cadastro unitário! Agora você informa que tem '5 unidades' de um produto. O sistema gerencia esse número automaticamente a cada venda.",
            "🛍️ **Balcão de Vendas (Pronta Entrega):** A tela de Pronta Entrega foi transformada em um 'Ponto de Venda' (POS) simplificado. Ela exibe visualmente o status do estoque (Verde/Laranja/Vermelho) e permite vender múltiplas unidades com um clique.",
            "📉 **Baixa Automática:** Registrar uma venda não apaga mais o produto do catálogo. O sistema apenas desconta a quantidade vendida. Mesmo que o estoque zere (ou fique negativo), o cadastro permanece salvo para futuras reposições."
        ]
    },
    {
        version: "1.1.8",
        date: "08/01/2026",
        changes: [
            "🛍️ **De Estoque para Catálogo:** O módulo 'Pronta Entrega' foi reinventado! Agora os produtos funcionam como um catálogo fixo (ex: para Feiras). Ao vender um item, ele permanece na lista para futuras vendas, eliminando a necessidade de recadastrar toda vez.",
            "💰 **Inteligência Financeira:** O cadastro de Pronta Entrega agora separa explicitamente Custos, Salário e Caixa da Empresa. Isso garante que as vendas rápidas alimentem seu Relatório Financeiro com precisão, acabando com as vendas sem dados de lucro.",
            "✏️ **Edição de Produtos:** Adicionado o botão 'Editar' no catálogo. Agora é possível ajustar preços, custos ou nomes de um produto existente sem precisar excluí-lo e criar outro do zero.",
            "🤖 **Cálculo Automático:** Ao preencher os custos e a margem de lucro no formulário de Pronta Entrega, o sistema agora soma os valores automaticamente para sugerir o Preço Final de Venda, evitando erros de cálculo."
        ]
    },
    {
        version: "1.1.7",
        date: "06/01/2026",
        changes: [
            "🖨️ **Identidade Visual Padronizada:** A nota de Orçamento agora utiliza a fonte oficial ('Roboto') em vez da fonte cursiva, garantindo maior legibilidade e profissionalismo.",
            "🛡️ **Privacidade de Dados:** Removida a numeração interna (ex: 0001/2026) da Nota de Orçamento impressa, conforme solicitação administrativa.",
            "📅 **Reorganização de Layout:** As datas de emissão e validade foram reposicionadas estrategicamente para uma leitura mais fluida, substituindo o antigo cabeçalho numérico.",
            "🎨 **Coesão Visual:** O Checklist de Produção foi reformulado para seguir a paleta de cores da marca (Teal e Rosé), abandonando o visual monocromático antigo."
        ]
    },
    {
        version: "1.1.6",
        date: "05/01/2026",
        changes: [
            "📄 **Orçamentos Padronizados:** A impressão agora inclui automaticamente os 5 termos de serviço do ateliê (regras de pagamento, artes e prazos), garantindo segurança e clareza jurídica para todos os clientes.",
            "📊 **Nota de Pedido Inteligente:** Ao imprimir um pedido, o sistema agora gera um 'Demonstrativo Financeiro' visual com cores, separando claramente o que é Custo (Vermelho), seu Salário (Azul) e o Caixa da Empresa (Verde).",
            "🗣️ **Linguagem Natural:** Atualização do termo técnico 'Mão de Obra' para 'Meu Salário' na tela de edição de pedidos, reforçando a valorização do tempo da artesã.",
            "🧹 **Limpeza Visual:** Refinamento dos documentos impressos com a remoção de campos redundantes e ajuste nas datas para maior precisão."
        ]
    },
    {
        version: "1.1.5",
        date: "02/01/2026",
        changes: [
            "🎨 **Design de Impressão Premium:** Transformação total dos documentos gerados (Orçamentos e Pedidos). Agora eles possuem um layout visual de 'Papel Timbrado', alinhado à identidade da marca Pérola Rara.",
            "📄 **Nova 'Nota de Pedido':** Adicionado um botão exclusivo na lista de pedidos para gerar um documento formal para o cliente, separado do Checklist interno de produção.",
            "💰 **Transparência Financeira na Impressão:** A nova Nota de Pedido agora exibe claramente para o cliente o valor da 'Entrada' (Já pago) e o 'Restante' (A pagar na entrega), com destaque visual nas cores da marca.",
            "🖋️ **Tipografia & Branding:** Integração das fontes oficiais ('Dancing Script' para títulos e 'Roboto' para dados) e inserção automática do logotipo em alta resolução nos documentos impressos."
        ]
    },
    {
        version: "1.1.4",
        date: "02/01/2026",
        changes: [
            "🏗️ **Refatoração Estratégica:** O antigo arquivo 'gigante' de Orçamentos foi dividido em dois especialistas: Vendas (orcamentos.js) e Produção (pedidos.js).",
            "🏭 **Foco em Produção:** O novo módulo de Pedidos agora gerencia exclusivamente o 'chão de fábrica' (checklists, edição de entregas e relatórios), garantindo que a área de vendas não seja impactada por mudanças na produção.",
            "🧩 **Arquitetura Limpa:** Implementamos um padrão de 'Injeção de Dependências', permitindo que os módulos compartilhem ferramentas (como formatação de moeda e salvamento) sem criar conflitos técnicos.",
            "🚀 **Base Sólida:** Essa separação prepara o terreno para futuras funcionalidades avançadas, como um Kanban de Produção e controle de estoque, sem a necessidade de reescrever o código antigo."
        ]
    },
    {
        version: "1.1.3",
        date: "01/01/2026",
        changes: [
            "📦 **Arquitetura Modular:** Realizamos uma grande refatoração nos bastidores! O módulo de Precificação foi dividido para separar a 'Gestão de Produtos' (Receitas) da 'Calculadora Financeira'.",
            "🛡️ **Maior Estabilidade:** Com essa divisão, alterações nos cálculos de preço não correm mais o risco de afetar o cadastro dos seus produtos, tornando o sistema mais robusto.",
            "🚀 **Performance de Código:** Arquivos menores e mais organizados facilitam o carregamento e futuras atualizações do sistema.",
            "🔧 **Base Preparada para o Futuro:** Essa estrutura permite que, em breve, possamos adicionar funcionalidades como 'Duplicar Produto' ou 'Importar Receitas' com muito mais facilidade."
        ]
    },
    {
        version: "1.1.2",
        date: "31/12/2025",
        changes: [
            "🔍 **Busca Inteligente:** Implementada barra de pesquisa instantânea nos módulos de 'Orçamentos' e 'Pedidos'. Agora é possível filtrar por Nome do Cliente, Número ou Data em tempo real.",
            "📄 **Paginação Automática:** Adeus rolagem infinita! As listas agora são organizadas em páginas (10 itens por vez) com navegação 'Anterior/Próximo', melhorando a performance e organização visual.",
            "🧹 **Limpeza de Interface:** Remoção dos botões manuais de 'Atualizar Lista', tornando o layout mais limpo e a experiência mais fluida.",
            "⚡ **Otimização de Renderização:** O sistema agora processa grandes volumes de dados de forma fatiada, evitando travamentos em dispositivos móveis."
        ]
    },
    {
        version: "1.1.1",
        date: "29/12/2025",
        changes: [
            "🤖 **Assistente Inteligente de Custos:** Fim do 'chutômetro'! Agora os itens complexos (Energia, Depreciação, Aluguel) possuem uma calculadora integrada baseada em consultoria especializada.",
            "⚡ **Cálculo de Energia:** Basta informar a potência da máquina e horas de uso para saber o custo exato na conta de luz, separando o gasto do ateliê do gasto doméstico.",
            "📉 **Depreciação Automática:** Fórmula embutida para calcular quanto reservar mensalmente para a reposição futura de máquinas e equipamentos.",
            "💾 **Memória de Cálculo:** O sistema agora salva os dados técnicos (Watts, m², Valor de Compra) que você preencheu. Na próxima vez, basta ajustar o tempo de uso sem precisar procurar os manuais novamente.",
            "🎨 **Interface Intuitiva:** Novo ícone de calculadora nos itens compatíveis e janela pop-up simplificada para inserção de dados."
        ]
    },
    {
        version: "1.1.0",
        date: "28/12/2025",
        changes: [
            "🗣️ **Humanização da Interface:** Adeus ao 'idioma de contador'! Unificação total da terminologia para a realidade da artesã.",
            "💰 **Meu Salário:** O termo 'Mão de Obra' foi substituído por 'Meu Salário' em todo o sistema, reforçando que o tempo trabalhado é sagrado.",
            "🏢 **Cultura de Reinvestimento:** 'Lucro' agora é 'Caixa da Empresa' e 'Custos Indiretos' viraram 'Gastos Fixos', facilitando o entendimento financeiro.",
            "🎓 **Educação Integrada:** Adição de tooltips (dicas flutuantes) explicativos nos novos termos para guiar a precificação.",
            "🖨️ **Coerência na Impressão:** As notas de precificação geradas agora utilizam exatamente os mesmos termos amigáveis apresentados na tela."
        ]
    },
    {
        version: "1.0.9",
        date: "11/12/2025",
        changes: [
            "🧮 Precisão Contábil: A fórmula de Encargos Trabalhistas foi recalibrada. O custo por hora agora reflete estritamente a provisão de 13º Salário + 1/3 de Férias diluídos nas horas trabalhadas, eliminando duplicações.",
            "⚡ Cálculo em Tempo Real: A simulação de Mão de Obra agora responde instantaneamente à digitação e seleção de opções, sem necessidade de salvar para visualizar a prévia.",
            "🔘 Controle de Custos: Implementado o botão 'Zerar' na tabela de Custos Indiretos. Agora é possível remover um custo do cálculo atual com um clique, mantendo a agilidade na precificação.",
            "🎨 UI Semântica: Estilização de alerta (vermelho suave) para ações de remoção/zeramento, prevenindo cliques acidentais."
        ]
    },
    {
        version: "1.0.8",
        date: "10/12/2025",
        changes: [
            "💎 Refinamento Visual (UI): Substituição global de Emojis por Ícones Vetoriais (SVG) delicados, elevando a percepção profissional do Portal.",
            "🎨 Coesão do Design System: Padronização do botão 'Salvar Precificação' para a cor primária (Teal), alinhando-o aos demais botões de ação.",
            "🧠 Semântica Financeira: O 'Subtotal de Custos' agora é exibido inteiramente em vermelho (Rótulo e Valor), facilitando a distinção imediata entre Saídas (Custos) e Entradas (Lucro).",
            "🧹 Limpeza de Interface: Remoção de redundâncias no painel de inputs e reagrupamento estratégico dos detalhes (Materiais e Custos Indiretos) no cartão de resultado.",
            "📝 Clareza Textual: Renomeação do módulo para 'Cálculo da Precificação', tornando a função da tela mais objetiva."
        ]
    }
];

/**
 * Inicializa o componente de versão na tela
 */
export function initChangelog() {
    const container = document.getElementById('version-container');
    
    // Proteção caso o container não exista no HTML
    if (!container) {
        console.warn('Container de versão (#version-container) não encontrado.');
        return;
    }

    // Pega a versão mais recente (o primeiro item do array)
    const latestVer = changeLogData[0].version;

    // Cria o elemento visual do indicador
    const indicator = document.createElement('div');
    indicator.id = 'version-indicator';
    indicator.textContent = `v${latestVer}`;
    indicator.title = "Clique para ver o histórico de atualizações";
    
    // Adiciona evento de clique para abrir o modal
    indicator.addEventListener('click', () => openChangelogModal());
    
    // Injeta no HTML
    container.innerHTML = ''; // Limpa conteúdo anterior se houver
    container.appendChild(indicator);
}

/**
 * Constrói e exibe o modal de histórico
 */
function openChangelogModal() {
    // Evita abrir múltiplos modais
    if (document.querySelector('.changelog-overlay')) return;

    // Cria o overlay (fundo escuro)
    const overlay = document.createElement('div');
    overlay.className = 'changelog-overlay';
    
    // Gera o HTML da lista de mudanças
    let listHTML = '';
    changeLogData.forEach(log => {
        const items = log.changes.map(c => `<li>${c}</li>`).join('');
        listHTML += `
            <div class="changelog-item">
                <div class="header-log">
                    <span class="changelog-version">Versão ${log.version}</span>
                    <span class="changelog-date">${log.date}</span>
                </div>
                <ul class="changelog-list">${items}</ul>
            </div>
        `;
    });

    // Estrutura interna do Modal
    overlay.innerHTML = `
        <div class="changelog-modal">
            <span class="close-changelog">&times;</span>
            <div class="modal-header">
                <h2>Histórico de Atualizações</h2>
                <p>Acompanhe a evolução do Portal Pérola Rara</p>
            </div>
            <div class="changelog-content">
                ${listHTML}
            </div>
        </div>
    `;

    // Lógica para fechar o modal (Botão X)
    overlay.querySelector('.close-changelog').onclick = () => overlay.remove();

    // Lógica para fechar clicando fora do modal
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
}
