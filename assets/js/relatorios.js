// assets/js/relatorios.js
import { utils } from './utils.js';

// ==========================================================================
// ESTADO INTERNO E CACHE DO MÓDULO DE RELATÓRIOS
// ==========================================================================
let obterPedidosFn = () => [];

const estadoRelatorio = {
    modoAtivo: 'mensal',       // 'mensal' ou '12m'
    baseMedia12m: 'ativos',    // 'ativos' ou 'corridos'
    ancoraDrillDown: null,     // { mes, ano, label } quando em modo Drill-Down
    cache12m: null,            // Cache estrutural da última agregação de 12 meses
    chaveCache12m: '',         // Chave 'ano-mes' para validação de cache
    alertasExibidosSessao: new Set() // Evita popups repetitivos do modal de alerta no mesmo mês
};

const NOMES_MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ==========================================================================
// 1. INICIALIZAÇÃO E INJEÇÃO DE DEPENDÊNCIA
// ==========================================================================

export function setupRelatorios(config) {
    if (config && typeof config.getPedidos === 'function') {
        obterPedidosFn = config.getPedidos;
    }

    popularSelectAnosRelatorio();
    inicializarListenersRelatorio();

    // Aliases de retrocompatibilidade seguros
    window.gerarRelatorioFinanceiro = () => renderizarRelatorioMensal(false);
    window.gerarRelatorioXLSX = () => exportarRelatorioXLSX(estadoRelatorio.modoAtivo);
}

export function invalidarCacheRelatorios() {
    estadoRelatorio.cache12m = null;
    estadoRelatorio.chaveCache12m = '';

    // Se a tela de relatório estiver visível no momento, atualiza automaticamente
    const secaoRelatorio = document.getElementById('relatorio');
    if (secaoRelatorio && secaoRelatorio.style.display !== 'none') {
        acionarRelatorioAtivo( true );
    }
}

// ==========================================================================
// 2. CONFIGURAÇÃO DE DOM E LISTENERS REATIVOS
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
        const pedidos = obterPedidosFn() || [];
        const anosSet = new Set([anoAtual, anoAtual - 1, anoAtual - 2]);

        pedidos.forEach(p => {
            if (p.dataPedido) {
                const anoPed = parseInt(p.dataPedido.split('-')[0], 10);
                if (!isNaN(anoPed) && anoPed > 2000) anosSet.add(anoPed);
            }
        });

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

function inicializarListenersRelatorio() {
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

    const selectMes = document.getElementById('relatorio-mes');
    const selectAno = document.getElementById('relatorio-ano');

    const aoMudarPeriodo = () => {
        estadoRelatorio.ancoraDrillDown = null;
        atualizarBannerDrillDown();
        acionarRelatorioAtivo(false);
    };

    if (selectMes) selectMes.addEventListener('change', aoMudarPeriodo);
    if (selectAno) selectAno.addEventListener('change', aoMudarPeriodo);

    const btnAtivos = document.getElementById('btn-media-ativos');
    const btnCorridos = document.getElementById('btn-media-corridos');

    if (btnAtivos) {
        btnAtivos.addEventListener('click', () => alternarBaseMedia12m('ativos'));
    }
    if (btnCorridos) {
        btnCorridos.addEventListener('click', () => alternarBaseMedia12m('corridos'));
    }

    const containerGrafico = document.getElementById('grafico-colunas-12m');
    if (containerGrafico) {
        containerGrafico.addEventListener('click', (e) => {
            const col = e.target.closest('.coluna-mes-item[data-mes][data-ano]');
            if (!col || col.classList.contains('mes-sem-venda')) return;
            executarDrillDownParaMes(parseInt(col.dataset.mes, 10), parseInt(col.dataset.ano, 10));
        });
    }

    const tbody12m = document.querySelector('#tabela-relatorio-12m tbody');
    if (tbody12m) {
        tbody12m.addEventListener('click', (e) => {
            const tr = e.target.closest('tr.linha-mes-clicavel[data-mes][data-ano]');
            if (!tr) return;
            executarDrillDownParaMes(parseInt(tr.dataset.mes, 10), parseInt(tr.dataset.ano, 10));
        });
    }

    const btnVoltar12m = document.getElementById('btn-voltar-12m');
    if (btnVoltar12m) {
        btnVoltar12m.addEventListener('click', retornarDoDrillDown);
    }

    const btnXlsxMensal = document.getElementById('btn-exportar-xlsx-mensal');
    const btnXlsx12m = document.getElementById('btn-exportar-xlsx-12m');
    if (btnXlsxMensal) btnXlsxMensal.addEventListener('click', () => exportarRelatorioXLSX('mensal'));
    if (btnXlsx12m) btnXlsx12m.addEventListener('click', () => exportarRelatorioXLSX('12m'));

    const linkMenuRelatorio = document.querySelector('nav ul li a[data-pagina="relatorio"]');
    if (linkMenuRelatorio) {
        linkMenuRelatorio.addEventListener('click', () => {
            popularSelectAnosRelatorio();
            acionarRelatorioAtivo(false);
        });
    }
}

// ==========================================================================
// 3. NAVEGAÇÃO ENTRE MODOS E DRILL-DOWN
// ==========================================================================

function alternarModoRelatorio(modo) {
    estadoRelatorio.modoAtivo = modo;

    const btnMensal = document.getElementById('tab-rel-mensal');
    const btn12m = document.getElementById('tab-rel-12m');
    const visaoMensal = document.getElementById('visao-relatorio-mensal');
    const visao12m = document.getElementById('visao-relatorio-12m');
    const labelFiltro = document.getElementById('label-filtro-relatorio');

    atualizarBannerDrillDown();

    if (modo === '12m') {
        btnMensal?.classList.remove('active');
        btn12m?.classList.add('active');
        if (visaoMensal) visaoMensal.style.display = 'none';
        if (visao12m) visao12m.style.display = 'block';
        if (labelFiltro) labelFiltro.textContent = 'Mês Final do Período:';
        renderizarRelatorio12Meses();
    } else {
        btn12m?.classList.remove('active');
        btnMensal?.classList.add('active');
        if (visao12m) visao12m.style.display = 'none';
        if (visaoMensal) visaoMensal.style.display = 'block';
        if (labelFiltro) labelFiltro.textContent = 'Mês de Referência:';
        renderizarRelatorioMensal(Boolean(estadoRelatorio.ancoraDrillDown));
    }
}

function acionarRelatorioAtivo(silenciarModal = false) {
    if (estadoRelatorio.modoAtivo === '12m') {
        renderizarRelatorio12Meses();
    } else {
        renderizarRelatorioMensal(silenciarModal);
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
        labelAlvo: `${NOMES_MESES_CURTO[mesAlvo]}/${anoAlvo}`
    };

    if (selectMes) selectMes.value = String(mesAlvo);
    if (selectAno) selectAno.value = String(anoAlvo);

    alternarModoRelatorio('mensal');
}

function retornarDoDrillDown() {
    if (!estadoRelatorio.ancoraDrillDown) return;

    const selectMes = document.getElementById('relatorio-mes');
    const selectAno = document.getElementById('relatorio-ano');

    if (selectMes) selectMes.value = String(estadoRelatorio.ancoraDrillDown.mesOrigem);
    if (selectAno) selectAno.value = String(estadoRelatorio.ancoraDrillDown.anoOrigem);

    estadoRelatorio.ancoraDrillDown = null;
    alternarModoRelatorio('12m');
}

function atualizarBannerDrillDown() {
    const banner = document.getElementById('banner-retorno-drilldown');
    const texto = document.getElementById('texto-drilldown-origem');
    if (!banner) return;

    if (estadoRelatorio.modoAtivo === 'mensal' && estadoRelatorio.ancoraDrillDown) {
        if (texto) {
            texto.innerHTML = `🔍 Inspecionando <strong>${estadoRelatorio.ancoraDrillDown.labelAlvo}</strong> a partir do Panorama de 12 Meses`;
        }
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

// ==========================================================================
// 4. MOTOR DO RELATÓRIO MENSAL
// ==========================================================================

function renderizarRelatorioMensal(silenciarModal = false) {
    const pedidos = obterPedidosFn() || [];
    const mes = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const anoSelect = document.getElementById('relatorio-ano');
    const ano = parseInt(anoSelect && anoSelect.value ? anoSelect.value : new Date().getFullYear(), 10);

    let totalFat = 0, totalMO = 0, totalLucro = 0, totalCustos = 0;
    let pedidosComAlerta = 0;

    const tbody = document.querySelector('#tabela-relatorio tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const pedidosFiltrados = pedidos.filter(p => {
        if (!p.dataPedido) return false;
        const parts = p.dataPedido.split('-');
        const pAno = parseInt(parts[0], 10);
        const pMes = parseInt(parts[1], 10) - 1;
        return pMes === mes && pAno === ano;
    });

    const fragment = document.createDocumentFragment();

    pedidosFiltrados.forEach(p => {
        const vTotal = parseFloat(p.total) || 0;
        const vMO = parseFloat(p.custoMaoDeObra) || 0;
        const vLucro = parseFloat(p.margemLucro) || 0;
        const vCustos = parseFloat(p.custosTotais) || 0;

        totalFat += vTotal;
        totalMO += vMO;
        totalLucro += vLucro;
        totalCustos += vCustos;

        if ((vCustos + vMO + vLucro) === 0) {
            pedidosComAlerta++;
        }

        const tr = document.createElement('tr');
        const nomeCliente = (p.cliente && p.cliente.length > 15) ? p.cliente.substring(0, 15) + '...' : (p.cliente || '-');

        tr.innerHTML = `
            <td>${utils.formatarDataBR(p.dataPedido).substring(0, 5)}</td>
            <td class="col-oculta-mobile">${p.numero || '-'}</td>
            <td><span title="${p.cliente || ''}">${nomeCliente}</span></td>
            <td style="color:#2196F3; font-weight:bold;">${utils.formatarMoeda(vMO)}</td>
            <td style="color:#4CAF50; font-weight:bold;">${utils.formatarMoeda(vLucro)}</td>
            <td style="color:#e53935; font-weight:bold;">${utils.formatarMoeda(vCustos)}</td>
            <td style="color:#ff9800; font-weight:bold;">${utils.formatarMoeda(vTotal)}</td>
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

    const valorDizimo = (totalMO + totalLucro) * 0.10;
    atualizarTextoElemento('kpi-dizimo', valorDizimo);

    const modalAlerta = document.getElementById('modal-alerta-financeiro');
    const spanQtd = document.getElementById('qtd-pedidos-incompletos');
    const chaveMes = `${ano}-${mes}`;

    if (!silenciarModal && pedidosFiltrados.length > 0 && pedidosComAlerta > 0 && modalAlerta && !estadoRelatorio.alertasExibidosSessao.has(chaveMes)) {
        estadoRelatorio.alertasExibidosSessao.add(chaveMes);
        if (spanQtd) spanQtd.textContent = pedidosComAlerta;
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

// ==========================================================================
// 5. MOTOR DO RELATÓRIO DE 12 MESES (AGREGAÇÃO O(N) + RENDERIZAÇÃO PARCIAL)
// ==========================================================================

function alternarBaseMedia12m(novaBase) {
    if (estadoRelatorio.baseMedia12m === novaBase) return;
    estadoRelatorio.baseMedia12m = novaBase;

    const btnAtivos = document.getElementById('btn-media-ativos');
    const btnCorridos = document.getElementById('btn-media-corridos');

    if (novaBase === 'ativos') {
        btnCorridos?.classList.remove('active');
        btnAtivos?.classList.add('active');
    } else {
        btnAtivos?.classList.remove('active');
        btnCorridos?.classList.add('active');
    }

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

    const pedidos = obterPedidosFn() || [];
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

    pedidos.forEach(p => {
        if (!p.dataPedido) return;
        const partes = p.dataPedido.split('-');
        if (partes.length < 2) return;

        const pAno = parseInt(partes[0], 10);
        const pMes = parseInt(partes[1], 10) - 1;
        const slot = mapaSlots.get(`${pAno}-${pMes}`);

        if (slot) {
            slot.qtd += 1;
            slot.salario += (parseFloat(p.custoMaoDeObra) || 0);
            slot.lucro += (parseFloat(p.margemLucro) || 0);
            slot.custos += (parseFloat(p.custosTotais) || 0);
            slot.total += (parseFloat(p.total) || 0);
        }
    });

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
    const anoSelect = document.getElementById('relatorio-ano');
    const anoRef = parseInt(anoSelect && anoSelect.value ? anoSelect.value : new Date().getFullYear(), 10);

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
                <td>MÉDIA MENSAL (${sufixoBase.toUpperCase()})</td>
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
            colunaEl.dataset.mes = m.mes;
            colunaEl.dataset.ano = m.ano;

            colunaEl.innerHTML = `
                <div class="tooltip-mes-12m">
                    <strong>${m.labelCurto} (${m.qtd} ped.)</strong><br>
                    Salário: ${utils.formatarMoeda(m.salario)}<br>
                    Caixa: ${utils.formatarMoeda(m.lucro)}<br>
                    Gastos: ${utils.formatarMoeda(m.custos)}<br>
                    <strong>Total: ${utils.formatarMoeda(m.total)}</strong>
                    ${!semVenda ? '<br><em style="color:#80cbc4; font-size:0.7rem;">Clique para ver os pedidos</em>' : ''}
                </div>
                <span class="valor-topo-barra">${valorTopo}</span>
                <div class="barra-vertical-pilha" style="height: ${alturaBarraPx}px;">
                    <div class="seg-v-gastos" style="height: ${pctCustos}%;"></div>
                    <div class="seg-v-salario" style="height: ${pctSalario}%;"></div>
                    <div class="seg-v-caixa" style="height: ${pctLucro}%;"></div>
                </div>
                <span class="mes-label-eixo">${m.labelCurto}</span>
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
                tr.dataset.mes = m.mes;
                tr.dataset.ano = m.ano;
                tr.title = `Clique para abrir o fechamento de ${m.labelCurto}`;
            } else {
                tr.style.opacity = '0.55';
            }

            tr.innerHTML = `
                <td><strong>${m.labelCurto}</strong> ${m.qtd > 0 ? '<small style="color:#7aa2a9;">🔍</small>' : ''}</td>
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
// 6. EXPORTAÇÃO REAL PARA EXCEL (.XLSX)
// ==========================================================================

function exportarRelatorioXLSX(modo = 'mensal') {
    if (typeof XLSX === 'undefined') {
        utils.showToast('Biblioteca de Excel não encontrada.', 'error');
        return;
    }

    const mes = parseInt(document.getElementById('relatorio-mes')?.value ?? new Date().getMonth(), 10);
    const ano = parseInt(document.getElementById('relatorio-ano')?.value ?? new Date().getFullYear(), 10);

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
        XLSX.writeFile(wb, `Relatorio_12Meses_PerolaRara_${NOMES_MESES_CURTO[mes]}_${ano}.xlsx`);
        utils.showToast('Planilha de 12 meses exportada com sucesso!', 'success');
    } else {
        const pedidos = (obterPedidosFn() || []).filter(p => {
            if (!p.dataPedido) return false;
            const parts = p.dataPedido.split('-');
            return (parseInt(parts[1], 10) - 1) === mes && parseInt(parts[0], 10) === ano;
        });

        if (pedidos.length === 0) {
            utils.showToast('Não há pedidos neste mês para exportar.', 'warning');
            return;
        }

        const linhas = pedidos.map(p => ({
            'Data': utils.formatarDataBR(p.dataPedido),
            'Nº Pedido': p.numero || '-',
            'Cliente': p.cliente || '-',
            'Meu Salário (R$)': Number((parseFloat(p.custoMaoDeObra) || 0).toFixed(2)),
            'Caixa Empresa (R$)': Number((parseFloat(p.margemLucro) || 0).toFixed(2)),
            'Gastos Produção (R$)': Number((parseFloat(p.custosTotais) || 0).toFixed(2)),
            'Total Vendido (R$)': Number((parseFloat(p.total) || 0).toFixed(2))
        }));

        const ws = XLSX.utils.json_to_sheet(linhas);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Fechamento ${NOMES_MESES_CURTO[mes]}-${ano}`);
        XLSX.writeFile(wb, `Relatorio_Mensal_PerolaRara_${NOMES_MESES_CURTO[mes]}_${ano}.xlsx`);
        utils.showToast('Planilha mensal exportada com sucesso!', 'success');
    }
}

// Helpers internos de UI
function atualizarTextoElemento(id, valor, isMoeda = true) {
    const el = document.getElementById(id);
    if (el) el.textContent = isMoeda ? utils.formatarMoeda(valor) : valor;
}

function definirLarguraBarra(id, percentual) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(Math.max(percentual, 0), 100)}%`;
}
