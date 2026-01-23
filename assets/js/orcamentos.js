// assets/js/orcamentos.js

import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, getDocs, doc, setDoc, updateDoc, 
    query, orderBy, getDoc, runTransaction 
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

// Variáveis de Ordenação (NOVO)
let colunaOrdenacaoOrc = ""; // Qual coluna está sendo ordenada ('cliente' ou vazio)
let ordemAtualOrc = "asc";   // Direção: 'asc' (A-Z) ou 'desc' (Z-A)

// ==========================================================================
// 1. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================

export async function initOrcamentos() {
    console.log("Inicializando Módulo Orçamentos (Vendas) v1.2.0...");
    
    // EXPOR FUNÇÕES GLOBAIS PARA O HTML (ONCLICK)
    window.excluirProduto = excluirProduto;
    window.visualizarImpressao = visualizarImpressao;
    window.editarOrcamento = editarOrcamento;
    window.gerarPedido = gerarPedido; 
    window.gerarOrcamento = gerarOrcamento;
    window.atualizarOrcamento = atualizarOrcamento;
    
    // EXPOR FUNÇÃO DE ORDENAÇÃO (NOVO)
    window.ordenarTabelaOrcamentos = ordenarTabelaOrcamentos;
    
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
        const q = query(orcamentosPedidosRef, orderBy("numero", "desc")); 
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
        
        // 2. Inicializa o Módulo de Pedidos
        setupPedidos({
            listaPedidos: pedidosTemp,
            salvarDadosFn: salvarDados,
            helpers: utils 
        });

    } catch (error) {
        console.error("Erro ao carregar dados:", error);
    }
}

// ==========================================================================
// 2. LÓGICA DE TRANSAÇÃO SEGURA (BLINDAGEM) & SALVAMENTO
// ==========================================================================

/**
 * Cria um documento (Orçamento ou Pedido) garantindo unicidade numérica via Transação Atômica.
 * @param {string} tipo - 'orcamento' ou 'pedido'
 * @param {object} dadosBase - Objeto com os dados do formulário
 * @param {string|null} idOrcamentoOriginal - Se for pedido vindo de orç, o ID para vincular
 */
async function criarDocumentoSeguro(tipo, dadosBase, idOrcamentoOriginal = null) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sessão expirada.");

    // Cria uma referência de documento nova (apenas para obter o ID gerado automaticamente)
    const novaDocRef = doc(orcamentosPedidosRef); 
    const campoContador = tipo === 'orcamento' ? 'ultimoOrcamento' : 'ultimoPedido';

    try {
        // Executa tudo ou nada (Atomicidade)
        await runTransaction(db, async (transaction) => {
            // 1. LEITURA (Deve vir antes de qualquer escrita)
            const contadorDoc = await transaction.get(contadoresRef);
            
            // 2. CÁLCULO DO NÚMERO
            let proximoNumero = 1;
            if (contadorDoc.exists()) {
                const dataContador = contadorDoc.data();
                proximoNumero = (dataContador[campoContador] || 0) + 1;
            }

            const anoAtual = new Date().getFullYear();
            const numeroFormatado = `${String(proximoNumero).padStart(4, '0')}/${anoAtual}`;

            // 3. PREPARAÇÃO DO OBJETO FINAL
            const dadosFinais = {
                ...dadosBase,
                id: novaDocRef.id,
                numero: numeroFormatado,
                tipo: tipo,
                criadoEm: new Date().toISOString(),
                criadoPor: user.email
            };

            // 4. ESCRITAS (Batch)
            
            // A. Atualiza contador
            transaction.set(contadoresRef, { [campoContador]: proximoNumero }, { merge: true });
            
            // B. Salva o novo documento
            transaction.set(novaDocRef, dadosFinais);

            // C. Se for conversão, atualiza o orçamento original
            if (tipo === 'pedido' && idOrcamentoOriginal) {
                const orcamentoRef = doc(db, "Orcamento-Pedido", idOrcamentoOriginal);
                transaction.update(orcamentoRef, { 
                    pedidoGerado: true, 
                    numeroPedido: numeroFormatado 
                });
            }

            // Atualiza o objeto local (referência) para uso na UI
            dadosBase.numero = numeroFormatado;
            dadosBase.id = novaDocRef.id;
        });

        return dadosBase; // Retorna com o número preenchido

    } catch (e) {
        console.error("Erro na transação:", e);
        throw e;
    }
}

/**
 * Função para ATUALIZAÇÕES (Edição).
 * Para CRIAÇÃO de novos itens, usar criarDocumentoSeguro.
 */
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
            // Fallback apenas se chamado incorretamente, mas o fluxo principal usa Transação
            const docRef = await addDoc(orcamentosPedidosRef, { ...dados, tipo });
            dados.id = docRef.id;
        }
    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar no banco de dados.");
        throw error;
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

// --- FUNÇÃO ATUALIZADA COM SEGURANÇA E UX ---
async function gerarOrcamento() {
    // 1. Bloqueio de UX
    const btn = document.getElementById("btnGerarOrcamento");
    const txtOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Processando...";
    btn.style.cursor = "wait";

    const dados = {
        // numero: REMOVIDO (Será gerado na transação)
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
        // tipo: 'orcamento' (Será injetado na transação)
    };

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        dados.produtos.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: utils.converterMoedaParaNumero(row.cells[3].textContent)
        });
    });

    try {
        // 2. Chamada Segura (Transação)
        const resultado = await criarDocumentoSeguro('orcamento', dados);

        orcamentos.unshift(resultado); 
        
        document.getElementById("orcamento").reset();
        limparCamposMoeda();
        document.querySelector("#tabelaProdutos tbody").innerHTML = "";
        
        alert(`Orçamento ${resultado.numero} gerado com sucesso!`);
        mostrarPagina('orcamentos-gerados');

    } catch (error) {
        alert("Erro ao gerar orçamento. Tente novamente.");
    } finally {
        // 3. Liberação de UX
        btn.disabled = false;
        btn.textContent = txtOriginal;
        btn.style.cursor = "pointer";
    }
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
    
    const pagamentos = Array.isArray(orc.pagamento) ? orc.pagamento : [orc.pagamento];
    document.querySelectorAll('input[name="pagamento"]').forEach(cb => {
        cb.checked = pagamentos.includes(cb.value);
    });

    document.getElementById("valorFrete").value = utils.formatarMoeda(orc.valorFrete);
    document.getElementById("valorOrcamento").value = utils.formatarMoeda(orc.valorOrcamento);
    document.getElementById("total").value = utils.formatarMoeda(orc.total);
    document.getElementById("observacoes").value = orc.observacoes;

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

    mostrarPagina('form-orcamento');
    document.getElementById("btnGerarOrcamento").style.display = "none";
    document.getElementById("btnAtualizarOrcamento").style.display = "inline-block";
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

    // Usa função simples para update
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

// ==========================================================================
// FUNÇÕES DE ORDENAÇÃO (NOVO)
// ==========================================================================

/**
 * Função chamada ao clicar no cabeçalho da tabela (TH)
 * Alterna entre ascendente e descendente
 */
function ordenarTabelaOrcamentos(coluna) {
    if (colunaOrdenacaoOrc === coluna) {
        // Se clicou na mesma coluna, inverte a ordem
        ordemAtualOrc = ordemAtualOrc === 'asc' ? 'desc' : 'asc';
    } else {
        // Se é uma coluna nova, reseta para ascendente
        colunaOrdenacaoOrc = coluna;
        ordemAtualOrc = 'asc';
    }
    mostrarOrcamentosGerados();
}

function mostrarOrcamentosGerados() {
    const tbody = document.querySelector("#tabela-orcamentos tbody");
    const btnAnt = document.getElementById("btn-ant-orc");
    const btnProx = document.getElementById("btn-prox-orc");
    const infoPag = document.getElementById("info-pag-orc");
    
    if(!tbody) return;
    tbody.innerHTML = '';

    const termo = termoBuscaOrc.trim();
    
    // 1. Filtragem
    let filtrados = orcamentos.filter(orc => {
        if (!termo) return true;
        const dataFormatada = utils.formatarDataBR(orc.dataOrcamento);
        return orc.cliente.toLowerCase().includes(termo) || 
               orc.numero.toLowerCase().includes(termo) || 
               dataFormatada.includes(termo);
    });

    // 2. Ordenação (Lógica Atualizada)
    if (colunaOrdenacaoOrc === 'cliente') {
        filtrados.sort((a, b) => {
            const valA = (a.cliente || '').toLowerCase();
            const valB = (b.cliente || '').toLowerCase();
            
            if (valA < valB) return ordemAtualOrc === 'asc' ? -1 : 1;
            if (valA > valB) return ordemAtualOrc === 'asc' ? 1 : -1;
            return 0;
        });
    } else {
        // Se não houver ordenação específica, mantém a ordem original (Data/Número Descendente)
        // Como o array principal já é carregado e mantido nessa ordem, não precisamos de sort extra aqui.
    }

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
                btnGerar.onclick = () => gerarPedido(orc.id); // Este acionará a função atualizada
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
// 5. PONTE VENDAS -> PRODUÇÃO (GERAR PEDIDO COM INTELIGÊNCIA FINANCEIRA)
// ==========================================================================

// --- FUNÇÃO ATUALIZADA COM SEGURANÇA E UX ---
async function gerarPedido(orcamentoId) {
    const orc = orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return;

    if(!confirm(`Gerar pedido para o cliente ${orc.cliente}?`)) return;

    // 1. UX: Bloqueio para evitar clique duplo
    // Como não há um botão direto no DOM (é criado dinamicamente na tabela), 
    // a melhor proteção é o confirm() e a transação, mas podemos mudar cursor global
    document.body.style.cursor = "wait";

   // --- BLOCO DE INTELIGÊNCIA FINANCEIRA (ATUALIZADO - CASCATA DE DESCONTOS) ---
    let custosMateriaisComIndiretos = 0;
    let maoDeObraAcumulada = 0;
    let produtosSemPrecificacao = 0;

    try {
        const precSnap = await getDocs(collection(db, "precificacoes-geradas"));
        const basePrecificacao = [];
        precSnap.forEach(d => basePrecificacao.push(d.data()));

        orc.produtos.forEach(itemOrc => {
            const nomeItem = itemOrc.descricao.trim();
            const infoFinanceira = basePrecificacao.find(p => p.produto === nomeItem);

            if (infoFinanceira) {
                const qtd = parseFloat(itemOrc.quantidade) || 1;
                maoDeObraAcumulada += (infoFinanceira.totalMaoDeObra || 0) * qtd;
                const mat = infoFinanceira.custoMateriais || 0;
                const ind = infoFinanceira.custoIndiretoTotal || 0;
                custosMateriaisComIndiretos += (mat + ind) * qtd;
            } else {
                produtosSemPrecificacao++;
            }
        });

    } catch (err) {
        console.error("Erro na inteligência financeira:", err);
    }

    // APLICANDO A CASCATA DE DESCONTOS (v1.2.1)
    // Se o valor cobrado for menor que o ideal, o sistema sacrifica o Lucro primeiro, depois o Salário.
    const resultadoFinanceiro = utils.calcularCascataFinanceira(
        orc.valorOrcamento,          // Receita (Valor dos Produtos)
        custosMateriaisComIndiretos, // Custos Fixos + Materiais
        maoDeObraAcumulada           // Salário Alvo
    );

    // Montagem da Mensagem Inteligente
    let mensagemConfirmacao = `Pedido calculado com sucesso!\n\n` +
        `Resumo Financeiro Real:\n` +
        `💰 Receita Produtos: ${utils.formatarMoeda(orc.valorOrcamento)}\n` +
        `🔴 Custos (Mat + Fixos): ${utils.formatarMoeda(resultadoFinanceiro.custos)}\n`;

    // Verifica status para dar feedback adequado
    if (resultadoFinanceiro.status === 'alerta') {
        mensagemConfirmacao += `⚠️ SEU SALÁRIO: ${utils.formatarMoeda(resultadoFinanceiro.salario)} (Reduzido por desconto)\n`;
        mensagemConfirmacao += `❌ LUCRO: R$ 0,00 (Margem absorvida)`;
    } else if (resultadoFinanceiro.status === 'prejuizo') {
        mensagemConfirmacao += `⛔ PREJUÍZO OPERACIONAL DETECTADO!\n`;
        mensagemConfirmacao += `O valor cobrado não cobre nem os materiais.`;
    } else {
        mensagemConfirmacao += `🔵 Seu Salário: ${utils.formatarMoeda(resultadoFinanceiro.salario)}\n`;
        mensagemConfirmacao += `🟢 Lucro Empresa: ${utils.formatarMoeda(resultadoFinanceiro.lucro)}`;
    }

    if (produtosSemPrecificacao > 0) {
        mensagemConfirmacao += `\n\n⚠️ ATENÇÃO: ${produtosSemPrecificacao} item(ns) não possuem precificação cadastrada.`;
    }

    // Trava de segurança para prejuízo
    if (resultadoFinanceiro.status === 'prejuizo') {
        if(!confirm(mensagemConfirmacao + "\n\nTEM CERTEZA QUE DESEJA GERAR ESSE PEDIDO COM PREJUÍZO?")) {
            // Se cancelar, reseta o cursor e sai
            document.body.style.cursor = "default";
            return;
        }
    } else {
        alert(mensagemConfirmacao);
    }
    // --- FIM BLOCO FINANCEIRO ---

    const pedido = {
        // numero: REMOVIDO (Transação cuidará disso)
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
        // tipo: 'pedido' (Injetado na Transação)
        
        // DADOS FINANCEIROS REAIS (PÓS-CASCATA)
        custoMaoDeObra: resultadoFinanceiro.salario,
        margemLucro: resultadoFinanceiro.lucro,
        custosTotais: resultadoFinanceiro.custos
    };

    try {
        // 2. Chamada Segura (Transação) vinculando ao Orçamento Original
        const resultado = await criarDocumentoSeguro('pedido', pedido, orcamentoId);

        // Atualiza orçamento localmente
        orc.pedidoGerado = true;
        orc.numeroPedido = resultado.numero;

        adicionarPedidoNaLista(resultado);
        mostrarOrcamentosGerados(); 
        
        const tabPedidos = document.querySelector('a[data-pagina="lista-pedidos"]');
        if(tabPedidos) tabPedidos.click();

        alert(`Pedido ${resultado.numero} gerado com sucesso!`);

    } catch (error) {
        alert("Erro ao gerar pedido. Verifique sua conexão.");
    } finally {
        // 3. UX: Restaura cursor
        document.body.style.cursor = "default";
    }
}

function visualizarImpressao(orcamento) {
    const janela = window.open('', '_blank');
    const dtOrc = utils.formatarDataBR(orcamento.dataOrcamento);
    const dtVal = utils.formatarDataBR(orcamento.dataValidade);
    const pagamento = Array.isArray(orcamento.pagamento) ? orcamento.pagamento.join(', ') : orcamento.pagamento;
    
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
