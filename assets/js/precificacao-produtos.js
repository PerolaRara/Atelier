// assets/js/precificacao-produtos.js

import { db } from './firebase-config.js';
import { 
    collection, doc, addDoc, getDocs, updateDoc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { 
    materiais, 
    formatarMoeda, 
    getUnidadeSigla 
} from './precificacao-insumos.js';

// ==========================================
// ESTADO COMPARTILHADO (Exports)
// ==========================================
export let produtos = [];

// ==========================================
// VARIÁVEIS LOCAIS DE CONTROLE
// ==========================================
let produtoEmEdicao = null;
let pagAtualProd = 1;
const ITENS_POR_PAGINA = 10;
let termoBuscaProd = "";

// ==========================================
// FUNÇÕES DE INICIALIZAÇÃO E CARREGAMENTO
// ==========================================

export async function carregarProdutos() {
    try {
        const prodSnap = await getDocs(collection(db, "produtos"));
        produtos = [];
        prodSnap.forEach(d => produtos.push({id: d.id, ...d.data()}));
        atualizarTabelaProdutosCadastrados();
        console.log("Produtos carregados:", produtos.length);
    } catch (e) {
        console.error("Erro ao carregar produtos:", e);
    }
}

export function initListenersProdutos() {
    // Listener do Botão de Cadastro
    const btnCadastrar = document.querySelector('#cadastrar-produto-btn');
    if(btnCadastrar) btnCadastrar.addEventListener('click', cadastrarProduto);

    // Listener de Busca (Debounce)
    const inputBusca = document.getElementById('busca-produto-lista');
    if(inputBusca) {
        inputBusca.addEventListener('input', (e) => {
            clearTimeout(window.timerBuscaProd);
            window.timerBuscaProd = setTimeout(() => {
                termoBuscaProd = e.target.value;
                pagAtualProd = 1; 
                atualizarTabelaProdutosCadastrados();
            }, 300);
        });
    }

    // Validação de Duplicidade em Tempo Real
    const inputNome = document.getElementById('nome-produto');
    if(inputNome) inputNome.addEventListener('input', verificarDuplicidadeTempoReal);
    
    // Autocomplete de Materiais (Dentro do formulário de produto)
    const inputMat = document.getElementById('pesquisa-material');
    if(inputMat) inputMat.addEventListener('input', buscarMateriaisAutocomplete);
}

// ==========================================
// LÓGICA DE NEGÓCIO: CALLBACKS E HELPERS
// ==========================================

// Função chamada pelo precificacao-insumos.js quando um material muda de preço
export async function atualizarCustosProdutosPorMaterial(material) {
    console.log(`Atualizando produtos que usam: ${material.nome}`);
    
    const produtosAfetados = produtos.filter(p => p.materiais.some(m => m.materialId === material.id));

    for (const prod of produtosAfetados) {
        prod.materiais.forEach(item => {
            if (item.materialId === material.id) {
                // Atualiza o custo unitário do material dentro da receita do produto
                item.material.custoUnitario = material.custoUnitario;
                item.custoTotal = calcularCustoTotalItem(item); 
            }
        });
        
        // Recalcula o total do produto
        prod.custoTotal = prod.materiais.reduce((acc, item) => acc + item.custoTotal, 0);

        await updateDoc(doc(db, "produtos", prod.id), {
            materiais: prod.materiais,
            custoTotal: prod.custoTotal
        });
    }
    
    if (produtosAfetados.length > 0) {
        atualizarTabelaProdutosCadastrados();
        
        // Tenta atualizar a tela de cálculo se houver produto selecionado
        const inputPesquisa = document.getElementById('produto-pesquisa');
        if (inputPesquisa && inputPesquisa.value) {
            // Dispara um evento customizado ou acessa função global se necessário
            // O módulo principal (precificacao.js) cuidará de re-selecionar se necessário
        }
    }
}

function normalizarTexto(texto) {
    if (!texto) return "";
    return texto
        .toLowerCase()
        .split(' ')
        .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1))
        .join(' ');
}

function calcularCustoTotalItem(item) {
    let custoTotal = 0;
    let quantidade = item.quantidade || 1;

    // Se o item tem o objeto material completo, usa o custo dele. 
    // Caso contrário, tenta usar o custoUnitario salvo no item (fallback).
    const custoUnit = item.material ? item.material.custoUnitario : (item.custoUnitario || 0);

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

// ==========================================
// LÓGICA DE INTERFACE (FORMULÁRIO DE PRODUTO)
// ==========================================

function verificarDuplicidadeTempoReal(e) {
    const input = e.target;
    const nomeDigitado = input.value.trim().toLowerCase();
    
    let avisoEl = document.getElementById('aviso-duplicidade-cadastro-prod');
    if (!avisoEl) {
        avisoEl = document.createElement('small');
        avisoEl.id = 'aviso-duplicidade-cadastro-prod';
        avisoEl.style.color = '#d32f2f'; 
        avisoEl.style.fontWeight = 'bold';
        avisoEl.style.display = 'none';
        avisoEl.style.marginTop = '5px';
        input.parentNode.insertBefore(avisoEl, input.nextSibling);
    }

    if (!nomeDigitado) {
        avisoEl.style.display = 'none';
        input.style.borderColor = '#ccc'; // Borda padrão (ajuste se seu CSS usar outra cor)
        // Se usar main.css com borda rosa, pode remover essa linha ou setar vazio
        input.style.borderColor = ''; 
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
        input.style.borderColor = '#4CAF50'; 
    }
}

function buscarMateriaisAutocomplete() {
    const termo = this.value.toLowerCase();
    const div = document.getElementById('resultados-pesquisa');
    div.innerHTML = '';
    
    if(!termo) { div.style.display = 'none'; return; }
    
    // Usa a lista de materiais exportada pelo módulo de insumos
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
        <td><button type="button" onclick="this.closest('tr').remove()">X</button></td>
    `;

    // Listeners para recálculo na linha
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

// ==========================================
// FUNÇÕES CRUD PRINCIPAIS
// ==========================================

async function cadastrarProduto() {
    const inputNome = document.getElementById('nome-produto');
    const nomeBruto = inputNome.value;
    
    if(!nomeBruto) return alert("Nome obrigatório");

    const nomeNormalizado = normalizarTexto(nomeBruto);

    // Validação duplicidade
    const nomeParaComparacao = nomeNormalizado.toLowerCase();
    const existeDuplicata = produtos.some(p => {
        if (produtoEmEdicao && p.id === produtoEmEdicao.id) return false;
        return p.nome.trim().toLowerCase() === nomeParaComparacao;
    });

    if (existeDuplicata) {
        alert(`Impossível salvar: O produto "${nomeNormalizado}" já existe.\nPor favor, utilize um nome diferente ou edite o existente.`);
        inputNome.style.borderColor = '#d32f2f';
        return;
    }

    const materiaisList = [];
    let custoTotal = 0;

    const rows = document.querySelectorAll('#tabela-materiais-produto tbody tr');
    rows.forEach(row => {
        const matId = row.cells[0].dataset.id;
        // Busca material original para garantir dados frescos
        const matOriginal = materiais.find(m => m.id === matId);
        
        // Se material foi arquivado ou não existe mais, tenta usar dados da linha (fallback arriscado, mas necessário)
        // Idealmente bloqueia, mas aqui vamos assumir que existe pois está na tabela visual
        const nomeMat = matOriginal ? matOriginal.nome : row.cells[0].innerText;
        const custoUnit = matOriginal ? matOriginal.custoUnitario : 0;

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
            material: { nome: nomeMat, custoUnitario: custoUnit }, 
            tipo,
            quantidade: qtd,
            custoTotal: custoItem,
            comprimento: comp, largura: larg, altura: alt, volume: vol, peso: peso, quantidadeMaterial: qtdMat
        });
        
        custoTotal += custoItem;
    });

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
        
        const avisoEl = document.getElementById('aviso-duplicidade-cadastro-prod');
        if(avisoEl) avisoEl.style.display = 'none';
        inputNome.style.borderColor = '';

        atualizarTabelaProdutosCadastrados();

    } catch (e) { console.error(e); alert("Erro ao salvar produto"); }
}

export function atualizarTabelaProdutosCadastrados() {
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
        btnAnt.onclick = () => { if(pagAtualProd > 1) { pagAtualProd--; atualizarTabelaProdutosCadastrados(); } };
    }
    if (btnProx) {
        btnProx.disabled = (pagAtualProd === totalPaginas);
        btnProx.onclick = () => { if(pagAtualProd < totalPaginas) { pagAtualProd++; atualizarTabelaProdutosCadastrados(); } };
    }
}

export function editarProduto(id) {
    const prod = produtos.find(p => p.id === id);
    if(!prod) return;
    
    produtoEmEdicao = prod;
    document.getElementById('nome-produto').value = prod.nome;
    const tbody = document.querySelector('#tabela-materiais-produto tbody');
    tbody.innerHTML = '';
    
    prod.materiais.forEach(item => {
        // Tenta encontrar o material na lista atual para garantir consistência
        const matReal = materiais.find(m => m.id === item.materialId);
        
        if(matReal) {
            // Se o material existe, usa ele (garante preço atualizado se for re-salvar)
            adicionarMaterialNaTabelaProduto(matReal, item);
        } else {
            // Se o material foi excluído, teríamos que recriar um objeto mock ou avisar
            // Por simplicidade, tentamos usar os dados do item se tiverem estrutura suficiente,
            // ou criamos um objeto temporário compatível
            console.warn("Material original não encontrado (pode ter sido arquivado):", item.materialId);
            
            // Mock para visualização usando dados históricos do item
            const matHistorico = {
                id: item.materialId,
                nome: item.material.nome,
                custoUnitario: item.material.custoUnitario,
                tipo: item.tipo,
                // Preenche medidas com dados do item para não quebrar a UI
                comprimentoCm: item.comprimento || 0,
                volumeMl: item.volume || 0,
                pesoG: item.peso || 0,
                larguraCm: item.largura || 0,
                alturaCm: item.altura || 0,
                quantidadeMaterial: item.quantidadeMaterial || 0
            };
            adicionarMaterialNaTabelaProduto(matHistorico, item);
        }
    });
    
    document.querySelector('#cadastrar-produto-btn').textContent = "Salvar Alterações";
    document.getElementById('cadastrar-produtos').scrollIntoView();
}

export async function removerProduto(id) {
    if(confirm("Excluir produto?")) {
        try {
            await deleteDoc(doc(db, "produtos", id));
            produtos = produtos.filter(p => p.id !== id);
            atualizarTabelaProdutosCadastrados();
        } catch(e) {
            console.error(e);
            alert("Erro ao excluir produto.");
        }
    }
}
