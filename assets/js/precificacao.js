// assets/js/precificacao.js

// 1. IMPORTAÇÕES DE INFRAESTRUTURA
import { db, auth } from './firebase-config.js';
import { 
    collection, doc, addDoc, getDocs, setDoc, deleteDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 2. IMPORTAÇÕES DOS MÓDULOS DE DADOS (INSUMOS E PRODUTOS)
import { 
    // Dados e Funções de Insumos
    maoDeObra, 
    custosIndiretosPredefinidos, 
    custosIndiretosAdicionais,
    carregarDadosInsumos,
    formatarMoeda, // Utilitário compartilhado
    setOnMaterialUpdateCallback, // Para registrar a reação à mudança de preços
    initListenersInsumos,
    // CRUDs de Insumos (UI)
    cadastrarMaterialInsumo,
    salvarMaoDeObra,
    editarMaoDeObraUI,
    adicionarNovoCustoIndireto,
    toggleCamposMaterial // Usado no HTML onclick
} from './precificacao-insumos.js';

import {
    // Dados e Funções de Produtos (NOVO)
    produtos,
    carregarProdutos,
    initListenersProdutos,
    editarProduto,  // Exposto para o window
    removerProduto, // Exposto para o window
    atualizarCustosProdutosPorMaterial // Callback
} from './precificacao-produtos.js';

// 3. VARIÁVEIS DE ESTADO LOCAIS (Dashboard e Histórico)
let precificacoesGeradas = [];
let taxaCredito = { percentual: 6, incluir: false };
let moduleInitialized = false;
let searchIndex = -1; // Controle da navegação por teclado na busca
let margemLucroPadrao = 50;

// Variáveis de Paginação (Histórico)
let pagAtualHist = 1;
const ITENS_POR_PAGINA = 10;
let termoBuscaHist = "";

// ==========================================================================
// 4. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================
export async function initPrecificacao() {
    console.log("Inicializando Módulo Precificação (Refatorado - V2)...");
    
    // EXPOR FUNÇÕES AO ESCOPO GLOBAL (WINDOW)
    // Funções de Insumos
    window.editarMaterialInsumo = window.editarMaterialInsumo; // Já exposto no insumos.js, mas reforçando se necessário
    window.removerMaterialInsumo = window.removerMaterialInsumo;
    
    // Funções de Produtos (Vindas do novo módulo)
    window.editarProduto = editarProduto;
    window.removerProduto = removerProduto;
    
    // Funções de Histórico (Locais)
    window.buscarPrecificacoesGeradas = atualizarTabelaPrecificacoesGeradas;
    window.visualizarPrecificacao = visualizarPrecificacao;
    window.removerPrecificacao = removerPrecificacao;

    // Configura o Callback: Quando um material mudar, avisa o módulo de produtos
    setOnMaterialUpdateCallback(atualizarCustosProdutosPorMaterial);

    await carregarDadosCompletos();
    
    if (!moduleInitialized) {
        setupEventListeners();
        moduleInitialized = true;
    }
}

async function carregarDadosCompletos() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        // Carregamento Paralelo para Performance
        await Promise.all([
            carregarDadosInsumos(), // Insumos.js
            carregarProdutos()      // Produtos.js
        ]);

        // Carrega Configurações Locais e Histórico
        const taxaDoc = await getDoc(doc(db, "configuracoes", "taxaCredito"));
        if (taxaDoc.exists()) taxaCredito = { ...taxaCredito, ...taxaDoc.data() };

        const precSnap = await getDocs(collection(db, "precificacoes-geradas"));
        precificacoesGeradas = [];
        precSnap.forEach(d => precificacoesGeradas.push({id: d.id, ...d.data()}));

        // Atualizar UI
        atualizarTabelaPrecificacoesGeradas();
        
        // Restaurar inputs de cálculo na tela
        const margemInput = document.getElementById('margem-lucro-final');
        if(margemInput) margemInput.value = margemLucroPadrao;
        
        const taxaInput = document.getElementById('taxa-credito-percentual');
        if(taxaInput) taxaInput.value = taxaCredito.percentual;
        
        if(taxaCredito.incluir) {
            const radioSim = document.getElementById('incluir-taxa-credito-sim');
            if(radioSim) radioSim.checked = true;
        } else {
            const radioNao = document.getElementById('incluir-taxa-credito-nao');
            if(radioNao) radioNao.checked = true;
        }

    } catch (e) {
        console.error("Erro crítico ao carregar dados:", e);
    }
}

// ==========================================================================
// 5. EVENT LISTENERS E NAVEGAÇÃO
// ==========================================================================

function debounce(func, timeout = 300) {
    let timer;
    return function(...args) {
        const context = this;
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(context, args), timeout);
    };
}

function setupEventListeners() {
    // 1. Navegação entre Abas
    document.querySelectorAll('#module-precificacao nav ul li a.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            mostrarSubMenu(link.dataset.submenu);
        });
    });

    // 2. Inicializa Listeners dos Sub-módulos
    initListenersInsumos(); // Insumos.js
    initListenersProdutos(); // Produtos.js (NOVO)

    // 3. Listeners Manuais de Insumos (Legado/UI)
    bindClick('#cadastrar-material-insumo-btn', cadastrarMaterialInsumo);
    document.querySelectorAll('input[name="tipo-material"]').forEach(radio => {
        radio.addEventListener('change', function() { toggleCamposMaterial(this.value); });
    });
    bindClick('#btn-salvar-mao-de-obra', salvarMaoDeObra);
    bindClick('#btn-editar-mao-de-obra', editarMaoDeObraUI);
    bindClick('#adicionarCustoIndiretoBtn', adicionarNovoCustoIndireto);

    // Listeners para cálculo em tempo real da Mão de Obra
    const inputSalario = document.getElementById('salario-receber');
    const inputHoras = document.getElementById('horas-trabalhadas');
    const radiosEncargos = document.querySelectorAll('input[name="incluir-ferias-13o"]');
    
    if(inputSalario) inputSalario.addEventListener('input', calcularMaoDeObraTempoReal);
    if(inputHoras) inputHoras.addEventListener('input', calcularMaoDeObraTempoReal);
    radiosEncargos.forEach(r => r.addEventListener('change', calcularMaoDeObraTempoReal));

    // 4. Listeners Locais (Histórico e Dashboard)
    const inputBuscaHist = document.getElementById('busca-precificacao');
    if(inputBuscaHist) {
        inputBuscaHist.addEventListener('input', debounce((e) => {
            termoBuscaHist = e.target.value;
            pagAtualHist = 1; 
            atualizarTabelaPrecificacoesGeradas();
        }, 300));
    }

    // Listeners do Dashboard de Cálculo
    const inputProd = document.getElementById('produto-pesquisa');
    if(inputProd) {
        inputProd.addEventListener('input', debounce(buscarProdutosAutocomplete, 300));
        
        inputProd.addEventListener('input', (e) => {
            if (e.target.value === '') {
                 const avisoEl = document.getElementById('aviso-preco-existente');
                 if(avisoEl) avisoEl.classList.add('hidden');
            }
        });
        
        inputProd.addEventListener('keydown', (e) => {
            const div = document.getElementById('produto-resultados');
            if (div.classList.contains('hidden')) return;

            const items = div.querySelectorAll('div');
            if (items.length === 0) return;
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                searchIndex++;
                if (searchIndex >= items.length) searchIndex = 0;
                updateSelection(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                searchIndex--;
                if (searchIndex < 0) searchIndex = items.length - 1;
                updateSelection(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (searchIndex > -1 && items[searchIndex]) {
                    items[searchIndex].click();
                }
            } else if (e.key === 'Escape') {
                div.classList.add('hidden');
                searchIndex = -1;
            }
        });
    }
    
    document.addEventListener('click', (e) => {
        const resultsDiv = document.getElementById('produto-resultados');
        const searchInput = document.getElementById('produto-pesquisa');
        
        if (resultsDiv && searchInput) {
            if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
                resultsDiv.classList.add('hidden');
                searchIndex = -1;
            }
        }
    });
    
    bindClick('#btn-gerar-nota', gerarNotaPrecificacao);
    addChangeListeners(['horas-produto', 'margem-lucro-final'], calcularCustos);
    addChangeListeners(['incluir-taxa-credito-sim', 'incluir-taxa-credito-nao'], calcularTotalComTaxas);
    bindClick('#btn-salvar-taxa-credito', salvarTaxaCredito);
}

function bindClick(selector, handler) {
    const el = document.querySelector(selector);
    if(el) el.addEventListener('click', handler);
}

function addChangeListeners(ids, handler) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('change', handler);
            el.addEventListener('input', handler);
        }
    });
}

function mostrarSubMenu(id) {
    document.querySelectorAll('#module-precificacao .subpagina').forEach(el => el.style.display = 'none');
    const target = document.getElementById(id);
    if(target) target.style.display = 'block';
}

function converterMoeda(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    return parseFloat(str.replace('R$','').replace(/\s/g,'').replace(/\./g,'').replace(',','.')) || 0;
}

// ==========================================================================
// 6. MÓDULO: DASHBOARD DE CÁLCULO (Lógica Financeira)
// ==========================================================================

function buscarProdutosAutocomplete() {
    const termo = this.value.toLowerCase();
    const div = document.getElementById('produto-resultados');
    const spinner = document.getElementById('search-spinner');
    
    if(spinner) spinner.classList.remove('hidden');

    div.innerHTML = '';
    searchIndex = -1; 

    if (!termo) { 
        div.classList.add('hidden');
        if(spinner) spinner.classList.add('hidden');
        return; 
    }

    // Usa a lista 'produtos' importada do precificacao-produtos.js
    const results = produtos.filter(p => p.nome.toLowerCase().includes(termo));

    if (results.length === 0) {
        div.classList.add('hidden');
        if(spinner) spinner.classList.add('hidden');
        return;
    }

    div.classList.remove('hidden');

    results.forEach((p, index) => {
        const item = document.createElement('div');
        item.textContent = p.nome;
        item.dataset.index = index; 
        
        item.onclick = () => {
            selecionarProdutoParaCalculo(p);
            div.classList.add('hidden');
        };
        
        item.onmouseenter = () => {
            searchIndex = index;
            updateSelection(div.querySelectorAll('div'));
        };

        div.appendChild(item);
    });

    if(spinner) setTimeout(() => spinner.classList.add('hidden'), 300); 
}

function updateSelection(items) {
    items.forEach(item => item.classList.remove('selected'));
    if (searchIndex > -1 && items[searchIndex]) {
        items[searchIndex].classList.add('selected');
        items[searchIndex].scrollIntoView({ block: 'nearest' });
    }
}

function verificarPrecoExistente(nomeProduto) {
    const avisoEl = document.getElementById('aviso-preco-existente');
    if (!avisoEl) return;

    const existente = precificacoesGeradas.find(p => p.produto === nomeProduto);

    if (existente) {
        avisoEl.textContent = `⚠️ Já precificado (Nº ${existente.numero})`;
        avisoEl.classList.remove('hidden');
    } else {
        avisoEl.classList.add('hidden');
        avisoEl.textContent = '';
    }
}

function selecionarProdutoParaCalculo(prod) {
    document.getElementById('produto-pesquisa').value = prod.nome;
    
    // Atualiza campo oculto (lógica de cálculo)
    const elHidden = document.getElementById('custo-produto');
    if(elHidden) elHidden.textContent = formatarMoeda(prod.custoTotal);
    
    // Exibe os materiais na nova área de detalhes
    const ul = document.getElementById('lista-materiais-produto');
    if(ul) {
        ul.innerHTML = '';
        prod.materiais.forEach(m => {
            const li = document.createElement('li');
            li.textContent = `${m.material.nome}: ${formatarMoeda(m.custoTotal)}`;
            ul.appendChild(li);
        });
    }
    
    calcularCustos();
    verificarPrecoExistente(prod.nome);
}

function calcularCustos() {
    // 1. Custos Diretos (Materiais) - Vem do Produto
    const custoMatDisplay = document.getElementById('custo-produto').textContent;
    const custoMat = converterMoeda(custoMatDisplay);
    
    const resCustoMat = document.getElementById('res-custo-mat');
    if(resCustoMat) resCustoMat.textContent = formatarMoeda(custoMat);

    const horas = parseFloat(document.getElementById('horas-produto').value) || 1;
    
    // 2. Mão de Obra e Encargos
    const custoMO = horas * maoDeObra.valorHora;
    const custoEncargos = horas * maoDeObra.custoFerias13o;
    const totalMO = custoMO + custoEncargos;
    
    const elTotalMO = document.getElementById('total-mao-de-obra');
    if(elTotalMO) elTotalMO.textContent = formatarMoeda(totalMO);

    const elOldMO = document.getElementById('custo-mao-de-obra-detalhe');
    if(elOldMO) elOldMO.textContent = formatarMoeda(custoMO);
    const elOldEncargos = document.getElementById('custo-ferias-13o-detalhe');
    if(elOldEncargos) elOldEncargos.textContent = formatarMoeda(custoEncargos);
    
    // 3. Custos Indiretos
    const todosCI = [...custosIndiretosPredefinidos, ...custosIndiretosAdicionais];
    const valorHoraCI = todosCI.reduce((acc, c) => acc + (c.valorMensal / maoDeObra.horas), 0);
    const totalCI = valorHoraCI * horas;
    
    const elTotalCI = document.getElementById('custo-indireto');
    if(elTotalCI) elTotalCI.textContent = formatarMoeda(totalCI);
    
    const ulCI = document.getElementById('lista-custos-indiretos-detalhes');
    if(ulCI) {
        ulCI.innerHTML = '';
        todosCI.filter(c => c.valorMensal > 0).forEach(c => {
            const li = document.createElement('li');
            const v = (c.valorMensal / maoDeObra.horas) * horas;
            li.textContent = `${c.descricao}: ${formatarMoeda(v)}`;
            ulCI.appendChild(li);
        });
    }

    // 4. Subtotal (Custos Operacionais = Material + Indiretos)
    const subtotalCustos = custoMat + totalCI;
    const elSubtotal = document.getElementById('subtotal');
    if(elSubtotal) elSubtotal.textContent = formatarMoeda(subtotalCustos);

    // Base para Markup (Custo Total Real = Material + MO + Indiretos)
    const baseCalculo = custoMat + totalMO + totalCI;

    // 5. Margem de Lucro
    const margemPerc = parseFloat(document.getElementById('margem-lucro-final').value) || 0;
    
    const lucro = baseCalculo * (margemPerc / 100);
    const totalSemTaxa = baseCalculo + lucro;

    const elLucro = document.getElementById('margem-lucro-valor');
    if(elLucro) elLucro.textContent = formatarMoeda(lucro);
    
    const elTotalSemTaxa = document.getElementById('total-final');
    if(elTotalSemTaxa) elTotalSemTaxa.textContent = formatarMoeda(totalSemTaxa);
    
    calcularTotalComTaxas();
}

async function salvarTaxaCredito() {
    const perc = parseFloat(document.getElementById('taxa-credito-percentual').value) || 0;
    const incluir = document.getElementById('incluir-taxa-credito-sim').checked;
    
    taxaCredito = { percentual: perc, incluir };
    await setDoc(doc(db, "configuracoes", "taxaCredito"), taxaCredito);
    calcularTotalComTaxas();
    alert("Taxa salva!");
}

function calcularTotalComTaxas() {
    const totalSemTaxa = converterMoeda(document.getElementById('total-final').textContent);
    const incluir = document.getElementById('incluir-taxa-credito-sim').checked;
    
    if(incluir) {
        const taxaVal = totalSemTaxa * (taxaCredito.percentual / 100);
        
        const elTaxa = document.getElementById('taxa-credito-valor');
        if(elTaxa) elTaxa.textContent = formatarMoeda(taxaVal);
        
        const elFinal = document.getElementById('total-final-com-taxas');
        if(elFinal) elFinal.textContent = formatarMoeda(totalSemTaxa + taxaVal);
    } else {
        const elTaxa = document.getElementById('taxa-credito-valor');
        if(elTaxa) elTaxa.textContent = formatarMoeda(0);
        
        const elFinal = document.getElementById('total-final-com-taxas');
        if(elFinal) elFinal.textContent = formatarMoeda(totalSemTaxa);
    }
}

// ==========================================================================
// 7. HISTÓRICO DE PRECIFICAÇÕES
// ==========================================================================

function obterProximoNumeroDisponivel() {
    const numerosExistentes = precificacoesGeradas
        .map(p => p.numero)
        .sort((a, b) => a - b);

    let esperado = 1;
    for (const num of numerosExistentes) {
        if (num === esperado) {
            esperado++;
        } else if (num > esperado) {
            return esperado; 
        }
    }
    return esperado;
}

async function gerarNotaPrecificacao() {
    const prodNome = document.getElementById('produto-pesquisa').value;
    const totalFinal = converterMoeda(document.getElementById('total-final-com-taxas').textContent);

    if(!prodNome || totalFinal <= 0) return alert("Selecione um produto e calcule o preço antes de salvar.");

    const precificacaoExistente = precificacoesGeradas.find(p => p.produto === prodNome);
    
    let idParaSalvar = null;
    let numeroParaSalvar = 0;
    let isUpdate = false;

    if (precificacaoExistente) {
        const confirmar = confirm(`O produto "${prodNome}" já possui precificação (Nº ${precificacaoExistente.numero}).\nDeseja atualizar os valores mantendo este número?`);
        if (!confirmar) return; 
        
        idParaSalvar = precificacaoExistente.id;
        numeroParaSalvar = precificacaoExistente.numero;
        isUpdate = true;
    } else {
        numeroParaSalvar = obterProximoNumeroDisponivel();
        isUpdate = false;
    }

    const nota = {
        numero: numeroParaSalvar,
        produto: prodNome,
        horas: document.getElementById('horas-produto').value,
        margem: document.getElementById('margem-lucro-final').value,
        total: totalFinal,
        custoMateriais: converterMoeda(document.getElementById('custo-produto').textContent),
        totalMaoDeObra: converterMoeda(document.getElementById('total-mao-de-obra').textContent),
        custoIndiretoTotal: converterMoeda(document.getElementById('custo-indireto').textContent),
        detalhesMateriais: getListaTexto('lista-materiais-produto'),
        detalhesCustosIndiretos: getListaTexto('lista-custos-indiretos-detalhes'),
        dataGeracao: new Date().toISOString()
    };

    try {
        if (isUpdate) {
            await setDoc(doc(db, "precificacoes-geradas", idParaSalvar), nota);
            const index = precificacoesGeradas.findIndex(p => p.id === idParaSalvar);
            if (index !== -1) precificacoesGeradas[index] = { id: idParaSalvar, ...nota };
            alert(`Precificação do produto "${prodNome}" atualizada!`);
        } else {
            const ref = await addDoc(collection(db, "precificacoes-geradas"), nota);
            nota.id = ref.id;
            precificacoesGeradas.push(nota);
            alert(`Precificação Nº ${nota.numero} salva para "${prodNome}"!`);
        }
        
        atualizarTabelaPrecificacoesGeradas();
        verificarPrecoExistente(prodNome);

    } catch(e) { 
        console.error(e); 
        alert("Erro ao salvar precificação."); 
    }
}

function getListaTexto(ulId) {
    const arr = [];
    const lista = document.querySelectorAll(`#${ulId} li`);
    if(lista) {
        lista.forEach(li => arr.push(li.textContent));
    }
    return arr;
}

function atualizarTabelaPrecificacoesGeradas() {
    const tbody = document.querySelector('#tabela-precificacoes-geradas tbody');
    const btnAnt = document.getElementById("btn-ant-hist");
    const btnProx = document.getElementById("btn-prox-hist");
    const infoPag = document.getElementById("info-pag-hist");

    if(!tbody) return;
    tbody.innerHTML = '';
    
    // 1. Filtragem e Ordenação
    const termo = termoBuscaHist.trim().toLowerCase();
    const filtrados = precificacoesGeradas.filter(p => {
        const matchProd = p.produto.toLowerCase().includes(termo);
        const matchNum = p.numero.toString().includes(termo);
        return matchProd || matchNum;
    });

    filtrados.sort((a,b) => b.numero - a.numero);

    // 2. Paginação
    const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA) || 1;
    if (pagAtualHist > totalPaginas) pagAtualHist = totalPaginas;
    if (pagAtualHist < 1) pagAtualHist = 1;

    const inicio = (pagAtualHist - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    // 3. Renderização
    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
    } else {
        itensPagina.forEach(p => {
            const row = tbody.insertRow();
            const dataFormatada = p.dataGeracao ? new Date(p.dataGeracao).toLocaleDateString() : '-';
            
            row.innerHTML = `
                <td>${p.numero}</td>
                <td>${p.produto}</td>
                <td>${dataFormatada}</td>
                <td>${formatarMoeda(p.total)}</td>
                <td>
                    <button onclick="visualizarPrecificacao('${p.id}')">Visualizar</button>
                    <button onclick="removerPrecificacao('${p.id}')" style="background-color: #e57373; margin-left: 5px;">Excluir</button>
                </td>
            `;
        });
    }

    // 4. Atualizar Controles
    if (infoPag) infoPag.textContent = `Página ${pagAtualHist} de ${totalPaginas}`;
    if (btnAnt) {
        btnAnt.disabled = (pagAtualHist === 1);
        btnAnt.onclick = () => { if(pagAtualHist > 1) { pagAtualHist--; atualizarTabelaPrecificacoesGeradas(); } };
    }
    if (btnProx) {
        btnProx.disabled = (pagAtualHist === totalPaginas);
        btnProx.onclick = () => { if(pagAtualHist < totalPaginas) { pagAtualHist++; atualizarTabelaPrecificacoesGeradas(); } };
    }
}

function visualizarPrecificacao(id) {
    const p = precificacoesGeradas.find(x => x.id === id);
    if(!p) return;

    const html = `
        <html>
        <head>
            <title>Nota ${p.numero}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                h1 { color: #7aa2a9; border-bottom: 2px solid #7aa2a9; }
                .box { border: 1px solid #ccc; padding: 15px; margin-bottom: 15px; border-radius: 8px; }
                .line { display: flex; justify-content: space-between; margin-bottom: 5px; }
                .total { font-size: 1.2em; font-weight: bold; margin-top: 10px; color: #444; }
                ul { margin: 5px 0 15px 20px; padding: 0; font-size: 0.9em; color: #666; }
            </style>
        </head>
        <body>
            <h1>Pérola Rara - Precificação Nº ${p.numero}</h1>
            <p><strong>Produto:</strong> ${p.produto}</p>
            <p><strong>Data:</strong> ${new Date(p.dataGeracao).toLocaleDateString()}</p>
            
            <div class="box">
                <div class="line"><span>Custo Materiais:</span> <span>${formatarMoeda(p.custoMateriais)}</span></div>
                <ul>${p.detalhesMateriais.map(x => `<li>${x}</li>`).join('')}</ul>
                
                <div class="line"><span>Meu Salário (${p.horas}h):</span> <span>${formatarMoeda(p.totalMaoDeObra)}</span></div>
                
                <div class="line"><span>Gastos Fixos:</span> <span>${formatarMoeda(p.custoIndiretoTotal)}</span></div>
                <ul>${p.detalhesCustosIndiretos.map(x => `<li>${x}</li>`).join('')}</ul>
            </div>

            <div class="box" style="background: #f9f9f9;">
                <div class="line"><span>Margem p/ Caixa (${p.margem}%):</span> <span>Incluso</span></div>
                <div class="line total"><span>Total Final:</span> <span>${formatarMoeda(p.total)}</span></div>
            </div>
            
            <button onclick="window.print()">Imprimir</button>
        </body>
        </html>
    `;
    
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

async function removerPrecificacao(id) {
    if(confirm("Excluir registro permanentemente?")) {
        await deleteDoc(doc(db, "precificacoes-geradas", id));
        precificacoesGeradas = precificacoesGeradas.filter(x => x.id !== id);
        atualizarTabelaPrecificacoesGeradas();
    }
}

function calcularMaoDeObraTempoReal() {
    // Apenas UI logic, os dados reais são salvos via Insumos.js
    const salario = parseFloat(document.getElementById('salario-receber').value) || 0;
    const horas = parseFloat(document.getElementById('horas-trabalhadas').value) || 220;
    const incluirEncargos = document.getElementById('incluir-ferias-13o-sim')?.checked;

    if (horas > 0) {
        const valorHora = salario / horas;
        const elValorHora = document.getElementById('valor-hora');
        if(elValorHora) elValorHora.value = valorHora.toFixed(2);

        const elCustoExtra = document.getElementById('custo-ferias-13o');
        if(elCustoExtra) {
            if (incluirEncargos) {
                const totalAnualExtras = salario + (salario / 3);
                const custoMensalDiluido = totalAnualExtras / 12;
                const custoPorHora = custoMensalDiluido / horas;
                elCustoExtra.value = custoPorHora.toFixed(2);
            } else {
                elCustoExtra.value = "0.00";
            }
        }
    }
}
