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
    }
};
