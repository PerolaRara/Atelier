// assets/js/precificacao.js

// 1. IMPORTAÇÕES DE INFRAESTRUTURA
import { db, auth } from './firebase-config.js';
import { 
    collection, doc, addDoc, getDocs, setDoc, deleteDoc, getDoc, query, where
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
    // Dados e Funções de Produtos
    produtos,
    carregarProdutos,
    initListenersProdutos,
    editarProduto,  // Exposto para o window
    removerProduto, // Exposto para o window
    atualizarCustosProdutosPorMaterial // Callback
} from './precificacao-produtos.js';

// NOVA IMPORTAÇÃO: Ponte para Sincronização com Estoque
import { verificarAtualizacaoEstoque } from './estoque.js';

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

// Variável de Controle de Edição (NOVO)
let precificacaoEmEdicaoId = null;

// ==========================================================================
// 4. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================
export async function initPrecificacao() {
    console.log("Inicializando Módulo Precificação (Refatorado - V2 - Isolado)...");
    
    // EXPOR FUNÇÕES AO ESCOPO GLOBAL (WINDOW)
    window.editarMaterialInsumo = window.editarMaterialInsumo; 
    window.removerMaterialInsumo = window.removerMaterialInsumo;
    
    window.editarProduto = editarProduto;
    window.removerProduto = removerProduto;
    
    window.buscarPrecificacoesGeradas = atualizarTabelaPrecificacoesGeradas;
    window.visualizarPrecificacao = visualizarPrecificacao;
    window.removerPrecificacao = removerPrecificacao;
    
    // EXPOR NOVA FUNÇÃO DE EDIÇÃO AO WINDOW
    window.editarPrecificacao = editarPrecificacao;

    setOnMaterialUpdateCallback(atualizarCustosProdutosPorMaterial);

    await carregarDadosCompletos();
    
    if (!moduleInitialized) {
        setupEventListeners();
        moduleInitialized = true;
    }
}

async function carregarDadosCompletos() {
    const user = auth.currentUser; // Captura usuário
    if (!user) return;

    try {
        // Carregamento Paralelo para Performance
        await Promise.all([
            carregarDadosInsumos(), // Insumos.js
            carregarProdutos()      // Produtos.js
        ]);

        // Carregar Taxa de Crédito Isolada
        const taxaDocId = `taxaCredito_${user.uid}`;
        const taxaDoc = await getDoc(doc(db, "configuracoes", taxaDocId));
        if (taxaDoc.exists()) taxaCredito = { ...taxaCredito, ...taxaDoc.data() };

        // Carregar Histórico de Precificação (Filtrado por usuário)
        const q = query(collection(db, "precificacoes-geradas"), where("ownerId", "==", user.uid));
        const precSnap = await getDocs(q);
        
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
            // Se estiver editando e mudar de aba, perguntar se quer cancelar?
            // Por simplicidade, mantemos o estado, mas o ideal seria limpar se sair do fluxo.
            mostrarSubMenu(link.dataset.submenu);
        });
    });

    // 2. Inicializa Listeners dos Sub-módulos
    initListenersInsumos(); 
    initListenersProdutos(); 

    // 3. Listeners Manuais de Insumos
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
    
    // LISTENER NOVO: Botão de Cancelar Edição
    bindClick('#btn-cancelar-edicao-precificacao', cancelarEdicaoPrecificacao);

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
// 6. MÓDULO: DASHBOARD DE CÁLCULO (Lógica Financeira & CRUD)
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

    // Se estivermos editando, não avisa que existe (pois estamos editando ele mesmo)
    const existente = precificacoesGeradas.find(p => p.produto === nomeProduto);

    if (existente && (!precificacaoEmEdicaoId || existente.id !== precificacaoEmEdicaoId)) {
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

// === FUNÇÕES NOVAS PARA EDIÇÃO (CRUD) ===

function editarPrecificacao(id) {
    const p = precificacoesGeradas.find(x => x.id === id);
    if(!p) return;

    // 1. Define estado de edição
    precificacaoEmEdicaoId = id;
    
    // Input hidden (se existir no HTML, caso contrário usamos a variável global)
    const hiddenId = document.getElementById('id-precificacao-edicao');
    if(hiddenId) hiddenId.value = id;

    // 2. Muda para a aba de cálculo
    mostrarSubMenu('calculo-precificacao');

    // 3. Preenche os campos "Fixos"
    document.getElementById('produto-pesquisa').value = p.produto;
    document.getElementById('horas-produto').value = p.horas;
    document.getElementById('margem-lucro-final').value = p.margem;

    // 4. LÓGICA DE CASCATA (Reatividade) - Prioridade 3
    // Busca o produto ATUAL para pegar custos ATUALIZADOS
    const produtoAtual = produtos.find(prod => prod.nome === p.produto);
    
    if (produtoAtual) {
        const custoAtualizado = produtoAtual.custoTotal;
        document.getElementById('custo-produto').textContent = formatarMoeda(custoAtualizado);
        
        // Atualiza a lista visual de materiais
        const ul = document.getElementById('lista-materiais-produto');
        if(ul) {
            ul.innerHTML = '';
            produtoAtual.materiais.forEach(m => {
                const li = document.createElement('li');
                li.textContent = `${m.material.nome}: ${formatarMoeda(m.custoTotal)}`;
                ul.appendChild(li);
            });
        }
        
        // Prioridade 2: Feedback visual se houve mudança de preço
        // Compara o custo salvo no histórico (p.custoMateriais) com o do cadastro atual (custoAtualizado)
        if (Math.abs(custoAtualizado - p.custoMateriais) > 0.01) {
            alert(`⚠️ ATENÇÃO: O custo dos materiais mudou desde a última precificação.\n\nAntigo: ${formatarMoeda(p.custoMateriais)}\nNovo (Atual): ${formatarMoeda(custoAtualizado)}\n\nO preço de venda sugerido será recalculado automaticamente.`);
        }
    } else {
        // Fallback: Produto pode ter sido excluído ou renomeado. Usa o valor histórico.
        document.getElementById('custo-produto').textContent = formatarMoeda(p.custoMateriais);
        alert("Aviso: O produto original não foi encontrado no cadastro atual. Usando custos históricos.");
    }

    // 5. Ajustes de UI
    const btnSalvarTexto = document.getElementById('texto-btn-salvar-precificacao');
    if(btnSalvarTexto) btnSalvarTexto.textContent = 'Atualizar Precificação';
    
    const btnCancelar = document.getElementById('btn-cancelar-edicao-precificacao');
    if(btnCancelar) btnCancelar.style.display = 'block';

    // 6. Recalcula tudo com os novos dados
    calcularCustos();
    verificarPrecoExistente(p.produto);
}

function cancelarEdicaoPrecificacao() {
    precificacaoEmEdicaoId = null;
    const hiddenId = document.getElementById('id-precificacao-edicao');
    if(hiddenId) hiddenId.value = '';
    
    // Limpar campos principais
    document.getElementById('produto-pesquisa').value = '';
    document.getElementById('horas-produto').value = '1';
    document.getElementById('margem-lucro-final').value = margemLucroPadrao; // Reseta para padrão
    
    // Limpar listas de detalhes
    const ul = document.getElementById('lista-materiais-produto');
    if(ul) ul.innerHTML = '';
    
    // Resetar UI dos botões
    const btnSalvarTexto = document.getElementById('texto-btn-salvar-precificacao');
    if(btnSalvarTexto) btnSalvarTexto.textContent = 'Salvar Precificação';
    
    const btnCancelar = document.getElementById('btn-cancelar-edicao-precificacao');
    if(btnCancelar) btnCancelar.style.display = 'none';
    
    // Ocultar resultados / Zerar
    const elHidden = document.getElementById('custo-produto');
    if(elHidden) elHidden.textContent = '0';
    
    const avisoEl = document.getElementById('aviso-preco-existente');
    if(avisoEl) avisoEl.classList.add('hidden');

    calcularCustos(); // Zera os totais visuais
}

function calcularCustos() {
    // 1. Custos Diretos (Materiais) - Vem do Produto (Atualizado ou Histórico)
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
    const user = auth.currentUser;
    if (!user) return alert("Erro: Usuário não identificado.");

    const perc = parseFloat(document.getElementById('taxa-credito-percentual').value) || 0;
    const incluir = document.getElementById('incluir-taxa-credito-sim').checked;
    
    taxaCredito = { percentual: perc, incluir };
    
    const taxaDocId = `taxaCredito_${user.uid}`;
    await setDoc(doc(db, "configuracoes", taxaDocId), taxaCredito);
    
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
// 7. HISTÓRICO DE PRECIFICAÇÕES & SALVAMENTO
// ==========================================================================

function obterProximoNumeroDisponivel() {
    // Como precificacoesGeradas já é filtrada por usuário no carregamento,
    // a numeração será sequencial e isolada para cada usuário.
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
    const user = auth.currentUser;
    if (!user) return alert("Sessão expirada.");

    const prodNome = document.getElementById('produto-pesquisa').value;
    const totalFinal = converterMoeda(document.getElementById('total-final-com-taxas').textContent);

    if(!prodNome || totalFinal <= 0) return alert("Selecione um produto e calcule o preço antes de salvar.");

    // Verifica se existe precificação anterior para este produto
    const precificacaoExistente = precificacoesGeradas.find(p => p.produto === prodNome);
    
    // Variáveis para lógica de Atualização vs Criação
    const isEditMode = !!precificacaoEmEdicaoId;
    let idParaSalvar = precificacaoEmEdicaoId;
    let numeroParaSalvar = 0;

    // LÓGICA DE DECISÃO:
    // 1. Se estiver editando explicitamente (clicou em editar), atualiza o ID em edição.
    // 2. Se não estiver editando, mas já existe, pergunta se quer sobrescrever (modo legado/segurança).
    
    if (isEditMode) {
        // Modo Edição Explícito: Mantém o número original
        const original = precificacoesGeradas.find(x => x.id === precificacaoEmEdicaoId);
        if (original) {
            numeroParaSalvar = original.numero;
        } else {
            // Caso raro de erro
            numeroParaSalvar = obterProximoNumeroDisponivel();
            idParaSalvar = null; // Força criar novo se perdeu a referência
        }
    } else if (precificacaoExistente) {
        // Modo Criação, mas já existe registro
        const confirmar = confirm(`O produto "${prodNome}" já possui precificação (Nº ${precificacaoExistente.numero}).\nDeseja atualizar os valores mantendo este número?`);
        if (!confirmar) return; 
        
        idParaSalvar = precificacaoExistente.id;
        numeroParaSalvar = precificacaoExistente.numero;
    } else {
        // Modo Criação Puro
        numeroParaSalvar = obterProximoNumeroDisponivel();
        idParaSalvar = null; // Será gerado pelo Firebase
    }

    const nota = {
        ownerId: user.uid,
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
        dataGeracao: new Date().toISOString() // Atualiza data sempre que salvar
    };

    try {
        if (idParaSalvar) {
            // ATUALIZAÇÃO (PUT)
            await setDoc(doc(db, "precificacoes-geradas", idParaSalvar), nota);
            
            // Atualiza array local
            const index = precificacoesGeradas.findIndex(p => p.id === idParaSalvar);
            if (index !== -1) precificacoesGeradas[index] = { id: idParaSalvar, ...nota };
            
            alert(`Precificação atualizada com sucesso!`);
            
            // Se estava em modo de edição, limpa o estado
            if(isEditMode) cancelarEdicaoPrecificacao();
        
        } else {
            // CRIAÇÃO (POST)
            const ref = await addDoc(collection(db, "precificacoes-geradas"), nota);
            nota.id = ref.id;
            precificacoesGeradas.push(nota);
            alert(`Precificação Nº ${nota.numero} salva para "${prodNome}"!`);
        }

        // --- SINCRONIZAÇÃO COM ESTOQUE ---
        // Atualiza o cadastro de estoque com os novos custos e preços
        const dadosFinanceirosAtualizados = {
            valorVenda: totalFinal, 
            financeiro: {
                custoProducao: converterMoeda(document.getElementById('custo-produto').textContent) + 
                               converterMoeda(document.getElementById('custo-indireto').textContent),
                maoDeObra: converterMoeda(document.getElementById('total-mao-de-obra').textContent),
                margemLucro: converterMoeda(document.getElementById('margem-lucro-valor').textContent)
            }
        };

        await verificarAtualizacaoEstoque(prodNome, dadosFinanceirosAtualizados);
        // --- FIM DA SINCRONIZAÇÃO ---
        
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
    
    // 1. Filtragem
    const termo = termoBuscaHist.trim().toLowerCase();
    const filtrados = precificacoesGeradas.filter(p => {
        const matchProd = p.produto.toLowerCase().includes(termo);
        const matchNum = p.numero.toString().includes(termo);
        return matchProd || matchNum;
    });

    // 2. Ordenação (Alfabética por Nome do Produto A-Z)
    filtrados.sort((a,b) => a.produto.localeCompare(b.produto));

    // 3. Paginação
    const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA) || 1;
    if (pagAtualHist > totalPaginas) pagAtualHist = totalPaginas;
    if (pagAtualHist < 1) pagAtualHist = 1;

    const inicio = (pagAtualHist - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    // 4. Renderização
    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
    } else {
        itensPagina.forEach(p => {
            const row = tbody.insertRow();
            const dataFormatada = p.dataGeracao ? new Date(p.dataGeracao).toLocaleDateString() : '-';
            
            // PRIORIDADE 1: Adicionado botão de editar com classe específica
            row.innerHTML = `
                <td>${p.numero}</td>
                <td>${p.produto}</td>
                <td>${dataFormatada}</td>
                <td>${formatarMoeda(p.total)}</td>
                <td>
                    <button class="btn-editar-precificacao" onclick="editarPrecificacao('${p.id}')">Editar</button>
                    <button onclick="visualizarPrecificacao('${p.id}')">Visualizar</button>
                    <button onclick="removerPrecificacao('${p.id}')" style="background-color: #e57373; margin-left: 5px;">Excluir</button>
                </td>
            `;
        });
    }

    // 5. Atualizar Controles
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
