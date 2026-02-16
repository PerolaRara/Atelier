// assets/js/orcamentos.js

import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, getDocs, doc, setDoc, updateDoc, 
    query, orderBy, getDoc, runTransaction, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// IMPORTAÇÕES DE MÓDULOS E UTILITÁRIOS
import { setupPedidos, adicionarPedidoNaLista } from './pedidos.js';
import { utils } from './utils.js';
import { buscarDadosPrecificacao } from './precificacao.js'; // Conexão com Histórico de Precificação

// REFERÊNCIAS AO FIRESTORE
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");
const contadoresRef = doc(db, "configuracoes", "contadores");

// ESTADO LOCAL
let orcamentos = [];
let orcamentoEditando = null;
let moduleInitialized = false;

// Variáveis de Paginação e Busca
const ITENS_POR_PAGINA = 10;
let pagAtualOrc = 1;
let termoBuscaOrc = "";

// Variáveis de Ordenação
let colunaOrdenacaoOrc = ""; 
let ordemAtualOrc = "asc";

// ==========================================================================
// 1. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================

export async function initOrcamentos() {
    console.log("Inicializando Módulo Orçamentos v1.5.1 [UX Fix + Automação]...");
    
    // Exposição de funções para o escopo global (Eventos Inline e Dinâmicos)
    window.excluirProduto = excluirProduto;
    window.visualizarImpressao = visualizarImpressao;
    window.editarOrcamento = editarOrcamento;
    window.gerarPedido = gerarPedido; 
    window.gerarOrcamento = gerarOrcamento;
    window.atualizarOrcamento = atualizarOrcamento;
    window.ordenarTabelaOrcamentos = ordenarTabelaOrcamentos;
    window.formatarEntradaMoeda = (input) => utils.aplicarMascaraMoeda(input);
    
    // --- CORREÇÃO APLICADA: Expondo a função de cálculo ---
    window.atualizarTotais = atualizarTotais;
    // ------------------------------------------------------
    
    // Funções de automação de busca (Plano de Evolução)
    window.tratarBuscaProdutoOrcamento = tratarBuscaProdutoOrcamento;
    window.selecionarProdutoOrcamento = selecionarProdutoOrcamento;
    window.limparBuscaLinha = limparBuscaLinha;

    await carregarDados();
    
    if (!moduleInitialized) {
        setupEventListeners();
        
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

        const q = query(
            orcamentosPedidosRef, 
            where("ownerId", "==", user.uid),
            orderBy("numero", "desc")
        ); 
        
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

        mostrarOrcamentosGerados();
        
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
// 2. LÓGICA DE TRANSAÇÃO SEGURA E SALVAMENTO
// ==========================================================================

async function criarDocumentoSeguro(tipo, dadosBase, idOrcamentoOriginal = null) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sessão expirada.");

    const novaDocRef = doc(orcamentosPedidosRef); 
    const campoContador = tipo === 'orcamento' ? 'ultimoOrcamento' : 'ultimoPedido';

    try {
        await runTransaction(db, async (transaction) => {
            const contadorDoc = await transaction.get(contadoresRef);
            
            let proximoNumero = 1;
            if (contadorDoc.exists()) {
                const dataContador = contadorDoc.data();
                proximoNumero = (dataContador[campoContador] || 0) + 1;
            }

            const anoAtual = new Date().getFullYear();
            const numeroFormatado = `${String(proximoNumero).padStart(4, '0')}/${anoAtual}`;

            const dadosFinais = {
                ...dadosBase,
                ownerId: user.uid,
                id: novaDocRef.id,
                numero: numeroFormatado,
                tipo: tipo,
                criadoEm: new Date().toISOString(),
                criadoPor: user.email
            };

            transaction.set(contadoresRef, { [campoContador]: proximoNumero }, { merge: true });
            transaction.set(novaDocRef, dadosFinais);

            if (tipo === 'pedido' && idOrcamentoOriginal) {
                const orcamentoRef = doc(db, "Orcamento-Pedido", idOrcamentoOriginal);
                transaction.update(orcamentoRef, { 
                    pedidoGerado: true, 
                    numeroPedido: numeroFormatado 
                });
            }

            dadosBase.numero = numeroFormatado;
            dadosBase.id = novaDocRef.id;
            dadosBase.ownerId = user.uid;
        });

        return dadosBase;

    } catch (e) {
        console.error("Erro na transação:", e);
        throw e;
    }
}

async function salvarDados(dados, tipo) {
    const user = auth.currentUser;
    if (!user) {
        alert("Sessão expirada.");
        return;
    }
    try {
        const dadosComDono = { ...dados, ownerId: user.uid };

        if (dados.id) {
            const docRef = doc(orcamentosPedidosRef, dados.id);
            await setDoc(docRef, dadosComDono, { merge: true });
        } else {
            const docRef = await addDoc(orcamentosPedidosRef, { ...dadosComDono, tipo });
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
    document.querySelectorAll('#module-orcamentos nav ul li a[data-pagina]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            mostrarPagina(link.dataset.pagina);
        });
    });

    bindClick('#btnAddProdutoOrcamento', adicionarProduto);
    bindClick('#btnGerarOrcamento', gerarOrcamento);
    bindClick('#btnAtualizarOrcamento', atualizarOrcamento);

    const inputBuscaOrc = document.getElementById('busca-orcamentos');
    if(inputBuscaOrc) {
        inputBuscaOrc.addEventListener('input', debounce((e) => {
            termoBuscaOrc = e.target.value.toLowerCase();
            pagAtualOrc = 1; 
            mostrarOrcamentosGerados();
        }));
    }

    bindClick('#btn-ant-orc', () => { 
        if(pagAtualOrc > 1) { pagAtualOrc--; mostrarOrcamentosGerados(); } 
    });
    bindClick('#btn-prox-orc', () => { 
        pagAtualOrc++; mostrarOrcamentosGerados(); 
    });

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
// 4. LÓGICA DE NEGÓCIO: ORÇAMENTOS (AUTOMAÇÃO E BUSCA)
// ==========================================================================

function adicionarProduto() {
    const tbody = document.querySelector("#tabelaProdutos tbody");
    const newRow = tbody.insertRow();
    
    // Armazena dados financeiros ocultos na linha (inicializados como 0)
    newRow.dataset.custoMat = "0";
    newRow.dataset.maoObra = "0";
    newRow.dataset.lucro = "0";

    // --- ATUALIZAÇÃO UX: Classe CSS para botão excluir ---
    newRow.innerHTML = `
        <td style="width: 80px;"><input type="number" class="produto-quantidade" value="1" min="1" oninput="atualizarTotais()" onchange="atualizarTotais()"></td>
        <td style="position: relative;">
            <div class="search-wrapper-integrated">
                <input type="text" class="search-input-integrated produto-descricao" placeholder="Buscar produto..." oninput="tratarBuscaProdutoOrcamento(this)" autocomplete="off">
                <button type="button" class="btn-clear-integrated" style="display:none;" onclick="limparBuscaLinha(this)">×</button>
            </div>
            <div class="dropdown-resultados"></div>
        </td>
        <td style="width: 120px;"><input type="text" class="produto-valor-unit" value="R$ 0,00" readonly style="background-color: #f0f0f0; cursor: default;"></td>
        <td style="width: 120px;" class="produto-total-linha">R$ 0,00</td>
        <td style="width: 50px; text-align: center;">
            <button type="button" class="btn-excluir-arredondado" onclick="excluirProduto(this)" title="Remover item">X</button>
        </td>
    `;
}

function tratarBuscaProdutoOrcamento(input) {
    const termo = input.value;
    const wrapper = input.parentElement;
    const dropdown = wrapper.nextElementSibling;
    const btnClear = wrapper.querySelector('.btn-clear-integrated');

    if(btnClear) btnClear.style.display = termo ? 'block' : 'none';

    if (termo.length < 2) {
        dropdown.style.display = 'none';
        return;
    }

    // Busca no histórico de precificação (via precificacao.js)
    const resultados = buscarDadosPrecificacao(termo);
    dropdown.innerHTML = '';

    if (resultados.length > 0) {
        dropdown.style.display = 'block';
        resultados.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item-busca';
            div.innerHTML = `<span>${item.produto}</span> <strong>${utils.formatarMoeda(item.total)}</strong>`;
            
            div.onclick = () => {
                selecionarProdutoOrcamento(input, item);
                dropdown.style.display = 'none';
            };
            dropdown.appendChild(div);
        });
    } else {
        dropdown.style.display = 'none';
    }
}

function selecionarProdutoOrcamento(input, dados) {
    const row = input.closest('tr');
    
    // 1. Preenche visualmente o Nome e o Valor Unitário de Venda
    input.value = dados.produto;
    // --- ALTERAÇÃO UX: Aplica classe para garantir contraste (texto escuro) ---
    input.classList.add('input-preenchido-fixo');

    const inputValor = row.querySelector('.produto-valor-unit');
    inputValor.value = utils.formatarMoeda(dados.total);
    
    // --- ALTERAÇÃO UX: Garante legibilidade no campo read-only ---
    inputValor.classList.add('input-preenchido-fixo');
    inputValor.style.backgroundColor = ""; // Remove estilo inline para usar a cor da classe (ciano)

    // 2. LÓGICA FINANCEIRA AUTOMÁTICA
    // Recupera os dados brutos da precificação (Histórico)
    // Custo Total = Materiais + Custos Fixos (Indiretos)
    const custoMatTotal = (dados.custoMateriais || 0) + (dados.custoIndiretoTotal || 0);
    const maoObra = dados.totalMaoDeObra || 0;
    
    // Calcula o Lucro unitário baseado no preço atual
    // Lucro = Preço Venda - (Custo + Mão de Obra)
    const lucroUnitario = dados.total - (custoMatTotal + maoObra);

    // 3. Salva esses valores "escondidos" na linha da tabela (Dataset)
    // Usamos esses valores para multiplicar pela quantidade depois
    row.dataset.custoMat = custoMatTotal;
    row.dataset.maoObra = maoObra;
    row.dataset.lucro = lucroUnitario;

    // 4. Recalcula totais da tela
    atualizarTotais();

    // Feedback visual rápido
    if(utils && utils.showToast) utils.showToast("Custos e Lucros carregados do histórico!", "success");
}

function limparBuscaLinha(btn) {
    const wrapper = btn.parentElement;
    const input = wrapper.querySelector('input');
    const row = btn.closest('tr');
    
    input.value = '';
    // --- ALTERAÇÃO UX: Restaura visual padrão (Rosé/Branco) ---
    input.classList.remove('input-preenchido-fixo');
    
    const inputValor = row.querySelector('.produto-valor-unit');
    inputValor.value = 'R$ 0,00';
    
    // --- ALTERAÇÃO UX: Restaura visual padrão de Readonly ---
    inputValor.classList.remove('input-preenchido-fixo');
    inputValor.style.backgroundColor = "#f0f0f0";
    
    // Zera dados financeiros
    row.dataset.custoMat = "0";
    row.dataset.maoObra = "0";
    row.dataset.lucro = "0";
    
    btn.style.display = 'none';
    input.focus();
    atualizarTotais();
}

function excluirProduto(btn) {
    btn.closest('tr').remove();
    atualizarTotais();
}

function atualizarTotais() {
    let totalProd = 0;
    
    // Acumuladores Financeiros
    let acmCustos = 0;
    let acmMaoObra = 0;
    let acmLucro = 0;

    const listaItensDiv = document.getElementById('lista-financeira-itens');
    if(listaItensDiv) listaItensDiv.innerHTML = '';

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        // Pega a quantidade digitada pelo usuário
        const qtd = parseFloat(row.querySelector(".produto-quantidade").value) || 0;
        
        const unit = utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value);
        const totalLinha = qtd * unit;
        
        row.querySelector(".produto-total-linha").textContent = utils.formatarMoeda(totalLinha);
        totalProd += totalLinha;

        // CÁLCULO FINANCEIRO DINÂMICO
        // Pega o valor unitário salvo no dataset e multiplica pela quantidade
        const cMat = (parseFloat(row.dataset.custoMat) || 0) * qtd;
        const cMO = (parseFloat(row.dataset.maoObra) || 0) * qtd;
        const cLucro = (parseFloat(row.dataset.lucro) || 0) * qtd;

        acmCustos += cMat;
        acmMaoObra += cMO;
        acmLucro += cLucro;

        // Feedback Visual no Painel (Oportunidade Adicional)
        const nome = row.querySelector(".produto-descricao").value;
        if (nome && listaItensDiv && qtd > 0) {
            listaItensDiv.innerHTML += `
                <div class="item-financeiro-row" style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 0.85rem;">
                    <span>${qtd}x ${nome}</span>
                    <small>Custo: ${utils.formatarMoeda(cMat)} | Salário: ${utils.formatarMoeda(cMO)} | Lucro: ${utils.formatarMoeda(cLucro)}</small>
                </div>`;
        }
    });
    
    const frete = utils.converterMoedaParaNumero(document.getElementById("valorFrete").value);
    document.getElementById("valorOrcamento").value = utils.formatarMoeda(totalProd);
    document.getElementById("total").value = utils.formatarMoeda(totalProd + frete);

    // Painel de Feedback Financeiro em tempo real
    const painel = document.getElementById('painel-feedback-financeiro');
    if (painel) {
        painel.style.display = totalProd > 0 ? 'block' : 'none';
        const elCustos = document.getElementById('feedback-total-custos');
        const elSalario = document.getElementById('feedback-total-salario');
        const elLucro = document.getElementById('feedback-total-lucro');
        
        if(elCustos) elCustos.textContent = utils.formatarMoeda(acmCustos);
        if(elSalario) elSalario.textContent = utils.formatarMoeda(acmMaoObra);
        if(elLucro) elLucro.textContent = utils.formatarMoeda(acmLucro);
    }
}

// ==========================================================================
// 5. PERSISTÊNCIA E EDIÇÃO
// ==========================================================================

async function gerarOrcamento() {
    const btn = document.getElementById("btnGerarOrcamento");
    const txtOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Processando...";
    btn.style.cursor = "wait";

    const dados = {
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
    };

    document.querySelectorAll("#tabelaProdutos tbody tr").forEach(row => {
        dados.produtos.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: utils.converterMoedaParaNumero(row.querySelector(".produto-total-linha").textContent),
            // Salvando Inteligência Financeira (Metadados do Plano)
            custoBase: parseFloat(row.dataset.custoMat) || 0,
            maoObraBase: parseFloat(row.dataset.maoObra) || 0
        });
    });

    try {
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
            // Re-hidratando datasets para manter a inteligência financeira na edição
            row.dataset.custoMat = p.custoBase || 0;
            row.dataset.maoObra = p.maoObraBase || 0;
            const unit = p.valorUnit || 0;
            row.dataset.lucro = unit - ((p.custoBase || 0) + (p.maoObraBase || 0));

            // --- ATUALIZAÇÃO UX: Classe CSS para botão excluir ---
            row.innerHTML = `
                <td style="width: 80px;"><input type="number" class="produto-quantidade" value="${p.quantidade}" min="1" oninput="atualizarTotais()" onchange="atualizarTotais()"></td>
                <td style="position: relative;">
                    <div class="search-wrapper-integrated">
                        <input type="text" class="search-input-integrated produto-descricao" value="${p.descricao}" oninput="tratarBuscaProdutoOrcamento(this)" autocomplete="off">
                        <button type="button" class="btn-clear-integrated" style="display:block;" onclick="limparBuscaLinha(this)">×</button>
                    </div>
                    <div class="dropdown-resultados"></div>
                </td>
                <td style="width: 120px;"><input type="text" class="produto-valor-unit" value="${utils.formatarMoeda(p.valorUnit)}" readonly style="background-color: #f0f0f0; cursor: default;"></td>
                <td style="width: 120px;" class="produto-total-linha">${utils.formatarMoeda(p.valorTotal)}</td>
                <td style="width: 50px; text-align: center;">
                    <button type="button" class="btn-excluir-arredondado" onclick="excluirProduto(this)" title="Remover item">X</button>
                </td>
            `;
        });
    }

    atualizarTotais();
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
            valorTotal: utils.converterMoedaParaNumero(row.querySelector(".produto-total-linha").textContent),
            custoBase: parseFloat(row.dataset.custoMat) || 0,
            maoObraBase: parseFloat(row.dataset.maoObra) || 0
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

// ==========================================================================
// 6. ORDENAÇÃO E RENDERIZAÇÃO
// ==========================================================================

function ordenarTabelaOrcamentos(coluna) {
    if (colunaOrdenacaoOrc === coluna) {
        ordemAtualOrc = ordemAtualOrc === 'asc' ? 'desc' : 'asc';
    } else {
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
    
    let filtrados = orcamentos.filter(orc => {
        if (!termo) return true;
        const dataFormatada = utils.formatarDataBR(orc.dataOrcamento);
        return orc.cliente.toLowerCase().includes(termo) || 
               orc.numero.toLowerCase().includes(termo) || 
               dataFormatada.includes(termo);
    });

    if (colunaOrdenacaoOrc === 'cliente') {
        filtrados.sort((a, b) => {
            const valA = (a.cliente || '').toLowerCase();
            const valB = (b.cliente || '').toLowerCase();
            if (valA < valB) return ordemAtualOrc === 'asc' ? -1 : 1;
            if (valA > valB) return ordemAtualOrc === 'asc' ? 1 : -1;
            return 0;
        });
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
// 7. PONTE VENDAS -> PRODUÇÃO (MÁGICA FINANCEIRA)
// ==========================================================================

async function gerarPedido(orcamentoId) {
    const user = auth.currentUser;
    if (!user) return;

    const orc = orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return;

    if(!confirm(`Gerar pedido para o cliente ${orc.cliente}?`)) return;

    document.body.style.cursor = "wait";

    // Priorizamos os dados que já estão no Orçamento (Dataset persistido)
    let custosMateriaisComIndiretos = 0;
    let maoDeObraAcumulada = 0;

    orc.produtos.forEach(itemOrc => {
        const qtd = parseFloat(itemOrc.quantidade) || 1;
        // Recupera a inteligência financeira salva no orçamento
        custosMateriaisComIndiretos += (itemOrc.custoBase || 0) * qtd;
        maoDeObraAcumulada += (itemOrc.maoObraBase || 0) * qtd;
    });

    // Cálculos via cascata utilitária baseada no valor final acordado
    const resultadoFinanceiro = utils.calcularCascataFinanceira(
        orc.valorOrcamento, 
        custosMateriaisComIndiretos,
        maoDeObraAcumulada
    );

    // Alerta de saúde financeira (Segurança do Plano)
    if (resultadoFinanceiro.status === 'prejuizo') {
        let msg = `⛔ PREJUÍZO OPERACIONAL DETECTADO!\nO valor cobrado não cobre os custos.\n`;
        msg += `Receita: ${utils.formatarMoeda(orc.valorOrcamento)} | Custos: ${utils.formatarMoeda(resultadoFinanceiro.custos)}\n\nDeseja continuar?`;
        if(!confirm(msg)) {
            document.body.style.cursor = "default";
            return;
        }
    }

    const pedido = {
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
        // Sincronização financeira automática para Relatórios
        custoMaoDeObra: resultadoFinanceiro.salario || 0,
        margemLucro: resultadoFinanceiro.lucro || 0,
        custosTotais: resultadoFinanceiro.custos || 0
    };

    try {
        const resultado = await criarDocumentoSeguro('pedido', pedido, orcamentoId);
        orc.pedidoGerado = true;
        orc.numeroPedido = resultado.numero;

        if (typeof adicionarPedidoNaLista === 'function') {
            adicionarPedidoNaLista(resultado); 
        }

        mostrarOrcamentosGerados(); 

        const tabPedidos = document.querySelector('a[data-pagina="lista-pedidos"]');
        if(tabPedidos) tabPedidos.click();

        setTimeout(() => {
            if (typeof window.editarPedido === 'function') {
                window.editarPedido(resultado.id);
                if(utils && utils.showToast) {
                    utils.showToast(`Pedido ${resultado.numero} gerado. Dados financeiros sincronizados.`, 'info');
                }
            } else {
                alert(`Pedido ${resultado.numero} gerado com sucesso!`);
            }
        }, 150);

    } catch (error) {
        console.error("Erro ao gerar pedido:", error);
        alert("Erro ao gerar pedido.");
    } finally {
        document.body.style.cursor = "default";
    }
}

// ==========================================================================
// 8. VISUALIZAÇÃO DE IMPRESSÃO
// ==========================================================================

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
