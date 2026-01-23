// assets/js/utils.js

export const utils = {
    // 1. FORMATAÇÃO VISUAL (Número -> String R$)
    formatarMoeda: (valor) => {
        // Blindagem: Se o valor for inválido (null, undefined, NaN), retorna visualização zerada
        if (valor === undefined || valor === null || isNaN(valor)) {
            return 'R$ 0,00';
        }
        // Garante que é tratado como float antes de formatar
        return parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    // 2. PARSER ROBUSTO (String R$ -> Número Float)
    // Objetivo: Transformar qualquer "sujeira" de input em número válido
    converterMoedaParaNumero: (valor) => {
        // Caso 1: Já é um número, retorna ele mesmo
        if (typeof valor === 'number') return valor;
        
        // Caso 2: Valor nulo, undefined ou vazio
        if (!valor) return 0;

        // Converte para string para segurança (caso venha um objeto inesperado)
        const stringValor = String(valor);

        // SANITIZAÇÃO (Prioridade 1 - Blindagem):
        // Remove tudo que NÃO for dígito (0-9), sinal de menos (-) ou vírgula (,).
        // Ignora: "R$", pontos de milhar, espaços, letras, símbolos invisíveis.
        const limpo = stringValor.replace(/[^\d,-]/g, '');

        // Se a string sanitizada ficou vazia ou contém apenas pontuação isolada, assume 0
        if (!limpo || limpo === ',' || limpo === '-') return 0;

        // Troca a vírgula decimal (padrão BR) por ponto (padrão JS/US) para cálculo
        const formatadoUSA = limpo.replace(',', '.');

        // Converte para Float
        const numero = parseFloat(formatadoUSA);

        // Última barreira de segurança: Retorna 0 se o resultado for NaN
        return isNaN(numero) ? 0 : numero;
    },

    // 3. AUXILIARES DE DATA
    formatarDataBR: (dataISO) => {
        if (!dataISO) return '-';
        // Espera formato YYYY-MM-DD
        const parts = dataISO.split('-');
        // Se a data não tiver 3 partes, retorna a original
        if (parts.length !== 3) return dataISO;
        
        const [ano, mes, dia] = parts;
        return `${dia}/${mes}/${ano}`;
    },

    // 4. MÁSCARA DE INPUT (Evento em Tempo Real)
    // Estilo ATM: Digita da direita para a esquerda (ex: 1 -> 0,01)
    aplicarMascaraMoeda: (input) => {
        // Remove tudo que não é dígito (limpeza inicial)
        let valor = input.value.replace(/\D/g, '');
        
        // Se o usuário apagou tudo, limpa o campo visualmente para não ficar "R$ 0,00" travado
        if (valor === '') {
            input.value = '';
            return;
        }

        // Converte para decimal (Divide por 100 para simular centavos)
        // parseInt com base 10 remove zeros à esquerda automaticamente (ex: "0050" vira 50)
        valor = (parseInt(valor, 10) / 100).toFixed(2) + '';
        
        // Troca ponto por vírgula para visualização brasileira
        valor = valor.replace(".", ",");
        
        // Adiciona pontos de milhar a cada 3 dígitos
        valor = valor.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
        
        // Atualiza o input com o prefixo
        input.value = 'R$ ' + valor;
    },

    // --- NOVAS FUNÇÕES: UX DE BUSCA E ORDENAÇÃO (v1.2.1) ---

    // 5. LIMPAR BUSCA (Vinculado ao botão X)
    limparBusca: (idInput) => {
        const input = document.getElementById(idInput);
        if (input) {
            input.value = '';
            input.focus();
            
            // Importante: Dispara manualmente o evento 'input'.
            // Isso faz com que os listeners "debounce" nos módulos (orcamentos.js, etc.)
            // percebam a mudança e recarreguem a lista original (sem filtro).
            input.dispatchEvent(new Event('input'));
            
            // Atualiza estado visual do botão (esconde o X)
            utils.alternarBotaoLimpar(input);
        }
    },

    // 6. CONTROLE VISUAL DO BOTÃO "X"
    alternarBotaoLimpar: (input) => {
        // Procura o botão dentro do wrapper pai (definido no HTML/CSS)
        const wrapper = input.parentElement;
        if (wrapper) {
            const btn = wrapper.querySelector('.btn-clear-search');
            if (btn) {
                // Mostra se tiver texto, esconde se vazio
                btn.style.display = input.value.trim().length > 0 ? 'flex' : 'none';
            }
        }
    },

    // 7. HELPER GENÉRICO DE ORDENAÇÃO
    ordenarDados: (array, chave, ordem = 'asc') => {
        return array.sort((a, b) => {
            // Proteção e tratamento para strings (Case Insensitive)
            const valA = (a[chave] !== undefined && a[chave] !== null) ? String(a[chave]).toLowerCase() : '';
            const valB = (b[chave] !== undefined && b[chave] !== null) ? String(b[chave]).toLowerCase() : '';

            if (valA < valB) return ordem === 'asc' ? -1 : 1;
            if (valA > valB) return ordem === 'asc' ? 1 : -1;
            return 0;
        });
    },

    // 8. LÓGICA DE CASCATA DE DESCONTOS (NOVO - v1.2.1 - Prioridade 1)
    // Distribui o valor da venda priorizando: Custos > Salário > Lucro
    calcularCascataFinanceira: (valorVendaTotal, custoProducaoTotal, salarioAlvoTotal) => {
        // 1. Garante números limpos e seguros
        const vlrVenda = parseFloat(valorVendaTotal) || 0;
        const vlrCusto = parseFloat(custoProducaoTotal) || 0;
        const vlrSalarioAlvo = parseFloat(salarioAlvoTotal) || 0;

        // 2. O que sobra após pagar os materiais/custos fixos?
        const sobraOperacional = vlrVenda - vlrCusto;

        let salarioReal = 0;
        let lucroReal = 0;
        let status = 'normal'; // normal, alerta (salário reduzido), prejuizo (custo não pago)

        if (sobraOperacional < 0) {
            // CENÁRIO CRÍTICO: Preço não cobre nem os custos
            status = 'prejuizo';
            salarioReal = 0;
            lucroReal = 0; // Prejuízo técnico fica implicito na diferença entre Venda e Custos
        } else if (sobraOperacional < vlrSalarioAlvo) {
            // CENÁRIO DE ALERTA: Cobre custos, mas "come" parte do salário
            status = 'alerta';
            salarioReal = sobraOperacional; // Artesã recebe apenas o que sobrou
            lucroReal = 0; // Empresa não lucra
        } else {
            // CENÁRIO IDEAL: Cobre custos e salário integral
            status = 'normal';
            salarioReal = vlrSalarioAlvo;
            lucroReal = sobraOperacional - vlrSalarioAlvo; // O excedente vai para o caixa
        }

        return {
            custos: vlrCusto,
            salario: salarioReal,
            lucro: lucroReal,
            status: status,
            sobraOperacional: sobraOperacional
        };
    }
};

// Expor função de limpar busca para o escopo global (window)
// Isso é necessário para que o atributo onclick="limparBusca(...)" no HTML funcione.
window.limparBusca = utils.limparBusca;
