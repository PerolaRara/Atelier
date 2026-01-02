// assets/js/pedidos.js

// ==========================================================================
// ESTADO LOCAL DO MÓDULO DE PEDIDOS
// ==========================================================================
let pedidos = [];
let salvarDadosFn = null; // Função injetada (Injeção de Dependência)
let helpers = {};       // Utilitários injetados (formatarMoeda, converterMoeda, etc)

// Variáveis de Estado (Paginação e Busca)
const ITENS_POR_PAGINA = 10;
let pagAtualPed = 1;
let termoBuscaPed = "";
let pedidoEditando = null;

// ==========================================================================
// 1. SETUP E INICIALIZAÇÃO (INTERFACE PÚBLICA)
// ==========================================================================

/**
 * Configura o módulo de pedidos com dados e dependências vindos do controlador principal.
 * @param {Object} config - Objeto contendo { listaPedidos, salvarDadosFn, helpers }
 */
export function setupPedidos(config) {
    console.log("Inicializando Módulo Pedidos...");
    
    // 1. Injeção de Dependências
    pedidos = config.listaPedidos || [];
    salvarDadosFn = config.salvarDadosFn;
    helpers = config.helpers;

    // 2. Expor funções para o HTML (window) para os botões onclick
    window.editarPedido = editarPedido;
    window.atualizarPedido = atualizarPedido;
    window.imprimirChecklist = imprimirChecklist;
    window.gerarRelatorioFinanceiro = gerarRelatorioFinanceiro;
    window.gerarRelatorioXLSX = gerarRelatorioXLSX; // <--- RESTAURADO
    
    // Funções auxiliares da tabela de edição
    window.adicionarProdutoEdicao = adicionarProdutoEdicao;
    window.excluirProdutoEdicao = excluirProdutoEdicao;
    window.atualizarTotaisEdicao = atualizarTotaisEdicao;
    window.atualizarRestanteEdicao = atualizarRestanteEdicao;

    // 3. Inicializar Listeners de DOM específicos deste módulo
    initListenersPedidos();

    // 4. Renderização Inicial
    mostrarPedidosRealizados();
}

/**
 * Permite que o módulo de orçamentos adicione um novo pedido à lista sem recarregar a página.
 */
export function adicionarPedidoNaLista(novoPedido) {
    pedidos.push(novoPedido);
    // Força ir para a primeira página para ver o novo item
    pagAtualPed = 1;
    termoBuscaPed = ""; 
    const inputBusca = document.getElementById('busca-pedidos');
    if(inputBusca) inputBusca.value = "";
    
    mostrarPedidosRealizados();
}

// ==========================================================================
// 2. LISTENERS E UTILITÁRIOS LOCAIS
// ==========================================================================

function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

function initListenersPedidos() {
    // Busca
    const inputBuscaPed = document.getElementById('busca-pedidos');
    if(inputBuscaPed) {
        inputBuscaPed.addEventListener('input', debounce((e) => {
            termoBuscaPed = e.target.value.toLowerCase();
            pagAtualPed = 1; 
            mostrarPedidosRealizados();
        }));
    }

    // Paginação
    const btnAnt = document.getElementById("btn-ant-ped");
    const btnProx = document.getElementById("btn-prox-ped");
    
    if(btnAnt) btnAnt.addEventListener('click', () => { 
        if(pagAtualPed > 1) { pagAtualPed--; mostrarPedidosRealizados(); } 
    });
    
    if(btnProx) btnProx.addEventListener('click', () => { 
        // A validação de limite máximo ocorre dentro do mostrarPedidosRealizados
        pagAtualPed++; 
        mostrarPedidosRealizados(); 
    });

    // Botões de Ação do Formulário de Edição
    const btnSalvar = document.getElementById('btnSalvarPedidoEdicao');
    if(btnSalvar) btnSalvar.addEventListener('click', atualizarPedido);

    const btnAddProd = document.getElementById('btnAddProdutoEdicao');
    if(btnAddProd) btnAddProd.addEventListener('click', adicionarProdutoEdicao);

    // RESTAURADO: Listener para o botão de XLSX
    // Procura qualquer botão dentro da área de relatório que tenha a intenção de gerar XLSX
    const btnXLSX = document.querySelector('#relatorio button[onclick="gerarRelatorioXLSX()"]') || 
                    document.querySelector('#btn-gerar-xlsx'); // Caso você adicione um ID no futuro
    
    if(btnXLSX) {
        // Removemos o onclick inline para garantir que o JS controle (opcional, mas boa prática)
        btnXLSX.removeAttribute('onclick');
        btnXLSX.addEventListener('click', gerarRelatorioXLSX);
    }
}

// ==========================================================================
// 3. LISTAGEM (UI)
// ==========================================================================

function mostrarPedidosRealizados() {
    const tbody = document.querySelector("#tabela-pedidos tbody");
    const btnAnt = document.getElementById("btn-ant-ped");
    const btnProx = document.getElementById("btn-prox-ped");
    const infoPag = document.getElementById("info-pag-ped");

    if(!tbody) return;
    tbody.innerHTML = '';

    // 1. Filtragem
    const termo = termoBuscaPed.trim();
    const filtrados = pedidos.filter(ped => {
        if (!termo) return true;
        const dataFormatada = ped.dataPedido ? ped.dataPedido.split('-').reverse().join('/') : '';
        const matchCliente = ped.cliente.toLowerCase().includes(termo);
        const matchNumero = ped.numero.toLowerCase().includes(termo);
        const matchData = dataFormatada.includes(termo);
        return matchCliente || matchNumero || matchData;
    });

    // 2. Ordenação (Decrescente)
    filtrados.sort((a,b) => b.numero.localeCompare(a.numero));

    // 3. Paginação
    const totalItens = filtrados.length;
    const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA) || 1;

    if (pagAtualPed > totalPaginas) pagAtualPed = totalPaginas;
    if (pagAtualPed < 1) pagAtualPed = 1;

    const indiceInicio = (pagAtualPed - 1) * ITENS_POR_PAGINA;
    const indiceFim = indiceInicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(indiceInicio, indiceFim);

    // 4. Renderização
    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum pedido encontrado.</td></tr>';
    } else {
        itensPagina.forEach(p => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${p.numero}</td>
                <td>${p.dataPedido ? p.dataPedido.split('-').reverse().join('/') : '-'}</td>
                <td>${p.cliente}</td>
                <td>${helpers.formatarMoeda(p.total)}</td>
                <td>
                    <button class="btn-editar-pedido" onclick="editarPedido('${p.id}')">Editar</button>
                    <button class="btn-checklist" style="background:#687f82; margin-left:5px;" onclick="imprimirChecklist('${p.id}')">Checklist</button>
                </td>
            `;
        });
    }

    // 5. Atualizar Controles
    if (infoPag) infoPag.textContent = `Página ${pagAtualPed} de ${totalPaginas}`;
    if (btnAnt) btnAnt.disabled = (pagAtualPed === 1);
    if (btnProx) btnProx.disabled = (pagAtualPed === totalPaginas);
}

// ==========================================================================
// 4. EDIÇÃO DE PEDIDOS
// ==========================================================================

function editarPedido(id) {
    const pedido = pedidos.find(p => p.id === id);
    if (!pedido) return;
    pedidoEditando = id;

    // Dados Básicos
    setVal("dataPedidoEdicao", pedido.dataPedido);
    setVal("dataEntregaEdicao", pedido.dataEntrega);
    setVal("clienteEdicao", pedido.cliente);
    setVal("enderecoEdicao", pedido.endereco);
    setVal("temaEdicao", pedido.tema);
    setVal("cidadeEdicao", pedido.cidade);
    setVal("contatoEdicao", pedido.telefone);
    setVal("coresEdicao", pedido.cores);
    
    // Valores Monetários
    setValMoeda("valorFreteEdicao", pedido.valorFrete);
    setValMoeda("valorPedidoEdicao", pedido.valorOrcamento || 0);
    setValMoeda("totalEdicao", pedido.total);
    setValMoeda("entradaEdicao", pedido.entrada || 0);
    setValMoeda("restanteEdicao", pedido.restante || 0);
    setVal("observacoesEdicao", pedido.observacoes);

    // Dados Financeiros Avançados
    setValMoeda("custoTotalPedido", pedido.custosTotais || 0);
    setValMoeda("maoDeObraPedido", pedido.custoMaoDeObra || 0);
    setValMoeda("lucroPedido", pedido.margemLucro || 0);
    
    // Compatibilidade Legado (Caso o HTML ainda use estes IDs antigos)
    setValMoeda("custoMaoDeObraEdicao", pedido.custoMaoDeObra || 0);
    setValMoeda("margemLucroEdicao", pedido.margemLucro || 0);

    // Produtos
    const tbody = document.querySelector("#tabelaProdutosEdicao tbody");
    tbody.innerHTML = '';
    if(pedido.produtos && pedido.produtos.length > 0) {
        pedido.produtos.forEach(p => adicionarRowProdutoEdicao(tbody, p));
    } else {
        // Se não houver produtos, adiciona uma linha vazia para começar
        adicionarRowProdutoEdicao(tbody, { quantidade: 1, descricao: '', valorUnit: 0, valorTotal: 0 });
    }

    mostrarPagina('form-edicao-pedido');
}

async function atualizarPedido() {
    if (!pedidoEditando) return;
    const index = pedidos.findIndex(p => p.id === pedidoEditando);
    
    // Captura valores financeiros
    const custosTotais = getValMoeda("custoTotalPedido");
    const custoMO = getValMoeda("maoDeObraPedido");
    const margem = getValMoeda("lucroPedido");

    const dados = {
        ...pedidos[index],
        cliente: document.getElementById("clienteEdicao").value,
        dataEntrega: document.getElementById("dataEntregaEdicao").value,
        valorFrete: getValMoeda("valorFreteEdicao"),
        total: getValMoeda("totalEdicao"),
        entrada: getValMoeda("entradaEdicao"),
        restante: getValMoeda("restanteEdicao"),
        
        custosTotais: custosTotais,
        custoMaoDeObra: custoMO,
        margemLucro: margem,
        
        produtos: lerProdutosDaTabela()
    };

    // Usa a função injetada pelo módulo pai para salvar
    await salvarDadosFn(dados, 'pedido');
    
    pedidos[index] = dados;
    alert("Pedido Atualizado e Dados Financeiros Salvos!");
    pedidoEditando = null;
    mostrarPagina('lista-pedidos');
    mostrarPedidosRealizados();
}

// Helpers de Formulário
function setVal(id, val) {
    const el = document.getElementById(id);
    if(el) el.value = val || '';
}

function setValMoeda(id, val) {
    const el = document.getElementById(id);
    if(el) el.value = helpers.formatarMoeda(val || 0);
}

function getValMoeda(id) {
    const el = document.getElementById(id);
    return el ? helpers.converterMoedaParaNumero(el.value) : 0;
}

function mostrarPagina(idPagina) {
    document.querySelectorAll('#module-orcamentos .pagina').forEach(p => p.style.display = 'none');
    const target = document.getElementById(idPagina);
    if(target) target.style.display = 'block';
}

// ==========================================================================
// 5. MANIPULAÇÃO DA TABELA DE PRODUTOS (EDIÇÃO)
// ==========================================================================

function adicionarProdutoEdicao() {
    const tbody = document.querySelector("#tabelaProdutosEdicao tbody");
    adicionarRowProdutoEdicao(tbody, { quantidade: 1, descricao: '', valorUnit: 0, valorTotal: 0 });
}

function adicionarRowProdutoEdicao(tbody, p) {
    const row = tbody.insertRow();
    row.innerHTML = `
        <td><input type="number" class="produto-quantidade" value="${p.quantidade}" min="1" onchange="atualizarTotaisEdicao()"></td>
        <td><input type="text" class="produto-descricao" value="${p.descricao}"></td>
        <td><input type="text" class="produto-valor-unit" value="${helpers.formatarMoeda(p.valorUnit)}" oninput="formatarEntradaMoeda(this)" onblur="atualizarTotaisEdicao()"></td>
        <td>${helpers.formatarMoeda(p.valorTotal)}</td>
        <td><button type="button" onclick="excluirProdutoEdicao(this)">Excluir</button></td>
    `;
}

function lerProdutosDaTabela() {
    const lista = [];
    document.querySelectorAll("#tabelaProdutosEdicao tbody tr").forEach(row => {
        lista.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: helpers.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: helpers.converterMoedaParaNumero(row.cells[3].textContent)
        });
    });
    return lista;
}

function excluirProdutoEdicao(btn) {
    btn.closest('tr').remove();
    atualizarTotaisEdicao();
}

function atualizarTotaisEdicao() {
    let total = 0;
    document.querySelectorAll("#tabelaProdutosEdicao tbody tr").forEach(row => {
        const qtd = parseFloat(row.querySelector(".produto-quantidade").value) || 0;
        const unit = helpers.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value);
        const sub = qtd * unit;
        row.cells[3].textContent = helpers.formatarMoeda(sub);
        total += sub;
    });
    
    const frete = getValMoeda("valorFreteEdicao");
    const totalFinal = total + frete;
    document.getElementById("valorPedidoEdicao").value = helpers.formatarMoeda(total);
    document.getElementById("totalEdicao").value = helpers.formatarMoeda(totalFinal);
    atualizarRestanteEdicao();
}

function atualizarRestanteEdicao() {
    const total = getValMoeda("totalEdicao");
    const entrada = getValMoeda("entradaEdicao");
    document.getElementById("restanteEdicao").value = helpers.formatarMoeda(total - entrada);
}

// ==========================================================================
// 6. RELATÓRIOS E CHECKLIST
// ==========================================================================

function imprimirChecklist(id) {
    const p = pedidos.find(o => o.id === id);
    if (!p) return;

    const janela = window.open('', '_blank');
    const html = `
        <html>
        <head>
            <title>Checklist - ${p.numero}</title>
            <style>
                body { font-family: 'Arial', sans-serif; padding: 20px; color: #000; }
                h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
                .info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #000; padding: 8px; text-align: left; }
                .box { width: 20px; height: 20px; border: 2px solid #000; display: inline-block; }
            </style>
        </head>
        <body>
            <h1>Ordem de Produção - ${p.numero}</h1>
            <div class="info">
                <div><strong>Cliente:</strong> ${p.cliente}</div>
                <div><strong>Entrega:</strong> ${p.dataEntrega ? p.dataEntrega.split('-').reverse().join('/') : '-'}</div>
            </div>
            <div class="info">
                <div><strong>Tema:</strong> ${p.tema}</div>
                <div><strong>Cores:</strong> ${p.cores}</div>
            </div>
            
            <h3>Itens para Conferência</h3>
            <table>
                <thead><tr><th style="width:50px">OK</th><th>Qtd</th><th>Descrição</th><th>Obs. Item</th></tr></thead>
                <tbody>
                    ${p.produtos.map(prod => `
                        <tr>
                            <td style="text-align:center;"><div class="box"></div></td>
                            <td>${prod.quantidade}</td>
                            <td>${prod.descricao}</td>
                            <td></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div style="margin-top: 30px; border: 1px solid #000; padding: 10px; min-height: 100px;">
                <strong>Observações Gerais:</strong><br>${p.observacoes}
            </div>
            <div style="text-align: center; margin-top: 30px;">
                <button onclick="window.print()">Imprimir</button>
            </div>
        </body>
        </html>
    `;
    janela.document.write(html);
    janela.document.close();
}

function gerarRelatorioFinanceiro() {
    const mes = parseInt(document.getElementById("relatorio-mes").value);
    const anoSelect = document.getElementById("relatorio-ano");
    const ano = parseInt(anoSelect ? anoSelect.value : new Date().getFullYear());

    let totalFat = 0, totalMO = 0, totalLucro = 0, totalCustos = 0;
    const tbody = document.querySelector("#tabela-relatorio tbody");
    if(!tbody) return;
    
    tbody.innerHTML = "";

    const pedidosFiltrados = pedidos.filter(p => {
        if(!p.dataPedido) return false;
        const parts = p.dataPedido.split('-');
        const pMes = parseInt(parts[1]) - 1; // Mes 0-indexado
        const pAno = parseInt(parts[0]);
        return pMes === mes && pAno === ano;
    });

    pedidosFiltrados.forEach(p => {
        totalFat += (p.total || 0);
        totalMO += (p.custoMaoDeObra || 0);
        totalLucro += (p.margemLucro || 0);
        totalCustos += (p.custosTotais || 0);

        const row = tbody.insertRow();
        const nomeCliente = p.cliente.length > 15 ? p.cliente.substring(0, 15) + '...' : p.cliente;

        row.innerHTML = `
            <td>${p.dataPedido.split('-').reverse().join('/').substring(0, 5)}</td>
            <td class="col-oculta-mobile">${p.numero}</td>
            <td><span title="${p.cliente}">${nomeCliente}</span></td>
            <td style="color:#2196F3; font-weight:bold;">${helpers.formatarMoeda(p.custoMaoDeObra)}</td>
            <td style="color:#4CAF50; font-weight:bold;">${helpers.formatarMoeda(p.margemLucro)}</td>
            <td style="color:#e53935; font-weight:bold;">${helpers.formatarMoeda(p.custosTotais)}</td>
            <td style="color:#ff9800; font-weight:bold;">${helpers.formatarMoeda(p.total)}</td>
        `;
    });

    if(pedidosFiltrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #777;">Nenhum pedido entregue neste período.</td></tr>';
    }

    updateElementText("kpi-qtd-pedidos", pedidosFiltrados.length, false);
    updateElementText("kpi-mao-obra", totalMO);
    updateElementText("kpi-lucro", totalLucro);
    updateElementText("kpi-custos", totalCustos);
    updateElementText("kpi-total", totalFat);

    if (totalFat > 0) {
        setBarWidth("barra-custos", (totalCustos / totalFat) * 100);
        setBarWidth("barra-salario", (totalMO / totalFat) * 100);
        setBarWidth("barra-lucro", (totalLucro / totalFat) * 100);
    } else {
        setBarWidth("barra-custos", 0);
        setBarWidth("barra-salario", 0);
        setBarWidth("barra-lucro", 0);
    }

    // Mensagem Motivacional
    const boxMsg = document.getElementById("mensagem-motivacional");
    if (boxMsg) {
        if (pedidosFiltrados.length > 0) {
            boxMsg.style.display = "block";
            let mensagem = "";
            if (totalLucro > totalCustos) {
                mensagem = "🎉 <strong>Uau!</strong> O caixa da sua empresa cresceu mais que seus gastos este mês!";
            } else if (totalMO > totalLucro && totalMO > totalCustos) {
                mensagem = "💼 <strong>Ótimo trabalho!</strong> Seu salário (Mão de Obra) foi o destaque do mês.";
            } else {
                mensagem = `🚀 <strong>Produção a todo vapor!</strong> Você entregou ${pedidosFiltrados.length} pedidos. Continue firme!`;
            }
            boxMsg.innerHTML = mensagem;
        } else {
            boxMsg.style.display = "none";
        }
    }
}

// RESTAURADO: Função de Exportação (Alert Temporário)
function gerarRelatorioXLSX() {
    alert("Exportação XLSX em breve.");
}

function updateElementText(id, value, isMoney = true) {
    const el = document.getElementById(id);
    if(el) el.textContent = isMoney ? helpers.formatarMoeda(value) : value;
}
function setBarWidth(id, pct) {
    const el = document.getElementById(id);
    if(el) el.style.width = `${pct}%`;
}
