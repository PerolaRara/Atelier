// assets/js/precificacao-produtos.js

import { db, auth } from './firebase-config.js'; // [MODIFICADO] Adicionado auth
import { 
    collection, doc, addDoc, getDocs, updateDoc, deleteDoc, query, where // [MODIFICADO] Adicionado query e where
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
    const user = auth.currentUser; // [MODIFICADO] Captura usuário
    if (!user) return;

    try {
        // [MODIFICADO] Filtra produtos pelo ID do usuário logado
        const q = query(collection(db, "produtos"), where("ownerId", "==", user.uid));
        const prodSnap = await getDocs(q);
        
        produtos = [];
        prodSnap.forEach(d => produtos.push({id: d.id, ...d.data()}));
        atualizarTabelaProdutosCadastrados();
        console.log(`Produtos carregados para ${user.email}:`, produtos.length);
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
    
    // A lista 'produtos' já está filtrada por usuário em carregarProdutos(),
    // então a atualização afetará apenas os produtos do usuário logado.
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

        // Atualiza no banco
        await updateDoc(doc(db, "produtos", prod.id), {
            materiais: prod.materiais,
            custoTotal: prod.custoTotal
        });
    }
    
    if (produtosAfetados.length > 0) {
        atualizarTabelaProdutosCadastrados();
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
    // Filtra apenas materiais ATIVOS para novas adições
    // OBS: A lista 'materiais' importada já estará filtrada pelo precificacao-insumos.js
    const results = materiais.filter(m => m.ativo !== false && m.nome.toLowerCase().includes(termo));
    
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

function adicionarMaterialNaTabelaProduto(mat, dadosSalvos = null, statusInativo = false) {
    const tbody = document.querySelector('#tabela-materiais-produto tbody');
    const row = tbody.insertRow();
    
    // Configuração Visual para Itens Inativos/Excluídos
    let nomeDisplay = mat.nome;
    let classeBotao = "";
    
    if (statusInativo) {
        row.classList.add('row-arquivado'); // Classe definida no CSS para fundo vermelho suave
        nomeDisplay = `⚠️ ${mat.nome} <span class="aviso-material-inativo">(Descontinuado)</span>`;
        classeBotao = "btn-alerta-remocao"; // Sugestão visual para o botão remover
    }

    let inputDimensao = '';
    let valDimensao = 0;

    // AQUI ESTÁ A ALTERAÇÃO: Removemos style="width:..." para o CSS controlar o tamanho
    if (mat.tipo === 'comprimento') {
        valDimensao = dadosSalvos ? dadosSalvos.comprimento : mat.comprimentoCm;
        inputDimensao = `<input type="number" class="dim-input" value="${valDimensao}"> cm`;
    } else if (mat.tipo === 'area') {
        const l = dadosSalvos ? dadosSalvos.largura : mat.larguraCm;
        const a = dadosSalvos ? dadosSalvos.altura : mat.alturaCm;
        inputDimensao = `<input type="number" class="dim-l" value="${l}"> x <input type="number" class="dim-a" value="${a}"> cm`;
    } else if (mat.tipo === 'litro') {
        valDimensao = dadosSalvos ? dadosSalvos.volume : mat.volumeMl;
        inputDimensao = `<input type="number" class="dim-input" value="${valDimensao}"> ml`;
    } else if (mat.tipo === 'quilo') {
        valDimensao = dadosSalvos ? dadosSalvos.peso : mat.pesoG;
        inputDimensao = `<input type="number" class="dim-input" value="${valDimensao}"> g`;
    } else {
        const qtdUn = dadosSalvos ? dadosSalvos.quantidadeMaterial : 1;
        inputDimensao = `<input type="number" class="dim-input" value="${qtdUn}"> un`;
    }

    const qtd = dadosSalvos ? dadosSalvos.quantidade : 1;
    
    // Salva o nome original puro em dataset para recuperação segura no cadastro
    const nomePuro = mat.nome || "(Sem nome)";

    row.innerHTML = `
        <td data-id="${mat.id}" data-nome-original="${nomePuro}">${nomeDisplay}</td>
        <td>${mat.tipo}</td>
        <td>${formatarMoeda(mat.custoUnitario)}</td>
        <td class="cell-dimensao">${inputDimensao}</td>
        <td><input type="number" class="qtd-input" value="${qtd}"></td>
        <td class="custo-total-item">R$ 0,00</td>
        <td><button type="button" class="${classeBotao}" onclick="this.closest('tr').remove()">X</button></td>
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
    const user = auth.currentUser; // [MODIFICADO] Captura usuário
    if (!user) return alert("Sessão expirada. Faça login novamente.");

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

    // === TRAVA DE SEGURANÇA: Verificação de Itens Fantasmas/Arquivados ===
    const itensArquivados = document.querySelectorAll('.row-arquivado');
    let possuiDadosDefasados = false;

    if (itensArquivados.length > 0) {
        const confirmar = confirm(
            `⚠️ ATENÇÃO: Este produto contém ${itensArquivados.length} material(is) descontinuado(s) ou excluído(s).\n\n` +
            `Manter esses itens pode gerar cálculos de custo incorretos.\n\n` +
            `Recomendamos remover as linhas vermelhas e adicionar os materiais substitutos ativos.\n\n` +
            `Deseja SALVAR mesmo assim, mantendo os dados antigos?`
        );
        
        if (!confirmar) return; // Cancela o salvamento
        possuiDadosDefasados = true; // Marca flag para auditoria
    }
    // ======================================================================

    const materiaisList = [];
    let custoTotal = 0;

    const rows = document.querySelectorAll('#tabela-materiais-produto tbody tr');
    rows.forEach(row => {
        const matId = row.cells[0].dataset.id;
        // Busca material original para garantir dados frescos
        // NOTA: 'materiais' é importado e já deve estar filtrado por usuário pelo outro módulo
        const matOriginal = materiais.find(m => m.id === matId);
        
        // Se material foi arquivado ou não existe mais, usa o dado salvo no dataset (fallback seguro)
        // para evitar salvar HTML de alerta (emojis) no nome.
        const nomeMat = matOriginal ? matOriginal.nome : (row.cells[0].dataset.nomeOriginal || row.cells[0].innerText);
        const custoUnit = matOriginal ? matOriginal.custoUnitario : 0; // Se não existir, custo unitário 0

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

    // Adiciona flag de auditoria se houver dados defasados
    const prodData = { 
        ownerId: user.uid, // [MODIFICADO] Vincula ao dono
        nome: nomeNormalizado, 
        materiais: materiaisList, 
        custoTotal,
        dadosDefasados: possuiDadosDefasados,
        ultimaAtualizacao: new Date().toISOString()
    };

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
    
    // 1. Filtragem (Busca)
    const termo = termoBuscaProd.trim().toLowerCase();
    const filtrados = produtos.filter(p => p.nome.toLowerCase().includes(termo));
    
    // 2. Ordenação (Alfabética A-Z) - Garantida
    filtrados.sort((a,b) => a.nome.localeCompare(b.nome));

    // 3. Paginação
    const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA) || 1;
    if (pagAtualProd > totalPaginas) pagAtualProd = totalPaginas;
    if (pagAtualProd < 1) pagAtualProd = 1;

    const inicio = (pagAtualProd - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const itensPagina = filtrados.slice(inicio, fim);

    // 4. Renderização
    if (itensPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum produto encontrado.</td></tr>';
    } else {
        itensPagina.forEach(p => {
            const row = tbody.insertRow();
            
            // Indicador visual na lista se o produto estiver marcado como defasado
            const alertaDefasado = p.dadosDefasados ? '<span title="Contém insumos descontinuados" style="color:#d32f2f; cursor:help;">⚠️</span> ' : '';

            row.innerHTML = `
                <td>${alertaDefasado}${p.nome}</td>
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

    // 5. Atualizar Controles de Paginação
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
        
        let materialParaRenderizar = null;
        let isInativo = false;

        if(matReal) {
            // Caso 1: Material existe no cadastro (filtrado por usuário)
            if (matReal.ativo === false) {
                // Existe, mas foi arquivado/desativado
                isInativo = true;
                materialParaRenderizar = matReal;
            } else {
                // Existe e está ativo (Cenário Ideal)
                isInativo = false;
                materialParaRenderizar = matReal;
            }
        } else {
            // Caso 2: Material foi excluído ou pertence a outro usuário (isolamento)
            // Se pertence a outro usuário, aparecerá como inexistente aqui, o que é correto
            console.warn("Material original não encontrado (pode ter sido excluído ou pertence a outro usuário):", item.materialId);
            isInativo = true;
            
            // Cria objeto Mock com dados históricos salvos dentro do item do produto
            materialParaRenderizar = {
                id: item.materialId,
                nome: item.material ? item.material.nome : "(Nome Indisponível)",
                custoUnitario: item.material ? item.material.custoUnitario : 0,
                tipo: item.tipo,
                comprimentoCm: item.comprimento || 0,
                volumeMl: item.volume || 0,
                pesoG: item.peso || 0,
                larguraCm: item.largura || 0,
                alturaCm: item.altura || 0,
                quantidadeMaterial: item.quantidadeMaterial || 0,
                ativo: false 
            };
        }

        // Renderiza com a flag de inativo se necessário
        adicionarMaterialNaTabelaProduto(materialParaRenderizar, item, isInativo);
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
