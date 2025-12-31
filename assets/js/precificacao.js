// assets/js/precificacao.js

// 1. IMPORTAÇÕES DE INFRAESTRUTURA
import { db, auth } from './firebase-config.js';
import { 
    collection, doc, addDoc, getDocs, updateDoc, deleteDoc, setDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 2. IMPORTAÇÕES DO MÓDULO DE INSUMOS
import { 
    // Dados (Estado Compartilhado)
    materiais, 
    maoDeObra, 
    custosIndiretosPredefinidos, 
    custosIndiretosAdicionais,
    
    // Funções de Carregamento e CRUD
    carregarDadosInsumos,
    cadastrarMaterialInsumo,
    salvarMaoDeObra,
    editarMaoDeObraUI,
    adicionarNovoCustoIndireto,
    
    // Funções de Busca e UI (Globais)
    buscarMateriaisCadastrados,
    buscarCustosIndiretosCadastrados,
    
    // Configuração e Helpers
    setOnMaterialUpdateCallback,
    getUnidadeSigla,
    
    // [NOVO] Importação do inicializador de listeners de materiais (Prioridade 1/2)
    initListenersMateriais
} from './precificacao-insumos.js';

// 3. VARIÁVEIS DE ESTADO LOCAIS (Produtos e Histórico)
let produtos = [];
let precificacoesGeradas = [];
let taxaCredito = { percentual: 6, incluir: false };
let produtoEmEdicao = null;
let moduleInitialized = false;
let searchIndex = -1; // Controle da navegação por teclado na busca
let margemLucroPadrao = 50;

// [NOVO] Variáveis de Paginação e Busca de Produtos
let pagAtualProd = 1;
const ITENS_POR_PAGINA = 10;
let termoBuscaProd = "";

// ==========================================================================
// 4. INICIALIZAÇÃO E CARREGAMENTO
// ==========================================================================
export async function initPrecificacao() {
    console.log("Inicializando Módulo Precificação (Modularizado)...");
    
    // EXPOR FUNÇÕES AO ESCOPO GLOBAL (WINDOW)
    // Nota: 'buscarProdutosCadastrados' foi removido pois agora usamos o listener com debounce
    window.editarProduto = editarProduto;
    window.removerProduto = removerProduto;
    
    window.buscarPrecificacoesGeradas = buscarPrecificacoesGeradas;
    window.visualizarPrecificacao = visualizarPrecificacao;
    window.removerPrecificacao = removerPrecificacao;

    // Configura o Callback de atualização de insumos
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
        // A. Carrega Insumos (Materiais, MO, Custos) do Módulo Externo
        await carregarDadosInsumos();

        // B. Carrega Configurações Locais
        const taxaDoc = await getDoc(doc(db, "configuracoes", "taxaCredito"));
        if (taxaDoc.exists()) taxaCredito = { ...taxaCredito, ...taxaDoc.data() };

        // C. Carrega Coleções Locais (Produtos e Histórico)
        const prodSnap = await getDocs(collection(db, "produtos"));
        produtos = [];
        prodSnap.forEach(d => produtos.push({id: d.id, ...d.data()}));

        const precSnap = await getDocs(collection(db, "precificacoes-geradas"));
        precificacoesGeradas = [];
        precSnap.forEach(d => precificacoesGeradas.push({id: d.id, ...d.data()}));

        // D. Atualizar UI (Agora com paginação)
        atualizarTabelaProdutosCadastrados();
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

// [NOVO] Função Helper Debounce
function debounce(func, timeout = 300) {
    let timer;
    return function(...args) {
        const context = this;
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(context, args), timeout);
    };
}

function setupEventListeners() {
    // Navegação entre Abas
    document.querySelectorAll('#module-precificacao nav ul li a.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            mostrarSubMenu(link.dataset.submenu);
        });
    });

    // --- Listeners para o Módulo de Insumos (Delegados e Inicialização) ---
    bindClick('#cadastrar-material-insumo-btn', cadastrarMaterialInsumo);
    
    // [NOVO] Inicializa os listeners de busca/paginação de Materiais (definidos no outro arquivo)
    if (typeof initListenersMateriais === 'function') {
        initListenersMateriais();
    }
    
    document.querySelectorAll('input[name="tipo-material"]').forEach(radio => {
        radio.addEventListener('change', function() { toggleCamposMaterial(this.value); });
    });

    bindClick('#btn-salvar-mao-de-obra', salvarMaoDeObra);
    bindClick('#btn-editar-mao-de-obra', editarMaoDeObraUI);
    bindClick('#adicionarCustoIndiretoBtn', adicionarNovoCustoIndireto);

    // [ATUALIZADO] Listeners para cálculo em tempo real da Mão de Obra
    const inputSalario = document.getElementById('salario-receber');
    const inputHoras = document.getElementById('horas-trabalhadas');
    // Adiciona listener também nos radios de encargos para recalcular ao trocar Sim/Não
    const radiosEncargos = document.querySelectorAll('input[name="incluir-ferias-13o"]');
    
    if(inputSalario) inputSalario.addEventListener('input', calcularMaoDeObraTempoReal);
    if(inputHoras) inputHoras.addEventListener('input', calcularMaoDeObraTempoReal);
    radiosEncargos.forEach(r => r.addEventListener('change', calcularMaoDeObraTempoReal));

    // --- Listeners Locais (Produtos e Cálculo) ---
    bindClick('#cadastrar-produto-btn', cadastrarProduto);
    
    // [NOVO] Listener para Busca de Produtos (Lista) com Debounce e Paginação
    const inputBuscaProd = document.getElementById('busca-produto-lista');
    if(inputBuscaProd) {
        inputBuscaProd.addEventListener('input', debounce((e) => {
            termoBuscaProd = e.target.value;
            pagAtualProd = 1; // Reseta para primeira página ao buscar
            atualizarTabelaProdutosCadastrados();
        }));
    }

    // [NOVO] Listener para Validação em Tempo Real (Duplicidade)
    const inputNomeProd = document.getElementById('nome-produto');
    if(inputNomeProd) {
        inputNomeProd.addEventListener('input', verificarDuplicidadeTempoReal);
    }

    const inputMat = document.getElementById('pesquisa-material');
    if(inputMat) inputMat.addEventListener('input', buscarMateriaisAutocomplete);

    // Cálculo - Debounce e Teclado
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
    
    // Fechar autocomplete ao clicar fora
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

function toggleCamposMaterial(tipo) {
    const campos = ['comprimento', 'litro', 'quilo', 'area'];
    campos.forEach(c => {
        const el = document.getElementById(`campos-${c}`);
        if(el) el.style.display = 'none';
    });
    
    const target = document.getElementById(`campos-${tipo}`);
    if(target) target.style.display = 'block';
}

function formatarMoeda(valor) {
    if (typeof valor !== 'number' || isNaN(valor)) return 'R$ 0,00';
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function converterMoeda(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    return parseFloat(str.replace('R$','').replace(/\s/g,'').replace(/\./g,'').replace(',','.')) || 0;
}

// [NOVO] Função Helper para Normalização de Texto (Title Case)
function normalizarTexto(texto) {
    if (!texto) return "";
    return texto
        .toLowerCase()
        .split(' ')
        .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1))
        .join(' ');
}

// ==========================================================================
// 6. LÓGICA DE PRODUTOS (CRUD e Montagem)
// ==========================================================================

// [NOVO] Feedback Visual em Tempo Real
function verificarDuplicidadeTempoReal(e) {
    const input = e.target;
    const nomeDigitado = input.value.trim().toLowerCase();
    
    // Cria ou seleciona o elemento de aviso
    let avisoEl = document.getElementById('aviso-duplicidade-cadastro-prod');
    if (!avisoEl) {
        avisoEl = document.createElement('small');
        avisoEl.id = 'aviso-duplicidade-cadastro-prod';
        avisoEl.style.color = '#d32f2f'; // Vermelho erro
        avisoEl.style.fontWeight = 'bold';
        avisoEl.style.display = 'none';
        avisoEl.style.marginTop = '5px';
        input.parentNode.insertBefore(avisoEl, input.nextSibling);
    }

    if (!nomeDigitado) {
        avisoEl.style.display = 'none';
        input.style.borderColor = '#ccc';
        return;
    }

    const existe = produtos.some(p => {
        if (produtoEmEdicao && p.id === produtoEmEdicao.id) return false;
        return p.nome.trim().toLowerCase() === nomeDigitado;
    });

    if (existe) {
        avisoEl.textContent = '⚠️ Este produto já está cadastrado.';
        avisoEl.style.display = 'block';
        input.style.borderColor = '#d32f2f';
    } else {
        avisoEl.style.display = 'none';
        input.style.borderColor = '#4CAF50'; // Verde ok
    }
}

async function atualizarCustosProdutosPorMaterial(material) {
    console.log(`Atualizando produtos que usam: ${material.nome}`);
    
    const produtosAfetados = produtos.filter(p => p.materiais.some(m => m.materialId === material.id));

    for (const prod of produtosAfetados) {
        prod.materiais.forEach(item => {
            if (item.materialId === material.id) {
                item.material.custoUnitario = material.custoUnitario;
                item.custoTotal = calcularCustoTotalItem(item); 
            }
        });
        
        prod.custoTotal = prod.materiais.reduce((acc, item) => acc + item.custoTotal, 0);

        await updateDoc(doc(db, "produtos", prod.id), {
            materiais: prod.materiais,
            custoTotal: prod.custoTotal
        });
    }
    
    if (produtosAfetados.length > 0) {
        atualizarTabelaProdutosCadastrados();
        const produtoSelecionadoNome = document.getElementById('produto-pesquisa').value;
        if (produtoSelecionadoNome) {
            const produtoSelecionado = produtos.find(p => p.nome === produtoSelecionadoNome);
            if (produtoSelecionado) {
                selecionarProdutoParaCalculo(produtoSelecionado);
            }
        }
    }
}

function buscarMateriaisAutocomplete() {
    const termo = this.value.toLowerCase();
    const div = document.getElementById('resultados-pesquisa');
    div.innerHTML = '';
    
    if(!termo) { div.style.display = 'none'; return; }
    
    const results = materiais.filter(m => m.nome.toLowerCase().includes(termo));
    results.forEach(m => {
        const item = document.createElement('div');
        item.textContent = m.nome;
        item.onclick = () => {
            adicionarMaterialNaTabelaProduto(m);
            div.style.display = 'none';
            document.getElementById('pesquisa-material').value = '';
        };
        div.appendChild(item);
    });
    div.style.display = results.length ? 'block' : 'none';
}

function adicionarMaterialNaTabelaProduto(mat, dadosSalvos = null) {
    const tbody = document.querySelector('#tabela-materiais-produto tbody');
    const row = tbody.insertRow();
    
    let inputDimensao = '';
    let valDimensao = 0;

    if (mat.tipo === 'comprimento') {
        valDimensao = dadosSalvos ? dadosSalvos.comprimento : mat.comprimentoCm;
        inputDimensao = `<input type="number" class="dim-input" value="${valDimensao}" style="width:60px"> cm`;
    } else if (mat.tipo === 'area') {
        const l = dadosSalvos ? dadosSalvos.largura : mat.larguraCm;
        const a = dadosSalvos ? dadosSalvos.altura : mat.alturaCm;
        inputDimensao = `<input type="number" class="dim-l" value="${l}" style="width:50px"> x <input type="number" class="dim-a" value="${a}" style="width:50px"> cm`;
    } else if (mat.tipo === 'litro') {
        valDimensao = dadosSalvos ? dadosSalvos.volume : mat.volumeMl;
        inputDimensao = `<input type="number" class="dim-input" value="${valDimensao}" style="width:60px"> ml`;
    } else if (mat.tipo === 'quilo') {
        valDimensao = dadosSalvos ? dadosSalvos.peso : mat.pesoG;
        inputDimensao = `<input type="number" class="dim-input" value="${valDimensao}" style="width:60px"> g`;
    } else {
        const qtdUn = dadosSalvos ? dadosSalvos.quantidadeMaterial : 1;
        inputDimensao = `<input type="number" class="dim-input" value="${qtdUn}" style="width:60px"> un`;
    }

    const qtd = dadosSalvos ? dadosSalvos.quantidade : 1;

    row.innerHTML = `
        <td data-id="${mat.id}">${mat.nome}</td>
        <td>${mat.tipo}</td>
        <td>${formatarMoeda(mat.custoUnitario)}</td>
        <td class="cell-dimensao">${inputDimensao}</td>
        <td><input type="number" class="qtd-input" value="${qtd}" style="width:50px"></td>
        <td class="custo-total-item">R$ 0,00</td>
        <td><button onclick="this.closest('tr').remove()">X</button></td>
    `;

    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => recalcularLinhaProduto(row, mat));
    });

    recalcularLinhaProduto(row, mat);
}

function recalcularLinhaProduto(row, mat) {
    const qtd = parseFloat(row.querySelector('.qtd-input').value) || 0;
    
    const itemTemp = {
        tipo: mat.tipo,
        material: { custoUnitario: mat.custoUnitario },
        quantidade: qtd
    };

    if(mat.tipo === 'comprimento') {
        itemTemp.comprimento = parseFloat(row.querySelector('.dim-input').value) || 0;
    } else if (mat.tipo === 'litro') {
        itemTemp.volume = parseFloat(row.querySelector('.dim-input').value) || 0;
    } else if (mat.tipo === 'quilo') {
        itemTemp.peso = parseFloat(row.querySelector('.dim-input').value) || 0;
    } else if (mat.tipo === 'area') {
        itemTemp.largura = parseFloat(row.querySelector('.dim-l').value) || 0;
        itemTemp.altura = parseFloat(row.querySelector('.dim-a').value) || 0;
    } else {
        itemTemp.quantidadeMaterial = parseFloat(row.querySelector('.dim-input').value) || 0;
    }

    const total = calcularCustoTotalItem(itemTemp);
    row.querySelector('.custo-total-item').textContent = formatarMoeda(total);
    row.dataset.total = total; 
}

async function cadastrarProduto() {
    const inputNome = document.getElementById('nome-produto');
    const nomeBruto = inputNome.value;
    
    if(!nomeBruto) return alert("Nome obrigatório");

    // [NOVO] Normalização de Dados (Title Case)
    const nomeNormalizado = normalizarTexto(nomeBruto);

    // [NOVO] Bloqueio de Duplicidade (Blindagem)
    const nomeParaComparacao = nomeNormalizado.toLowerCase();
    const existeDuplicata = produtos.some(p => {
        // Se estiver editando, ignora a si mesmo
        if (produtoEmEdicao && p.id === produtoEmEdicao.id) return false;
        
        return p.nome.trim().toLowerCase() === nomeParaComparacao;
    });

    if (existeDuplicata) {
        alert(`Impossível salvar: O produto "${nomeNormalizado}" já existe.\nPor favor, utilize um nome diferente ou edite o existente.`);
        // Re-aciona visualmente o erro caso o alert seja fechado
        inputNome.style.borderColor = '#d32f2f';
        return;
    }

    const materiaisList = [];
    let custoTotal = 0;

    const rows = document.querySelectorAll('#tabela-materiais-produto tbody tr');
    rows.forEach(row => {
        const matId = row.cells[0].dataset.id;
        const matOriginal = materiais.find(m => m.id === matId);
        const tipo = row.cells[1].innerText;
        const qtd = parseFloat(row.querySelector('.qtd-input').value);
        const custoItem = parseFloat(row.dataset.total);

        let comp=0, larg=0, alt=0, vol=0, peso=0, qtdMat=0;
        
        if(tipo === 'comprimento') comp = parseFloat(row.querySelector('.dim-input').value);
        else if(tipo === 'litro') vol = parseFloat(row.querySelector('.dim-input').value);
        else if(tipo === 'quilo') peso = parseFloat(row.querySelector('.dim-input').value);
        else if(tipo === 'area') {
            larg = parseFloat(row.querySelector('.dim-l').value);
            alt = parseFloat(row.querySelector('.dim-a').value);
        } else {
            qtdMat = parseFloat(row.querySelector('.dim-input').value);
        }

        materiaisList.push({
            materialId: matId,
            material: { nome: matOriginal.nome, custoUnitario: matOriginal.custoUnitario }, 
            tipo,
            quantidade: qtd,
            custoTotal: custoItem,
            comprimento: comp, largura: larg, altura: alt, volume: vol, peso: peso, quantidadeMaterial: qtdMat
        });
        
        custoTotal += custoItem;
    });

    // Usa o nome normalizado no objeto final
    const prodData = { nome: nomeNormalizado, materiais: materiaisList, custoTotal };

    try {
        if(produtoEmEdicao) {
            await updateDoc(doc(db, "produtos", produtoEmEdicao.id), prodData);
            const idx = produtos.findIndex(p => p.id === produtoEmEdicao.id);
            if(idx !== -1) produtos[idx] = { id: produtoEmEdicao.id, ...prodData };
            produtoEmEdicao = null;
            document.querySelector('#cadastrar-produto-btn').textContent = "Cadastrar Produto";
        } else {
            const ref = await addDoc(collection(db, "produtos"), prodData);
            prodData.id = ref.id;
            produtos.push(prodData);
        }
        
        alert("Produto Salvo com Sucesso!");
        document.getElementById('form-produtos-cadastrados').reset();
        document.querySelector('#tabela-materiais-produto tbody').innerHTML = '';
        
        // Limpa estado de erro visual
        const avisoEl = document.getElementById('aviso-duplicidade-cadastro-prod');
        if(avisoEl) avisoEl.style.display = 'none';
        inputNome.style.borderColor = '#ccc';

        atualizarTabelaProdutosCadastrados();

    } catch (e) { console.error(e); alert("Erro ao salvar produto"); }
}

// [ATUALIZADO] Função de Renderização da Tabela de Produtos (Com Paginação e Filtro)
function atualizarTabelaProdutosCadastrados() {
    const tbody = document.querySelector('#tabela-produtos tbody');
    const btnAnt = document.getElementById("btn-ant-prod");
    const btnProx = document.getElementById("btn-prox-prod");
    const infoPag = document.getElementById("info-pag-prod");

    if(!tbody) return;
    tbody.innerHTML = '';
    
    // 1. Filtragem (Busca) e Ordenação
    const termo = termoBuscaProd.trim().toLowerCase();
    const filtrados = produtos.filter(p => p.nome.toLowerCase().includes(termo));
    filtrados.sort((a,b) => a.nome.localeCompare(b.nome));

    // 2. Paginação
    const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA) || 1;
    if (pagAtualProd > totalPaginas) pagAtualProd = totalPaginas;
    if (pagAtualProd < 1) pagAtualProd = 1;

    const inicio = (pagAtualProd - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    // 3. Renderização
    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum produto encontrado.</td></tr>';
    } else {
        itensPagina.forEach(p => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${p.nome}</td>
                <td><ul>${p.materiais.map(m => `<li>${m.material.nome} (${m.quantidade})</li>`).join('')}</ul></td>
                <td>-</td>
                <td>${formatarMoeda(p.custoTotal)}</td>
                <td>
                    <button class="btn-editar-prod" onclick="editarProduto('${p.id}')">Editar</button>
                    <button class="btn-remover-prod" onclick="removerProduto('${p.id}')">Remover</button>
                </td>
            `;
        });
    }

    // 4. Atualizar Controles de Paginação
    if (infoPag) infoPag.textContent = `Página ${pagAtualProd} de ${totalPaginas}`;
    if (btnAnt) {
        btnAnt.disabled = (pagAtualProd === 1);
        // Atualiza o listener para usar a função local
        btnAnt.onclick = () => { if(pagAtualProd > 1) { pagAtualProd--; atualizarTabelaProdutosCadastrados(); } };
    }
    if (btnProx) {
        btnProx.disabled = (pagAtualProd === totalPaginas);
        // Atualiza o listener para usar a função local
        btnProx.onclick = () => { if(pagAtualProd < totalPaginas) { pagAtualProd++; atualizarTabelaProdutosCadastrados(); } };
    }
}

// Nota: A função 'buscarProdutosCadastrados' antiga foi removida pois agora usamos 'atualizarTabelaProdutosCadastrados' com filtro

function editarProduto(id) {
    const prod = produtos.find(p => p.id === id);
    if(!prod) return;
    
    produtoEmEdicao = prod;
    document.getElementById('nome-produto').value = prod.nome;
    const tbody = document.querySelector('#tabela-materiais-produto tbody');
    tbody.innerHTML = '';
    
    prod.materiais.forEach(item => {
        const matReal = materiais.find(m => m.id === item.materialId);
        if(matReal) {
            adicionarMaterialNaTabelaProduto(matReal, item);
        }
    });
    document.querySelector('#cadastrar-produto-btn').textContent = "Salvar Alterações";
    document.getElementById('cadastrar-produtos').scrollIntoView();
}

async function removerProduto(id) {
    if(confirm("Excluir produto?")) {
        await deleteDoc(doc(db, "produtos", id));
        produtos = produtos.filter(p => p.id !== id);
        atualizarTabelaProdutosCadastrados();
    }
}

// ==========================================================================
// 7. MÓDULO: CÁLCULO DE PREÇO E HISTÓRICO (DASHBOARD REDESIGN)
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
    
    // ATUALIZAÇÃO: Exibe os materiais na nova área de detalhes
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
    // 1. Custos Diretos (Materiais)
    // Lê do span oculto
    const custoMatDisplay = document.getElementById('custo-produto').textContent;
    const custoMat = converterMoeda(custoMatDisplay);
    
    // Atualiza display no Card de Resultado (Dashboard)
    const resCustoMat = document.getElementById('res-custo-mat');
    if(resCustoMat) resCustoMat.textContent = formatarMoeda(custoMat);

    const horas = parseFloat(document.getElementById('horas-produto').value) || 1;
    
    // 2. Mão de Obra e Encargos
    const custoMO = horas * maoDeObra.valorHora;
    const custoEncargos = horas * maoDeObra.custoFerias13o;
    const totalMO = custoMO + custoEncargos;
    
    // Atualiza DASHBOARD: Card de Mão de Obra (Valor Unificado)
    const elTotalMO = document.getElementById('total-mao-de-obra');
    if(elTotalMO) elTotalMO.textContent = formatarMoeda(totalMO);

    // Compatibilidade: Campos ocultos para salvar no banco
    const elOldMO = document.getElementById('custo-mao-de-obra-detalhe');
    if(elOldMO) elOldMO.textContent = formatarMoeda(custoMO);
    const elOldEncargos = document.getElementById('custo-ferias-13o-detalhe');
    if(elOldEncargos) elOldEncargos.textContent = formatarMoeda(custoEncargos);
    
    // 3. Custos Indiretos
    const todosCI = [...custosIndiretosPredefinidos, ...custosIndiretosAdicionais];
    const valorHoraCI = todosCI.reduce((acc, c) => acc + (c.valorMensal / maoDeObra.horas), 0);
    const totalCI = valorHoraCI * horas;
    
    // Atualiza DASHBOARD: Card de Custos Indiretos
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

    // 4. Subtotal (DASHBOARD: Custos Operacionais = Material + Indiretos)
    // Nota: Mão de Obra é mostrada separadamente no card, mas entra no cálculo do Markup
    const subtotalCustos = custoMat + totalCI;
    const elSubtotal = document.getElementById('subtotal');
    if(elSubtotal) elSubtotal.textContent = formatarMoeda(subtotalCustos);

    // Base para Markup (Custo Total Real = Material + MO + Indiretos)
    const baseCalculo = custoMat + totalMO + totalCI;

    // 5. Margem de Lucro
    const margemPerc = parseFloat(document.getElementById('margem-lucro-final').value) || 0;
    
    const lucro = baseCalculo * (margemPerc / 100);
    const totalSemTaxa = baseCalculo + lucro;

    // Atualiza DASHBOARD: Lucro
    const elLucro = document.getElementById('margem-lucro-valor');
    if(elLucro) elLucro.textContent = formatarMoeda(lucro);
    
    // Atualiza DASHBOARD: Total sem Taxas
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
        // Cálculo de taxa "por dentro" ou "por fora"? 
        // O código original usava "por fora" (soma simples). Mantendo lógica original.
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
        // Lê os valores calculados (agora disponíveis nos novos elementos ou ocultos)
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
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const ordenadas = [...precificacoesGeradas].sort((a,b) => b.numero - a.numero);

    ordenadas.forEach(p => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${p.numero}</td>
            <td>${p.produto}</td>
            <td>
                <button onclick="visualizarPrecificacao('${p.id}')">Visualizar</button>
                <button onclick="removerPrecificacao('${p.id}')">Excluir</button>
            </td>
        `;
    });
}

function buscarPrecificacoesGeradas() {
    const termo = document.getElementById('busca-precificacao').value.toLowerCase();
    const rows = document.querySelectorAll('#tabela-precificacoes-geradas tbody tr');
    rows.forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(termo) ? '' : 'none';
    });
}

function visualizarPrecificacao(id) {
    const p = precificacoesGeradas.find(x => x.id === id);
    if(!p) return;

    // TEMPLATE ATUALIZADO (PRIORIDADE 1: TERMINOLOGIA)
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
                
                <!-- TERMINOLOGIA ATUALIZADA: Mão de Obra -> Meu Salário -->
                <div class="line"><span>Meu Salário (${p.horas}h):</span> <span>${formatarMoeda(p.totalMaoDeObra)}</span></div>
                
                <!-- TERMINOLOGIA ATUALIZADA: Custos Indiretos -> Gastos Fixos -->
                <div class="line"><span>Gastos Fixos:</span> <span>${formatarMoeda(p.custoIndiretoTotal)}</span></div>
                <ul>${p.detalhesCustosIndiretos.map(x => `<li>${x}</li>`).join('')}</ul>
            </div>

            <div class="box" style="background: #f9f9f9;">
                <!-- TERMINOLOGIA ATUALIZADA: Margem de Lucro -> Margem p/ Caixa -->
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

// ==========================================================================
// 8. FUNÇÕES AUXILIARES DE CÁLCULO
// ==========================================================================

function calcularCustoTotalItem(item) {
    let custoTotal = 0;
    let quantidade = item.quantidade || 1;

    const custoUnit = item.material ? item.material.custoUnitario : 0;

    if (item.tipo === "comprimento") {
        custoTotal = custoUnit * (item.comprimento / 100) * quantidade;
    } else if (item.tipo === "area") {
        custoTotal = custoUnit * (item.largura * item.altura / 10000) * quantidade;
    } else if (item.tipo === "litro") {
        custoTotal = custoUnit * (item.volume / 1000) * quantidade;
    } else if (item.tipo === "quilo") {
        custoTotal = custoUnit * (item.peso / 1000) * quantidade;
    } else if (item.tipo === "unidade") {
        let qtdMat = item.quantidadeMaterial || 1;
        custoTotal = custoUnit * qtdMat * quantidade;
    }
    
    return custoTotal;
}

// [ATUALIZADO] Função para calcular Mão de Obra em Tempo Real
function calcularMaoDeObraTempoReal() {
    const salario = parseFloat(document.getElementById('salario-receber').value) || 0;
    const horas = parseFloat(document.getElementById('horas-trabalhadas').value) || 220;
    
    // Verifica se o checkbox de incluir encargos está marcado
    const incluirEncargos = document.getElementById('incluir-ferias-13o-sim')?.checked;

    if (horas > 0) {
        // 1. Atualiza Valor Hora Normal
        const valorHora = salario / horas;
        const elValorHora = document.getElementById('valor-hora');
        if(elValorHora) elValorHora.value = valorHora.toFixed(2);

        // 2. Atualiza Valor Encargos em Tempo Real
        const elCustoExtra = document.getElementById('custo-ferias-13o');
        if(elCustoExtra) {
            if (incluirEncargos) {
                // FÓRMULA ATUALIZADA: ((Salário (13º) + Salário/3 (1/3 Férias)) / 12) / Horas
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
