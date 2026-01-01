// assets/js/changelog.js

/**
 * Dados do Histórico de Versões
 * Adicione novas versões no topo do array.
 */
const changeLogData = [
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
    },
    {
        version: "1.0.7",
        date: "09/12/2025",
        changes: [
            "🎨 Redesign Total da Precificação: A antiga calculadora evoluiu para um 'Painel de Controle Financeiro' (Dashboard).",
            "📊 Cartão de Resultado Inteligente: Nova visualização que 'explode' o preço final, separando claramente o que é Custo, o que é seu Salário (Mão de Obra) e o que é Lucro da Empresa.",
            "🧠 Clareza Financeira: Destaque visual com cores específicas para diferenciar o dinheiro da artesã (Azul) do dinheiro de crescimento do negócio (Verde).",
            "📱 Layout Responsivo Otimizado: Estrutura de colunas que se adapta perfeitamente: lado a lado no computador e empilhado verticalmente no celular.",
            "🔧 Organização de Inputs: Controles de Margem e Taxas agrupados logicamente para facilitar o preenchimento."
        ]
    },
    {
        version: "1.0.6",
        date: "08/12/2025",
        changes: [
            "🏗️ Refatoração Arquitetural: Divisão estratégica do módulo de Precificação em dois núcleos ('Insumos' e 'Produtos') para maior estabilidade.",
            "⚡ Performance: Implementação de carregamento paralelo (Promise.all) para Materiais, Mão de Obra e Custos Indiretos.",
            "🔧 Manutenibilidade: Criação do arquivo 'precificacao-insumos.js' centralizando a lógica de custos base, facilitando futuras inovações.",
            "🔗 Integridade: Sistema de callbacks implementado para garantir que atualizações de materiais recalculem automaticamente os custos dos produtos ('Efeito Dominó')."
        ]
    },
    {
        version: "1.0.5",
        date: "07/12/2025",
        changes: [
            "🧠 Mudança de Paradigma: O módulo de Precificação agora é 100% focado no Produto, removendo o campo 'Cliente' para maior consistência dos dados.",
            "🔢 Numeração Inteligente: Implementado sistema de 'preenchimento de lacunas'. Ao excluir uma precificação (ex: Nº 2), o próximo registro assumirá este número automaticamente.",
            "👀 Feedback Visual em Tempo Real: Adicionado um 'Badge' de alerta ao selecionar um produto, informando instantaneamente se ele já possui preço salvo.",
            "🛡️ Proteção de Dados: Nova lógica de salvamento que detecta duplicidade e permite atualizar o registro existente em vez de criar cópias desnecessárias.",
            "🏷️ Interface: Renomeação do menu 'Calculadora' para 'Precificação' e limpeza visual do formulário."
        ]
    },
    {
        version: "1.0.4",
        date: "06/12/2025",
        changes: [
            "🚀 Power UX: Navegação profissional por teclado na busca de produtos (Setas ↑/↓ e Enter).",
            "⏳ Feedback Visual: Adicionado indicador de carregamento (spinner) no campo de busca.",
            "💎 Refinamento de Interface: Destaque visual claro para o item selecionado na lista de sugestões."
        ]
    },
    {
        version: "1.0.3",
        date: "05/12/2025",
        changes: [
            "⚡ Otimização (Debounce): A busca de produtos agora aguarda você parar de digitar, tornando o sistema mais rápido em celulares.",
            "🖱️ UX Melhorada: A lista de sugestões fecha automaticamente ao clicar fora dela, limpando a tela.",
            "🎨 Correção Visual: Alinhamento dos botões de seleção (Materiais e Encargos) corrigido."
        ]
    },
    {
        version: "1.0.2",
        date: "05/12/2025",
        changes: [
            "🐛 Correção Crítica: O campo de busca de produtos na Calculadora de Precificação agora exibe a lista de sugestões corretamente.",
            "🎨 Melhoria UI: A lista de resultados da busca recebeu sombreamento e melhor posicionamento para não quebrar o layout.",
            "🔧 Ajuste Técnico: Refinamento na lógica de exibição/ocultação (classe .hidden) dos resultados de pesquisa."
        ]
    },
    {
        version: "1.0.1",
        date: "03/12/2025",
        changes: [
            "🖨️ Restauração da funcionalidade 'Imprimir Orçamento' com layout otimizado.",
            "💰 Inclusão de campos gerenciais ('Margem de Lucro' e 'Custo Mão de Obra') na edição de pedidos.",
            "🎨 Implementação de regras CSS de impressão para relatórios mais limpos.",
            "🔧 Ajustes na persistência de dados financeiros no Firebase."
        ]
    },
    {
        version: "1.0.0",
        date: "01/12/2025",
        changes: [
            "✨ Refinamento visual da Splash Screen (Tema Rosé).",
            "🎨 Melhoria nos cards do Hub com efeitos de interatividade.",
            "📐 Reposicionamento estratégico do slogan da marca.",
            "👤 Novo design para identificação de usuário logado.",
            "🚀 Implementação do módulo de Changelog (Histórico de Mudanças)."
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
