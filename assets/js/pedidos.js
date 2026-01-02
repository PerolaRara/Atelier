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
    window.imprimirNotaPedido = imprimirNotaPedido; // <--- NOVA FUNÇÃO EXPOSTA
    window.gerarRelatorioFinanceiro = gerarRelatorioFinanceiro;
    window.gerarRelatorioXLSX = gerarRelatorioXLSX;
    
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
    const btnXLSX = document.querySelector('#relatorio button[onclick="gerarRelatorioXLSX()"]') || 
                    document.querySelector('#btn-gerar-xlsx'); 
    
    if(btnXLSX) {
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
            // INCLUSÃO DO BOTÃO "NOTA" ABAIXO
            row.innerHTML = `
                <td>${p.numero}</td>
                <td>${p.dataPedido ? p.dataPedido.split('-').reverse().join('/') : '-'}</td>
                <td>${p.cliente}</td>
                <td>${helpers.formatarMoeda(p.total)}</td>
                <td>
                    <button class="btn-editar-pedido" onclick="editarPedido('${p.id}')">Editar</button>
                    <button class="btn-checklist" style="background:#687f82; margin-left:5px;" onclick="imprimirChecklist('${p.id}')">Checklist</button>
                    <button class="btn-nota" style="background:#dfb6b0; margin-left:5px;" onclick="imprimirNotaPedido('${p.id}')">Nota</button>
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
// 6. RELATÓRIOS, CHECKLIST E ***NOVA NOTA DE PEDIDO***
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

/**
 * Função NOVA: Gera uma nota de pedido profissional para o cliente.
 * Design similar ao Orçamento, mas com informações de pagamento.
 */
function imprimirNotaPedido(id) {
    const p = pedidos.find(o => o.id === id);
    if (!p) return;

    const janela = window.open('', '_blank');
    const dtPed = p.dataPedido ? p.dataPedido.split('-').reverse().join('/') : '-';
    const dtEnt = p.dataEntrega ? p.dataEntrega.split('-').reverse().join('/') : '-';
    
    // Caminho absoluto para garantir carregamento da imagem na nova janela
    const pathBase = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const logoSrc = `${pathBase}/assets/images/logo_perola_rara.png`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Pedido ${p.numero} - Pérola Rara</title>
            <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Roboto:wght@300;400;700&display=swap" rel="stylesheet">
            <style>
                /* RESET & BASE */
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { font-family: 'Roboto', sans-serif; color: #555; margin: 0; padding: 40px; background: #fff; font-size: 14px; }
                
                /* HEADER & LOGO */
                .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #7aa2a9; padding-bottom: 20px; margin-bottom: 30px; }
                .logo-box { width: 150px; text-align: left; }
                .logo-box img { max-width: 100%; height: auto; }
                .company-info { text-align: right; }
                .company-info h1 { font-family: 'Dancing Script', cursive; color: #7aa2a9; font-size: 2.5em; margin: 0; }
                .company-info p { margin: 2px 0; font-size: 0.9em; color: #888; }
                
                /* DOC INFO */
                .doc-title { text-align: center; margin-bottom: 30px; }
                /* Título em Verde para Pedido */
                .doc-title h2 { background-color: #7aa2a9; color: #fff; display: inline-block; padding: 8px 30px; border-radius: 50px; text-transform: uppercase; font-size: 1.1em; letter-spacing: 1px; margin: 0; }
                .doc-meta { font-size: 0.9em; margin-top: 5px; color: #999; }

                /* CLIENT GRID - Borda Rosa para diferenciar */
                .client-box { background-color: #f8f9fa; border-left: 5px solid #dfb6b0; padding: 20px; margin-bottom: 30px; border-radius: 0 10px 10px 0; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
                .info-item strong { color: #7aa2a9; text-transform: uppercase; font-size: 0.8em; display: block; margin-bottom: 2px; }

                /* TABLE - Header Rosa para diferenciar */
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                th { background-color: #dfb6b0; color: #fff; font-weight: 500; text-transform: uppercase; font-size: 0.85em; padding: 12px; text-align: left; }
                td { padding: 12px; border-bottom: 1px solid #eee; color: #444; }
                tr:nth-child(even) { background-color: #fcfcfc; }
                .col-money { text-align: right; font-family: 'Roboto', monospace; font-weight: 500; }

                /* TOTALS */
                .totals-section { display: flex; justify-content: flex-end; }
                .totals-box { width: 280px; background: #fff9f8; border: 1px solid #efebe9; padding: 20px; border-radius: 8px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95em; }
                .total-row.final { border-top: 2px solid #dfb6b0; padding-top: 10px; margin-top: 10px; font-size: 1.2em; font-weight: bold; color: #7aa2a9; }

                /* FOOTER */
                .footer-notes { margin-top: 40px; padding-top: 20px; border-top: 1px dashed #ccc; font-size: 0.85em; color: #777; line-height: 1.5; }
                .footer-notes strong { color: #555; }
                
                @media print { 
                    body { padding: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div class="logo-box">
                    <img src="${logoSrc}" alt="Pérola Rara">
                </div>
                <div class="company-info">
                    <h1>Pérola Rara</h1>
                    <p>Fraldas Personalizadas</p>
                    <p>(65) 99250-3151</p>
                    <p>@perolararafraldapersonalizada</p>
                </div>
            </div>

            <div class="doc-title">
                <h2>Nota de Pedido Nº ${p.numero}</h2>
                <div class="doc-meta">Data Pedido: ${dtPed} • Previsão Entrega: ${dtEnt}</div>
            </div>

            <div class="client-box">
                <div class="info-grid">
                    <div class="info-item"><strong>Cliente</strong> ${p.cliente || '-'}</div>
                    <div class="info-item"><strong>Cidade</strong> ${p.cidade || '-'}</div>
                    <div class="info-item"><strong>Telefone</strong> ${p.telefone || '-'}</div>
                    <div class="info-item"><strong>Email</strong> ${p.email || '-'}</div>
                    <div class="info-item" style="grid-column: span 2;"><strong>Tema / Cores</strong> ${p.tema || '-'} / ${p.cores || '-'}</div>
                    <div class="info-item" style="grid-column: span 2;"><strong>Endereço Entrega</strong> ${p.endereco || '-'}</div>
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
                    ${p.produtos.map(prod => `
                        <tr>
                            <td>${prod.quantidade}</td>
                            <td>${prod.descricao}</td>
                            <td class="col-money">${helpers.formatarMoeda(prod.valorUnit)}</td>
                            <td class="col-money">${helpers.formatarMoeda(prod.valorTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="totals-section">
                <div class="totals-box">
                    <div class="total-row"><span>Subtotal:</span> <span>${helpers.formatarMoeda(p.valorOrcamento)}</span></div>
                    <div class="total-row"><span>Frete:</span> <span>${helpers.formatarMoeda(p.valorFrete)}</span></div>
                    <div class="total-row final"><span>Total Geral:</span> <span>${helpers.formatarMoeda(p.total)}</span></div>
                    
                    <div style="margin-top:15px; border-top: 1px dotted #ccc; padding-top:10px;">
                        <div class="total-row" style="color:#4CAF50;"><span>Pago (Entrada):</span> <span>${helpers.formatarMoeda(p.entrada)}</span></div>
                        <div class="total-row" style="color:#e53935; font-weight:bold;"><span>A Pagar (Restante):</span> <span>${helpers.formatarMoeda(p.restante)}</span></div>
                    </div>
                </div>
            </div>

            ${p.observacoes ? `
            <div class="footer-notes">
                <strong>Observações e Termos:</strong><br>
                ${p.observacoes.replace(/\n/g, '<br>')}
            </div>` : ''}

            <div style="text-align: center; margin-top: 50px;" class="no-print">
                <button onclick="window.print()" style="padding: 12px 30px; background: #dfb6b0; color: white; border: none; border-radius: 30px; cursor: pointer; font-size: 16px; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">IMPRIMIR NOTA</button>
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
