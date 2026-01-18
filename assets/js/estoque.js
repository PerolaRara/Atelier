// assets/js/estoque.js

import { db, auth } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { adicionarPedidoNaLista } from './pedidos.js'; // Integração com pedidos

// Referências
const estoqueRef = collection(db, "estoque");
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");

// Estado Local
let itensEstoque = [];
let numeroPedidoEstoque = 1; // Controle independente de numeração para vendas rápidas
let pagAtualEstoqueAdm = 1;
let pagAtualVendaEstoque = 1;
let termoBuscaEstoqueAdm = "";
let termoBuscaVendaEstoque = "";
const ITENS_POR_PAGINA = 10;

// Helpers locais (duplicados para desacoplamento ou importados de utils se houvesse)
const helpers = {
    formatarMoeda: (valor) => valor?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00',
    converterMoedaParaNumero: (valor) => {
        if (typeof valor === 'number') return valor;
        if (typeof valor !== 'string') return 0;
        return parseFloat(valor.replace(/R\$\s?|\./g, '').replace(',', '.')) || 0;
    }
};

export async function initEstoque() {
    console.log("Inicializando Módulo Estoque Separado...");
    
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

    // 1. Carregar Itens
    itensEstoque = [];
    const snapshot = await getDocs(estoqueRef);
    snapshot.forEach(doc => {
        itensEstoque.push({ id: doc.id, ...doc.data() });
    });

    // 2. Sincronizar numeração de pedidos (para Venda Rápida)
    // Busca o maior número de pedido existente para não duplicar
    const qPedidos = query(orcamentosPedidosRef, where("tipo", "==", "pedido"), orderBy("numero", "desc")); // Requer índice ou lógica simplificada
    // Nota: Para simplificar sem criar índices complexos agora, pegamos todos e filtramos o maior número
    const allPedidos = await getDocs(orcamentosPedidosRef);
    let maxNum = 0;
    allPedidos.forEach(d => {
        const data = d.data();
        if(data.tipo === 'pedido' && data.numero) {
            const num = parseInt(data.numero.split('/')[0]);
            if(num > maxNum) maxNum = num;
        }
    });
    numeroPedidoEstoque = maxNum + 1;

    renderizarTabelaProntaEntrega();
    renderizarTabelaEstoqueAdm();
}

function setupEventListeners() {
    // Listeners de Paginação e Busca (IDs devem existir no HTML)
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
}

// --- FUNÇÕES DE LÓGICA (Transplantadas e Limpas) ---

function renderizarTabelaEstoqueAdm() {
    const tbody = document.querySelector("#tabela-estoque-adm tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtrados = itensEstoque.filter(item => 
        item.produto.toLowerCase().includes(termoBuscaEstoqueAdm) || 
        (item.detalhes && item.detalhes.toLowerCase().includes(termoBuscaEstoqueAdm))
    );

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

    const filtrados = itensEstoque.filter(item => item.produto.toLowerCase().includes(termoBuscaVendaEstoque));
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

// Funções de CRUD (Cadastro, Edição, Venda)
async function cadastrarItemEstoque() {
    const idEdicao = document.getElementById('estoque-id-edicao').value;
    const produto = document.getElementById('estoque-produto').value;
    const quantidade = parseInt(document.getElementById('estoque-quantidade').value) || 0;
    const valorVenda = helpers.converterMoedaParaNumero(document.getElementById('estoque-valor').value);
    
    // Captura financeiro para relatórios
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

async function iniciarVenda(id) {
    const item = itensEstoque.find(i => i.id === id);
    if(!item) return;

    const inputQtd = prompt(`Vender "${item.produto}"\nQtd atual: ${item.quantidade}\nQuantos vender?`, "1");
    if(!inputQtd) return;
    const qtdVenda = parseInt(inputQtd);
    if(!qtdVenda || qtdVenda <= 0) return alert("Qtd inválida");

    const novoEstoque = (item.quantidade || 0) - qtdVenda;
    if(!confirm(`Confirmar venda de ${qtdVenda}un? Total: ${helpers.formatarMoeda(item.valorVenda * qtdVenda)}`)) return;

    try {
        // Atualiza Estoque
        await updateDoc(doc(estoqueRef, item.id), { quantidade: novoEstoque });
        item.quantidade = novoEstoque;

        // Gera Pedido Financeiro
        const novoPedido = {
            numero: `${String(numeroPedidoEstoque).padStart(4,'0')}/${new Date().getFullYear()}`,
            tipo: 'pedido',
            dataPedido: new Date().toISOString().split('T')[0],
            dataEntrega: new Date().toISOString().split('T')[0],
            cliente: "Venda Pronta Entrega",
            endereco: "Balcão",
            tema: "Pronta Entrega",
            cores: item.detalhes || "-",
            total: item.valorVenda * qtdVenda,
            entrada: item.valorVenda * qtdVenda,
            restante: 0,
            valorFrete: 0,
            valorOrcamento: item.valorVenda * qtdVenda,
            custosTotais: (item.financeiro?.custoProducao || 0) * qtdVenda,
            custoMaoDeObra: (item.financeiro?.maoDeObra || 0) * qtdVenda,
            margemLucro: (item.financeiro?.margemLucro || 0) * qtdVenda,
            produtos: [{ descricao: item.produto, quantidade: qtdVenda, valorUnit: item.valorVenda, valorTotal: item.valorVenda * qtdVenda }],
            observacoes: `Venda via Estoque. Qtd: ${qtdVenda}`
        };

        await addDoc(orcamentosPedidosRef, novoPedido);
        numeroPedidoEstoque++;
        adicionarPedidoNaLista(novoPedido); // Atualiza lista de pedidos em tempo real

        alert("Venda realizada!");
        renderizarTabelaProntaEntrega();
        renderizarTabelaEstoqueAdm();
    } catch(e) { console.error(e); alert("Erro na venda."); }
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

    document.getElementById('btn-salvar-estoque').textContent = "Atualizar Estoque";
    document.getElementById('btn-cancelar-estoque').style.display = 'inline-block';
    document.getElementById('form-estoque-gerencial').scrollIntoView({behavior: 'smooth'});
}

function cancelarEdicaoEstoque() {
    document.getElementById('form-estoque-gerencial').reset();
    document.getElementById('estoque-id-edicao').value = "";
    document.getElementById('btn-salvar-estoque').textContent = "Salvar no Estoque";
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

// Relatório de Saídas (Simplificado)
async function gerarRelatorioRanking() {
    // Mesma lógica do arquivo original, mas mantida aqui isolada
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
