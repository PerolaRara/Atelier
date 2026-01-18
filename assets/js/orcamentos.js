// assets/js/orcamentos.js

import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, getDocs, doc, setDoc, updateDoc, 
    query, orderBy, getDoc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// IMPORTAÇÕES DE MÓDULOS E UTILITÁRIOS
import { setupPedidos, adicionarPedidoNaLista } from './pedidos.js';
import { utils } from './utils.js';

// REFERÊNCIAS AO FIRESTORE
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");
const precificacoesRef = collection(db, "precificacoes-geradas");
const contadoresRef = doc(db, "configuracoes", "contadores");

// ESTADO LOCAL
let orcamentos = [];
let orcamentoEditando = null;
let moduleInitialized = false;

// Variáveis de Paginação e Busca
const ITENS_POR_PAGINA = 10;
let pagAtualOrc = 1;
let termoBuscaOrc = "";

// ==========================================================================
// 1. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================

export async function initOrcamentos() {
    console.log("Inicializando Módulo Orçamentos (Vendas) v1.2.0...");
    
    // EXPOR FUNÇÕES GLOBAIS PARA O HTML (ONCLICK)
    window.excluirProduto = excluirProduto;
    window.visualizarImpressao = visualizarImpressao;
    window.editarOrcamento = editarOrcamento; // <--- CORRIGIDO: Agora está definido
    window.gerarPedido = gerarPedido; 
    window.gerarOrcamento = gerarOrcamento;
    window.atualizarOrcamento = atualizarOrcamento;
    
    // EXPOR A MÁSCARA DE MOEDA DO UTILS PARA O HTML
    window.formatarEntradaMoeda = (input) => utils.aplicarMascaraMoeda(input);

    await carregarDados();
    
    // Configurar eventos (apenas uma vez)
    if (!moduleInitialized) {
        setupEventListeners();
        
        // Popular Select de Anos no Relatório (UI Global)
        const selectAno = document.getElementById("relatorio-ano");
        if(selectAno) {
            const anoAtual = new Date().getFullYear();
            for(let i = anoAtual; i >= anoAtual - 2; i--) {
                const opt = document.createElement("option");
                opt.value = i;
                opt.text = i;
                selectAno.appendChild(opt);
            }
        }
        moduleInitialized = true;
    }
    
    mostrarPagina('form-orcamento');
}

async function carregarDados() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        orcamentos = [];
        const pedidosTemp = []; 

        // Carregar Orçamentos e Pedidos
        const q = query(orcamentosPedidosRef, orderBy("numero", "desc")); // Traz do mais novo para o mais antigo
        const snapshot = await getDocs(q);

        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;

            if (data.tipo === 'orcamento') {
                orcamentos.push(data);
            } else if (data.tipo === 'pedido') {
                pedidosTemp.push(data);
            }
        });

        console.log(`Carregado: ${orcamentos.length} Orçamentos, ${pedidosTemp.length} Pedidos.`);
        
        // 1. Renderiza a tabela de Orçamentos
        mostrarOrcamentosGerados();
        
        // 2. Inicializa o Módulo de Pedidos (Passando utils injetado)
        setupPedidos({
            listaPedidos: pedidosTemp,
            salvarDadosFn: salvarDados,
            helpers: utils // Injeta o novo utils
        });

    } catch (error) {
        console.error("Erro ao carregar dados:", error);
    }
}

// ==========================================================================
// 2. LÓGICA DE CONTADORES E SALVAMENTO
// ==========================================================================

/**
 * Função inteligente para pegar o próximo número.
 * Tenta ler do contador centralizado. Se não existir, calcula baseado no array local (migração).
 */
async function obterProximoNumero(tipo) {
    const campo = tipo === 'orcamento' ? 'ultimoOrcamento' : 'ultimoPedido';
    let proximo = 1;

    try {
        const docSnap = await getDoc(contadoresRef);
        
        if (docSnap.exists()) {
            // Cenário Ideal: O contador existe
            const data = docSnap.data();
            proximo = (data[campo] || 0) + 1;
        } else {
            // Cenário Migração: Contador não existe, calcula baseado no que já temos carregado
            console.log("Criando contador centralizado pela primeira vez...");
            let max = 0;
            const lista = tipo === 'orcamento' ? orcamentos : []; // Pedidos já estão em outro modulo, mas podemos estimar
            // Nota: Para pedidos, se for a primeira vez, pode começar do 1 ou precisaríamos ler do array de pedidosTemp
            
            lista.forEach(item => {
                const num = parseInt(item.numero.split('/')[0]);
                if(num > max) max = num;
            });
            proximo = max + 1;
        }

        // Atualiza o contador no banco para o novo número
        await setDoc(contadoresRef, { [campo]: proximo }, { merge: true });
        
    } catch (e) {
        console.error("Erro ao obter contador:", e);
        // Fallback de emergência: usa timestamp para não travar
        proximo = Date.now().toString().slice(-4); 
    }

    const ano = new Date().getFullYear();
    return `${String(proximo).padStart(4, '0')}/${ano}`;
}

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
        throw error; // Propaga erro para parar execução se necessário
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

    // Busca de Orçamentos
    const inputBuscaOrc = document.getElementById('busca-orcamentos');
    if(inputBuscaOrc) {
        inputBuscaOrc.addEventListener('input', debounce((e) => {
            termoBuscaOrc = e.target.value.toLowerCase();
            pagAtualOrc = 1; 
            mostrarOrcamentosGerados();
        }));
    }

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
    
    const freteInput = document.getElementById('valorFrete');
    if(freteInput) {
        freteInput.addEventListener('input', () => {
            utils.aplicarMascaraMoeda(freteInput);
            atualizarTotais();
        });
    }
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
    }
}

function limparCamposMoeda() {
    ['valorFrete', 'valorOrcamento', 'total'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = 'R$ 0,00';
    });
}

// ==========================================================================
// 4. LÓGICA DE NEGÓCIO: ORÇAMENTOS
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
        const unit = utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value);
        const total = qtd * unit;
        row.cells[3].textContent = utils.formatarMoeda(total);
        totalProd += total;
    });
    
    const frete = utils.converterMoedaParaNumero(document.getElementById("valorFrete").value);
    document.getElementById("valorOrcamento").value = utils.formatarMoeda(totalProd);
    document.getElementById("total").value = utils.formatarMoeda(totalProd + frete);
}

async function gerarOrcamento() {
    // 1. Obter número centralizado
    const novoNumero = await obterProximoNumero('orcamento');

    const dados = {
        numero: novoNumero,
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
        valorFrete: utils.converterMoedaParaNumero(document.getElementById("valorFrete").value),
        valorOrcamento: utils.converterMoedaParaNumero(document.getElementById("valorOrcamento").value),
        total: utils.converterMoedaParaNumero(document.getElementById("total").value),
        observacoes: document.getElementById("observacoes").value,
        produtos: [],
        pedidoGerado: false,
        tipo: 'orcamento'
    };

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        dados.produtos.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: utils.converterMoedaParaNumero(row.cells[3].textContent)
        });
    });

    await salvarDados(dados, 'orcamento');
    orcamentos.unshift(dados); // Adiciona no início da lista local
    
    document.getElementById("orcamento").reset();
    limparCamposMoeda();
    document.querySelector("#tabelaProdutos tbody").innerHTML = "";
    
    alert(`Orçamento ${novoNumero} gerado com sucesso!`);
    mostrarPagina('orcamentos-gerados');
}

// === FUNÇÃO REINTEGRADA PARA CORREÇÃO DE ERRO ===
function editarOrcamento(id) {
    const orc = orcamentos.find(o => o.id === id);
    if (!orc) return;

    orcamentoEditando = id;
    
    // Preenche campos do formulário
    document.getElementById("dataOrcamento").value = orc.dataOrcamento;
    document.getElementById("dataValidade").value = orc.dataValidade;
    document.getElementById("cliente").value = orc.cliente;
    document.getElementById("endereco").value = orc.endereco;
    document.getElementById("tema").value = orc.tema;
    document.getElementById("cidade").value = orc.cidade;
    document.getElementById("telefone").value = orc.telefone;
    document.getElementById("clienteEmail").value = orc.email || "";
    document.getElementById("cores").value = orc.cores;
    
    // Checkboxes de pagamento
    const pagamentos = Array.isArray(orc.pagamento) ? orc.pagamento : [orc.pagamento];
    document.querySelectorAll('input[name="pagamento"]').forEach(cb => {
        cb.checked = pagamentos.includes(cb.value);
    });

    // Campos monetários com Utils
    document.getElementById("valorFrete").value = utils.formatarMoeda(orc.valorFrete);
    document.getElementById("valorOrcamento").value = utils.formatarMoeda(orc.valorOrcamento);
    document.getElementById("total").value = utils.formatarMoeda(orc.total);
    document.getElementById("observacoes").value = orc.observacoes;

    // Recria tabela de produtos
    const tbody = document.querySelector("#tabelaProdutos tbody");
    tbody.innerHTML = '';
    
    if (orc.produtos && orc.produtos.length > 0) {
        orc.produtos.forEach(p => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td><input type="number" class="produto-quantidade" value="${p.quantidade}" min="1"></td>
                <td><input type="text" class="produto-descricao" value="${p.descricao}"></td>
                <td><input type="text" class="produto-valor-unit" value="${utils.formatarMoeda(p.valorUnit)}" oninput="formatarEntradaMoeda(this)"></td>
                <td>${utils.formatarMoeda(p.valorTotal)}</td>
                <td><button type="button" onclick="excluirProduto(this)">Excluir</button></td>
            `;
        });
    }

    // Muda estado da interface
    mostrarPagina('form-orcamento');
    document.getElementById("btnGerarOrcamento").style.display = "none";
    document.getElementById("btnAtualizarOrcamento").style.display = "inline-block";
    
    // Rola para o topo
    document.querySelector('.mobile-container').scrollIntoView({ behavior: 'smooth' });
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
        valorFrete: utils.converterMoedaParaNumero(document.getElementById("valorFrete").value),
        valorOrcamento: utils.converterMoedaParaNumero(document.getElementById("valorOrcamento").value),
        total: utils.converterMoedaParaNumero(document.getElementById("total").value),
        observacoes: document.getElementById("observacoes").value,
        produtos: []
    };

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        dados.produtos.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: utils.converterMoedaParaNumero(row.cells[3].textContent)
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
        const dataFormatada = utils.formatarDataBR(orc.dataOrcamento);
        return orc.cliente.toLowerCase().includes(termo) || 
               orc.numero.toLowerCase().includes(termo) || 
               dataFormatada.includes(termo);
    });

    // Ordenação já vem do Firebase, mas garantimos aqui
    // filtrados.sort((a,b) => b.numero.localeCompare(a.numero)); // Se necessário

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
                <td>${utils.formatarDataBR(orc.dataOrcamento)}</td>
                <td>${orc.cliente}</td>
                <td>${utils.formatarMoeda(orc.total)}</td>
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
                span.style.fontWeight = "bold";
                span.style.fontSize = "0.9em";
                cellAcoes.appendChild(span);
            }
        });
    }

    if (infoPag) infoPag.textContent = `Página ${pagAtualOrc} de ${totalPaginas}`;
    if (btnAnt) btnAnt.disabled = (pagAtualOrc === 1);
    if (btnProx) btnProx.disabled = (pagAtualOrc === totalPaginas);
}

// ==========================================================================
// 5. PONTE VENDAS -> PRODUÇÃO (GERAR PEDIDO)
// ==========================================================================

async function gerarPedido(orcamentoId) {
    const orc = orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return;

    if(!confirm(`Gerar pedido para o cliente ${orc.cliente}?`)) return;

    // 1. Obter número centralizado de PEDIDO
    const novoNumeroPedido = await obterProximoNumero('pedido');

    const pedido = {
        numero: novoNumeroPedido,
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
        // Campos financeiros iniciam zerados (editados depois)
        custoMaoDeObra: 0,
        margemLucro: 0,
        custosTotais: 0
    };

    await salvarDados(pedido, 'pedido');
    
    // Atualiza o orçamento para marcar como gerado
    orc.pedidoGerado = true;
    orc.numeroPedido = pedido.numero;
    await salvarDados(orc, 'orcamento');

    // Atualiza UI
    adicionarPedidoNaLista(pedido);
    alert(`Pedido ${pedido.numero} gerado com sucesso!`);
    
    mostrarOrcamentosGerados(); // Atualiza botão na tabela
    
    // Redireciona para aba de Pedidos
    const tabPedidos = document.querySelector('a[data-pagina="lista-pedidos"]');
    if(tabPedidos) tabPedidos.click();
}

function visualizarImpressao(orcamento) {
    const janela = window.open('', '_blank');
    const dtOrc = utils.formatarDataBR(orcamento.dataOrcamento);
    const dtVal = utils.formatarDataBR(orcamento.dataValidade);
    const pagamento = Array.isArray(orcamento.pagamento) ? orcamento.pagamento.join(', ') : orcamento.pagamento;
    
    // Caminho da logo
    const path = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    const logoSrc = `${window.location.origin}${path}/assets/images/logo_perola_rara.png`;

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
                .conditions { margin-top: 40px; font-size: 0.9em; color: #555; border-top: 1px solid #eee; padding-top: 20px; }
                .conditions p { margin: 5px 0; font-weight: bold; color: #7aa2a9; }
                .conditions ol { padding-left: 20px; margin: 5px 0; }
                .conditions li { margin-bottom: 5px; }
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
                            <td class="col-money">${utils.formatarMoeda(p.valorUnit)}</td>
                            <td class="col-money">${utils.formatarMoeda(p.valorTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="totals-box">
                <div class="total-row"><span>Frete:</span> <span>${utils.formatarMoeda(orcamento.valorFrete)}</span></div>
                <div class="total-row final"><span>Total:</span> <span>${utils.formatarMoeda(orcamento.total)}</span></div>
                <div style="margin-top:10px; font-size:0.8em; color:#888; text-align:right;">Forma Pagto: ${pagamento}</div>
            </div>

            <div class="conditions">
                <p>Observações:</p>
                <ol>
                    <li>Trabalhamos com enxoval personalizado com bordado computadorizado.</li>
                    <li>Após a confirmação do pagamento, enviaremos a arte. Em caso de desistência, não haverá reembolso.</li>
                    <li>Serão enviadas 3 opções de imagens para escolher, e em seguida a arte final com o nome será enviada para aprovação.</li>
                    <li>Aceitamos Pix, débito, e crédito (juros por conta do cliente).</li>
                    <li>Entregamos com taxa.</li>
                </ol>
                ${orcamento.observacoes ? `<p style="margin-top:15px; border-top:1px dashed #ccc; padding-top:10px;">Nota adicional: ${orcamento.observacoes}</p>` : ''}
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
