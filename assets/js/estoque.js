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
import { utils } from './utils.js'; // Importação do sistema de utilitários e Toasts

// Referências
const estoqueRef = collection(db, "estoque");
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");
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
    console.log("Inicializando Módulo Estoque v1.3.0 (Pedagógico + Toasts)...");
    
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
    document.getElementById('btn-salvar-estoque')?.addEventListener('click', cadastrarItemEstoque);
    document.getElementById('btn-cancelar-estoque')?.addEventListener('click', cancelarEdicaoEstoque);
    document.getElementById('btn-gerar-relatorio-saida')?.addEventListener('click', gerarRelatorioRanking);

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

    ['estoque-custo', 'estoque-mao-obra', 'estoque-margem'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', atualizarPrecoVendaAutomatico);
    });
    
    document.getElementById('btn-ant-est-adm')?.addEventListener('click', () => { if(pagAtualEstoqueAdm > 1) {pagAtualEstoqueAdm--; renderizarTabelaEstoqueAdm();} });
    document.getElementById('btn-prox-est-adm')?.addEventListener('click', () => { pagAtualEstoqueAdm++; renderizarTabelaEstoqueAdm(); });
    
    document.getElementById('btn-ant-venda-est')?.addEventListener('click', () => { if(pagAtualVendaEstoque > 1) {pagAtualVendaEstoque--; renderizarTabelaProntaEntrega();} });
    document.getElementById('btn-prox-venda-est')?.addEventListener('click', () => { pagAtualVendaEstoque++; renderizarTabelaProntaEntrega(); });

    const inputNomeProduto = document.getElementById('estoque-produto');
    if(inputNomeProduto) {
        inputNomeProduto.addEventListener('input', (e) => verificarDuplicidade(e.target.value));
    }
}

function verificarDuplicidade(nomeDigitado) {
    const termo = nomeDigitado.trim().toLowerCase();
    const btnSalvar = document.getElementById('btn-salvar-estoque');
    const idEdicao = document.getElementById('estoque-id-edicao').value;

    const duplicado = itensEstoque.find(item => 
        item.produto.toLowerCase() === termo && item.id !== idEdicao
    );

    if (duplicado) {
        btnSalvar.disabled = true;
        btnSalvar.textContent = "Nome já existe!";
        btnSalvar.style.backgroundColor = "#e53935";
        btnSalvar.style.cursor = "not-allowed";
    } else {
        btnSalvar.disabled = false;
        btnSalvar.textContent = idEdicao ? "Atualizar Estoque" : "Salvar no Estoque";
        btnSalvar.style.backgroundColor = "";
        btnSalvar.style.cursor = "pointer";
    }
}

// --- FUNÇÕES DE RENDERIZAÇÃO ---

function renderizarTabelaEstoqueAdm() {
    const tbody = document.querySelector("#tabela-estoque-adm tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtrados = itensEstoque.filter(item => 
        item.produto.toLowerCase().includes(termoBuscaEstoqueAdm) || 
        (item.detalhes && item.detalhes.toLowerCase().includes(termoBuscaEstoqueAdm))
    );

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

    const filtrados = itensEstoque.filter(item => item.produto.toLowerCase().includes(termoBuscaVendaEstoque));
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
    const user = auth.currentUser;
    if (!user) return alert("Sessão expirada. Recarregue a página.");

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

    // --- LÓGICA PEDAGÓGICA (SOFT BLOCK) ---
    const dadosFinanceirosIncompletos = (financeiro.custoProducao === 0 || financeiro.maoDeObra === 0 || financeiro.margemLucro === 0);

    if (dadosFinanceirosIncompletos) {
        const msgEducativa = 
            "⚠️ ATENÇÃO: DADOS FINANCEIROS INCOMPLETOS\n\n" +
            "Notamos que Custos, Salário ou Lucro estão zerados.\n" +
            "Isso deixará seu Relatório Financeiro impreciso.\n\n" +
            "Deseja salvar no estoque mesmo assim?";
        
        if (!confirm(msgEducativa)) return; 
    }

    const item = { 
        ownerId: user.uid,
        produto, quantidade, valorVenda, financeiro,
        detalhes: document.getElementById('estoque-detalhes').value,
        dataAtualizacao: new Date().toISOString()
    };

    try {
        if (idEdicao) {
            await updateDoc(doc(estoqueRef, idEdicao), item);
            const idx = itensEstoque.findIndex(i => i.id === idEdicao);
            if(idx !== -1) itensEstoque[idx] = { id: idEdicao, ...item };
        } else {
            const ref = await addDoc(estoqueRef, item);
            itensEstoque.push({ id: ref.id, ...item });
        }

        // Feedback Visual (Toasts)
        if (dadosFinanceirosIncompletos) {
            if(utils?.showToast) utils.showToast("Item salvo com pendências financeiras.", "warning");
        } else {
            if(utils?.showToast) utils.showToast("Item salvo com sucesso!", "success");
        }

        cancelarEdicaoEstoque();
        renderizarTabelaEstoqueAdm();
        renderizarTabelaProntaEntrega();
    } catch(e) { 
        console.error(e); 
        if(utils?.showToast) utils.showToast("Erro ao salvar no banco de dados.", "error");
    }
}

async function iniciarVenda(id) {
    const user = auth.currentUser;
    if (!user) return alert("Sessão expirada.");

    const itemLocal = itensEstoque.find(i => i.id === id);
    if(!itemLocal) return;

    const inputQtd = prompt(`Vender "${itemLocal.produto}"? Qtd atual: ${itemLocal.quantidade}\nQuantos vender?`, "1");
    if(!inputQtd) return;
    const qtdVenda = parseInt(inputQtd);
    if(!qtdVenda || qtdVenda <= 0) return alert("Qtd inválida");

    try {
        const resultado = await runTransaction(db, async (transaction) => {
            const itemDocRef = doc(db, "estoque", id);
            const itemDoc = await transaction.get(itemDocRef);
            
            if (!itemDoc.exists()) throw "Este produto não existe mais.";
            if (itemDoc.data().ownerId && itemDoc.data().ownerId !== user.uid) throw "Permissão negada.";

            const contadorDoc = await transaction.get(contadorGeralRef);
            const estoqueAtual = itemDoc.data().quantidade || 0;
            const novoEstoque = estoqueAtual - qtdVenda;
            
            let proximoNumero = (contadorDoc.exists()) ? (contadorDoc.data().ultimoPedido || 0) + 1 : 1;
            const anoAtual = new Date().getFullYear();
            const numeroPedidoFormatado = `${String(proximoNumero).padStart(4,'0')}/${anoAtual}`;

            const novoPedidoRef = doc(collection(db, "Orcamento-Pedido")); 
            const dadosItem = itemDoc.data();
            
            const novoPedido = {
                ownerId: user.uid,
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

            transaction.update(itemDocRef, { quantidade: novoEstoque });
            transaction.set(contadorGeralRef, { ultimoPedido: proximoNumero }, { merge: true });
            transaction.set(novoPedidoRef, novoPedido);
            
            return { novoPedido, novoEstoque, idItem: id, idNovoPedido: novoPedidoRef.id };
        });

        if(utils?.showToast) utils.showToast("Venda registrada! Redirecionando...", "info");
        
        await carregarDadosEstoque();

        if (typeof window.editarPedido === 'function') {
            setTimeout(() => {
                const tabPedidos = document.querySelector('a[data-pagina="lista-pedidos"]');
                if(tabPedidos) tabPedidos.click();
                
                window.editarPedido(resultado.idNovoPedido);
                
                setTimeout(() => {
                   if(utils?.showToast) utils.showToast("Por favor, confira os dados financeiros desta venda.", "warning");
                }, 800);
            }, 500);
        }

    } catch(e) { 
        console.error("Transação falhou: ", e); 
        if(utils?.showToast) utils.showToast("Erro ao processar venda: " + e, "error");
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
        if(utils?.showToast) utils.showToast("Item excluído permanentemente.", "info");
    }
}

function atualizarPrecoVendaAutomatico() {
    const c = helpers.converterMoedaParaNumero(document.getElementById('estoque-custo').value);
    const m = helpers.converterMoedaParaNumero(document.getElementById('estoque-mao-obra').value);
    const l = helpers.converterMoedaParaNumero(document.getElementById('estoque-margem').value);
    document.getElementById('estoque-valor').value = helpers.formatarMoeda(c + m + l);
}

async function gerarRelatorioRanking() {
    const user = auth.currentUser;
    if (!user) return;

    const dtInicio = document.getElementById('rel-estoque-inicio').value;
    const dtFim = document.getElementById('rel-estoque-fim').value;
    if (!dtInicio || !dtFim) return alert("Selecione datas.");

    const tbody = document.querySelector("#tabela-ranking-saidas tbody");
    tbody.innerHTML = '<tr><td colspan="3">Carregando...</td></tr>';
    document.getElementById('resultado-relatorio-estoque').style.display = 'block';

    const q = query(
        orcamentosPedidosRef, 
        where("tipo", "==", "pedido"),
        where("ownerId", "==", user.uid)
    );
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

export async function verificarAtualizacaoEstoque(nomeProduto, novosDados) {
    const user = auth.currentUser;
    if (!user) return false;

    const q = query(
        estoqueRef, 
        where("produto", "==", nomeProduto),
        where("ownerId", "==", user.uid)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) return false;

    const novoValorFmt = helpers.formatarMoeda(novosDados.valorVenda);
    const msg = `⚠️ ATENÇÃO - ESTOQUE DETECTADO\n\n` +
                `Encontrei unidades de "${nomeProduto}" no estoque.\n` +
                `Deseja atualizar o preço para ${novoValorFmt}?\n\n` +
                `Isso evita prejuízo na reposição.`;

    if (confirm(msg)) {
        try {
            const batch = writeBatch(db);
            const dataHoje = new Date().toLocaleDateString('pt-BR');
            
            snapshot.forEach(docSnap => {
                const ref = doc(db, "estoque", docSnap.id);
                const dadosAtuais = docSnap.data();
                let detalhesAtualizados = (dadosAtuais.detalhes || "") + `\n[${dataHoje}: Preço atualizado via Precificação]`;

                batch.update(ref, {
                    valorVenda: novosDados.valorVenda,
                    financeiro: novosDados.financeiro,
                    dataAtualizacao: new Date().toISOString(),
                    detalhes: detalhesAtualizados
                });
            });

            await batch.commit();
            if(utils?.showToast) utils.showToast("Estoque sincronizado!", "success");
            await carregarDadosEstoque();
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }
    return false;
}

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
