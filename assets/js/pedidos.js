// assets/js/pedidos.js

import { utils } from './utils.js'; // Prioridade 1: Importação da Caixa de Ferramentas

// ==========================================================================
// ESTADO LOCAL DO MÓDULO DE PEDIDOS
// ==========================================================================
let pedidos = [];
let salvarDadosFn = null; // Função injetada (Injeção de Dependência)

// Variáveis de Estado (Paginação e Busca)
const ITENS_POR_PAGINA = 10;
let pagAtualPed = 1;
let termoBuscaPed = "";
let pedidoEditando = null;

// --- NOVAS VARIÁVEIS DE FILTRO (PLANO DE EVOLUÇÃO) ---
let filtroMesPed = "";
let filtroAnoPed = "";
let filtroSoPendentes = false;

// --- VARIÁVEL DE CONTROLE DE ALTERAÇÃO ---
let houveAlteracaoNaoSalva = false;

// --- VARIÁVEIS DE CONTROLE DE ORDENAÇÃO ---
let ordemAtualPed = 'asc';
let colunaOrdenacaoPed = '';

// ==========================================================================
// 1. SETUP E INICIALIZAÇÃO (INTERFACE PÚBLICA)
// ==========================================================================

/**
 * Configura o módulo de pedidos com dados e dependências vindos do controlador principal.
 * @param {Object} config - Objeto contendo { listaPedidos, salvarDadosFn }
 */
export function setupPedidos(config) {
    console.log("Inicializando Módulo Pedidos...");
    
    // 1. Injeção de Dependências
    pedidos = config.listaPedidos || [];
    salvarDadosFn = config.salvarDadosFn;

    // 2. Expor funções para o HTML (window) para os botões onclick
    window.editarPedido = editarPedido;
    window.atualizarPedido = atualizarPedido;
    window.imprimirChecklist = imprimirChecklist;
    window.imprimirNotaPedido = imprimirNotaPedido;
    
    window.gerarRelatorioFinanceiro = gerarRelatorioFinanceiro;
    window.gerarRelatorioXLSX = gerarRelatorioXLSX;
    
    // Funções auxiliares da tabela de edição
    window.adicionarProdutoEdicao = adicionarProdutoEdicao;
    window.excluirProdutoEdicao = excluirProdutoEdicao;
    window.atualizarTotaisEdicao = atualizarTotaisEdicao;
    window.atualizarRestanteEdicao = atualizarRestanteEdicao;

    // 3. Popular Select de Anos Dinamicamente (PLANO DE EVOLUÇÃO)
    const selectAno = document.getElementById("filtro-ped-ano");
    if(selectAno) {
        const anoAtual = new Date().getFullYear();
        selectAno.innerHTML = '<option value="">Todos os Anos</option>';
        // Mostra ano atual e 2 anos para trás
        for(let i = anoAtual; i >= anoAtual - 2; i--) {
            const opt = document.createElement("option");
            opt.value = i;
            opt.text = i;
            selectAno.appendChild(opt);
        }
    }

    // 4. Inicializar Listeners de DOM específicos deste módulo
    initListenersPedidos();

    // 5. Renderização Inicial
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

// --- FUNÇÃO AUXILIAR PARA MARCAR ALTERAÇÃO ---
function marcarAlteracao() {
    if (!houveAlteracaoNaoSalva) {
        houveAlteracaoNaoSalva = true;
    }
}

// --- PROTEÇÃO CONTRA FECHAMENTO DE ABA ---
window.addEventListener('beforeunload', (e) => {
    const telaEdicao = document.getElementById('form-edicao-pedido');
    if (houveAlteracaoNaoSalva && telaEdicao && telaEdicao.style.display !== 'none') {
        e.preventDefault();
        e.returnValue = 'Há alterações não salvas. Deseja sair?';
    }
});

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

    // --- NOVOS LISTENERS DE FILTRO (PLANO DE EVOLUÇÃO) ---
    const selMes = document.getElementById('filtro-ped-mes');
    const selAno = document.getElementById('filtro-ped-ano');
    const chkPendentes = document.getElementById('filtro-ped-pendentes');

    if(selMes) {
        selMes.addEventListener('change', (e) => {
            filtroMesPed = e.target.value;
            pagAtualPed = 1;
            mostrarPedidosRealizados();
        });
    }

    if(selAno) {
        selAno.addEventListener('change', (e) => {
            filtroAnoPed = e.target.value;
            pagAtualPed = 1;
            mostrarPedidosRealizados();
        });
    }

    if(chkPendentes) {
        chkPendentes.addEventListener('change', (e) => {
            filtroSoPendentes = e.target.checked;
            pagAtualPed = 1;
            mostrarPedidosRealizados();
        });
    }

    // Paginação
    const btnAnt = document.getElementById("btn-ant-ped");
    const btnProx = document.getElementById("btn-prox-ped");
    
    if(btnAnt) btnAnt.addEventListener('click', () => { 
        if(pagAtualPed > 1) { pagAtualPed--; mostrarPedidosRealizados(); } 
    });
    
    if(btnProx) btnProx.addEventListener('click', () => { 
        pagAtualPed++; 
        mostrarPedidosRealizados(); 
    });

    // Botões de Ação do Formulário de Edição
    const btnSalvar = document.getElementById('btnSalvarPedidoEdicao');
    if(btnSalvar) btnSalvar.addEventListener('click', atualizarPedido);

    const btnAddProd = document.getElementById('btnAddProdutoEdicao');
    if(btnAddProd) btnAddProd.addEventListener('click', adicionarProdutoEdicao);

    // Listener para o botão de XLSX
    const btnXLSX = document.querySelector('#relatorio button[onclick="gerarRelatorioXLSX()"]') || 
                    document.querySelector('#btn-gerar-xlsx'); 
    
    if(btnXLSX) {
        btnXLSX.removeAttribute('onclick');
        btnXLSX.addEventListener('click', gerarRelatorioXLSX);
    }

    // --- PROTEÇÃO DE NAVEGAÇÃO INTERNA ---
    document.querySelectorAll('.btn-back-hub, nav ul li a').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const telaEdicao = document.getElementById('form-edicao-pedido');
            const estaNaEdicao = telaEdicao && telaEdicao.style.display !== 'none';

            if (houveAlteracaoNaoSalva && estaNaEdicao) {
                const confirmacao = confirm("⚠️ Você tem alterações não salvas no pedido!\n\nSe sair agora, perderá os dados editados.\nDeseja sair mesmo assim?");
                if (!confirmacao) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                } else {
                    houveAlteracaoNaoSalva = false;
                }
            }
        });
    });
}

// ==========================================================================
// 3. LISTAGEM (UI)
// ==========================================================================

// Função exposta para o HTML chamar no onclick do cabeçalho
window.ordenarPedidos = (coluna) => {
    if (colunaOrdenacaoPed === coluna) {
        ordemAtualPed = ordemAtualPed === 'asc' ? 'desc' : 'asc';
    } else {
        colunaOrdenacaoPed = coluna;
        ordemAtualPed = 'asc';
    }
    mostrarPedidosRealizados();
};

function mostrarPedidosRealizados() {
    const tbody = document.querySelector("#tabela-pedidos tbody");
    const btnAnt = document.getElementById("btn-ant-ped");
    const btnProx = document.getElementById("btn-prox-ped");
    const infoPag = document.getElementById("info-pag-ped");

    if(!tbody) return;
    tbody.innerHTML = '';

    // 1. FILTRAGEM AVANÇADA (PLANO DE EVOLUÇÃO)
    const termo = termoBuscaPed.trim();
    let filtrados = pedidos.filter(ped => {
        // A) Filtro de Texto (Busca Geral)
        let matchTexto = true;
        if (termo) {
            const dataFormatada = utils.formatarDataBR(ped.dataPedido);
            const matchCliente = ped.cliente.toLowerCase().includes(termo);
            const matchNumero = ped.numero.toLowerCase().includes(termo);
            const matchData = dataFormatada.includes(termo);
            matchTexto = matchCliente || matchNumero || matchData;
        }

        // B) Filtros de Data (Mês/Ano)
        let matchDataFiltro = true;
        if (filtroMesPed !== "" || filtroAnoPed !== "") {
            if (!ped.dataPedido) {
                matchDataFiltro = false; 
            } else {
                const partes = ped.dataPedido.split('-'); 
                const pAno = partes[0];
                const pMes = String(parseInt(partes[1]) - 1); // Converte "01" para "0", etc.

                if (filtroAnoPed !== "" && pAno !== filtroAnoPed) matchDataFiltro = false;
                if (filtroMesPed !== "" && pMes !== filtroMesPed) matchDataFiltro = false;
            }
        }

        // C) Filtro de Pendência Financeira (Rigor Total: Retroativo e Parcial)
        let matchPendencia = true;
        if (filtroSoPendentes) {
            const custos = parseFloat(ped.custosTotais) || 0;
            const maoObra = parseFloat(ped.custoMaoDeObra) || 0;
            const lucro = parseFloat(ped.margemLucro) || 0;

            // Se todos os campos estiverem preenchidos (> 0), o pedido está completo.
            // Se houver qualquer zero, ele é considerado pendência.
            const estaCompleto = (custos > 0 && maoObra > 0 && lucro > 0);
            if (estaCompleto) matchPendencia = false;
        }

        return matchTexto && matchDataFiltro && matchPendencia;
    });

    // 2. LÓGICA DE ORDENAÇÃO
    if (colunaOrdenacaoPed === 'cliente') {
        filtrados.sort((a,b) => {
            const valA = (a.cliente || '').toLowerCase();
            const valB = (b.cliente || '').toLowerCase();
            return ordemAtualPed === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        });
        
        document.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
        const thAtual = document.querySelector(`th[onclick*="ordenarPedidos('${colunaOrdenacaoPed}')"]`);
        if(thAtual) thAtual.classList.add(ordemAtualPed);

    } else {
        // Padrão: Ordenação (Decrescente) por Número
        filtrados.sort((a,b) => b.numero.localeCompare(a.numero));
    }

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
        if (filtroSoPendentes) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding: 30px;">
                        <div style="font-size: 1.3em; color: #2e7d32; margin-bottom: 5px;">🎉 <strong>Parabéns!</strong></div>
                        <div style="color: #666;">Todos os seus pedidos estão com o financeiro em dia!</div>
                    </td>
                </tr>`;
        } else {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Nenhum pedido encontrado.</td></tr>';
        }
    } else {
        itensPagina.forEach(p => {
            const row = tbody.insertRow();
            
            // Verificação de dados incompletos (Rigor Total: Retroativo e Parcial)
            const custos = parseFloat(p.custosTotais) || 0;
            const maoObra = parseFloat(p.custoMaoDeObra) || 0;
            const lucro = parseFloat(p.margemLucro) || 0;
            
            // Verifica se ALGUM dos três pilares é zero (ou inválido)
            const possuiPendencia = (custos === 0 || maoObra === 0 || lucro === 0);
            
            const alertaHtml = possuiPendencia 
                ? `<span style="margin-left:8px; cursor:help; font-size:1.2em;" title="⚠️ Pendência Financeira: Custos, Salário ou Caixa estão zerados.">⚠️</span>` 
                : '';

            row.innerHTML = `
                <td>${p.numero}</td>
                <td>${utils.formatarDataBR(p.dataPedido)}</td>
                <td>${p.cliente}</td>
                <td>${utils.formatarMoeda(p.total)} ${alertaHtml}</td>
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

    // Resetamos o controle de alterações ao abrir um novo formulário
    houveAlteracaoNaoSalva = false;

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
    
    // Armazenar Salário Base
    const inputMO = document.getElementById("maoDeObraPedido");
    if(inputMO) {
        inputMO.dataset.salarioAlvo = pedido.custoMaoDeObra || 0;
        inputMO.style.backgroundColor = ""; 
        inputMO.style.color = "";
        const inputLucro = document.getElementById("lucroPedido");
        if(inputLucro) {
            inputLucro.style.backgroundColor = ""; 
            inputLucro.style.color = "";
        }
    }

    // Produtos
    const tbody = document.querySelector("#tabelaProdutosEdicao tbody");
    tbody.innerHTML = '';
    if(pedido.produtos && pedido.produtos.length > 0) {
        pedido.produtos.forEach(p => adicionarRowProdutoEdicao(tbody, p));
    } else {
        adicionarRowProdutoEdicao(tbody, { quantidade: 1, descricao: '', valorUnit: 0, valorTotal: 0 });
    }

    // Monitoramento de Alterações
    houveAlteracaoNaoSalva = false;
    const inputCusto = document.getElementById("custoTotalPedido");
    if(inputCusto) inputCusto.style.border = "";

    const inputsMonitorados = document.querySelectorAll('#form-edicao-pedido input, #form-edicao-pedido textarea');
    inputsMonitorados.forEach(input => {
        input.addEventListener('input', () => {
            if(!houveAlteracaoNaoSalva) {
                houveAlteracaoNaoSalva = true;
                const btn = document.getElementById('btnSalvarPedidoEdicao');
                if(btn) btn.innerText = "Salvar Alterações *";
            }
        });
    });

    mostrarPagina('form-edicao-pedido');
}

async function atualizarPedido() {
    if (!pedidoEditando) return;
    
    const custosTotais = getValMoeda("custoTotalPedido");
    const custoMO = getValMoeda("maoDeObraPedido"); 
    const margem = getValMoeda("lucroPedido");      

    const dadosIncompletos = (custosTotais === 0 || custoMO === 0 || margem === 0);

    if (dadosIncompletos) {
        const mensagemEducativa = 
            "⚠️ ATENÇÃO: DADOS FINANCEIROS INCOMPLETOS\n\n" +
            "Notamos que um ou mais campos essenciais (Custos, Salário ou Lucro) estão zerados.\n" +
            "Para que seu Relatório Financeiro funcione corretamente, é ideal preenchê-los.\n\n" +
            "Deseja salvar mesmo assim?";
        
        if (!confirm(mensagemEducativa)) {
            if(custosTotais === 0) document.getElementById("custoTotalPedido")?.focus();
            else if(custoMO === 0) document.getElementById("maoDeObraPedido")?.focus();
            return; 
        }
    }

    const index = pedidos.findIndex(p => p.id === pedidoEditando);
    const dados = {
        ...pedidos[index],
        cliente: document.getElementById("clienteEdicao").value,
        dataEntrega: document.getElementById("dataEntregaEdicao").value,
        valorFrete: getValMoeda("valorFreteEdicao"),
        total: getValMoeda("totalEdicao"),
        entrada: getValMoeda("entradaEdicao"),
        restante: getValMoeda("restanteEdicao"),
        observacoes: document.getElementById("observacoesEdicao").value,
        
        custosTotais: custosTotais,
        custoMaoDeObra: custoMO,
        margemLucro: margem,
        
        produtos: lerProdutosDaTabela()
    };

    try {
        await salvarDadosFn(dados, 'pedido');
        pedidos[index] = dados;

        houveAlteracaoNaoSalva = false;
        const btn = document.getElementById('btnSalvarPedidoEdicao');
        if(btn) btn.innerText = "Salvar Pedido";
        
        pedidoEditando = null;
        mostrarPagina('lista-pedidos');
        mostrarPedidosRealizados();

        if (dadosIncompletos) {
            utils.showToast("Pedido salvo, mas sem dados financeiros completos.", "warning"); 
        } else {
            utils.showToast("Pedido atualizado e dados financeiros salvos!", "success");
        }

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar pedido.");
    }
}

// Helpers de Formulário
function setVal(id, val) {
    const el = document.getElementById(id);
    if(el) el.value = val || '';
}

function setValMoeda(id, val) {
    const el = document.getElementById(id);
    if(el) el.value = utils.formatarMoeda(val || 0);
}

function getValMoeda(id) {
    const el = document.getElementById(id);
    return el ? utils.converterMoedaParaNumero(el.value) : 0;
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
    marcarAlteracao();
}

function adicionarRowProdutoEdicao(tbody, p) {
    const row = tbody.insertRow();
    row.innerHTML = `
        <td><input type="number" class="produto-quantidade" value="${p.quantidade}" min="1" onchange="atualizarTotaisEdicao()"></td>
        <td><input type="text" class="produto-descricao" value="${p.descricao}"></td>
        <td><input type="text" class="produto-valor-unit" value="${utils.formatarMoeda(p.valorUnit)}" oninput="formatarEntradaMoeda(this)" onblur="atualizarTotaisEdicao()"></td>
        <td>${utils.formatarMoeda(p.valorTotal)}</td>
        <td><button type="button" onclick="excluirProdutoEdicao(this)">Excluir</button></td>
    `;
    
    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', marcarAlteracao);
    });
}

function lerProdutosDaTabela() {
    const lista = [];
    document.querySelectorAll("#tabelaProdutosEdicao tbody tr").forEach(row => {
        lista.push({
            quantidade: parseFloat(row.querySelector(".produto-quantidade").value),
            descricao: row.querySelector(".produto-descricao").value,
            valorUnit: utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value),
            valorTotal: utils.converterMoedaParaNumero(row.cells[3].textContent)
        });
    });
    return lista;
}

function excluirProdutoEdicao(btn) {
    btn.closest('tr').remove();
    atualizarTotaisEdicao();
    marcarAlteracao();
}

window.atualizarTotaisEdicao = function() {
    marcarAlteracao();

    let totalProd = 0;
    document.querySelectorAll("#tabelaProdutosEdicao tbody tr").forEach(row => {
        const qtd = parseFloat(row.querySelector(".produto-quantidade").value) || 0;
        const unit = utils.converterMoedaParaNumero(row.querySelector(".produto-valor-unit").value);
        const sub = qtd * unit;
        row.cells[3].textContent = utils.formatarMoeda(sub);
        totalProd += sub;
    });
    
    const frete = utils.converterMoedaParaNumero(document.getElementById("valorFreteEdicao").value);
    const novoTotalVenda = totalProd + frete;

    document.getElementById("valorPedidoEdicao").value = utils.formatarMoeda(totalProd);
    document.getElementById("totalEdicao").value = utils.formatarMoeda(novoTotalVenda);
    
    const custoProdTotal = utils.converterMoedaParaNumero(document.getElementById("custoTotalPedido").value);
    const inputMO = document.getElementById("maoDeObraPedido");
    let salarioAlvo = 0;
    
    if (inputMO.dataset.salarioAlvo) {
        salarioAlvo = parseFloat(inputMO.dataset.salarioAlvo);
    } else {
        salarioAlvo = utils.converterMoedaParaNumero(inputMO.value);
        inputMO.dataset.salarioAlvo = salarioAlvo;
    }

    const resultado = utils.calcularCascataFinanceira(novoTotalVenda, custoProdTotal, salarioAlvo);

    inputMO.value = utils.formatarMoeda(resultado.salario);
    document.getElementById("lucroPedido").value = utils.formatarMoeda(resultado.lucro);

    const inputLucro = document.getElementById("lucroPedido");
    inputMO.style.backgroundColor = ""; 
    inputMO.style.color = "";
    inputLucro.style.backgroundColor = ""; 
    inputLucro.style.color = "";

    if (resultado.status === 'alerta') {
        inputMO.style.backgroundColor = "#fff3e0"; 
        inputMO.style.color = "#e65100";
        inputMO.title = "Atenção: O desconto está reduzindo seu salário!";
        inputLucro.style.backgroundColor = "#ffebee";
        inputLucro.style.color = "#c62828";
    } else if (resultado.status === 'prejuizo') {
        inputMO.style.backgroundColor = "#ffebee";
        inputMO.style.color = "#c62828";
        inputMO.title = "PREJUÍZO: Valor de venda não cobre os custos!";
    }

    atualizarRestanteEdicao();
};

function atualizarRestanteEdicao() {
    const total = getValMoeda("totalEdicao");
    const entrada = getValMoeda("entradaEdicao");
    document.getElementById("restanteEdicao").value = utils.formatarMoeda(total - entrada);
    marcarAlteracao();
}

// ==========================================================================
// 6. RELATÓRIOS E CHECKLIST
// ==========================================================================

function imprimirChecklist(id) {
    const p = pedidos.find(o => o.id === id);
    if (!p) return;
    const janela = window.open('', '_blank');
    const dtEnt = utils.formatarDataBR(p.dataEntrega);
    const logoSrc = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + '/assets/images/logo_perola_rara.png';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Checklist Produção</title>
            <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { font-family: 'Roboto', sans-serif; color: #444; margin: 0; padding: 40px; background: #fff; font-size: 14px; }
                .header-container { text-align: center; border-bottom: 3px solid #7aa2a9; padding-bottom: 20px; margin-bottom: 25px; }
                .logo-box { margin: 0 auto 5px auto; width: 100px; }
                .logo-box img { max-width: 100%; height: auto; }
                .doc-title { text-align: center; margin-bottom: 20px; }
                .doc-title h2 { background-color: #7aa2a9; color: #fff; display: inline-block; padding: 8px 30px; border-radius: 50px; text-transform: uppercase; font-size: 1.2em; margin: 0; }
                .delivery-highlight { text-align: center; margin: 15px 0 30px 0; font-size: 1.1em; color: #e53935; font-weight: bold; border: 2px dashed #dfb6b0; padding: 10px; border-radius: 8px; background: #fff9f8; display: inline-block; }
                .production-box { border-top: 5px solid #dfb6b0; padding: 20px; margin-bottom: 20px; background: #f8f9fa; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
                .info-item { font-size: 1.1em; }
                .info-item strong { display: block; font-size: 0.8em; text-transform: uppercase; color: #7aa2a9; margin-bottom: 4px; font-weight: 700; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th { background-color: #dfb6b0; color: #fff; font-weight: bold; text-transform: uppercase; font-size: 0.85em; padding: 10px; text-align: left; }
                td { padding: 12px; border-bottom: 1px solid #eee; vertical-align: middle; color: #333; }
                tr:nth-child(even) { background-color: #fcfcfc; }
                .check-box { width: 24px; height: 24px; border: 2px solid #7aa2a9; display: block; margin: 0 auto; background: #fff; border-radius: 4px; }
                .footer-area { margin-top: 30px; border: 1px solid #b2d8d8; background-color: #f0f7f7; padding: 15px; min-height: 100px; border-radius: 8px; }
                .footer-area strong { color: #5a8289; display: block; margin-bottom: 5px; }
                @media print { .no-print { display: none; } body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div class="logo-box"><img src="${logoSrc}" alt="Pérola Rara"></div>
            </div>

            <div style="text-align: center;">
                <div class="doc-title"><h2>Checklist de Produção</h2></div>
                <div class="delivery-highlight">Entrega: ${dtEnt}</div>
            </div>

            <div class="production-box">
                <div class="info-grid">
                    <div class="info-item"><strong>Cliente</strong> ${p.cliente}</div>
                    <div class="info-item"><strong>Tema</strong> ${p.tema || 'N/A'}</div>
                    <div class="info-item" style="grid-column: span 2;"><strong>Cores / Detalhes</strong> ${p.cores || 'N/A'}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 10%; text-align:center;">OK</th>
                        <th style="width: 10%; text-align:center;">QTD</th>
                        <th style="width: 80%">ITEM / DESCRIÇÃO</th>
                    </tr>
                </thead>
                <tbody>
                    ${p.produtos.map(prod => `
                        <tr>
                            <td><div class="check-box"></div></td>
                            <td style="text-align:center; font-weight:bold; font-size:1.2em; color: #7aa2a9;">${prod.quantidade}</td>
                            <td style="font-size:1.1em;">${prod.descricao}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="footer-area">
                <strong>Observações Técnicas / Anotações de Produção:</strong><br>
                ${p.observacoes ? p.observacoes.replace(/\n/g, '<br>') : ''}
            </div>

            <div class="no-print" style="text-align:center; margin-top:30px;">
                <button onclick="window.print()" style="padding:15px 40px; background:#7aa2a9; color:#fff; border:none; border-radius:30px; cursor:pointer; font-weight:bold; font-size:16px;">IMPRIMIR CHECKLIST</button>
            </div>
        </body>
        </html>
    `;
    janela.document.write(html);
    janela.document.close();
}

function imprimirNotaPedido(id) {
    const p = pedidos.find(o => o.id === id);
    if (!p) return;
    const janela = window.open('', '_blank');
    const dtPed = utils.formatarDataBR(p.dataPedido);
    const logoSrc = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + '/assets/images/logo_perola_rara.png';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Pedido ${p.numero}</title>
            <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Roboto:wght@300;400;700&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { font-family: 'Roboto', sans-serif; color: #555; margin: 0; padding: 40px; background: #fff; font-size: 14px; }
                .header-container { text-align: center; border-bottom: 3px solid #7aa2a9; padding-bottom: 20px; margin-bottom: 30px; }
                .logo-box { margin: 0 auto 10px auto; width: 120px; }
                .logo-box img { max-width: 100%; height: auto; }
                .company-info h1 { font-family: 'Roboto', sans-serif; font-weight: 700; color: #7aa2a9; font-size: 2.5em; margin: 0; line-height: 1.2; }
                .company-info p { margin: 2px 0; font-size: 0.9em; color: #888; }
                .doc-title { text-align: center; margin-bottom: 30px; }
                .doc-title h2 { background-color: #7aa2a9; color: #fff; display: inline-block; padding: 8px 30px; border-radius: 50px; text-transform: uppercase; font-size: 1.1em; letter-spacing: 1px; margin: 0; }
                .doc-meta { font-size: 0.9em; margin-top: 5px; color: #999; }
                .client-box { background-color: #f8f9fa; border-top: 5px solid #dfb6b0; padding: 20px; margin-bottom: 30px; border-radius: 8px; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
                .info-item strong { color: #7aa2a9; text-transform: uppercase; font-size: 0.8em; display: block; margin-bottom: 2px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                th { background-color: #dfb6b0; color: #fff; font-weight: 500; text-transform: uppercase; font-size: 0.85em; padding: 12px; text-align: left; }
                td { padding: 12px; border-bottom: 1px solid #eee; color: #444; }
                tr:nth-child(even) { background-color: #fcfcfc; }
                .col-money { text-align: right; font-family: 'Roboto', monospace; font-weight: 500; }
                .totals-section { display: flex; justify-content: flex-end; }
                .totals-box { width: 280px; background: #fff9f8; border: 1px solid #efebe9; padding: 20px; border-radius: 8px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95em; }
                .total-row.final { border-top: 2px solid #dfb6b0; padding-top: 10px; margin-top: 10px; font-size: 1.2em; font-weight: bold; color: #7aa2a9; }
                .finance-breakdown-container { margin-top: 30px; border-top: 2px dashed #ccc; padding-top: 20px; page-break-inside: avoid; }
                .finance-breakdown-container h3 { text-align: center; font-size: 1em; color: #555; text-transform: uppercase; margin-bottom: 15px; }
                .cards-wrapper { display: flex; justify-content: space-between; gap: 10px; }
                .card { flex: 1; padding: 10px; border-radius: 6px; text-align: center; border: 1px solid; }
                .card-label { display: block; font-size: 0.8em; font-weight: bold; margin-bottom: 4px; }
                .card-value { display: block; font-size: 1.1em; color: #333; font-weight: bold; }
                .card-costs { background: #ffebee; border-color: #ef5350; }
                .card-costs .card-label { color: #c62828; }
                .card-salary { background: #e3f2fd; border-color: #42a5f5; }
                .card-salary .card-label { color: #1565c0; }
                .card-profit { background: #e8f5e9; border-color: #66bb6a; }
                .card-profit .card-label { color: #2e7d32; }
                .footer-notes { margin-top: 40px; padding-top: 20px; border-top: 1px dashed #ccc; font-size: 0.85em; color: #777; }
                @media print { .no-print { display: none; } body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div class="logo-box"><img src="${logoSrc}" alt="Pérola Rara"></div>
                <div class="company-info">
                    <h1>Pérola Rara</h1>
                    <p>Fraldas Personalizadas • (65) 99250-3151</p>
                </div>
            </div>

            <div class="doc-title">
                <h2>Nota de Pedido Nº ${p.numero}</h2>
                <div class="doc-meta">Data Pedido: ${dtPed} • Entrega: ${utils.formatarDataBR(p.dataEntrega)}</div>
            </div>

            <div class="client-box">
                <div class="info-grid">
                    <div class="info-item"><strong>Cliente</strong> ${p.cliente || '-'}</div>
                    <div class="info-item"><strong>Contato</strong> ${p.telefone || '-'}</div>
                    <div class="info-item" style="grid-column: span 2;"><strong>Endereço</strong> ${p.endereco || '-'}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 10%">Qtd</th>
                        <th style="width: 50%">Descrição</th>
                        <th class="col-money" style="width: 20%">Unit.</th>
                        <th class="col-money" style="width: 20%">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${p.produtos.map(prod => `
                        <tr>
                            <td>${prod.quantidade}</td>
                            <td>${prod.descricao}</td>
                            <td class="col-money">${utils.formatarMoeda(prod.valorUnit)}</td>
                            <td class="col-money">${utils.formatarMoeda(prod.valorTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="totals-section">
                <div class="totals-box">
                    <div class="total-row"><span>Subtotal:</span> <span>${utils.formatarMoeda(p.valorOrcamento)}</span></div>
                    <div class="total-row"><span>Frete:</span> <span>${utils.formatarMoeda(p.valorFrete)}</span></div>
                    <div class="total-row final"><span>Total Geral:</span> <span>${utils.formatarMoeda(p.total)}</span></div>
                    <div style="margin-top:15px; border-top:1px dotted #ccc; padding-top:10px;">
                        <div class="total-row" style="color:#4CAF50;"><span>Entrada:</span> <span>${utils.formatarMoeda(p.entrada)}</span></div>
                        <div class="total-row" style="color:#e53935; font-weight:bold;"><span>Restante:</span> <span>${utils.formatarMoeda(p.restante)}</span></div>
                    </div>
                </div>
            </div>
            
            <div class="finance-breakdown-container">
                <h3>Demonstrativo Financeiro (Controle Interno)</h3>
                <div class="cards-wrapper">
                    <div class="card card-costs">
                        <span class="card-label">CUSTOS TOTAIS</span>
                        <span class="card-value">${utils.formatarMoeda(p.custosTotais || 0)}</span>
                    </div>
                    <div class="card card-salary">
                        <span class="card-label">MEU SALÁRIO</span>
                        <span class="card-value">${utils.formatarMoeda(p.custoMaoDeObra || 0)}</span>
                    </div>
                    <div class="card card-profit">
                        <span class="card-label">CAIXA EMPRESA</span>
                        <span class="card-value">${utils.formatarMoeda(p.margemLucro || 0)}</span>
                    </div>
                </div>
            </div>
            
            ${p.observacoes ? `<div class="footer-notes"><strong>Observações:</strong><br>${p.observacoes.replace(/\n/g, '<br>')}</div>` : ''}
            
            <div class="no-print" style="text-align:center; margin-top:40px;">
                <button onclick="window.print()" style="padding:12px 30px; background:#dfb6b0; color:#fff; border:none; border-radius:30px; cursor:pointer; font-weight:bold;">IMPRIMIR NOTA</button>
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
    let pedidosComAlerta = 0;

    const tbody = document.querySelector("#tabela-relatorio tbody");
    if(!tbody) return;
    
    tbody.innerHTML = "";

    const pedidosFiltrados = pedidos.filter(p => {
        if(!p.dataPedido) return false;
        const parts = p.dataPedido.split('-');
        const pMes = parseInt(parts[1]) - 1; 
        const pAno = parseInt(parts[0]);
        return pMes === mes && pAno === ano;
    });

    pedidosFiltrados.forEach(p => {
        totalFat += (p.total || 0);
        totalMO += (p.custoMaoDeObra || 0);
        totalLucro += (p.margemLucro || 0);
        totalCustos += (p.custosTotais || 0);

        const somaFinanceira = (parseFloat(p.custosTotais)||0) + (parseFloat(p.custoMaoDeObra)||0) + (parseFloat(p.margemLucro)||0);
        if (somaFinanceira === 0) {
            pedidosComAlerta++;
        }

        const row = tbody.insertRow();
        const nomeCliente = p.cliente.length > 15 ? p.cliente.substring(0, 15) + '...' : p.cliente;

        row.innerHTML = `
            <td>${utils.formatarDataBR(p.dataPedido).substring(0, 5)}</td>
            <td class="col-oculta-mobile">${p.numero}</td>
            <td><span title="${p.cliente}">${nomeCliente}</span></td>
            <td style="color:#2196F3; font-weight:bold;">${utils.formatarMoeda(p.custoMaoDeObra)}</td>
            <td style="color:#4CAF50; font-weight:bold;">${utils.formatarMoeda(p.margemLucro)}</td>
            <td style="color:#e53935; font-weight:bold;">${utils.formatarMoeda(p.custosTotais)}</td>
            <td style="color:#ff9800; font-weight:bold;">${utils.formatarMoeda(p.total)}</td>
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

    const baseCalculoDizimo = totalMO + totalLucro;
    const valorDizimo = baseCalculoDizimo * 0.10;
    updateElementText("kpi-dizimo", valorDizimo);

    const modalAlerta = document.getElementById('modal-alerta-financeiro');
    const spanQtd = document.getElementById('qtd-pedidos-incompletos');

    if (pedidosFiltrados.length > 0 && pedidosComAlerta > 0 && modalAlerta) {
        spanQtd.textContent = pedidosComAlerta;
        modalAlerta.style.display = 'flex';
    } else if (modalAlerta) {
        modalAlerta.style.display = 'none';
    }

    if (totalFat > 0) {
        setBarWidth("barra-custos", (totalCustos / totalFat) * 100);
        setBarWidth("barra-salario", (totalMO / totalFat) * 100);
        setBarWidth("barra-lucro", (totalLucro / totalFat) * 100);
    } else {
        setBarWidth("barra-custos", 0);
        setBarWidth("barra-salario", 0);
        setBarWidth("barra-lucro", 0);
    }

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

function gerarRelatorioXLSX() {
    alert("Exportação XLSX em breve.");
}

function updateElementText(id, value, isMoney = true) {
    const el = document.getElementById(id);
    if(el) el.textContent = isMoney ? utils.formatarMoeda(value) : value;
}

function setBarWidth(id, pct) {
    const el = document.getElementById(id);
    if(el) el.style.width = `${pct}%`;
}
