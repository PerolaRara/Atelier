// assets/js/orcamentos.js

import { db, auth } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, setDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// IMPORTAÇÃO ESTRATÉGICA DO MÓDULO DE PEDIDOS
import { setupPedidos, adicionarPedidoNaLista } from './pedidos.js';

// Referências
const orcamentosPedidosRef = collection(db, "Orcamento-Pedido");

// Variáveis de Estado (Dados)
let numeroOrcamento = 1;
let numeroPedido = 1;
const anoAtual = new Date().getFullYear();
let orcamentoEditando = null;
let orcamentos = [];
let moduleInitialized = false;

// Variáveis de Estado (Paginação e Busca)
const ITENS_POR_PAGINA = 10;
let pagAtualOrc = 1;
let termoBuscaOrc = "";

// ==========================================================================
// 1. HELPERS E FORMATAÇÃO (Definidos aqui e passados para pedidos.js)
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
    console.log("Inicializando Módulo Orçamentos (Controlador Principal)...");
    
    // EXPOR FUNÇÕES DE ORÇAMENTO PARA O HTML
    window.excluirProduto = excluirProduto;
    window.visualizarImpressao = visualizarImpressao;
    window.editarOrcamento = editarOrcamento;
    window.gerarPedido = gerarPedido; // A ponte entre Vendas e Produção
    window.gerarOrcamento = gerarOrcamento;
    window.atualizarOrcamento = atualizarOrcamento;

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
        moduleInitialized = true;
    }
    
    mostrarPagina('form-orcamento');
}

async function carregarDados() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        orcamentos = [];
        const pedidosTemp = []; // Lista temporária para passar ao módulo de pedidos

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
        
        console.log(`Carregado: ${orcamentos.length} Orçamentos, ${pedidosTemp.length} Pedidos`);
        
        // 1. Renderiza Orçamentos (Responsabilidade deste arquivo)
        mostrarOrcamentosGerados();
        
        // 2. Inicializa o Módulo de Pedidos com os dados separados (Injeção)
        setupPedidos({
            listaPedidos: pedidosTemp,
            salvarDadosFn: salvarDados,
            helpers: helpers
        });

    } catch (error) {
        console.error("Erro ao carregar dados:", error);
    }
}

// Função de Salvamento Genérica (Centralizada para uso dos dois módulos)
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
    // (Mesma lógica de template de impressão do arquivo original)
    const janela = window.open('', '_blank');
    const dtOrc = orcamento.dataOrcamento ? orcamento.dataOrcamento.split('-').reverse().join('/') : '';
    const dtVal = orcamento.dataValidade ? orcamento.dataValidade.split('-').reverse().join('/') : '';
    const pagamento = Array.isArray(orcamento.pagamento) ? orcamento.pagamento.join(', ') : orcamento.pagamento;

    const html = `
        <html>
        <head>
            <title>Orçamento ${orcamento.numero}</title>
            <style>
                body { font-family: 'Arial', sans-serif; padding: 40px; color: #333; }
                .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #7aa2a9; padding-bottom: 20px; }
                .header h1 { color: #7aa2a9; margin: 0; }
                .header p { color: #777; font-size: 0.9em; margin: 5px 0; }
                .info-section { margin-bottom: 30px; line-height: 1.6; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: #f2f2f2; color: #333; }
                .totais { text-align: right; margin-top: 30px; }
                .totais h3 { color: #7aa2a9; }
                .obs { margin-top: 40px; font-size: 0.9em; color: #555; border-top: 1px solid #eee; padding-top: 10px; }
                @media print { button { display: none; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Pérola Rara</h1>
                <p>Orçamento Nº ${orcamento.numero}</p>
                <p>(65) 99250-3151 | @perolararafraldapersonalizada</p>
            </div>
            
            <div class="info-section">
                <strong>Cliente:</strong> ${orcamento.cliente || '-'}<br>
                <strong>Cidade:</strong> ${orcamento.cidade || '-'}<br>
                <strong>Telefone:</strong> ${orcamento.telefone || '-'}<br>
                <strong>Data:</strong> ${dtOrc}<br>
                <strong>Validade:</strong> ${dtVal}<br>
                <strong>Tema:</strong> ${orcamento.tema || '-'}<br>
                <strong>Cores:</strong> ${orcamento.cores || '-'}
            </div>

            <h3>Produtos</h3>
            <table>
                <thead><tr><th>Qtd</th><th>Descrição</th><th>Valor Unit.</th><th>Total</th></tr></thead>
                <tbody>
                    ${orcamento.produtos.map(p => `
                        <tr>
                            <td>${p.quantidade}</td>
                            <td>${p.descricao}</td>
                            <td>${helpers.formatarMoeda(p.valorUnit)}</td>
                            <td>${helpers.formatarMoeda(p.valorTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="totais">
                <p><strong>Frete:</strong> ${helpers.formatarMoeda(orcamento.valorFrete)}</p>
                <h3>Total Geral: ${helpers.formatarMoeda(orcamento.total)}</h3>
                <p><strong>Forma de Pagamento:</strong> ${pagamento}</p>
            </div>

            ${orcamento.observacoes ? `<div class="obs"><strong>Observações:</strong><br>${orcamento.observacoes}</div>` : ''}

            <div style="text-align: center; margin-top: 50px;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #7aa2a9; color: white; border: none; border-radius: 5px; cursor: pointer;">Imprimir</button>
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
    // Nota: O novo pedido é adicionado à lista local do módulo de pedidos 
    // através da função exportada abaixo, para não precisar recarregar tudo.

    orc.pedidoGerado = true;
    orc.numeroPedido = pedido.numero;
    await salvarDados(orc, 'orcamento');

    // Notifica o módulo de Pedidos sobre o novo item
    adicionarPedidoNaLista(pedido);

    alert(`Pedido ${pedido.numero} gerado!`);
    
    // Atualiza a tabela de orçamentos para mostrar que já foi gerado
    mostrarOrcamentosGerados();
    
    // Redireciona para a aba de pedidos
    document.querySelector('a[data-pagina="lista-pedidos"]').click();
}
