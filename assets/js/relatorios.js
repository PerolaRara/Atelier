import { utils } from './utils.js';

// ==========================================================================
// ESTADO INTERNO E CACHE EM DOIS NÍVEIS DO MÓDULO DE RELATÓRIOS
// ==========================================================================
let obterPedidosFn = () => [];

const estadoRelatorio = {
    // Máquina de Estados Ortogonal (2x2): dominioAtivo x modoAtivo
    dominioAtivo: 'financeiro',     // 'financeiro' | 'produtos'
    modoAtivo: 'mensal',            // 'mensal' | '12m'

    // Controles do Domínio Financeiro
    baseMedia12m: 'ativos',         // 'ativos' | 'corridos'
    cache12m: null,
    chaveCache12m: '',
    alertasExibidosSessao: new Set(),

    // Controles do Domínio de Produtos
    filtroProduto: '__TODOS__',     // '__TODOS__' ou chave normalizada do produto
    metricaProduto: 'qtd',          // 'qtd' (Peças) | 'valor' (Receita s/ Frete)
    baseMediaProd12m: 'ativos',     // 'ativos' | 'corridos'
    rankingMensalExpandido: false,  // Controla Top 8 vs Todos no gráfico mensal

    // Cache Nível 1: Índice Normalizado de Pedidos e Catálogo Único
    indicePedidosNormalizados: null,
    catalogoProdutosMap: null,      // Map(chave -> nomeExibicao)

    // Cache Nível 2: Agregações Memoizadas de Produtos
    cacheProdMensal: null,
    chaveCacheProdMensal: '',
    cacheProd12m: null,
    chaveCacheProd12m: '',

    // Contexto de Drill-Down Agnóstico ao Domínio
    ancoraDrillDown: null           // { mesOrigem, anoOrigem, dominioOrigem, labelAlvo }
};

const NOMES_MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const REGEX_LEGADO_PRONTA_ENTREGA = /\((.+?)\s*-\s*(\d+)\s*un\)/i;

// ==========================================================================
// 1. UTILITÁRIOS DE SEGURANÇA (BLINDAGEM XSS) E FORMATAÇÃO
// ==========================================================================

function escaparHTML(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function atualizarTextoElemento(id, valor, isMoeda = true) {
    const el = document.getElementById(id);
    if (el) el.textContent = isMoeda ? utils.formatarMoeda(valor) : String(valor);
}

function definirLarguraBarra(id, percentual) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(Math.max(percentual, 0), 100)}%`;
}

// ==========================================================================
// 2. INICIALIZAÇÃO E INVALIDAÇÃO UNIFICADA DE CACHE
// ==========================================================================

export function setupRelatorios(config) {
    if (config && typeof config.getPedidos === 'function') {
        obterPedidosFn = config.getPedidos;
    }

    invalidarCacheRelatorios(false);
    popularSelectAnosRelatorio();
    popularSelectFiltroProdutos();
    inicializarListenersRelatorio();

    // Aliases globais de retrocompatibilidade
    window.gerarRelatorioFinanceiro = () => acionarRelatorioAtivo(false);
    window.gerarRelatorioXLSX = () => exportarRelatorioXLSX(estadoRelatorio.dominioAtivo, estadoRelatorio.modoAtivo);
}

export function invalidarCacheRelatorios(reRenderizarSeVisivel = true) {
    // Limpa Nível 1 e Nível 2 (Garante consistência após criar, editar ou excluir pedido)
    estadoRelatorio.indicePedidosNormalizados = null;
    estadoRelatorio.catalogoProdutosMap = null;

    estadoRelatorio.cache12m = null;
    estadoRelatorio.chaveCache12m = '';

    estadoRelatorio.cacheProdMensal = null;
    estadoRelatorio.chaveCacheProdMensal = '';
    estadoRelatorio.cacheProd12m = null;
    estadoRelatorio.chaveCacheProd12m = '';

    if (reRenderizarSeVisivel) {
        const secaoRelatorio = document.getElementById('relatorio');
        if (secaoRelatorio && secaoRelatorio.style.display !== 'none') {
            popularSelectAnosRelatorio();
            popularSelectFiltroProdutos();
            acionarRelatorioAtivo(true);
        }
    }
}

// ==========================================================================
// 3. CAMADA DE INGESTÃO E NORMALIZAÇÃO (CACHE NÍVEL 1 - O(N) ÚNICO)
// ==========================================================================

function extrairItensNormalizadosDoPedido(pedido) {
    const tema = (pedido.tema || '').trim().toLowerCase();
    const cliente = (pedido.cliente || '').trim();
    const obs = (pedido.observacoes || '').toLowerCase();

    const isProntaEntrega =
        tema === 'pronta entrega' ||
        cliente.startsWith('Venda Pronta Entrega') ||
        obs.includes('venda via estoque');

    const canal = isProntaEntrega ? 'pronta' : 'encomenda';
    const itensExtraidos = [];

    if (Array.isArray(pedido.produtos) && pedido.produtos.length > 0) {
        for (let i = 0; i < pedido.produtos.length; i++) {
            const item = pedido.produtos[i];
            const nomeLimpo = (item.descricao || 'Produto Sem Nome').trim();
            const qtd = parseFloat(item.quantidade) || 0;
            const unit = parseFloat(item.valorUnit) || 0;
            const valorTotal = parseFloat(item.valorTotal) || (qtd * unit) || 0;

            if (qtd > 0) {
                itensExtraidos.push({
                    chave: nomeLimpo.toLowerCase(),
                    nomeExibicao: nomeLimpo,
                    quantidade: qtd,
                    receita: valorTotal,
                    canal
                });
            }
        }
    } else if (isProntaEntrega) {
        // Fallback para registros antigos onde o item constava apenas entre parênteses no nome do cliente
        const match = cliente.match(REGEX_LEGADO_PRONTA_ENTREGA);
        const nomeFallback = match
            ? match[1].trim()
            : (cliente.replace(/Venda Pronta Entrega/i, '').replace(/[()]/g, '').trim() || 'Item Pronta Entrega');
        const qtdFallback = match ? (parseInt(match[2], 10) || 1) : 1;

        itensExtraidos.push({
            chave: nomeFallback.toLowerCase(),
            nomeExibicao: nomeFallback,
            quantidade: qtdFallback,
            receita: parseFloat(pedido.total) || 0,
            canal: 'pronta'
        });
    }

    return itensExtraidos;
}

function obterIndicePedidosNormalizados() {
    if (estadoRelatorio.indicePedidosNormalizados) {
        return estadoRelatorio.indicePedidosNormalizados;
    }

    const pedidosBrutos = obterPedidosFn() || [];
    const indice = [];
    const catalogoMap = new Map();

    for (let i = 0; i < pedidosBrutos.length; i++) {
        const p = pedidosBrutos[i];
        if (!p.dataPedido) continue;

        const partes = p.dataPedido.split('-');
        if (partes.length < 2) continue;

        const ano = parseInt(partes[0], 10);
        const mes = parseInt(partes[1], 10) - 1;
        if (isNaN(ano) || isNaN(mes)) continue;

        const itens = extrairItensNormalizadosDoPedido(p);
        for (let j = 0; j < itens.length; j++) {
            const it = itens[j];
            if (!catalogoMap.has(it.chave)) {
                catalogoMap.set(it.chave, it.nomeExibicao);
            }
        }

        indice.push({
            id: p.id,
            numero: p.numero || '-',
            dataPedido: p.dataPedido,
            ano,
            mes,
            cliente: p.cliente || '-',
            total: parseFloat(p.total) || 0,
            custoMaoDeObra: parseFloat(p.custoMaoDeObra) || 0,
            margemLucro: parseFloat(p.margemLucro) || 0,
            custosTotais: parseFloat(p.custosTotais) || 0,
            itens
        });
    }

    estadoRelatorio.indicePedidosNormalizados = indice;
    estadoRelatorio.catalogoProdutosMap = catalogoMap;
    return indice;
}

// ==========================================================================
// 4. CONFIGURAÇÃO DE SELETORES E EVENT LISTENERS CONSOLIDADOS
// ==========================================================================

function popularSelectAnosRelatorio() {
    const selectMes = document.getElementById('relatorio-mes');
    const selectAno = document.getElementById('relatorio-ano');
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth();

    if (selectMes && !selectMes.dataset.inicializado) {
        selectMes.value = String(mesAtual);
        selectMes.dataset.inicializado = 'true';
    }

    if (selectAno) {
        const indice = obterIndicePedidosNormalizados();
        const anosSet = new Set([anoAtual, anoAtual - 1, anoAtual - 2]);

        for (let i = 0; i < indice.length; i++) {
            if (indice[i].ano > 2000) anosSet.add(indice[i].ano);
        }

        const anosOrdenados = Array.from(anosSet).sort((a, b) => b - a);
        const valorAnterior = selectAno.value;

        selectAno.innerHTML = '';
        anosOrdenados.forEach(ano => {
            const opt = document.createElement('option');
            opt.value = String(ano);
            opt.textContent = String(ano);
            selectAno.appendChild(opt);
        });

        selectAno.value = anosOrdenados.includes(Number(valorAnterior))
            ? valorAnterior
            : String(anoAtual);
    }
}

function popularSelectFiltroProdutos() {
    const selectProd = document.getElementById('relatorio-filtro-produto');
    if (!selectProd) return;

    obterIndicePedidosNormalizados();
    const catalogoMap = estadoRelatorio.catalogoProdutosMap || new Map();
    const valorAnterior = estadoRelatorio.filtroProduto;

    selectProd.innerHTML = '<option value="__TODOS__">🌎 Todos os Produtos (Visão Global)</option>';

    Array.from(catalogoMap.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([chave, nomeExibicao]) => {
            const opt = document.createElement('option');
            opt.value = chave;
            opt.textContent = `📦 ${nomeExibicao}`;
            selectProd.appendChild(opt);
        });

    selectProd.value = catalogoMap.has(valorAnterior) ? valorAnterior : '__TODOS__';
    estadoRelatorio.filtroProduto = selectProd.value;

    const btnReset = document.getElementById('btn-limpar-filtro-prod');
    if (btnReset) {
        btnReset.style.display = estadoRelatorio.filtroProduto !== '__TODOS__' ? 'inline-block' : 'none';
    }
}

function inicializarListenersRelatorio() {
    // 1. Comutador de Domínio no Título (Financeiro <-> Produtos)
    const btnSwitch = document.getElementById('btn-switch-tipo-relatorio');
    const pillFin = document.getElementById('pill-dominio-financeiro');
    const pillProd = document.getElementById('pill-dominio-produtos');

    if (btnSwitch) {
        btnSwitch.addEventListener('click', () => {
            const proximo = estadoRelatorio.dominioAtivo === 'financeiro' ? 'produtos' : 'financeiro';
            alternarDominioRelatorio(proximo);
        });
    }
    if (pillFin) pillFin.addEventListener('click', () => alternarDominioRelatorio('financeiro'));
    if (pillProd) pillProd.addEventListener('click', () => alternarDominioRelatorio('produtos'));

    // 2. Abas de Período (Mensal <-> 12 Meses)
    const tabMensal = document.getElementById('tab-rel-mensal');
    const tab12m = document.getElementById('tab-rel-12m');

    if (tabMensal) {
        tabMensal.addEventListener('click', () => {
            estadoRelatorio.ancoraDrillDown = null;
            alternarModoRelatorio('mensal');
        });
    }
    if (tab12m) {
        tab12m.addEventListener('click', () => {
            estadoRelatorio.ancoraDrillDown = null;
            alternarModoRelatorio('12m');
        });
    }

    // 3. Seletores de Mês e Ano
    const selectMes = document.getElementById('relatorio-mes');
    const selectAno = document.getElementById('relatorio-ano');

    const aoMudarPeriodo = () => {
        estadoRelatorio.ancoraDrillDown = null;
        estadoRelatorio.rankingMensalExpandido = false;
        sincronizarInterfaceRelatorio(false);
    };

    if (selectMes) selectMes.addEventListener('change', aoMudarPeriodo);
    if (selectAno) selectAno.addEventListener('change', aoMudarPeriodo);

    // 4. Filtro de Produto Individual e Botão Limpar Filtro
    const selectProd = document.getElementById('relatorio-filtro-produto');
    const btnLimparProd = document.getElementById('btn-limpar-filtro-prod');

    if (selectProd) {
        selectProd.addEventListener('change', (e) => {
            aplicarFiltroProduto(e.target.value);
        });
    }
    if (btnLimparProd) {
        btnLimparProd.addEventListener('click', () => aplicarFiltroProduto('__TODOS__'));
    }

    // 5. Botões de Métrica do Gráfico de Produtos (Qtd vs Valor) - O(1) via Cache Nível 2
    const btnMetricaQtd = document.getElementById('btn-metrica-qtd');
    const btnMetricaValor = document.getElementById('btn-metrica-valor');

    if (btnMetricaQtd) btnMetricaQtd.addEventListener('click', () => alternarMetricaProdutos('qtd'));
    if (btnMetricaValor) btnMetricaValor.addEventListener('click', () => alternarMetricaProdutos('valor'));

    // 6. Botão Expandir Todos os Produtos no Gráfico Mensal
    const btnExpandirRanking = document.getElementById('btn-expandir-ranking-mes');
    if (btnExpandirRanking) {
        btnExpandirRanking.addEventListener('click', () => {
            estadoRelatorio.rankingMensalExpandido = !estadoRelatorio.rankingMensalExpandido;
            if (estadoRelatorio.cacheProdMensal) {
                renderizarGraficoRankingMensalProdutos(estadoRelatorio.cacheProdMensal);
            }
        });
    }

    // 7. Base de Cálculo de Média 12m (Financeiro e Produtos)
    document.getElementById('btn-media-ativos')?.addEventListener('click', () => alternarBaseMedia12m('ativos'));
    document.getElementById('btn-media-corridos')?.addEventListener('click', () => alternarBaseMedia12m('corridos'));

    document.getElementById('btn-prod-media-ativos')?.addEventListener('click', () => alternarBaseMediaProdutos12m('ativos'));
    document.getElementById('btn-prod-media-corridos')?.addEventListener('click', () => alternarBaseMediaProdutos12m('corridos'));

    // 8. Delegação de Eventos para Drill-Down e Seleção de Produto
    document.getElementById('grafico-colunas-12m')?.addEventListener('click', tratarCliqueDrillDownMes);
    document.querySelector('#tabela-relatorio-12m tbody')?.addEventListener('click', tratarCliqueDrillDownMes);
    document.getElementById('grafico-colunas-prod-12m')?.addEventListener('click', tratarCliqueDrillDownMes);

    document.getElementById('grafico-ranking-produtos-mes')?.addEventListener('click', tratarCliqueSelecaoProduto);
    document.querySelector('#tabela-produtos-mensal tbody')?.addEventListener('click', tratarCliqueSelecaoProduto);
    document.querySelector('#tabela-produtos-12m tbody')?.addEventListener('click', tratarCliqueSelecaoProduto);

    document.getElementById('btn-voltar-12m')?.addEventListener('click', retornarDoDrillDown);

    // 9. Exportações XLSX
    document.getElementById('btn-exportar-xlsx-mensal')?.addEventListener('click', () => exportarRelatorioXLSX('financeiro', 'mensal'));
    document.getElementById('btn-exportar-xlsx-12m')?.addEventListener('click', () => exportarRelatorioXLSX('financeiro', '12m'));
    document.getElementById('btn-exportar-xlsx-prod-mensal')?.addEventListener('click', () => exportarRelatorioXLSX('produtos', 'mensal'));
    document.getElementById('btn-exportar-xlsx-prod-12m')?.addEventListener('click', () => exportarRelatorioXLSX('produtos', '12m'));

    // 10. Entrada na Aba Relatório pelo Menu Principal
    const linkMenuRelatorio = document.querySelector('nav ul li a[data-pagina="relatorio"]');
    if (linkMenuRelatorio) {
        linkMenuRelatorio.addEventListener('click', () => {
            popularSelectAnosRelatorio();
            popularSelectFiltroProdutos();
            sincronizarInterfaceRelatorio(false);
        });
    }
}

function tratarCliqueDrillDownMes(e) {
    const alvo = e.target.closest('[data-mes][data-ano]');
    if (!alvo || alvo.classList.contains('mes-sem-venda')) return;
    executarDrillDownParaMes(parseInt(alvo.dataset.mes, 10), parseInt(alvo.dataset.ano, 10));
}

function tratarCliqueSelecaoProduto(e) {
    const alvo = e.target.closest('[data-chave-produto]');
    if (!alvo) return;
    const chaveClicada = alvo.dataset.chaveProduto;
    const novaChave = estadoRelatorio.filtroProduto === chaveClicada ? '__TODOS__' : chaveClicada;
    aplicarFiltroProduto(novaChave);
}

// ==========================================================================
// 5. ORQUESTRADOR DA MÁQUINA DE ESTADOS 2x2 E DRILL-DOWN AGNÓSTICO
// ==========================================================================

function alternarDominioRelatorio(novoDominio) {
    if (estadoRelatorio.dominioAtivo === novoDominio) return;
    estadoRelatorio.dominioAtivo = novoDominio;
    sincronizarInterfaceRelatorio(true);
}

function alternarModoRelatorio(novoModo) {
    estadoRelatorio.modoAtivo = novoModo;
    sincronizarInterfaceRelatorio(Boolean(estadoRelatorio.ancoraDrillDown));
}

function acionarRelatorioAtivo(silenciarModal = false) {
    sincronizarInterfaceRelatorio(silenciarModal);
}

function sincronizarInterfaceRelatorio(silenciarModal = false) {
    const isProdutos = estadoRelatorio.dominioAtivo === 'produtos';
    const is12m = estadoRelatorio.modoAtivo === '12m';

    // 1. Atualiza Cabeçalho Switcher
    const iconeTitulo = document.getElementById('icone-titulo-relatorio');
    const textoTitulo = document.getElementById('texto-titulo-relatorio');
    const pillFin = document.getElementById('pill-dominio-financeiro');
    const pillProd = document.getElementById('pill-dominio-produtos');

    if (iconeTitulo) iconeTitulo.textContent = isProdutos ? '🛍️' : '💰';
    if (textoTitulo) textoTitulo.textContent = isProdutos ? 'Desempenho de Produtos' : 'Relatório Financeiro';
    pillFin?.classList.toggle('active', !isProdutos);
    pillProd?.classList.toggle('active', isProdutos);

    // 2. Atualiza Abas Mensal / 12m
    document.getElementById('tab-rel-mensal')?.classList.toggle('active', !is12m);
    document.getElementById('tab-rel-12m')?.classList.toggle('active', is12m);

    const labelFiltro = document.getElementById('label-filtro-relatorio');
    if (labelFiltro) {
        labelFiltro.textContent = is12m ? 'Mês Final do Período:' : 'Mês de Referência:';
    }

    // 3. Visibilidade dos Containers de Domínio e Barra de Filtro de Produtos
    const domFin = document.getElementById('dominio-relatorio-financeiro');
    const domProd = document.getElementById('dominio-relatorio-produtos');
    const barraFiltroProd = document.getElementById('barra-filtro-produtos');

    if (domFin) domFin.style.display = isProdutos ? 'none' : 'block';
    if (domProd) domProd.style.display = isProdutos ? 'block' : 'none';
    if (barraFiltroProd) barraFiltroProd.style.display = isProdutos ? 'flex' : 'none';

    atualizarBannerDrillDown();

    // 4. Aciona a Visão Exata da Matriz 2x2
    if (!isProdutos) {
        const visaoFinMensal = document.getElementById('visao-relatorio-mensal');
        const visaoFin12m = document.getElementById('visao-relatorio-12m');
        if (visaoFinMensal) visaoFinMensal.style.display = is12m ? 'none' : 'block';
        if (visaoFin12m) visaoFin12m.style.display = is12m ? 'block' : 'none';

        if (is12m) renderizarRelatorio12Meses();
        else renderizarRelatorioMensal(silenciarModal);
    } else {
        const visaoProdMensal = document.getElementById('visao-produtos-mensal');
        const visaoProd12m = document.getElementById('visao-produtos-12m');
        if (visaoProdMensal) visaoProdMensal.style.display = is12m ? 'none' : 'block';
        if (visaoProd12m) visaoProd12m.style.display = is12m ? 'block' : 'none';

        if (is12m) renderizarRelatorioProdutos12Meses();
        else renderizarRelatorioProdutosMensal();
    }
}

function executarDrillDownParaMes(mesAlvo, anoAlvo) {
    const selectMes = document.getElementById('relatorio-mes');
    const selectAno = document.getElementById('relatorio-ano');

    const mesOrigem = parseInt(selectMes?.value ?? new Date().getMonth(), 10);
    const anoOrigem = parseInt(selectAno?.value ?? new Date().getFullYear(), 10);

    estadoRelatorio.ancoraDrillDown = {
        mesOrigem,
        anoOrigem,
        dominioOrigem: estadoRelatorio.dominioAtivo,
        labelAlvo: `${NOMES_MESES_CURTO[mesAlvo]}/${anoAlvo}`
    };

    if (selectMes) selectMes.value = String(mesAlvo);
    if (selectAno) selectAno.value = String(anoAlvo);

    estadoRelatorio.modoAtivo = 'mensal';
    sincronizarInterfaceRelatorio(true);
}

function retornarDoDrillDown() {
    if (!estadoRelatorio.ancoraDrillDown) return;

    const selectMes = document.getElementById('relatorio-mes');
    const selectAno = document.getElementById('relatorio-ano');

    if (selectMes) selectMes.value = String(estadoRelatorio.ancoraDrillDown.mesOrigem);
    if (selectAno) selectAno.value = String(estadoRelatorio.ancoraDrillDown.anoOrigem);

    estadoRelatorio.dominioAtivo = estadoRelatorio.ancoraDrillDown.dominioOrigem || estadoRelatorio.dominioAtivo;
    estadoRelatorio.modoAtivo = '12m';
    estadoRelatorio.ancoraDrillDown = null;

    sincronizarInterfaceRelatorio(true);
}

function atualizarBannerDrillDown() {
    const banner = document.getElementById('banner-retorno-drilldown');
    const texto = document.getElementById('texto-drilldown-origem');
    if (!banner) return;

    if (estadoRelatorio.modoAtivo === 'mensal' && estadoRelatorio.ancoraDrillDown) {
        const contextoNome = estadoRelatorio.dominioAtivo === 'produtos' ? 'Saídas de Produtos' : 'Fechamento Financeiro';
        if (texto) {
            texto.innerHTML = `🔍 Inspecionando <strong>${escaparHTML(estadoRelatorio.ancoraDrillDown.labelAlvo)}</strong> (${contextoNome})`;
        }
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

// ==========================================================================
// 6. DOMÍNIO 1: MOTOR DO RELATÓRIO FINANCEIRO (MENSAL & 12 MESES)
// ==========================================================================

function renderizarRelatorioMensal(silenciarModal = false) {
    const indice = obterIndicePedidosNormalizados();
    const mes = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const ano = parseInt(document.getElementById('relatorio-ano')?.value ?? new Date().getFullYear(), 10);

    let totalFat = 0, totalMO = 0, totalLucro = 0, totalCustos = 0;
    let pedidosComAlerta = 0;

    const tbody = document.querySelector('#tabela-relatorio tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const pedidosFiltrados = indice.filter(p => p.mes === mes && p.ano === ano);
    const fragment = document.createDocumentFragment();

    pedidosFiltrados.forEach(p => {
        totalFat += p.total;
        totalMO += p.custoMaoDeObra;
        totalLucro += p.margemLucro;
        totalCustos += p.custosTotais;

        if ((p.custosTotais + p.custoMaoDeObra + p.margemLucro) === 0) {
            pedidosComAlerta++;
        }

        const tr = document.createElement('tr');
        const nomeCurto = p.cliente.length > 15 ? p.cliente.substring(0, 15) + '...' : p.cliente;

        tr.innerHTML = `
            <td>${escaparHTML(utils.formatarDataBR(p.dataPedido).substring(0, 5))}</td>
            <td class="col-oculta-mobile">${escaparHTML(p.numero)}</td>
            <td><span title="${escaparHTML(p.cliente)}">${escaparHTML(nomeCurto)}</span></td>
            <td style="color:#2196F3; font-weight:bold;">${utils.formatarMoeda(p.custoMaoDeObra)}</td>
            <td style="color:#4CAF50; font-weight:bold;">${utils.formatarMoeda(p.margemLucro)}</td>
            <td style="color:#e53935; font-weight:bold;">${utils.formatarMoeda(p.custosTotais)}</td>
            <td style="color:#ff9800; font-weight:bold;">${utils.formatarMoeda(p.total)}</td>
        `;
        fragment.appendChild(tr);
    });

    if (pedidosFiltrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #777;">Nenhum pedido entregue neste período.</td></tr>';
    } else {
        tbody.appendChild(fragment);
    }

    atualizarTextoElemento('kpi-qtd-pedidos', pedidosFiltrados.length, false);
    atualizarTextoElemento('kpi-mao-obra', totalMO);
    atualizarTextoElemento('kpi-lucro', totalLucro);
    atualizarTextoElemento('kpi-custos', totalCustos);
    atualizarTextoElemento('kpi-total', totalFat);
    atualizarTextoElemento('kpi-dizimo', (totalMO + totalLucro) * 0.10);

    const modalAlerta = document.getElementById('modal-alerta-financeiro');
    const spanQtd = document.getElementById('qtd-pedidos-incompletos');
    const chaveMes = `${ano}-${mes}`;

    if (!silenciarModal && pedidosFiltrados.length > 0 && pedidosComAlerta > 0 && modalAlerta && !estadoRelatorio.alertasExibidosSessao.has(chaveMes)) {
        estadoRelatorio.alertasExibidosSessao.add(chaveMes);
        if (spanQtd) spanQtd.textContent = String(pedidosComAlerta);
        modalAlerta.style.display = 'flex';
    }

    if (totalFat > 0) {
        definirLarguraBarra('barra-custos', (totalCustos / totalFat) * 100);
        definirLarguraBarra('barra-salario', (totalMO / totalFat) * 100);
        definirLarguraBarra('barra-lucro', (totalLucro / totalFat) * 100);
    } else {
        definirLarguraBarra('barra-custos', 0);
        definirLarguraBarra('barra-salario', 0);
        definirLarguraBarra('barra-lucro', 0);
    }

    const boxMsg = document.getElementById('mensagem-motivacional');
    if (boxMsg) {
        if (pedidosFiltrados.length > 0) {
            boxMsg.style.display = 'block';
            if (totalLucro > totalCustos) {
                boxMsg.innerHTML = '🎉 <strong>Uau!</strong> O caixa da sua empresa cresceu mais que seus gastos este mês!';
            } else if (totalMO > totalLucro && totalMO > totalCustos) {
                boxMsg.innerHTML = '💼 <strong>Ótimo trabalho!</strong> Seu salário (Mão de Obra) foi o destaque do mês.';
            } else {
                boxMsg.innerHTML = `🚀 <strong>Produção a todo vapor!</strong> Você entregou ${pedidosFiltrados.length} pedidos. Continue firme!`;
            }
        } else {
            boxMsg.style.display = 'none';
        }
    }
}

function alternarBaseMedia12m(novaBase) {
    if (estadoRelatorio.baseMedia12m === novaBase) return;
    estadoRelatorio.baseMedia12m = novaBase;

    document.getElementById('btn-media-ativos')?.classList.toggle('active', novaBase === 'ativos');
    document.getElementById('btn-media-corridos')?.classList.toggle('active', novaBase === 'corridos');

    if (estadoRelatorio.cache12m) {
        atualizarKPIsERodape12m(estadoRelatorio.cache12m);
    } else {
        renderizarRelatorio12Meses();
    }
}

function calcularDados12Meses(mesRef, anoRef) {
    const chave = `${anoRef}-${mesRef}`;
    if (estadoRelatorio.cache12m && estadoRelatorio.chaveCache12m === chave) {
        return estadoRelatorio.cache12m;
    }

    const indice = obterIndicePedidosNormalizados();
    const janelaMeses = [];
    const mapaSlots = new Map();

    for (let i = 11; i >= 0; i--) {
        const dataAlvo = new Date(anoRef, mesRef - i, 1);
        const m = dataAlvo.getMonth();
        const a = dataAlvo.getFullYear();
        const slot = {
            mes: m,
            ano: a,
            labelCurto: `${NOMES_MESES_CURTO[m]}/${String(a).slice(-2)}`,
            qtd: 0,
            salario: 0,
            lucro: 0,
            custos: 0,
            total: 0
        };
        janelaMeses.push(slot);
        mapaSlots.set(`${a}-${m}`, slot);
    }

    for (let i = 0; i < indice.length; i++) {
        const p = indice[i];
        const slot = mapaSlots.get(`${p.ano}-${p.mes}`);
        if (slot) {
            slot.qtd += 1;
            slot.salario += p.custoMaoDeObra;
            slot.lucro += p.margemLucro;
            slot.custos += p.custosTotais;
            slot.total += p.total;
        }
    }

    let somaQtd = 0, somaSalario = 0, somaLucro = 0, somaCustos = 0, somaTotal = 0;
    let maiorFaturamentoMes = 0;
    let qtdMesesAtivos = 0;

    janelaMeses.forEach(m => {
        somaQtd += m.qtd;
        somaSalario += m.salario;
        somaLucro += m.lucro;
        somaCustos += m.custos;
        somaTotal += m.total;
        if (m.qtd > 0) qtdMesesAtivos++;
        if (m.total > maiorFaturamentoMes) maiorFaturamentoMes = m.total;
    });

    const resultado = {
        janelaMeses,
        somaQtd,
        somaSalario,
        somaLucro,
        somaCustos,
        somaTotal,
        maiorFaturamentoMes,
        qtdMesesAtivos
    };

    estadoRelatorio.cache12m = resultado;
    estadoRelatorio.chaveCache12m = chave;
    return resultado;
}

function renderizarRelatorio12Meses() {
    const mesRef = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const anoRef = parseInt(document.getElementById('relatorio-ano')?.value ?? new Date().getFullYear(), 10);

    const dados = calcularDados12Meses(mesRef, anoRef);

    const labelIntervalo = document.getElementById('label-intervalo-12m');
    if (labelIntervalo && dados.janelaMeses.length === 12) {
        labelIntervalo.textContent = `Período: ${dados.janelaMeses[0].labelCurto} a ${dados.janelaMeses[11].labelCurto}`;
    }

    const badgeAtivos = document.getElementById('badge-meses-ativos');
    if (badgeAtivos) {
        badgeAtivos.textContent = `${dados.qtdMesesAtivos} de 12 meses com vendas`;
    }

    atualizarKPIsERodape12m(dados);
    renderizarGraficoETabela12m(dados);
}

function atualizarKPIsERodape12m(dados) {
    const { somaQtd, somaSalario, somaLucro, somaCustos, somaTotal, qtdMesesAtivos } = dados;

    const usarAtivos = estadoRelatorio.baseMedia12m === 'ativos';
    const divisor = usarAtivos ? (qtdMesesAtivos > 0 ? qtdMesesAtivos : 1) : 12;
    const sufixoBase = usarAtivos
        ? `${qtdMesesAtivos} ${qtdMesesAtivos === 1 ? 'mês ativo' : 'meses ativos'}`
        : '12 meses fixos';

    const mediaQtd = somaQtd / divisor;
    const mediaSalario = somaSalario / divisor;
    const mediaLucro = somaLucro / divisor;
    const mediaCustos = somaCustos / divisor;
    const mediaTotal = somaTotal / divisor;
    const somaDizimo = (somaSalario + somaLucro) * 0.10;
    const mediaDizimo = somaDizimo / divisor;

    atualizarTextoElemento('kpi-12m-qtd', mediaQtd.toFixed(1).replace('.', ','), false);
    atualizarTextoElemento('kpi-12m-salario', mediaSalario);
    atualizarTextoElemento('kpi-12m-lucro', mediaLucro);
    atualizarTextoElemento('kpi-12m-custos', mediaCustos);
    atualizarTextoElemento('kpi-12m-total', mediaTotal);
    atualizarTextoElemento('kpi-12m-dizimo', mediaDizimo);

    atualizarTextoElemento('acum-12m-qtd', `Total: ${somaQtd} ped. (${sufixoBase})`, false);
    atualizarTextoElemento('acum-12m-salario', `Acumulado: ${utils.formatarMoeda(somaSalario)}`, false);
    atualizarTextoElemento('acum-12m-lucro', `Acumulado: ${utils.formatarMoeda(somaLucro)}`, false);
    atualizarTextoElemento('acum-12m-custos', `Acumulado: ${utils.formatarMoeda(somaCustos)}`, false);
    atualizarTextoElemento('acum-12m-total', `Acumulado: ${utils.formatarMoeda(somaTotal)}`, false);
    atualizarTextoElemento('acum-12m-dizimo', `Total no período: ${utils.formatarMoeda(somaDizimo)} (${sufixoBase})`, false);

    const tfoot12m = document.querySelector('#tabela-relatorio-12m tfoot');
    if (tfoot12m) {
        tfoot12m.innerHTML = `
            <tr class="linha-media-anual">
                <td>MÉDIA MENSAL (${escaparHTML(sufixoBase.toUpperCase())})</td>
                <td style="text-align: center;">${mediaQtd.toFixed(1).replace('.', ',')}</td>
                <td style="color:#2196F3;">${utils.formatarMoeda(mediaSalario)}</td>
                <td style="color:#4CAF50;">${utils.formatarMoeda(mediaLucro)}</td>
                <td style="color:#e53935;">${utils.formatarMoeda(mediaCustos)}</td>
                <td style="color:#ff9800;">${utils.formatarMoeda(mediaTotal)}</td>
            </tr>
            <tr class="linha-total-anual">
                <td>ACUMULADO (12 MESES)</td>
                <td style="text-align: center;">${somaQtd}</td>
                <td style="color:#2196F3;">${utils.formatarMoeda(somaSalario)}</td>
                <td style="color:#4CAF50;">${utils.formatarMoeda(somaLucro)}</td>
                <td style="color:#e53935;">${utils.formatarMoeda(somaCustos)}</td>
                <td style="color:#ff9800;">${utils.formatarMoeda(somaTotal)}</td>
            </tr>
        `;
    }
}

function renderizarGraficoETabela12m(dados) {
    const { janelaMeses, maiorFaturamentoMes } = dados;

    const containerGrafico = document.getElementById('grafico-colunas-12m');
    if (containerGrafico) {
        containerGrafico.innerHTML = '';
        const fragGrafico = document.createDocumentFragment();
        const alturaMaximaPx = 175;

        janelaMeses.forEach(m => {
            const proporcaoMes = maiorFaturamentoMes > 0 ? (m.total / maiorFaturamentoMes) : 0;
            const alturaBarraPx = Math.max(proporcaoMes * alturaMaximaPx, 4);

            const somaComp = m.custos + m.salario + m.lucro;
            const pctCustos = somaComp > 0 ? (m.custos / somaComp) * 100 : 0;
            const pctSalario = somaComp > 0 ? (m.salario / somaComp) * 100 : 0;
            const pctLucro = somaComp > 0 ? (m.lucro / somaComp) * 100 : 0;

            const valorTopo = m.total > 0 ? `R$ ${Math.round(m.total).toLocaleString('pt-BR')}` : '-';
            const semVenda = m.qtd === 0;

            const colunaEl = document.createElement('div');
            colunaEl.className = `coluna-mes-item ${semVenda ? 'mes-sem-venda' : ''}`;
            colunaEl.dataset.mes = String(m.mes);
            colunaEl.dataset.ano = String(m.ano);

            colunaEl.innerHTML = `
                <div class="tooltip-mes-12m">
                    <strong>${escaparHTML(m.labelCurto)} (${m.qtd} ped.)</strong><br>
                    Salário: ${utils.formatarMoeda(m.salario)}<br>
                    Caixa: ${utils.formatarMoeda(m.lucro)}<br>
                    Gastos: ${utils.formatarMoeda(m.custos)}<br>
                    <strong>Total: ${utils.formatarMoeda(m.total)}</strong>
                    ${!semVenda ? '<br><em style="color:#80cbc4; font-size:0.7rem;">Clique para ver os pedidos</em>' : ''}
                </div>
                <span class="valor-topo-barra">${escaparHTML(valorTopo)}</span>
                <div class="barra-vertical-pilha" style="height: ${alturaBarraPx}px;">
                    <div class="seg-v-gastos" style="height: ${pctCustos}%;"></div>
                    <div class="seg-v-salario" style="height: ${pctSalario}%;"></div>
                    <div class="seg-v-caixa" style="height: ${pctLucro}%;"></div>
                </div>
                <span class="mes-label-eixo">${escaparHTML(m.labelCurto)}</span>
            `;
            fragGrafico.appendChild(colunaEl);
        });

        containerGrafico.appendChild(fragGrafico);

        const scrollWrapper = document.getElementById('grafico-scroll-wrapper');
        if (scrollWrapper && scrollWrapper.scrollWidth > scrollWrapper.clientWidth) {
            scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
        }
    }

    const tbody12m = document.querySelector('#tabela-relatorio-12m tbody');
    if (tbody12m) {
        tbody12m.innerHTML = '';
        const fragTabela = document.createDocumentFragment();

        [...janelaMeses].reverse().forEach(m => {
            const tr = document.createElement('tr');
            if (m.qtd > 0) {
                tr.className = 'linha-mes-clicavel';
                tr.dataset.mes = String(m.mes);
                tr.dataset.ano = String(m.ano);
                tr.title = `Clique para abrir o fechamento de ${m.labelCurto}`;
            } else {
                tr.style.opacity = '0.55';
            }

            tr.innerHTML = `
                <td><strong>${escaparHTML(m.labelCurto)}</strong> ${m.qtd > 0 ? '<small style="color:#7aa2a9;">🔍</small>' : ''}</td>
                <td style="text-align: center;">${m.qtd}</td>
                <td style="color:#2196F3; font-weight:500;">${utils.formatarMoeda(m.salario)}</td>
                <td style="color:#4CAF50; font-weight:500;">${utils.formatarMoeda(m.lucro)}</td>
                <td style="color:#e53935; font-weight:500;">${utils.formatarMoeda(m.custos)}</td>
                <td style="color:#ff9800; font-weight:bold;">${utils.formatarMoeda(m.total)}</td>
            `;
            fragTabela.appendChild(tr);
        });

        tbody12m.appendChild(fragTabela);
    }
}

// ==========================================================================
// 7. DOMÍNIO 2: MOTOR DE DESEMPENHO DE PRODUTOS (CACHE NÍVEL 2 - O(1) UI)
// ==========================================================================

function aplicarFiltroProduto(novaChave) {
    estadoRelatorio.filtroProduto = novaChave || '__TODOS__';
    estadoRelatorio.rankingMensalExpandido = false;

    const selectProd = document.getElementById('relatorio-filtro-produto');
    if (selectProd && selectProd.value !== estadoRelatorio.filtroProduto) {
        selectProd.value = estadoRelatorio.filtroProduto;
    }

    const btnReset = document.getElementById('btn-limpar-filtro-prod');
    if (btnReset) {
        btnReset.style.display = estadoRelatorio.filtroProduto !== '__TODOS__' ? 'inline-block' : 'none';
    }

    sincronizarInterfaceRelatorio(true);
}

function alternarMetricaProdutos(novaMetrica) {
    if (estadoRelatorio.metricaProduto === novaMetrica) return;
    estadoRelatorio.metricaProduto = novaMetrica;

    document.getElementById('btn-metrica-qtd')?.classList.toggle('active', novaMetrica === 'qtd');
    document.getElementById('btn-metrica-valor')?.classList.toggle('active', novaMetrica === 'valor');

    // Re-renderiza apenas os gráficos usando o Cache Nível 2 em O(1)
    if (estadoRelatorio.modoAtivo === '12m') {
        if (estadoRelatorio.cacheProd12m) {
            renderizarGraficoColunasProdutos12m(estadoRelatorio.cacheProd12m);
        } else {
            renderizarRelatorioProdutos12Meses();
        }
    } else {
        if (estadoRelatorio.cacheProdMensal) {
            renderizarGraficoRankingMensalProdutos(estadoRelatorio.cacheProdMensal);
        } else {
            renderizarRelatorioProdutosMensal();
        }
    }
}

function alternarBaseMediaProdutos12m(novaBase) {
    if (estadoRelatorio.baseMediaProd12m === novaBase) return;
    estadoRelatorio.baseMediaProd12m = novaBase;

    document.getElementById('btn-prod-media-ativos')?.classList.toggle('active', novaBase === 'ativos');
    document.getElementById('btn-prod-media-corridos')?.classList.toggle('active', novaBase === 'corridos');

    if (estadoRelatorio.cacheProd12m) {
        atualizarKPIsETabelaProdutos12m(estadoRelatorio.cacheProd12m);
    } else {
        renderizarRelatorioProdutos12Meses();
    }
}

function calcularDadosProdutosMensal(mes, ano, filtroChave) {
    const chaveCache = `${ano}-${mes}-${filtroChave}`;
    if (estadoRelatorio.cacheProdMensal && estadoRelatorio.chaveCacheProdMensal === chaveCache) {
        return estadoRelatorio.cacheProdMensal;
    }

    const indice = obterIndicePedidosNormalizados();
    const mapaConsolidado = new Map();

    let totalPecas = 0, qtdEncomenda = 0, qtdPronta = 0;
    let recTotal = 0, recEncomenda = 0, recPronta = 0;

    for (let i = 0; i < indice.length; i++) {
        const p = indice[i];
        if (p.mes !== mes || p.ano !== ano) continue;

        for (let j = 0; j < p.itens.length; j++) {
            const item = p.itens[j];
            if (filtroChave !== '__TODOS__' && item.chave !== filtroChave) continue;

            let reg = mapaConsolidado.get(item.chave);
            if (!reg) {
                reg = {
                    chave: item.chave,
                    nome: item.nomeExibicao,
                    qtdTotal: 0,
                    qtdEncomenda: 0,
                    qtdPronta: 0,
                    receitaTotal: 0
                };
                mapaConsolidado.set(item.chave, reg);
            }

            reg.qtdTotal += item.quantidade;
            reg.receitaTotal += item.receita;
            totalPecas += item.quantidade;
            recTotal += item.receita;

            if (item.canal === 'pronta') {
                reg.qtdPronta += item.quantidade;
                qtdPronta += item.quantidade;
                recPronta += item.receita;
            } else {
                reg.qtdEncomenda += item.quantidade;
                qtdEncomenda += item.quantidade;
                recEncomenda += item.receita;
            }
        }
    }

    const listaOrdenada = Array.from(mapaConsolidado.values()).sort((a, b) => {
        if (b.qtdTotal !== a.qtdTotal) return b.qtdTotal - a.qtdTotal;
        return b.receitaTotal - a.receitaTotal;
    });

    const resultado = {
        listaOrdenada,
        totalPecas,
        qtdEncomenda,
        qtdPronta,
        recTotal,
        recEncomenda,
        recPronta
    };

    estadoRelatorio.cacheProdMensal = resultado;
    estadoRelatorio.chaveCacheProdMensal = chaveCache;
    return resultado;
}

function renderizarRelatorioProdutosMensal() {
    const mes = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const ano = parseInt(document.getElementById('relatorio-ano')?.value ?? new Date().getFullYear(), 10);
    const dados = calcularDadosProdutosMensal(mes, ano, estadoRelatorio.filtroProduto);

    const { listaOrdenada, totalPecas, qtdEncomenda, qtdPronta, recTotal, recEncomenda, recPronta } = dados;
    const campeao = listaOrdenada[0] || null;

    const pctEnc = totalPecas > 0 ? Math.round((qtdEncomenda / totalPecas) * 100) : 0;
    const pctPro = totalPecas > 0 ? (100 - pctEnc) : 0;

    atualizarTextoElemento('kpi-prod-mes-pecas', totalPecas, false);
    atualizarTextoElemento('sub-prod-mes-skus', `${listaOrdenada.length} produto(s) com saída`, false);

    atualizarTextoElemento('kpi-prod-mes-encomenda', `${qtdEncomenda} un.`, false);
    atualizarTextoElemento('sub-prod-mes-encomenda', `${pctEnc}% (${utils.formatarMoeda(recEncomenda)})`, false);

    atualizarTextoElemento('kpi-prod-mes-pronta', `${qtdPronta} un.`, false);
    atualizarTextoElemento('sub-prod-mes-pronta', `${pctPro}% (${utils.formatarMoeda(recPronta)})`, false);

    atualizarTextoElemento('kpi-prod-mes-campeao', campeao ? campeao.nome : '-', false);
    atualizarTextoElemento('sub-prod-mes-campeao', campeao ? `${campeao.qtdTotal} un. (${utils.formatarMoeda(campeao.receitaTotal)})` : 'Sem vendas no mês', false);

    atualizarTextoElemento('kpi-prod-mes-receita', recTotal, true);

    definirLarguraBarra('barra-canal-encomenda', pctEnc);
    definirLarguraBarra('barra-canal-pronta', pctPro);

    // Insight Automático de Canal para a Artesã
    const boxInsight = document.getElementById('insight-produtos-mensal');
    if (boxInsight) {
        if (totalPecas > 0 && campeao) {
            boxInsight.style.display = 'block';
            const canalPredominante = qtdPronta > qtdEncomenda ? 'Pronta-Entrega (Estoque)' : 'Sob Encomenda (Orçamento)';
            boxInsight.innerHTML = `✨ <strong>Destaque do Mês:</strong> A peça <strong>${escaparHTML(campeao.nome)}</strong> liderou com ${campeao.qtdTotal} unidades. O canal principal foi <strong>${canalPredominante}</strong>.`;
        } else {
            boxInsight.style.display = 'none';
        }
    }

    renderizarGraficoRankingMensalProdutos(dados);

    // Renderização da Tabela Mensal de Produtos
    const tbody = document.querySelector('#tabela-produtos-mensal tbody');
    if (tbody) {
        tbody.innerHTML = '';
        if (listaOrdenada.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #777;">Nenhuma peça vendida neste mês para o filtro selecionado.</td></tr>';
        } else {
            const frag = document.createDocumentFragment();
            listaOrdenada.forEach(item => {
                const ticketMedio = item.qtdTotal > 0 ? (item.receitaTotal / item.qtdTotal) : 0;
                const tr = document.createElement('tr');
                tr.className = 'linha-mes-clicavel';
                tr.dataset.chaveProduto = item.chave;
                tr.title = 'Clique para filtrar ou limpar o filtro deste produto';

                tr.innerHTML = `
                    <td><strong>${escaparHTML(item.nome)}</strong></td>
                    <td style="text-align:center; font-weight:bold;">${item.qtdTotal}</td>
                    <td style="text-align:center;"><span class="badge-canal-mini badge-encomenda">${item.qtdEncomenda} un.</span></td>
                    <td style="text-align:center;"><span class="badge-canal-mini badge-pronta">${item.qtdPronta} un.</span></td>
                    <td>${utils.formatarMoeda(ticketMedio)}</td>
                    <td style="color:#ff9800; font-weight:bold;">${utils.formatarMoeda(item.receitaTotal)}</td>
                `;
                frag.appendChild(tr);
            });
            tbody.appendChild(frag);
        }
    }
}

function renderizarGraficoRankingMensalProdutos(dados) {
    const container = document.getElementById('grafico-ranking-produtos-mes');
    const boxBtnExpandir = document.getElementById('container-btn-expandir-ranking');
    const btnExpandir = document.getElementById('btn-expandir-ranking-mes');
    if (!container) return;

    container.innerHTML = '';
    const { listaOrdenada } = dados;

    if (listaOrdenada.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#888; padding:15px;">Nenhuma saída registrada para exibir no gráfico.</p>';
        if (boxBtnExpandir) boxBtnExpandir.style.display = 'none';
        return;
    }

    const usarValor = estadoRelatorio.metricaProduto === 'valor';
    const limitePadrao = 8;
    const itensExibidos = estadoRelatorio.rankingMensalExpandido
        ? listaOrdenada
        : listaOrdenada.slice(0, limitePadrao);

    if (boxBtnExpandir && btnExpandir) {
        if (listaOrdenada.length > limitePadrao) {
            boxBtnExpandir.style.display = 'block';
            btnExpandir.textContent = estadoRelatorio.rankingMensalExpandido
                ? 'Mostrar apenas o Top 8'
                : `Mostrar todos os ${listaOrdenada.length} produtos no gráfico`;
        } else {
            boxBtnExpandir.style.display = 'none';
        }
    }

    const maiorBase = itensExibidos.reduce(
        (max, item) => Math.max(max, usarValor ? item.receitaTotal : item.qtdTotal),
        0
    );

    const frag = document.createDocumentFragment();

    itensExibidos.forEach((item, idx) => {
        const valorMetrica = usarValor ? item.receitaTotal : item.qtdTotal;
        const larguraTotalPct = maiorBase > 0 ? Math.max((valorMetrica / maiorBase) * 100, 6) : 0;
        const fatiaEncPct = item.qtdTotal > 0 ? (item.qtdEncomenda / item.qtdTotal) * 100 : 0;
        const fatiaProPct = 100 - fatiaEncPct;

        const row = document.createElement('div');
        row.className = `ranking-prod-row ${estadoRelatorio.filtroProduto === item.chave ? 'selecionado' : ''}`;
        row.dataset.chaveProduto = item.chave;

        const textoValor = usarValor
            ? `${utils.formatarMoeda(item.receitaTotal)} (${item.qtdTotal} un.)`
            : `${item.qtdTotal} un. (${utils.formatarMoeda(item.receitaTotal)})`;

        row.innerHTML = `
            <div class="ranking-prod-header">
                <span>${idx + 1}º ${escaparHTML(item.nome)}</span>
                <span class="ranking-prod-meta">${escaparHTML(textoValor)}</span>
            </div>
            <div class="ranking-prod-bar-track">
                <div style="width: ${larguraTotalPct}%; display: flex; height: 100%;">
                    <div class="segmento-encomenda" style="width: ${fatiaEncPct}%" title="Sob Encomenda: ${item.qtdEncomenda} un."></div>
                    <div class="segmento-pronta" style="width: ${fatiaProPct}%" title="Pronta-Entrega: ${item.qtdPronta} un."></div>
                </div>
            </div>
        `;
        frag.appendChild(row);
    });

    container.appendChild(frag);
}

function calcularDadosProdutos12Meses(mesRef, anoRef, filtroChave) {
    const chaveCache = `${anoRef}-${mesRef}-${filtroChave}`;
    if (estadoRelatorio.cacheProd12m && estadoRelatorio.chaveCacheProd12m === chaveCache) {
        return estadoRelatorio.cacheProd12m;
    }

    const indice = obterIndicePedidosNormalizados();
    const janelaMeses = [];
    const mapaSlots = new Map();
    const mapaAnualProdutos = new Map();

    for (let i = 11; i >= 0; i--) {
        const d = new Date(anoRef, mesRef - i, 1);
        const m = d.getMonth();
        const a = d.getFullYear();
        const slot = {
            mes: m,
            ano: a,
            labelCurto: `${NOMES_MESES_CURTO[m]}/${String(a).slice(-2)}`,
            qtdTotal: 0,
            qtdEncomenda: 0,
            qtdPronta: 0,
            recTotal: 0,
            recEncomenda: 0,
            recPronta: 0
        };
        janelaMeses.push(slot);
        mapaSlots.set(`${a}-${m}`, slot);
    }

    for (let i = 0; i < indice.length; i++) {
        const p = indice[i];
        const slot = mapaSlots.get(`${p.ano}-${p.mes}`);
        if (!slot) continue;

        for (let j = 0; j < p.itens.length; j++) {
            const item = p.itens[j];
            if (filtroChave !== '__TODOS__' && item.chave !== filtroChave) continue;

            slot.qtdTotal += item.quantidade;
            slot.recTotal += item.receita;

            if (item.canal === 'pronta') {
                slot.qtdPronta += item.quantidade;
                slot.recPronta += item.receita;
            } else {
                slot.qtdEncomenda += item.quantidade;
                slot.recEncomenda += item.receita;
            }

            let regAnual = mapaAnualProdutos.get(item.chave);
            if (!regAnual) {
                regAnual = {
                    chave: item.chave,
                    nome: item.nomeExibicao,
                    qtdTotal: 0,
                    qtdEncomenda: 0,
                    qtdPronta: 0,
                    receitaTotal: 0
                };
                mapaAnualProdutos.set(item.chave, regAnual);
            }

            regAnual.qtdTotal += item.quantidade;
            regAnual.receitaTotal += item.receita;
            if (item.canal === 'pronta') regAnual.qtdPronta += item.quantidade;
            else regAnual.qtdEncomenda += item.quantidade;
        }
    }

    let somaQtd = 0, somaEnc = 0, somaPro = 0, somaRec = 0, mesesAtivos = 0;
    janelaMeses.forEach(m => {
        somaQtd += m.qtdTotal;
        somaEnc += m.qtdEncomenda;
        somaPro += m.qtdPronta;
        somaRec += m.recTotal;
        if (m.qtdTotal > 0) mesesAtivos++;
    });

    const rankingAnual = Array.from(mapaAnualProdutos.values()).sort((a, b) => {
        if (b.qtdTotal !== a.qtdTotal) return b.qtdTotal - a.qtdTotal;
        return b.receitaTotal - a.receitaTotal;
    });

    const resultado = {
        janelaMeses,
        rankingAnual,
        somaQtd,
        somaEnc,
        somaPro,
        somaRec,
        mesesAtivos
    };

    estadoRelatorio.cacheProd12m = resultado;
    estadoRelatorio.chaveCacheProd12m = chaveCache;
    return resultado;
}

function renderizarRelatorioProdutos12Meses() {
    const mesRef = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const anoRef = parseInt(document.getElementById('relatorio-ano')?.value ?? new Date().getFullYear(), 10);

    const dados = calcularDadosProdutos12Meses(mesRef, anoRef, estadoRelatorio.filtroProduto);

    const labelIntervalo = document.getElementById('label-intervalo-prod-12m');
    if (labelIntervalo && dados.janelaMeses.length === 12) {
        labelIntervalo.textContent = `Período: ${dados.janelaMeses[0].labelCurto} a ${dados.janelaMeses[11].labelCurto}`;
    }

    const badgeAtivos = document.getElementById('badge-meses-ativos-prod');
    if (badgeAtivos) {
        badgeAtivos.textContent = `${dados.mesesAtivos} de 12 meses com saídas`;
    }

    const tituloGrafico = document.getElementById('titulo-grafico-prod-12m');
    if (tituloGrafico) {
        const nomeFiltro = estadoRelatorio.filtroProduto === '__TODOS__'
            ? 'Todos os Produtos'
            : (estadoRelatorio.catalogoProdutosMap?.get(estadoRelatorio.filtroProduto) || 'Produto Selecionado');
        tituloGrafico.textContent = `Evolução 12 Meses — ${nomeFiltro}`;
    }

    atualizarKPIsETabelaProdutos12m(dados);
    renderizarGraficoColunasProdutos12m(dados);
}

function atualizarKPIsETabelaProdutos12m(dados) {
    const { rankingAnual, somaQtd, somaEnc, somaPro, somaRec, mesesAtivos } = dados;

    const usarAtivos = estadoRelatorio.baseMediaProd12m === 'ativos';
    const divisor = usarAtivos ? (mesesAtivos > 0 ? mesesAtivos : 1) : 12;
    const sufixoBase = usarAtivos
        ? `${mesesAtivos} ${mesesAtivos === 1 ? 'mês ativo' : 'meses ativos'}`
        : '12 meses fixos';

    const pctEnc = somaQtd > 0 ? Math.round((somaEnc / somaQtd) * 100) : 0;
    const pctPro = somaQtd > 0 ? (100 - pctEnc) : 0;

    atualizarTextoElemento('kpi-prod-12m-qtd', `${(somaQtd / divisor).toFixed(1).replace('.', ',')} un.`, false);
    atualizarTextoElemento('acum-prod-12m-qtd', `Total: ${somaQtd} un. (${sufixoBase})`, false);

    atualizarTextoElemento('kpi-prod-12m-encomenda', `${(somaEnc / divisor).toFixed(1).replace('.', ',')} un.`, false);
    atualizarTextoElemento('acum-prod-12m-encomenda', `Acumulado: ${somaEnc} un. (${pctEnc}%)`, false);

    atualizarTextoElemento('kpi-prod-12m-pronta', `${(somaPro / divisor).toFixed(1).replace('.', ',')} un.`, false);
    atualizarTextoElemento('acum-prod-12m-pronta', `Acumulado: ${somaPro} un. (${pctPro}%)`, false);

    atualizarTextoElemento('kpi-prod-12m-receita', somaRec / divisor, true);
    atualizarTextoElemento('acum-prod-12m-receita', `Acumulado: ${utils.formatarMoeda(somaRec)}`, false);

    // Tabela de Ranking Consolidado 12m
    const tbody12m = document.querySelector('#tabela-produtos-12m tbody');
    const tfoot12m = document.querySelector('#tabela-produtos-12m tfoot');

    if (tbody12m) {
        tbody12m.innerHTML = '';
        if (rankingAnual.length === 0) {
            tbody12m.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #777;">Nenhuma saída registrada nos últimos 12 meses.</td></tr>';
        } else {
            const frag = document.createDocumentFragment();
            rankingAnual.forEach((item, idx) => {
                const pEnc = item.qtdTotal > 0 ? Math.round((item.qtdEncomenda / item.qtdTotal) * 100) : 0;
                const pPro = item.qtdTotal > 0 ? (100 - pEnc) : 0;
                const tr = document.createElement('tr');
                tr.className = 'linha-mes-clicavel';
                tr.dataset.chaveProduto = item.chave;
                tr.title = 'Clique para focar a evolução de 12 meses neste produto';

                tr.innerHTML = `
                    <td><strong>${idx + 1}º</strong></td>
                    <td><strong>${escaparHTML(item.nome)}</strong></td>
                    <td style="text-align:center; font-weight:bold;">${item.qtdTotal} un.</td>
                    <td style="text-align:center;">${(item.qtdTotal / divisor).toFixed(1).replace('.', ',')}</td>
                    <td style="text-align:center;"><span class="badge-canal-mini badge-encomenda">${item.qtdEncomenda} (${pEnc}%)</span></td>
                    <td style="text-align:center;"><span class="badge-canal-mini badge-pronta">${item.qtdPronta} (${pPro}%)</span></td>
                    <td style="color:#ff9800; font-weight:bold;">${utils.formatarMoeda(item.receitaTotal)}</td>
                `;
                frag.appendChild(tr);
            });
            tbody12m.appendChild(frag);
        }
    }

    if (tfoot12m) {
        tfoot12m.innerHTML = `
            <tr class="linha-media-anual">
                <td colspan="2">MÉDIA MENSAL (${escaparHTML(sufixoBase.toUpperCase())})</td>
                <td style="text-align:center;">${(somaQtd / divisor).toFixed(1).replace('.', ',')} un.</td>
                <td style="text-align:center;">-</td>
                <td style="text-align:center; color:#ad6a63;">${(somaEnc / divisor).toFixed(1).replace('.', ',')} un.</td>
                <td style="text-align:center; color:#00796b;">${(somaPro / divisor).toFixed(1).replace('.', ',')} un.</td>
                <td style="color:#ff9800;">${utils.formatarMoeda(somaRec / divisor)}</td>
            </tr>
            <tr class="linha-total-anual">
                <td colspan="2">ACUMULADO (12 MESES)</td>
                <td style="text-align:center;">${somaQtd} un.</td>
                <td style="text-align:center;">100%</td>
                <td style="text-align:center; color:#ad6a63;">${somaEnc} un. (${pctEnc}%)</td>
                <td style="text-align:center; color:#00796b;">${somaPro} un. (${pctPro}%)</td>
                <td style="color:#ff9800;">${utils.formatarMoeda(somaRec)}</td>
            </tr>
        `;
    }
}

function renderizarGraficoColunasProdutos12m(dados) {
    const container = document.getElementById('grafico-colunas-prod-12m');
    if (!container) return;

    container.innerHTML = '';
    const { janelaMeses } = dados;
    const usarValor = estadoRelatorio.metricaProduto === 'valor';
    const alturaMaximaPx = 175;

    const maiorPico = janelaMeses.reduce(
        (max, m) => Math.max(max, usarValor ? m.recTotal : m.qtdTotal),
        0
    );

    const frag = document.createDocumentFragment();

    janelaMeses.forEach(m => {
        const valorBase = usarValor ? m.recTotal : m.qtdTotal;
        const proporcao = maiorPico > 0 ? (valorBase / maiorPico) : 0;
        const alturaPx = Math.max(proporcao * alturaMaximaPx, 4);

        const pEnc = m.qtdTotal > 0 ? (m.qtdEncomenda / m.qtdTotal) * 100 : 0;
        const pPro = m.qtdTotal > 0 ? (100 - pEnc) : 0;

        const semVenda = m.qtdTotal === 0;
        const labelTopo = semVenda
            ? '-'
            : (usarValor ? `R$ ${Math.round(m.recTotal).toLocaleString('pt-BR')}` : `${m.qtdTotal} un`);

        const col = document.createElement('div');
        col.className = `coluna-mes-item ${semVenda ? 'mes-sem-venda' : ''}`;
        col.dataset.mes = String(m.mes);
        col.dataset.ano = String(m.ano);

        col.innerHTML = `
            <div class="tooltip-mes-12m">
                <strong>${escaparHTML(m.labelCurto)} (${m.qtdTotal} peças)</strong><br>
                Sob Encomenda: ${m.qtdEncomenda} un.<br>
                Pronta-Entrega: ${m.qtdPronta} un.<br>
                <strong>Receita: ${utils.formatarMoeda(m.recTotal)}</strong>
                ${!semVenda ? '<br><em style="color:#80cbc4; font-size:0.7rem;">Clique para ver detalhes do mês</em>' : ''}
            </div>
            <span class="valor-topo-barra">${escaparHTML(labelTopo)}</span>
            <div class="barra-vertical-pilha" style="height: ${alturaPx}px;">
                <div class="seg-v-encomenda" style="height: ${pEnc}%;"></div>
                <div class="seg-v-pronta" style="height: ${pPro}%;"></div>
            </div>
            <span class="mes-label-eixo">${escaparHTML(m.labelCurto)}</span>
        `;
        frag.appendChild(col);
    });

    container.appendChild(frag);

    const scrollWrapper = document.getElementById('grafico-prod-scroll-wrapper');
    if (scrollWrapper && scrollWrapper.scrollWidth > scrollWrapper.clientWidth) {
        scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
    }
}

// ==========================================================================
// 8. EXPORTAÇÃO PARA EXCEL (.XLSX) - FINANCEIRO E PRODUTOS
// ==========================================================================

function exportarRelatorioXLSX(dominio = 'financeiro', modo = 'mensal') {
    if (typeof XLSX === 'undefined') {
        utils.showToast('Biblioteca de Excel não encontrada.', 'error');
        return;
    }

    const mes = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const ano = parseInt(document.getElementById('relatorio-ano')?.value ?? new Date().getFullYear(), 10);

    if (dominio === 'produtos') {
        if (modo === '12m') {
            const dados = calcularDadosProdutos12Meses(mes, ano, estadoRelatorio.filtroProduto);
            if (dados.rankingAnual.length === 0) {
                utils.showToast('Não há saídas de produtos no período para exportar.', 'warning');
                return;
            }

            const usarAtivos = estadoRelatorio.baseMediaProd12m === 'ativos';
            const divisor = usarAtivos ? (dados.mesesAtivos > 0 ? dados.mesesAtivos : 1) : 12;

            const linhas = dados.rankingAnual.map((item, idx) => ({
                'Posição': `${idx + 1}º`,
                'Produto': item.nome,
                'Total Peças (12m)': item.qtdTotal,
                'Média / Mês': Number((item.qtdTotal / divisor).toFixed(1)),
                'Qtd Encomenda': item.qtdEncomenda,
                'Qtd Pronta-Entrega': item.qtdPronta,
                'Receita Acumulada s/ Frete (R$)': Number(item.receitaTotal.toFixed(2))
            }));

            const ws = XLSX.utils.json_to_sheet(linhas);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Produtos 12 Meses');
            XLSX.writeFile(wb, `Relatorio_Produtos_12Meses_PerolaRara_${NOMES_MESES_CURTO[mes]}_${ano}.xlsx`);
            utils.showToast('Planilha anual de produtos exportada com sucesso!', 'success');
        } else {
            const dados = calcularDadosProdutosMensal(mes, ano, estadoRelatorio.filtroProduto);
            if (dados.listaOrdenada.length === 0) {
                utils.showToast('Não há saídas de produtos neste mês para exportar.', 'warning');
                return;
            }

            const linhas = dados.listaOrdenada.map((item, idx) => ({
                'Posição': `${idx + 1}º`,
                'Produto': item.nome,
                'Total Qtd': item.qtdTotal,
                'Sob Encomenda': item.qtdEncomenda,
                'Pronta-Entrega': item.qtdPronta,
                'Ticket Médio (R$)': Number((item.qtdTotal > 0 ? item.receitaTotal / item.qtdTotal : 0).toFixed(2)),
                'Receita s/ Frete (R$)': Number(item.receitaTotal.toFixed(2))
            }));

            const ws = XLSX.utils.json_to_sheet(linhas);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Produtos ${NOMES_MESES_CURTO[mes]}-${ano}`);
            XLSX.writeFile(wb, `Relatorio_Produtos_Mensal_PerolaRara_${NOMES_MESES_CURTO[mes]}_${ano}.xlsx`);
            utils.showToast('Planilha mensal de produtos exportada com sucesso!', 'success');
        }
    } else {
        if (modo === '12m') {
            const dados = calcularDados12Meses(mes, ano);
            const linhas = dados.janelaMeses.map(m => ({
                'Mês/Ano': m.labelCurto,
                'Qtd Pedidos': m.qtd,
                'Meu Salário (R$)': Number(m.salario.toFixed(2)),
                'Caixa Empresa (R$)': Number(m.lucro.toFixed(2)),
                'Gastos Produção (R$)': Number(m.custos.toFixed(2)),
                'Total Vendido (R$)': Number(m.total.toFixed(2))
            }));

            const ws = XLSX.utils.json_to_sheet(linhas);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Resumo 12 Meses');
            XLSX.writeFile(wb, `Relatorio_Financeiro_12Meses_PerolaRara_${NOMES_MESES_CURTO[mes]}_${ano}.xlsx`);
            utils.showToast('Planilha financeira de 12 meses exportada com sucesso!', 'success');
        } else {
            const indice = obterIndicePedidosNormalizados();
            const pedidos = indice.filter(p => p.mes === mes && p.ano === ano);

            if (pedidos.length === 0) {
                utils.showToast('Não há pedidos neste mês para exportar.', 'warning');
                return;
            }

            const linhas = pedidos.map(p => ({
                'Data': utils.formatarDataBR(p.dataPedido),
                'Nº Pedido': p.numero,
                'Cliente': p.cliente,
                'Meu Salário (R$)': Number(p.custoMaoDeObra.toFixed(2)),
                'Caixa Empresa (R$)': Number(p.margemLucro.toFixed(2)),
                'Gastos Produção (R$)': Number(p.custosTotais.toFixed(2)),
                'Total Vendido (R$)': Number(p.total.toFixed(2))
            }));

            const ws = XLSX.utils.json_to_sheet(linhas);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Fechamento ${NOMES_MESES_CURTO[mes]}-${ano}`);
            XLSX.writeFile(wb, `Relatorio_Financeiro_Mensal_PerolaRara_${NOMES_MESES_CURTO[mes]}_${ano}.xlsx`);
            utils.showToast('Planilha financeira mensal exportada com sucesso!', 'success');
        }
    }
}