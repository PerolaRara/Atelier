// assets/js/orcamentos.js

import { db, auth } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, setDoc, updateDoc, deleteDoc, query, orderBy, where } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// IMPORTAÇÃO ESTRATÉGICA DO MÓDULO DE PEDIDOS
import { setupPedidos, adicionarPedidoNaLista } from './pedidos.js';

// Referências
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");
const estoqueRef = collection(db, "estoque"); // Catálogo de Pronta Entrega / Estoque
const precificacoesRef = collection(db, "precificacoes-geradas");

// Variáveis de Estado (Dados)
let numeroOrcamento = 1;
let numeroPedido = 1;
const anoAtual = new Date().getFullYear();
let orcamentoEditando = null;
let orcamentos = [];
let itensEstoque = []; // Estado local do catálogo
let precificacoesCache = []; 
let moduleInitialized = false;

// Variáveis de Estado (Paginação e Busca - Orçamentos)
const ITENS_POR_PAGINA = 10;
let pagAtualOrc = 1;
let termoBuscaOrc = "";

// Variáveis de Estado (Paginação e Busca - Estoque e Vendas)
let pagAtualEstoqueAdm = 1;
let pagAtualVendaEstoque = 1;
let termoBuscaEstoqueAdm = "";
let termoBuscaVendaEstoque = "";

// ==========================================================================
// 1. HELPERS E FORMATAÇÃO
// ==========================================================================

const helpers = {
    formatarMoeda: (valor) => {
        if (valor === undefined || valor === null) return 'R$ 0,00';
        return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },
    converterMoedaParaNumero: (valor) => {
        if (typeof valor === 'number') return valor;
        if (typeof valor !== 'string') return 0;
        return parseFloat(valor.replace(/R\$\s?|\./g, '').replace(',', '.')) || 0;
    }
};

// Helpers expostos para o HTML (oninput)
window.formatarEntradaMoeda = (input) => {
    if (!input.value) {
        input.value = 'R$ 0,00';
        return;
    }
    let valor = input.value.replace(/\D/g, '');
    valor = (valor / 100).toFixed(2) + '';
    valor = valor.replace(".", ",");
    valor = valor.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
    input.value = 'R$ ' + valor;
};

// ==========================================================================
// 2. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================
export async function initOrcamentos() {
    console.log("Inicializando Módulo Orçamentos e Estoque...");
    
    // EXPOR FUNÇÕES DE ORÇAMENTO PARA O HTML
    window.excluirProduto = excluirProduto;
    window.visualizarImpressao = visualizarImpressao;
    window.editarOrcamento = editarOrcamento;
    window.gerarPedido = gerarPedido; 
    window.gerarOrcamento = gerarOrcamento;
    window.atualizarOrcamento = atualizarOrcamento;

    // EXPOR FUNÇÕES DE ESTOQUE (NOVO FLUXO)
    window.cadastrarItemEstoque = cadastrarItemEstoque;
    window.iniciarVenda = iniciarVenda; // Substitui venderItemEstoque
    window.excluirItemEstoque = excluirItemEstoque;
    window.editarItemEstoque = editarItemEstoque;
    window.cancelarEdicaoEstoque = cancelarEdicaoEstoque;
    // window.selecionarSugestaoEstoque removido (Feature desativada)

    // Carregar dados do banco e distribuir para os módulos
    await carregarDados();
    
    // Configurar eventos (apenas uma vez)
    if (!moduleInitialized) {
        setupEventListeners();
        
        // Popular Select de Anos no Relatório (UI Global)
        const selectAno = document.getElementById("relatorio-ano");
        if(selectAno) {
            for(let i = anoAtual; i >= anoAtual - 2; i--) {
                const opt = document.createElement("option");
                opt.value = i;
                opt.text = i;
                selectAno.appendChild(opt);
            }
        }
        
        // PRIORIDADE 2: Pré-selecionar datas do mês atual no relatório de saídas (UX)
        configurarDatasRelatorioPadrao();

        moduleInitialized = true;
    }
    
    mostrarPagina('form-orcamento');
}

// Helper para definir datas padrão
function configurarDatasRelatorioPadrao() {
    const hoje = new Date();
    // Primeiro dia do mês atual
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
    // Último dia do mês atual
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];

    const inputInicio = document.getElementById('rel-estoque-inicio');
    const inputFim = document.getElementById('rel-estoque-fim');

    if(inputInicio) inputInicio.value = primeiroDia;
    if(inputFim) inputFim.value = ultimoDia;
}

async function carregarDados() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        orcamentos = [];
        const pedidosTemp = []; 

        // Carregar Orçamentos e Pedidos
        const q = query(orcamentosPedidosRef, orderBy("numero"));
        const snapshot = await getDocs(q);

        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;

            if (data.tipo === 'orcamento') {
                orcamentos.push(data);
                const num = parseInt(data.numero.split('/')[0]);
                if (num >= numeroOrcamento) numeroOrcamento = num + 1;
            } else if (data.tipo === 'pedido') {
                pedidosTemp.push(data);
                const num = parseInt(data.numero.split('/')[0]);
                if (num >= numeroPedido) numeroPedido = num + 1;
            }
        });
        
        // Carregar Catálogo/Estoque
        await carregarEstoque();

        // Carregar Precificações para Cache (Mantido caso seja usado em outro lugar, mas removido da busca de estoque)
        const qPrec = query(precificacoesRef, orderBy("data", "desc"));
        const snapPrec = await getDocs(qPrec);
        precificacoesCache = [];
        snapPrec.forEach(doc => {
            precificacoesCache.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`Carregado: ${orcamentos.length} Orçamentos, ${pedidosTemp.length} Pedidos, ${itensEstoque.length} Itens Estoque`);
        
        // 1. Renderiza Orçamentos
        mostrarOrcamentosGerados();
        
        // 2. Inicializa o Módulo de Pedidos
        setupPedidos({
            listaPedidos: pedidosTemp,
            salvarDadosFn: salvarDados,
            helpers: helpers
        });

    } catch (error) {
        console.error("Erro ao carregar dados:", error);
    }
}

// Carregamento Específico de Estoque
async function carregarEstoque() {
    itensEstoque = [];
    const snapshot = await getDocs(estoqueRef);
    snapshot.forEach(doc => {
        itensEstoque.push({ id: doc.id, ...doc.data() });
    });
    // Renderiza as duas visões (Venda e Gestão)
    renderizarTabelaProntaEntrega();
    renderizarTabelaEstoqueAdm();
}

// Função de Salvamento Genérica
async function salvarDados(dados, tipo) {
    if (!auth.currentUser) {
        alert("Sessão expirada.");
        return;
    }
    try {
        if (dados.id) {
            const docRef = doc(orcamentosPedidosRef, dados.id);
            await setDoc(docRef, dados, { merge: true });
        } else {
            const docRef = await addDoc(orcamentosPedidosRef, { ...dados, tipo });
            dados.id = docRef.id;
        }
    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar no banco de dados.");
    }
}

// ==========================================================================
// 3. LISTENERS E NAVEGAÇÃO
// ==========================================================================

function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

function setupEventListeners() {
    // Navegação entre Abas
    document.querySelectorAll('#module-orcamentos nav ul li a[data-pagina]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            mostrarPagina(link.dataset.pagina);
        });
    });

    // Botões de Orçamento
    bindClick('#btnAddProdutoOrcamento', adicionarProduto);
    bindClick('#btnGerarOrcamento', gerarOrcamento);
    bindClick('#btnAtualizarOrcamento', atualizarOrcamento);

    // --- LOGICA ESTOQUE E VENDAS (NOVOS IDs) ---
    
    // Cadastro/Edição no Menu Estoque
    bindClick('#btn-salvar-estoque', cadastrarItemEstoque);
    bindClick('#btn-cancelar-estoque', cancelarEdicaoEstoque); 
    
    // Fallback para IDs antigos
    bindClick('#btn-add-estoque', cadastrarItemEstoque);
    bindClick('#btn-cancelar-edicao-estoque', cancelarEdicaoEstoque);

    // PRIORIDADE 1: Listener do Relatório de Saídas (Novo)
    bindClick('#btn-gerar-relatorio-saida', gerarRelatorioRanking);

    // Paginação: Tabela de Vendas (Pronta Entrega)
    bindClick('#btn-ant-venda-est', () => { 
        if(pagAtualVendaEstoque > 1) { pagAtualVendaEstoque--; renderizarTabelaProntaEntrega(); } 
    });
    bindClick('#btn-prox-venda-est', () => { 
        pagAtualVendaEstoque++; renderizarTabelaProntaEntrega(); 
    });

    // Paginação: Tabela de Gestão (Estoque ADM)
    bindClick('#btn-ant-est-adm', () => { 
        if(pagAtualEstoqueAdm > 1) { pagAtualEstoqueAdm--; renderizarTabelaEstoqueAdm(); } 
    });
    bindClick('#btn-prox-est-adm', () => { 
        pagAtualEstoqueAdm++; renderizarTabelaEstoqueAdm(); 
    });

    // Busca com Debounce: Vendas
    const inputBuscaVenda = document.getElementById('busca-vendas-estoque');
    if(inputBuscaVenda) {
        inputBuscaVenda.addEventListener('input', debounce((e) => {
            termoBuscaVendaEstoque = e.target.value.toLowerCase();
            pagAtualVendaEstoque = 1; 
            renderizarTabelaProntaEntrega();
        }));
    }

    // Busca com Debounce: Gestão
    const inputBuscaAdm = document.getElementById('busca-lista-estoque-adm');
    if(inputBuscaAdm) {
        inputBuscaAdm.addEventListener('input', debounce((e) => {
            termoBuscaEstoqueAdm = e.target.value.toLowerCase();
            pagAtualEstoqueAdm = 1; 
            renderizarTabelaEstoqueAdm();
        }));
    }

    // PRIORIDADE 3: Cálculo Automático do Preço de Venda
    const inputsFinanceiros = ['estoque-custo', 'estoque-mao-obra', 'estoque-margem'];
    inputsFinanceiros.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('input', () => {
                window.formatarEntradaMoeda(el);
                atualizarPrecoVendaAutomatico();
            });
        }
    });
    // --- FIM LOGICA ESTOQUE ---

    // Busca de Orçamentos
    const inputBuscaOrc = document.getElementById('busca-orcamentos');
    if(inputBuscaOrc) {
        inputBuscaOrc.addEventListener('input', debounce((e) => {
            termoBuscaOrc = e.target.value.toLowerCase();
            pagAtualOrc = 1; 
            mostrarOrcamentosGerados();
        }));
    }

    // PRIORIDADE 1: REMOVIDOS LISTENERS DE BUSCA INTELIGENTE DE ESTOQUE (inputProdEstoque)
    
    // Paginação de Orçamentos
    bindClick('#btn-ant-orc', () => { 
        if(pagAtualOrc > 1) { pagAtualOrc--; mostrarOrcamentosGerados(); } 
    });
    bindClick('#btn-prox-orc', () => { 
        pagAtualOrc++; mostrarOrcamentosGerados(); 
    });

    // Listeners Dinâmicos (Inputs da Tabela de Orçamento)
    const tabProd = document.querySelector('#tabelaProdutos');
    if(tabProd) {
        tabProd.addEventListener('input', (e) => {
            if(e.target.matches('.produto-quantidade, .produto-valor-unit')) atualizarTotais();
        });
    }
    
    const freteInput = document.querySelector('#valorFrete');
    if(freteInput) freteInput.addEventListener('input', () => {
        window.formatarEntradaMoeda(freteInput);
        atualizarTotais();
    });
}

function bindClick(selector, handler) {
    const el = document.querySelector(selector);
    if(el) el.addEventListener('click', handler);
}

function mostrarPagina(idPagina) {
    document.querySelectorAll('#module-orcamentos .pagina').forEach(p => p.style.display = 'none');
    const target = document.getElementById(idPagina);
    if(target) {
        target.style.display = 'block';
        if(idPagina === 'orcamentos-gerados') mostrarOrcamentosGerados();
        if(idPagina === 'estoque') renderizarTabelaEstoqueAdm();
        if(idPagina === 'pronta-entrega') renderizarTabelaProntaEntrega();
    }
}

function gerarNumeroFormatado(numero) {
    return numero.toString().padStart(4, '0') + '/' + anoAtual;
}

function limparCamposMoeda() {
    ['valorFrete', 'valorOrcamento', 'total'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = 'R$ 0,00';
    });
}

// ==========================================================================
// 4. LÓGICA DE NEGÓCIO: ORÇAMENTOS (VENDAS)
// ==========================================================================

function adicionarProduto() {
    const tbody = document.querySelector("#tabelaProdutos tbody");
    const newRow = tbody.insertRow();
    newRow.innerHTML = `
        <td><input type="number" class="produto-quantidade" value="1" min="1"></td>
        <td><input type="text" class="produto-descricao"></td>
        <td><input type="text" class="produto-valor-unit" value="R$ 0,00" oninput="formatarEntradaMoeda(this)"></td>
        <td>R$ 0,00</td>
        <td><button type="button" onclick="excluirProduto(this)">Excluir</button></td>
    `;
}

function excluirProduto(btn) {
    btn.closest('tr').remove();
    atualizarTotais();
}

function atualizarTotais() {
    let totalProd = 0;
    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        const qtd = parseFloat(row.querySelector(".produto-quantidade").value) || 0;
        const unit = helpers.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value);
        const total = qtd * unit;
        row.cells[3].textContent = helpers.formatarMoeda(total);
        totalProd += total;
    });
    
    const frete = helpers.converterMoedaParaNumero(document.getElementById("valorFrete").value);
    document.getElementById("valorOrcamento").value = helpers.formatarMoeda(totalProd);
    document.getElementById("total").value = helpers.formatarMoeda(totalProd + frete);
}

async function gerarOrcamento() {
    const dados = {
        numero: gerarNumeroFormatado(numeroOrcamento),
        dataOrcamento: document.getElementById("dataOrcamento").value,
        dataValidade: document.getElementById("dataValidade").value,
        cliente: document.getElementById("cliente").value,
        endereco: document.getElementById("endereco").value,
        tema: document.getElementById("tema").value,
        cidade: document.getElementById("cidade").value,
        telefone: document.getElementById("telefone").value,
        email: document.getElementById("clienteEmail").value,
        cores: document.getElementById("cores").value,
        pagamento: Array.from(document.querySelectorAll('input[name="pagamento"]:checked')).map(el => el.value),
        valorFrete: helpers.converterMoedaParaNumero(document.getElementById("valorFrete").value),
        valorOrcamento: helpers.converterMoedaParaNumero(document.getElementById("valorOrcamento").value),
        total: helpers.converterMoedaParaNumero(document.getElementById("total").value),
        observacoes: document.getElementById("observacoes").value,
        produtos: [],
        pedidoGerado: false,
        tipo: 'orcamento'
    };

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        dados.produtos.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: helpers.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: helpers.converterMoedaParaNumero(row.cells[3].textContent)
        });
    });

    await salvarDados(dados, 'orcamento');
    numeroOrcamento++;
    orcamentos.push(dados);
    
    document.getElementById("orcamento").reset();
    limparCamposMoeda();
    document.querySelector("#tabelaProdutos tbody").innerHTML = "";
    
    alert("Orçamento gerado!");
    mostrarPagina('orcamentos-gerados');
}

async function atualizarOrcamento() {
    if (!orcamentoEditando) return;
    
    const index = orcamentos.findIndex(o => o.id === orcamentoEditando);
    if(index === -1) return;

    const dados = {
        ...orcamentos[index],
        dataOrcamento: document.getElementById("dataOrcamento").value,
        dataValidade: document.getElementById("dataValidade").value,
        cliente: document.getElementById("cliente").value,
        endereco: document.getElementById("endereco").value,
        tema: document.getElementById("tema").value,
        cidade: document.getElementById("cidade").value,
        telefone: document.getElementById("telefone").value,
        email: document.getElementById("clienteEmail").value,
        cores: document.getElementById("cores").value,
        pagamento: Array.from(document.querySelectorAll('input[name="pagamento"]:checked')).map(el => el.value),
        valorFrete: helpers.converterMoedaParaNumero(document.getElementById("valorFrete").value),
        valorOrcamento: helpers.converterMoedaParaNumero(document.getElementById("valorOrcamento").value),
        total: helpers.converterMoedaParaNumero(document.getElementById("total").value),
        observacoes: document.getElementById("observacoes").value,
        produtos: []
    };

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        dados.produtos.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: helpers.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: helpers.converterMoedaParaNumero(row.cells[3].textContent)
        });
    });

    await salvarDados(dados, 'orcamento');
    orcamentos[index] = dados;
    
    alert("Orçamento atualizado!");
    orcamentoEditando = null;
    document.getElementById("orcamento").reset();
    document.querySelector("#tabelaProdutos tbody").innerHTML = "";
    document.getElementById("btnGerarOrcamento").style.display = "inline-block";
    document.getElementById("btnAtualizarOrcamento").style.display = "none";
    mostrarPagina('orcamentos-gerados');
}

function mostrarOrcamentosGerados() {
    const tbody = document.querySelector("#tabela-orcamentos tbody");
    const btnAnt = document.getElementById("btn-ant-orc");
    const btnProx = document.getElementById("btn-prox-orc");
    const infoPag = document.getElementById("info-pag-orc");
    
    if(!tbody) return;
    tbody.innerHTML = '';

    const termo = termoBuscaOrc.trim();
    const filtrados = orcamentos.filter(orc => {
        if (!termo) return true;
        const dataFormatada = orc.dataOrcamento ? orc.dataOrcamento.split('-').reverse().join('/') : '';
        return orc.cliente.toLowerCase().includes(termo) || 
               orc.numero.toLowerCase().includes(termo) || 
               dataFormatada.includes(termo);
    });

    // Ordenação (Mais recentes primeiro)
    filtrados.sort((a,b) => b.numero.localeCompare(a.numero));

    // Paginação
    const totalItens = filtrados.length;
    const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA) || 1;

    if (pagAtualOrc > totalPaginas) pagAtualOrc = totalPaginas;
    if (pagAtualOrc < 1) pagAtualOrc = 1;

    const inicio = (pagAtualOrc - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum orçamento encontrado.</td></tr>';
    } else {
        itensPagina.forEach(orc => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${orc.numero}</td>
                <td>${orc.dataOrcamento ? orc.dataOrcamento.split('-').reverse().join('/') : '-'}</td>
                <td>${orc.cliente}</td>
                <td>${helpers.formatarMoeda(orc.total)}</td>
                <td>${orc.pedidoGerado ? orc.numeroPedido : 'Não'}</td>
                <td></td>
            `;
            
            const cellAcoes = row.cells[5];
            
            const btnImprimir = document.createElement('button');
            btnImprimir.textContent = "Imprimir";
            btnImprimir.style.marginRight = "5px";
            btnImprimir.onclick = () => visualizarImpressao(orc);
            cellAcoes.appendChild(btnImprimir);

            if (!orc.pedidoGerado) {
                const btnEditar = document.createElement('button');
                btnEditar.textContent = "Editar";
                btnEditar.style.marginRight = "5px";
                btnEditar.onclick = () => editarOrcamento(orc.id);
                cellAcoes.appendChild(btnEditar);
                
                const btnGerar = document.createElement('button');
                btnGerar.textContent = "Gerar Pedido";
                btnGerar.onclick = () => gerarPedido(orc.id);
                cellAcoes.appendChild(btnGerar);
            } else {
                const span = document.createElement('span');
                span.textContent = " Pedido Gerado";
                span.style.color = "#7aa2a9";
                cellAcoes.appendChild(span);
            }
        });
    }

    if (infoPag) infoPag.textContent = `Página ${pagAtualOrc} de ${totalPaginas}`;
    if (btnAnt) btnAnt.disabled = (pagAtualOrc === 1);
    if (btnProx) btnProx.disabled = (pagAtualOrc === totalPaginas);
}

function visualizarImpressao(orcamento) {
    const janela = window.open('', '_blank');
    const dtOrc = orcamento.dataOrcamento ? orcamento.dataOrcamento.split('-').reverse().join('/') : '-';
    const dtVal = orcamento.dataValidade ? orcamento.dataValidade.split('-').reverse().join('/') : '-';
    const pagamento = Array.isArray(orcamento.pagamento) ? orcamento.pagamento.join(', ') : orcamento.pagamento;
    
    // Caminho absoluto da imagem para garantir que apareça na impressão
    const logoSrc = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + '/assets/images/logo_perola_rara.png';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Orçamento - Pérola Rara</title>
            <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { font-family: 'Roboto', sans-serif; color: #555; margin: 0; padding: 40px; background: #fff; font-size: 14px; }
                .header-container { text-align: center; border-bottom: 3px solid #7aa2a9; padding-bottom: 20px; margin-bottom: 20px; }
                .logo-box { margin: 0 auto 10px auto; width: 120px; }
                .logo-box img { max-width: 100%; height: auto; }
                .company-info h1 { font-family: 'Roboto', sans-serif; font-weight: 700; color: #7aa2a9; font-size: 2.2em; margin: 0;}
                .company-info p { margin: 2px 0; font-size: 0.9em; color: #888; }
                .date-bar { display: flex; justify-content: space-between; background-color: #f0f7f7; padding: 10px 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #b2d8d8; }
                .client-box { background-color: #fff; border: 1px solid #eee; padding: 20px; margin-bottom: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                th { background-color: #7aa2a9; color: #fff; font-weight: 500; text-transform: uppercase; font-size: 0.85em; padding: 12px; text-align: left; }
                td { padding: 12px; border-bottom: 1px solid #eee; color: #444; }
                .col-money { text-align: right; font-family: 'Roboto', monospace; font-weight: 500; }
                .totals-box { width: 280px; background: #fff9f8; border: 1px solid #efebe9; padding: 20px; border-radius: 8px; margin-left: auto; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95em; }
                .total-row.final { border-top: 2px solid #dfb6b0; padding-top: 10px; margin-top: 10px; font-size: 1.2em; font-weight: bold; color: #7aa2a9; }
                @media print { .no-print { display: none; } body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div class="logo-box"><img src="${logoSrc}" alt="Pérola Rara"></div>
                <div class="company-info">
                    <h1>Pérola Rara</h1>
                    <p>Fraldas Personalizadas • (65) 99250-3151</p>
                    <p>@perolararafraldapersonalizada</p>
                </div>
            </div>

            <div class="date-bar">
                <div class="date-item"><strong>Data do Orçamento:</strong> ${dtOrc}</div>
                <div class="date-item"><strong>Validade da Proposta:</strong> ${dtVal}</div>
            </div>

            <div class="client-box">
                <div class="info-grid">
                    <div class="info-item"><strong>Cliente</strong> ${orcamento.cliente || '-'}</div>
                    <div class="info-item"><strong>Cidade/Contato</strong> ${orcamento.cidade || '-'} • ${orcamento.telefone || '-'}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 10%">Qtd</th>
                        <th style="width: 50%">Descrição</th>
                        <th class="col-money" style="width: 20%">Valor Unit.</th>
                        <th class="col-money" style="width: 20%">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${orcamento.produtos.map(p => `
                        <tr>
                            <td>${p.quantidade}</td>
                            <td>${p.descricao}</td>
                            <td class="col-money">${helpers.formatarMoeda(p.valorUnit)}</td>
                            <td class="col-money">${helpers.formatarMoeda(p.valorTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="totals-box">
                <div class="total-row"><span>Frete:</span> <span>${helpers.formatarMoeda(orcamento.valorFrete)}</span></div>
                <div class="total-row final"><span>Total:</span> <span>${helpers.formatarMoeda(orcamento.total)}</span></div>
                <div style="margin-top:10px; font-size:0.8em; color:#888; text-align:right;">Forma Pagto: ${pagamento}</div>
            </div>

            <div class="no-print" style="text-align:center; margin-top:40px;">
                <button onclick="window.print()" style="padding:12px 30px; background:#7aa2a9; color:#fff; border:none; border-radius:30px; cursor:pointer; font-weight:bold;">IMPRIMIR</button>
            </div>
        </body>
        </html>
    `;
    janela.document.write(html);
    janela.document.close();
}

function editarOrcamento(id) {
    const orc = orcamentos.find(o => o.id === id);
    if (!orc) return;

    orcamentoEditando = id;
    
    document.getElementById("dataOrcamento").value = orc.dataOrcamento;
    document.getElementById("dataValidade").value = orc.dataValidade;
    document.getElementById("cliente").value = orc.cliente;
    document.getElementById("endereco").value = orc.endereco;
    document.getElementById("tema").value = orc.tema;
    document.getElementById("cidade").value = orc.cidade;
    document.getElementById("telefone").value = orc.telefone;
    document.getElementById("clienteEmail").value = orc.email || "";
    document.getElementById("cores").value = orc.cores;
    document.getElementById("valorFrete").value = helpers.formatarMoeda(orc.valorFrete);
    document.getElementById("valorOrcamento").value = helpers.formatarMoeda(orc.valorOrcamento);
    document.getElementById("total").value = helpers.formatarMoeda(orc.total);
    document.getElementById("observacoes").value = orc.observacoes;

    const tbody = document.querySelector("#tabelaProdutos tbody");
    tbody.innerHTML = '';
    orc.produtos.forEach(p => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="number" class="produto-quantidade" value="${p.quantidade}" min="1"></td>
            <td><input type="text" class="produto-descricao" value="${p.descricao}"></td>
            <td><input type="text" class="produto-valor-unit" value="${helpers.formatarMoeda(p.valorUnit)}" oninput="formatarEntradaMoeda(this)"></td>
            <td>${helpers.formatarMoeda(p.valorTotal)}</td>
            <td><button type="button" onclick="excluirProduto(this)">Excluir</button></td>
        `;
    });

    mostrarPagina('form-orcamento');
    document.getElementById("btnGerarOrcamento").style.display = "none";
    document.getElementById("btnAtualizarOrcamento").style.display = "inline-block";
}

// ==========================================================================
// 5. PONTE VENDAS -> PRODUÇÃO (GERAR PEDIDO)
// ==========================================================================

async function gerarPedido(orcamentoId) {
    const orc = orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return;

    const pedido = {
        numero: gerarNumeroFormatado(numeroPedido),
        dataPedido: new Date().toISOString().split('T')[0],
        dataEntrega: orc.dataValidade,
        cliente: orc.cliente,
        endereco: orc.endereco,
        tema: orc.tema,
        cidade: orc.cidade,
        telefone: orc.telefone,
        email: orc.email,
        cores: orc.cores,
        pagamento: orc.pagamento,
        valorFrete: orc.valorFrete,
        valorOrcamento: orc.valorOrcamento,
        total: orc.total,
        observacoes: orc.observacoes,
        entrada: 0,
        restante: orc.total,
        produtos: orc.produtos,
        tipo: 'pedido',
        // Campos financeiros iniciais (Zerados pois vêm da precificação externa)
        custoMaoDeObra: 0,
        margemLucro: 0,
        custosTotais: 0
    };

    await salvarDados(pedido, 'pedido');
    numeroPedido++;
    orc.pedidoGerado = true;
    orc.numeroPedido = pedido.numero;
    await salvarDados(orc, 'orcamento');

    adicionarPedidoNaLista(pedido);

    alert(`Pedido ${pedido.numero} gerado!`);
    mostrarOrcamentosGerados();
    document.querySelector('a[data-pagina="lista-pedidos"]').click();
}

// ==========================================================================
// 6. MÓDULO DE ESTOQUE E PRONTA ENTREGA
// ==========================================================================

// --- TABELA 1: GESTÃO DO ESTOQUE (ADM) ---
function renderizarTabelaEstoqueAdm() {
    const tbody = document.querySelector("#tabela-estoque-adm tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtrados = itensEstoque.filter(item => 
        item.produto.toLowerCase().includes(termoBuscaEstoqueAdm.toLowerCase()) || 
        (item.detalhes && item.detalhes.toLowerCase().includes(termoBuscaEstoqueAdm.toLowerCase()))
    );

    // Paginação ADM
    const totalItens = filtrados.length;
    const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA) || 1;

    if (pagAtualEstoqueAdm > totalPaginas) pagAtualEstoqueAdm = totalPaginas;
    if (pagAtualEstoqueAdm < 1) pagAtualEstoqueAdm = 1;

    const inicio = (pagAtualEstoqueAdm - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum item no estoque.</td></tr>';
    } else {
        itensPagina.forEach(item => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>
                    <strong>${item.produto}</strong><br>
                    <small style="color:#666;">${item.detalhes || ''}</small>
                </td>
                <td style="text-align: center; font-weight: bold; font-size: 1.1em;">${item.quantidade || 0}</td>
                <td>${helpers.formatarMoeda(item.valorVenda)}</td>
                <td>
                    <button onclick="editarItemEstoque('${item.id}')" style="background-color:#FF9800; margin-right:5px;">Editar</button>
                    <button onclick="excluirItemEstoque('${item.id}')" style="background-color:#e53935;">Excluir</button>
                </td>
            `;
        });
    }

    // Atualiza controles de paginação
    const infoPag = document.getElementById("info-pag-est-adm");
    const btnAnt = document.getElementById("btn-ant-est-adm");
    const btnProx = document.getElementById("btn-prox-est-adm");
    
    if (infoPag) infoPag.textContent = `Página ${pagAtualEstoqueAdm} de ${totalPaginas}`;
    if (btnAnt) btnAnt.disabled = (pagAtualEstoqueAdm === 1);
    if (btnProx) btnProx.disabled = (pagAtualEstoqueAdm === totalPaginas);
}

// --- TABELA 2: VENDAS (PRONTA ENTREGA) ---
function renderizarTabelaProntaEntrega() {
    const tbody = document.querySelector("#tabela-vendas-estoque tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtrados = itensEstoque.filter(item => 
        item.produto.toLowerCase().includes(termoBuscaVendaEstoque.toLowerCase())
    );

    // Paginação Vendas
    const totalItens = filtrados.length;
    const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA) || 1;

    if (pagAtualVendaEstoque > totalPaginas) pagAtualVendaEstoque = totalPaginas;
    if (pagAtualVendaEstoque < 1) pagAtualVendaEstoque = 1;

    const inicio = (pagAtualVendaEstoque - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum item encontrado.</td></tr>';
    } else {
        itensPagina.forEach(item => {
            const qtd = item.quantidade || 0;
            // Indicador Visual de Estoque (Prioridade UX)
            const corQtd = qtd <= 0 ? '#e53935' : (qtd < 3 ? '#ff9800' : '#4CAF50'); // Vermelho se <=0, Laranja se baixo

            const row = tbody.insertRow();
            row.innerHTML = `
                <td>
                    <strong>${item.produto}</strong><br>
                    <small style="color:#666;">${item.detalhes || ''}</small>
                </td>
                <td style="text-align: center; font-weight: bold; color: ${corQtd}; font-size: 1.1em;">
                    ${qtd}
                </td>
                <td>${helpers.formatarMoeda(item.valorVenda)}</td>
                <td>
                    <button class="btn-vender" onclick="iniciarVenda('${item.id}')" style="background-color:#4CAF50;">Vender</button>
                </td>
            `;
        });
    }

    // Atualiza controles de paginação
    const infoPag = document.getElementById("info-pag-venda-est");
    const btnAnt = document.getElementById("btn-ant-venda-est");
    const btnProx = document.getElementById("btn-prox-venda-est");
    
    if (infoPag) infoPag.textContent = `Página ${pagAtualVendaEstoque} de ${totalPaginas}`;
    if (btnAnt) btnAnt.disabled = (pagAtualVendaEstoque === 1);
    if (btnProx) btnProx.disabled = (pagAtualVendaEstoque === totalPaginas);
}

// PRIORIDADE 3: Cálculo Automático (Helper)
function atualizarPrecoVendaAutomatico() {
    const custo = helpers.converterMoedaParaNumero(document.getElementById('estoque-custo').value);
    const mo = helpers.converterMoedaParaNumero(document.getElementById('estoque-mao-obra').value);
    const margem = helpers.converterMoedaParaNumero(document.getElementById('estoque-margem').value);
    
    // Soma total
    const total = custo + mo + margem;
    
    // Atualiza o campo de valor final
    const inputTotal = document.getElementById('estoque-valor');
    inputTotal.value = helpers.formatarMoeda(total);
}

// Prepara UI para Edição (Menu Estoque)
function editarItemEstoque(id) {
    const item = itensEstoque.find(i => i.id === id);
    if (!item) return;

    // Popula campos (IDs baseados no HTML novo)
    document.getElementById('estoque-id-edicao').value = item.id;
    document.getElementById('estoque-produto').value = item.produto;
    // NOVO: Popula quantidade
    document.getElementById('estoque-quantidade').value = item.quantidade || 0;
    
    document.getElementById('estoque-detalhes').value = item.detalhes || '';
    document.getElementById('estoque-valor').value = helpers.formatarMoeda(item.valorVenda);
    
    // Fallback para dados financeiros
    const fin = item.financeiro || {};
    document.getElementById('estoque-custo').value = helpers.formatarMoeda(fin.custoProducao || 0);
    document.getElementById('estoque-mao-obra').value = helpers.formatarMoeda(fin.maoDeObra || 0);
    document.getElementById('estoque-margem').value = helpers.formatarMoeda(fin.margemLucro || 0);

    // Altera Estado da UI
    const btnSalvar = document.getElementById('btn-salvar-estoque') || document.getElementById('btn-add-estoque');
    if(btnSalvar) btnSalvar.textContent = "Atualizar Estoque";
    
    const btnCancel = document.getElementById('btn-cancelar-estoque') || document.getElementById('btn-cancelar-edicao-estoque');
    if(btnCancel) btnCancel.style.display = 'inline-block';
    
    // Scroll (tenta focar no formulário onde quer que esteja)
    const form = document.getElementById('form-estoque-gerencial') || document.getElementById('form-estoque');
    if(form) form.scrollIntoView({ behavior: 'smooth' });
}

function cancelarEdicaoEstoque() {
    const form = document.getElementById('form-estoque-gerencial') || document.getElementById('form-estoque');
    if(form) form.reset();
    
    document.getElementById('estoque-id-edicao').value = "";
    
    const btnSalvar = document.getElementById('btn-salvar-estoque') || document.getElementById('btn-add-estoque');
    if(btnSalvar) btnSalvar.textContent = "Salvar no Estoque";
    
    const btnCancel = document.getElementById('btn-cancelar-estoque') || document.getElementById('btn-cancelar-edicao-estoque');
    if(btnCancel) btnCancel.style.display = 'none';
}

// Cadastro de Estoque (CREATE / UPDATE)
async function cadastrarItemEstoque() {
    const idEdicao = document.getElementById('estoque-id-edicao').value;
    const produto = document.getElementById('estoque-produto').value;
    const quantidade = parseInt(document.getElementById('estoque-quantidade').value) || 0; // NOVO: Captura Qtd
    
    // Captura valores financeiros
    const custoProducao = helpers.converterMoedaParaNumero(document.getElementById('estoque-custo').value);
    const maoDeObra = helpers.converterMoedaParaNumero(document.getElementById('estoque-mao-obra').value);
    const margemLucro = helpers.converterMoedaParaNumero(document.getElementById('estoque-margem').value);
    const valorVenda = helpers.converterMoedaParaNumero(document.getElementById('estoque-valor').value);
    
    if(!produto || valorVenda <= 0) return alert("Preencha o nome do produto e valores financeiros.");

    const item = {
        produto,
        quantidade, // Salva Qtd
        detalhes: document.getElementById('estoque-detalhes').value,
        valorVenda,
        financeiro: {
            custoProducao,
            maoDeObra,
            margemLucro
        },
        dataAtualizacao: new Date().toISOString()
    };

    try {
        if (idEdicao) {
            // MODO EDIÇÃO (UPDATE)
            await updateDoc(doc(estoqueRef, idEdicao), item);
            
            // Atualiza array local
            const index = itensEstoque.findIndex(i => i.id === idEdicao);
            if (index !== -1) itensEstoque[index] = { id: idEdicao, ...item };
            
            alert("Estoque atualizado!");
            cancelarEdicaoEstoque();
        } else {
            // MODO CRIAÇÃO (CREATE)
            const docRef = await addDoc(estoqueRef, item);
            item.id = docRef.id;
            itensEstoque.push(item);
            
            alert("Produto cadastrado no estoque!");
            
            // Limpa form
            const form = document.getElementById('form-estoque-gerencial') || document.getElementById('form-estoque');
            if(form) form.reset();
        }
        // Renderiza ambas as tabelas para garantir sincronia
        renderizarTabelaEstoqueAdm();
        renderizarTabelaProntaEntrega();
    } catch (e) {
        console.error(e);
        alert("Erro ao salvar produto.");
    }
}

// Venda Inteligente (Abatimento de Quantidade)
async function iniciarVenda(id) {
    const item = itensEstoque.find(i => i.id === id);
    if(!item) return;

    // 1. Pergunta a Quantidade
    const inputQtd = prompt(`Vender "${item.produto}"\nEstoque atual: ${item.quantidade || 0}\n\nQuantas unidades?`, "1");
    if(inputQtd === null) return; // Cancelou
    
    const qtdVenda = parseInt(inputQtd);
    if(!qtdVenda || qtdVenda <= 0) return alert("Quantidade inválida.");

    // 2. Calcula novo Estoque (Permite negativo lógico)
    let novoEstoque = (item.quantidade || 0) - qtdVenda;
    
    let aviso = "";
    if (novoEstoque < 0) {
        aviso = `\n\n⚠️ ATENÇÃO: O estoque ficará NEGATIVO (${novoEstoque}).\nVerifique se há produtos físicos disponíveis.`;
    }

    const confirmacao = confirm(`Confirmar venda de ${qtdVenda}x "${item.produto}"?${aviso}\nValor Total: ${helpers.formatarMoeda(item.valorVenda * qtdVenda)}`);
    if(!confirmacao) return;

    // Fallback Financeiro
    const fin = item.financeiro || {};
    const custoProd = fin.custoProducao || 0;
    const maoObra = fin.maoDeObra || 0;
    const lucro = fin.margemLucro || (item.valorVenda - custoProd - maoObra);

    try {
        // 3. Atualiza Estoque no Firebase (NÃO EXCLUIR, APENAS ATUALIZAR QTD)
        const docRef = doc(estoqueRef, item.id);
        await updateDoc(docRef, { quantidade: novoEstoque });
        
        // Atualiza localmente
        item.quantidade = novoEstoque;

        // 4. GERA O PEDIDO (Financeiro)
        const novoPedido = {
            numero: gerarNumeroFormatado(numeroPedido), 
            tipo: 'pedido',
            dataPedido: new Date().toISOString().split('T')[0],
            dataEntrega: new Date().toISOString().split('T')[0], // Entrega imediata
            cliente: "Venda Pronta Entrega", 
            endereco: "Feira / Balcão",
            telefone: "",
            tema: "Pronta Entrega",
            cores: item.detalhes || "Padrão",
            
            // Totais da Venda (Multiplicados pela Qtd)
            total: item.valorVenda * qtdVenda,
            entrada: item.valorVenda * qtdVenda, 
            restante: 0,
            valorFrete: 0,
            valorOrcamento: item.valorVenda * qtdVenda,
            
            // DADOS FINANCEIROS PRESERVADOS PARA RELATÓRIO
            custosTotais: custoProd * qtdVenda,
            custoMaoDeObra: maoObra * qtdVenda,
            margemLucro: lucro * qtdVenda, 

            produtos: [{
                descricao: item.produto,
                quantidade: qtdVenda,
                valorUnit: item.valorVenda,
                valorTotal: item.valorVenda * qtdVenda
            }],
            observacoes: `Venda rápida registrada via Estoque. Qtd: ${qtdVenda}.`
        };

        await salvarDados(novoPedido, 'pedido');
        numeroPedido++; 

        alert("Venda realizada e estoque atualizado!");
        
        // Atualiza as tabelas visualmente
        renderizarTabelaProntaEntrega();
        renderizarTabelaEstoqueAdm();
        
        // Adiciona o pedido à lista global para relatório
        adicionarPedidoNaLista(novoPedido); 
        
    } catch (e) {
        console.error(e);
        alert("Erro ao processar venda.");
    }
}

async function excluirItemEstoque(id) {
    if(!confirm("Tem certeza que deseja remover este item do catálogo de estoque?")) return;
    try {
        await deleteDoc(doc(estoqueRef, id));
        itensEstoque = itensEstoque.filter(i => i.id !== id);
        renderizarTabelaEstoqueAdm();
        renderizarTabelaProntaEntrega();
    } catch (e) {
        alert("Erro ao excluir.");
    }
}

// ==========================================================================
// 7. LÓGICA DE RELATÓRIO DE SAÍDAS (RANKING) - PRIORIDADE 1
// ==========================================================================

async function gerarRelatorioRanking() {
    const dtInicio = document.getElementById('rel-estoque-inicio').value;
    const dtFim = document.getElementById('rel-estoque-fim').value;

    if (!dtInicio || !dtFim) return alert("Selecione a data de início e fim.");

    const tbody = document.querySelector("#tabela-ranking-saidas tbody");
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Carregando dados...</td></tr>';
    document.getElementById('resultado-relatorio-estoque').style.display = 'block';

    try {
        // 1. Buscar todos os pedidos (tipo 'pedido')
        // Nota: Filtramos no client-side para manter consistência com o restante da aplicação
        const q = query(collection(db, "Orcamento-Pedido"), where("tipo", "==", "pedido"));
        const snapshot = await getDocs(q);
        
        const mapaVendas = {};

        // 2. Processar e Filtrar
        snapshot.forEach(doc => {
            const p = doc.data();
            // Verifica intervalo de datas
            if (p.dataPedido >= dtInicio && p.dataPedido <= dtFim) {
                if (p.produtos && Array.isArray(p.produtos)) {
                    p.produtos.forEach(prod => {
                        const nome = prod.descricao || "Item sem nome";
                        const qtd = parseFloat(prod.quantidade) || 0;

                        if (!mapaVendas[nome]) {
                            mapaVendas[nome] = 0;
                        }
                        mapaVendas[nome] += qtd;
                    });
                }
            }
        });

        // 3. Transformar em Array e Ordenar
        const ranking = Object.entries(mapaVendas)
            .map(([produto, qtd]) => ({ produto, qtd }))
            .sort((a, b) => b.qtd - a.qtd); // Maior para menor

        // 4. Renderizar
        tbody.innerHTML = "";
        
        if (ranking.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Nenhuma saída registrada neste período.</td></tr>';
            return;
        }

        ranking.forEach((item, index) => {
            const posicao = index + 1;
            let classeRank = "";
            if(posicao === 1) classeRank = "rank-1";
            if(posicao === 2) classeRank = "rank-2";
            if(posicao === 3) classeRank = "rank-3";

            const row = tbody.insertRow();
            row.className = classeRank;
            row.innerHTML = `
                <td style="text-align: center; font-weight: bold;">${posicao}º</td>
                <td>${item.produto}</td>
                <td style="text-align: center; font-weight: bold;">${item.qtd}</td>
            `;
        });

    } catch (error) {
        console.error("Erro ao gerar relatório:", error);
        alert("Erro ao processar dados de vendas.");
        tbody.innerHTML = "";
    }
}
