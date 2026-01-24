// assets/js/estoque.js

import { 
    db, 
    auth, 
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    runTransaction, 
    setDoc,          
    writeBatch       
} from './firebase-config.js';

import { adicionarPedidoNaLista } from './pedidos.js'; 

// Referências
const estoqueRef = collection(db, "estoque");
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");
// Referência para o documento de contadores (Singleton)
const contadorGeralRef = doc(db, "configuracoes", "contadores");

// Estado Local
let itensEstoque = [];
let pagAtualEstoqueAdm = 1;
let pagAtualVendaEstoque = 1;
let termoBuscaEstoqueAdm = "";
let termoBuscaVendaEstoque = "";
const ITENS_POR_PAGINA = 10;

// Helpers locais 
const helpers = {
    formatarMoeda: (valor) => valor?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00',
    converterMoedaParaNumero: (valor) => {
        if (typeof valor === 'number') return valor;
        if (typeof valor !== 'string') return 0;
        return parseFloat(valor.replace(/R\$\s?|\./g, '').replace(',', '.')) || 0;
    }
};

export async function initEstoque() {
    console.log("Inicializando Módulo Estoque v1.2.0 (Transacional)...");
    
    // Expor funções globais para o HTML
    window.cadastrarItemEstoque = cadastrarItemEstoque;
    window.iniciarVenda = iniciarVenda;
    window.excluirItemEstoque = excluirItemEstoque;
    window.editarItemEstoque = editarItemEstoque;
    window.cancelarEdicaoEstoque = cancelarEdicaoEstoque;
    window.gerarRelatorioRanking = gerarRelatorioRanking;

    setupEventListeners();
    await carregarDadosEstoque();
}

async function carregarDadosEstoque() {
    const user = auth.currentUser;
    if (!user) return;

    // 1. Carregar Itens (Filtrados pelo Usuário Logado)
    itensEstoque = [];
    try {
        const q = query(estoqueRef, where("ownerId", "==", user.uid));
        const snapshot = await getDocs(q);
        
        snapshot.forEach(doc => {
            itensEstoque.push({ id: doc.id, ...doc.data() });
        });

        renderizarTabelaProntaEntrega();
        renderizarTabelaEstoqueAdm();
    } catch (e) {
        console.error("Erro ao carregar estoque:", e);
    }
}

function setupEventListeners() {
    // Botões Principais
    document.getElementById('btn-salvar-estoque')?.addEventListener('click', cadastrarItemEstoque);
    document.getElementById('btn-cancelar-estoque')?.addEventListener('click', cancelarEdicaoEstoque);
    document.getElementById('btn-gerar-relatorio-saida')?.addEventListener('click', gerarRelatorioRanking);

    // Inputs de busca com debounce
    const inputBuscaVenda = document.getElementById('busca-vendas-estoque');
    if(inputBuscaVenda) {
        inputBuscaVenda.addEventListener('input', (e) => {
            termoBuscaVendaEstoque = e.target.value.toLowerCase();
            pagAtualVendaEstoque = 1; 
            renderizarTabelaProntaEntrega();
        });
    }

    const inputBuscaAdm = document.getElementById('busca-lista-estoque-adm');
    if(inputBuscaAdm) {
        inputBuscaAdm.addEventListener('input', (e) => {
            termoBuscaEstoqueAdm = e.target.value.toLowerCase();
            pagAtualEstoqueAdm = 1; 
            renderizarTabelaEstoqueAdm();
        });
    }

    // Cálculo automático preço
    ['estoque-custo', 'estoque-mao-obra', 'estoque-margem'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', atualizarPrecoVendaAutomatico);
    });
    
    // Paginação
    document.getElementById('btn-ant-est-adm')?.addEventListener('click', () => { if(pagAtualEstoqueAdm > 1) {pagAtualEstoqueAdm--; renderizarTabelaEstoqueAdm();} });
    document.getElementById('btn-prox-est-adm')?.addEventListener('click', () => { pagAtualEstoqueAdm++; renderizarTabelaEstoqueAdm(); });
    
    document.getElementById('btn-ant-venda-est')?.addEventListener('click', () => { if(pagAtualVendaEstoque > 1) {pagAtualVendaEstoque--; renderizarTabelaProntaEntrega();} });
    document.getElementById('btn-prox-venda-est')?.addEventListener('click', () => { pagAtualVendaEstoque++; renderizarTabelaProntaEntrega(); });

    // NOVO: Validação de Duplicidade em Tempo Real
    const inputNomeProduto = document.getElementById('estoque-produto');
    if(inputNomeProduto) {
        inputNomeProduto.addEventListener('input', (e) => verificarDuplicidade(e.target.value));
    }
}

// --- FUNÇÃO DE VALIDAÇÃO (PRIORIDADE 3) ---
function verificarDuplicidade(nomeDigitado) {
    const termo = nomeDigitado.trim().toLowerCase();
    const btnSalvar = document.getElementById('btn-salvar-estoque');
    const idEdicao = document.getElementById('estoque-id-edicao').value;

    // Procura item com mesmo nome, ignorando o próprio item se estiver editando
    const duplicado = itensEstoque.find(item => 
        item.produto.toLowerCase() === termo && item.id !== idEdicao
    );

    if (duplicado) {
        btnSalvar.disabled = true;
        btnSalvar.textContent = "Nome já existe!";
        btnSalvar.style.backgroundColor = "#e53935"; // Vermelho alerta
        btnSalvar.style.cursor = "not-allowed";
    } else {
        btnSalvar.disabled = false;
        btnSalvar.textContent = idEdicao ? "Atualizar Estoque" : "Salvar no Estoque";
        btnSalvar.style.backgroundColor = ""; // Volta ao estilo original (CSS)
        btnSalvar.style.cursor = "pointer";
    }
}

// --- FUNÇÕES DE RENDERIZAÇÃO ---

function renderizarTabelaEstoqueAdm() {
    const tbody = document.querySelector("#tabela-estoque-adm tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Filtragem
    const filtrados = itensEstoque.filter(item => 
        item.produto.toLowerCase().includes(termoBuscaEstoqueAdm) || 
        (item.detalhes && item.detalhes.toLowerCase().includes(termoBuscaEstoqueAdm))
    );

    // [NOVO] Ordenação Alfabética por Produto (A-Z)
    filtrados.sort((a, b) => a.produto.localeCompare(b.produto));

    const paginacao = paginarArray(filtrados, pagAtualEstoqueAdm);
    
    if (paginacao.itens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum item no estoque.</td></tr>';
    } else {
        paginacao.itens.forEach(item => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td><strong>${item.produto}</strong><br><small style="color:#666;">${item.detalhes || ''}</small></td>
                <td style="text-align: center; font-weight: bold; font-size: 1.1em;">${item.quantidade || 0}</td>
                <td>${helpers.formatarMoeda(item.valorVenda)}</td>
                <td>
                    <button onclick="editarItemEstoque('${item.id}')" style="background-color:#FF9800; margin-right:5px;">Editar</button>
                    <button onclick="excluirItemEstoque('${item.id}')" style="background-color:#e53935;">Excluir</button>
                </td>
            `;
        });
    }
    atualizarControlesPaginacao("info-pag-est-adm", "btn-ant-est-adm", "btn-prox-est-adm", pagAtualEstoqueAdm, paginacao.totalPaginas);
}

function renderizarTabelaProntaEntrega() {
    const tbody = document.querySelector("#tabela-vendas-estoque tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Filtragem
    const filtrados = itensEstoque.filter(item => item.produto.toLowerCase().includes(termoBuscaVendaEstoque));
    
    // [NOVO] Ordenação Alfabética por Produto (A-Z)
    filtrados.sort((a, b) => a.produto.localeCompare(b.produto));

    const paginacao = paginarArray(filtrados, pagAtualVendaEstoque);

    if (paginacao.itens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhum item encontrado.</td></tr>';
    } else {
        paginacao.itens.forEach(item => {
            const qtd = item.quantidade || 0;
            const corQtd = qtd <= 0 ? '#e53935' : (qtd < 3 ? '#ff9800' : '#4CAF50');
            const row = tbody.insertRow();
            row.innerHTML = `
                <td><strong>${item.produto}</strong><br><small style="color:#666;">${item.detalhes || ''}</small></td>
                <td style="text-align: center; font-weight: bold; color: ${corQtd}; font-size: 1.1em;">${qtd}</td>
                <td>${helpers.formatarMoeda(item.valorVenda)}</td>
                <td><button class="btn-vender" onclick="iniciarVenda('${item.id}')" style="background-color:#4CAF50;">Vender</button></td>
            `;
        });
    }
    atualizarControlesPaginacao("info-pag-venda-est", "btn-ant-venda-est", "btn-prox-venda-est", pagAtualVendaEstoque, paginacao.totalPaginas);
}

// --- FUNÇÕES DE CRUD E TRANSAÇÕES ---

async function cadastrarItemEstoque() {
    const idEdicao = document.getElementById('estoque-id-edicao').value;
    const produto = document.getElementById('estoque-produto').value;
    const quantidade = parseInt(document.getElementById('estoque-quantidade').value) || 0;
    const valorVenda = helpers.converterMoedaParaNumero(document.getElementById('estoque-valor').value);
    
    const financeiro = {
        custoProducao: helpers.converterMoedaParaNumero(document.getElementById('estoque-custo').value),
        maoDeObra: helpers.converterMoedaParaNumero(document.getElementById('estoque-mao-obra').value),
        margemLucro: helpers.converterMoedaParaNumero(document.getElementById('estoque-margem').value)
    };

    if(!produto || valorVenda <= 0) return alert("Preencha o nome e valores.");

    const item = { 
        produto, quantidade, valorVenda, financeiro,
        detalhes: document.getElementById('estoque-detalhes').value,
        dataAtualizacao: new Date().toISOString()
    };

    try {
        if (idEdicao) {
            await updateDoc(doc(estoqueRef, idEdicao), item);
            const idx = itensEstoque.findIndex(i => i.id === idEdicao);
            if(idx !== -1) itensEstoque[idx] = { id: idEdicao, ...item };
            alert("Atualizado!");
        } else {
            const ref = await addDoc(estoqueRef, item);
            itensEstoque.push({ id: ref.id, ...item });
            alert("Cadastrado!");
        }
        cancelarEdicaoEstoque();
        renderizarTabelaEstoqueAdm();
        renderizarTabelaProntaEntrega();
    } catch(e) { console.error(e); alert("Erro ao salvar."); }
}

// --- LÓGICA DE VENDA SEGURA (PRIORIDADE 2 - TRANSAÇÃO) ---
async function iniciarVenda(id) {
    const itemLocal = itensEstoque.find(i => i.id === id);
    if(!itemLocal) return;

    const inputQtd = prompt(`Vender "${itemLocal.produto}"? Qtd atual: ${itemLocal.quantidade}\nQuantos vender?`, "1");
    if(!inputQtd) return;
    const qtdVenda = parseInt(inputQtd);
    if(!qtdVenda || qtdVenda <= 0) return alert("Qtd inválida");

    try {
        // Executa tudo ou nada (Atomicidade)
        await runTransaction(db, async (transaction) => {
            // 1. LEITURAS (Devem ocorrer antes de qualquer escrita)
            const itemDocRef = doc(db, "estoque", id);
            const itemDoc = await transaction.get(itemDocRef);
            
            if (!itemDoc.exists()) {
                throw "Este produto não existe mais no banco de dados.";
            }

            const contadorDoc = await transaction.get(contadorGeralRef);
            
            // 2. LÓGICA DE NEGÓCIO E CÁLCULOS
            const estoqueAtual = itemDoc.data().quantidade || 0;
            const novoEstoque = estoqueAtual - qtdVenda;
            
            // Determinar próximo número de pedido (Centralizado)
            let proximoNumero = 1;
            if (contadorDoc.exists()) {
                proximoNumero = (contadorDoc.data().ultimoPedido || 0) + 1;
            } else {
                // Se não existir contador (primeiro uso), assume 1. 
                proximoNumero = 1;
            }

            const anoAtual = new Date().getFullYear();
            const numeroPedidoFormatado = `${String(proximoNumero).padStart(4,'0')}/${anoAtual}`;

            // Preparar dados do novo pedido
            // Cria referência para novo documento na coleção de pedidos
            const novoPedidoRef = doc(collection(db, "Orcamento-Pedido")); 
            const dadosItem = itemDoc.data();
            
            const novoPedido = {
                numero: numeroPedidoFormatado,
                tipo: 'pedido',
                dataPedido: new Date().toISOString().split('T')[0],
                dataEntrega: new Date().toISOString().split('T')[0],
                cliente: "Venda Pronta Entrega",
                endereco: "Balcão",
                tema: "Pronta Entrega",
                cores: dadosItem.detalhes || "-",
                total: dadosItem.valorVenda * qtdVenda,
                entrada: dadosItem.valorVenda * qtdVenda,
                restante: 0,
                valorFrete: 0,
                valorOrcamento: dadosItem.valorVenda * qtdVenda,
                // Dados financeiros proporcionais
                custosTotais: (dadosItem.financeiro?.custoProducao || 0) * qtdVenda,
                custoMaoDeObra: (dadosItem.financeiro?.maoDeObra || 0) * qtdVenda,
                margemLucro: (dadosItem.financeiro?.margemLucro || 0) * qtdVenda,
                produtos: [{ 
                    descricao: dadosItem.produto, 
                    quantidade: qtdVenda, 
                    valorUnit: dadosItem.valorVenda, 
                    valorTotal: dadosItem.valorVenda * qtdVenda 
                }],
                observacoes: `Venda via Estoque. Qtd: ${qtdVenda}`
            };

            // 3. ESCRITAS (Batch de operações)
            // A. Atualiza Estoque
            transaction.update(itemDocRef, { quantidade: novoEstoque });
            
            // B. Atualiza Contador Global
            transaction.set(contadorGeralRef, { ultimoPedido: proximoNumero }, { merge: true });
            
            // C. Cria o Pedido Financeiro
            transaction.set(novoPedidoRef, novoPedido);
            
            // Retornamos o pedido criado para usar na UI depois
            return { novoPedido, novoEstoque, idItem: id };
        });

        // Se chegou aqui, a transação foi sucesso
        alert("Venda realizada com sucesso!");
        
        // Recarregar dados para refletir mudanças (especialmente estoque)
        await carregarDadosEstoque();

    } catch(e) { 
        console.error("Transação falhou: ", e); 
        alert("Erro ao realizar venda: " + e); 
    }
}

function editarItemEstoque(id) {
    const item = itensEstoque.find(i => i.id === id);
    if(!item) return;
    
    document.getElementById('estoque-id-edicao').value = item.id;
    document.getElementById('estoque-produto').value = item.produto;
    document.getElementById('estoque-quantidade').value = item.quantidade;
    document.getElementById('estoque-detalhes').value = item.detalhes || '';
    document.getElementById('estoque-valor').value = helpers.formatarMoeda(item.valorVenda);
    
    const fin = item.financeiro || {};
    document.getElementById('estoque-custo').value = helpers.formatarMoeda(fin.custoProducao || 0);
    document.getElementById('estoque-mao-obra').value = helpers.formatarMoeda(fin.maoDeObra || 0);
    document.getElementById('estoque-margem').value = helpers.formatarMoeda(fin.margemLucro || 0);

    const btnSalvar = document.getElementById('btn-salvar-estoque');
    btnSalvar.textContent = "Atualizar Estoque";
    // Resetar validação visual caso estivesse em erro
    btnSalvar.disabled = false;
    btnSalvar.style.backgroundColor = ""; 

    document.getElementById('btn-cancelar-estoque').style.display = 'inline-block';
    document.getElementById('form-estoque-gerencial').scrollIntoView({behavior: 'smooth'});
}

function cancelarEdicaoEstoque() {
    document.getElementById('form-estoque-gerencial').reset();
    document.getElementById('estoque-id-edicao').value = "";
    
    const btnSalvar = document.getElementById('btn-salvar-estoque');
    btnSalvar.textContent = "Salvar no Estoque";
    btnSalvar.disabled = false;
    btnSalvar.style.backgroundColor = "";

    document.getElementById('btn-cancelar-estoque').style.display = 'none';
}

async function excluirItemEstoque(id) {
    if(confirm("Excluir item do catálogo?")) {
        await deleteDoc(doc(estoqueRef, id));
        itensEstoque = itensEstoque.filter(i => i.id !== id);
        renderizarTabelaEstoqueAdm();
        renderizarTabelaProntaEntrega();
    }
}

function atualizarPrecoVendaAutomatico() {
    const c = helpers.converterMoedaParaNumero(document.getElementById('estoque-custo').value);
    const m = helpers.converterMoedaParaNumero(document.getElementById('estoque-mao-obra').value);
    const l = helpers.converterMoedaParaNumero(document.getElementById('estoque-margem').value);
    document.getElementById('estoque-valor').value = helpers.formatarMoeda(c + m + l);
}

// Relatório de Saídas (Mantido igual, apenas isolado)
async function gerarRelatorioRanking() {
    const dtInicio = document.getElementById('rel-estoque-inicio').value;
    const dtFim = document.getElementById('rel-estoque-fim').value;
    if (!dtInicio || !dtFim) return alert("Selecione datas.");

    const tbody = document.querySelector("#tabela-ranking-saidas tbody");
    tbody.innerHTML = '<tr><td colspan="3">Carregando...</td></tr>';
    document.getElementById('resultado-relatorio-estoque').style.display = 'block';

    const q = query(orcamentosPedidosRef, where("tipo", "==", "pedido"));
    const snapshot = await getDocs(q);
    const mapa = {};

    snapshot.forEach(doc => {
        const p = doc.data();
        if (p.dataPedido >= dtInicio && p.dataPedido <= dtFim && p.produtos) {
            p.produtos.forEach(prod => {
                const nome = prod.descricao || "Item";
                mapa[nome] = (mapa[nome] || 0) + (parseFloat(prod.quantidade) || 0);
            });
        }
    });

    const ranking = Object.entries(mapa).map(([produto, qtd]) => ({ produto, qtd })).sort((a,b) => b.qtd - a.qtd);
    tbody.innerHTML = "";
    if(!ranking.length) tbody.innerHTML = '<tr><td colspan="3">Sem vendas no período.</td></tr>';
    
    ranking.forEach((r, i) => {
        tbody.insertRow().innerHTML = `<td>${i+1}º</td><td>${r.produto}</td><td>${r.qtd}</td>`;
    });
}

// --- NOVO: FUNÇÃO DE SINCRONIZAÇÃO (INTEGRAÇÃO COM PRECIFICAÇÃO) ---
/**
 * Busca itens no estoque pelo nome e oferece atualização em massa.
 * Chamada pelo módulo de Precificação (precificacao.js).
 */
export async function verificarAtualizacaoEstoque(nomeProduto, novosDados) {
    // Busca por nome exato (Prioridade 1 - Action Plan)
    const q = query(estoqueRef, where("produto", "==", nomeProduto));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return false; // Nenhum item encontrado, segue fluxo normal

    // UX: Mensagem de confirmação detalhada (Prioridade 2)
    const qtdItens = snapshot.size;
    const novoValorFmt = helpers.formatarMoeda(novosDados.valorVenda);
    const msg = `⚠️ ATENÇÃO - ESTOQUE DETECTADO\n\n` +
                `Encontrei ${qtdItens} unidade(s) de "${nomeProduto}" no estoque de Pronta Entrega.\n` +
                `Deseja atualizar o preço de venda para ${novoValorFmt} e ajustar os custos internos (salário/margem)?\n\n` +
                `Esta ação evita prejuízo na reposição de itens antigos.`;

    if (confirm(msg)) {
        try {
            // WriteBatch para operação atômica (Prioridade 1)
            const batch = writeBatch(db);
            const dataHoje = new Date().toLocaleDateString('pt-BR');
            
            snapshot.forEach(docSnap => {
                const ref = doc(db, "estoque", docSnap.id);
                const dadosAtuais = docSnap.data();

                // Lógica de Histórico/Auditoria (Prioridade 3 - Arquitetura)
                // Adiciona uma nota ao campo detalhes sem apagar o existente
                let detalhesAtualizados = dadosAtuais.detalhes || "";
                detalhesAtualizados += `\n[${dataHoje}: Preço atualizado via Precificação para ${novoValorFmt}]`;

                batch.update(ref, {
                    valorVenda: novosDados.valorVenda,
                    financeiro: novosDados.financeiro,
                    dataAtualizacao: new Date().toISOString(),
                    detalhes: detalhesAtualizados
                });
            });

            await batch.commit();
            alert(`Sucesso! ${qtdItens} item(ns) do estoque foram atualizados para a nova realidade de mercado.`);
            
            // Se o usuário estiver na tela de estoque ou com ela carregada, atualizamos a lista
            if (itensEstoque.length > 0) {
                await carregarDadosEstoque();
            }
            return true;
        } catch (error) {
            console.error("Erro ao sincronizar estoque em massa:", error);
            alert("Erro ao atualizar itens do estoque: " + error.message);
            return false;
        }
    }
    return false;
}

// Helpers de Paginação
function paginarArray(array, pagina) {
    const totalPaginas = Math.ceil(array.length / ITENS_POR_PAGINA) || 1;
    const inicio = (pagina - 1) * ITENS_POR_PAGINA;
    return { itens: array.slice(inicio, inicio + ITENS_POR_PAGINA), totalPaginas };
}

function atualizarControlesPaginacao(labelId, btnAntId, btnProxId, pagAtual, totalPags) {
    const label = document.getElementById(labelId);
    if(label) label.textContent = `Pág ${pagAtual} de ${totalPags}`;
    const btnAnt = document.getElementById(btnAntId);
    if(btnAnt) btnAnt.disabled = pagAtual === 1;
    const btnProx = document.getElementById(btnProxId);
    if(btnProx) btnProx.disabled = pagAtual === totalPags;
}
