// assets/js/precificacao-insumos.js

import { db, auth } from './firebase-config.js';
import { 
    collection, doc, setDoc, getDocs, updateDoc, deleteDoc, addDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ==========================================
// ESTADO COMPARTILHADO (Exports)
// ==========================================
export let materiais = [];
export let maoDeObra = { salario: 0, horas: 220, valorHora: 0, incluirFerias13o: false, custoFerias13o: 0 };
export let custosIndiretosPredefinidos = [];

export let custosIndiretosPredefinidosBase = [
    { descricao: "Energia elétrica", valorMensal: 0 },
    { descricao: "Água", valorMensal: 0 },
    { descricao: "Gás", valorMensal: 0 },
    { descricao: "Aluguel do espaço", valorMensal: 0 },
    { descricao: "Depreciação de máquinas e equipamentos", valorMensal: 0 },
    { descricao: "Manutenção predial e de equipamentos", valorMensal: 0 },
    { descricao: "Despesas com segurança", valorMensal: 0 },
    { descricao: "Limpeza e conservação", valorMensal: 0 },
    { descricao: "Material de escritório", valorMensal: 0 },
    { descricao: "Impostos e taxas indiretos", valorMensal: 0 },
    { descricao: "Marketing institucional", valorMensal: 0 },
    { descricao: "Transporte e logística", valorMensal: 0 },
    { descricao: "Despesas com utilidades", valorMensal: 0 },
    { descricao: "Demais custos administrativos", valorMensal: 0 }
];

export let custosIndiretosAdicionais = [];

// Variáveis Locais de Controle
let materialEmEdicao = null;
let onMaterialUpdateCallback = null;
let inputDestinoAtualId = null; // Para saber qual input atualizar após o cálculo
let indexDestinoAtual = null;   // Para saber qual item salvar

// ==========================================
// CONFIGURAÇÃO DAS CALCULADORAS (ASSISTENTE)
// ==========================================
const calculadorasConfig = {
    'Energia elétrica': {
        titulo: 'Calc. Energia de Maquinário',
        campos: [
            { id: 'potencia', label: 'Potência da Máquina (Watts)', tipo: 'number', help: 'Veja na etiqueta atrás da máquina (ex: 400)' },
            { id: 'horasDia', label: 'Horas ligada por dia', tipo: 'number', help: 'Média de uso diário' },
            { id: 'diasMes', label: 'Dias trabalhados no mês', tipo: 'number', value: 20 },
            { id: 'tarifa', label: 'Tarifa de Energia (R$/kWh)', tipo: 'number', value: 1.20, help: 'Olhe na sua conta de luz (Preço do kWh)' }
        ],
        calcular: (v) => {
            // Fórmula: (Watts * Horas * Dias / 1000) * Tarifa
            const kwhMensal = (v.potencia * v.horasDia * v.diasMes) / 1000;
            return kwhMensal * v.tarifa;
        }
    },
    'Depreciação de máquinas e equipamentos': {
        titulo: 'Calc. Depreciação (Reserva)',
        campos: [
            { id: 'valorCompra', label: 'Valor de Compra (R$)', tipo: 'number' },
            { id: 'valorRevenda', label: 'Valor Estimado de Revenda (R$)', tipo: 'number', help: 'Por quanto venderia usada no final?' },
            { id: 'vidaUtil', label: 'Vida Útil (Anos)', tipo: 'number', value: 5, help: 'Quanto tempo pretende ficar com ela?' }
        ],
        calcular: (v) => {
            // Fórmula: (Compra - Revenda) / Meses
            const meses = v.vidaUtil * 12;
            if (meses === 0) return 0;
            return (v.valorCompra - v.valorRevenda) / meses;
        }
    },
    'Manutenção predial e de equipamentos': {
        titulo: 'Provisão de Manutenção',
        campos: [
            { id: 'gastoAnual', label: 'Gasto Anual Estimado (R$)', tipo: 'number', help: 'Soma de revisões e reparos previstos no ano' }
        ],
        calcular: (v) => { return v.gastoAnual / 12; }
    },
    'Aluguel do espaço': {
        titulo: 'Rateio de Aluguel (Home Office)',
        campos: [
            { id: 'valorTotal', label: 'Valor Total Aluguel/Condomínio (R$)', tipo: 'number' },
            { id: 'areaTotal', label: 'Área Total da Casa (m²)', tipo: 'number' },
            { id: 'areaAtelie', label: 'Área do Ateliê (m²)', tipo: 'number' }
        ],
        calcular: (v) => {
            // Regra de 3 simples
            if (v.areaTotal === 0) return 0;
            const percentual = v.areaAtelie / v.areaTotal;
            return v.valorTotal * percentual;
        }
    }
};

// ==========================================
// FUNÇÕES AUXILIARES E CONFIGURAÇÃO
// ==========================================

export function setOnMaterialUpdateCallback(callback) {
    onMaterialUpdateCallback = callback;
}

export function formatarMoeda(valor) {
    if (typeof valor !== 'number' || isNaN(valor)) return 'R$ 0,00';
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function getUnidadeSigla(tipo) {
    const map = { comprimento: 'm', litro: 'L', quilo: 'kg', area: 'm²', unidade: 'un' };
    return map[tipo] || '';
}

function calcularCustoUnitario(tipo, valorTotal, comprimentoCm, volumeMl, pesoG, larguraCm, alturaCm) {
    let custo = 0;
    if (valorTotal <= 0) return 0;

    switch (tipo) {
        case "comprimento": custo = valorTotal / (comprimentoCm / 100); break; // R$/metro
        case "litro": custo = valorTotal / (volumeMl / 1000); break; // R$/litro
        case "quilo": custo = valorTotal / (pesoG / 1000); break; // R$/kg
        case "unidade": custo = valorTotal; break; // R$/unidade
        case "area": custo = valorTotal / ((larguraCm / 100) * (alturaCm / 100)); break; // R$/m²
    }
    return custo;
}

// ==========================================
// FUNÇÃO AGRUPADORA
// ==========================================
export async function carregarDadosInsumos() {
    console.log("Carregando dados de insumos...");
    await Promise.all([
        carregarMateriais(),
        carregarMaoDeObra(),
        carregarCustosIndiretos()
    ]);
    console.log("Dados de insumos carregados.");
}

// ==========================================
// MÓDULO: MATERIAIS
// ==========================================

export async function carregarMateriais() {
    try {
        const matSnap = await getDocs(collection(db, "materiais-insumos"));
        materiais = [];
        matSnap.forEach(d => materiais.push({id: d.id, ...d.data()}));
        atualizarTabelaMateriaisInsumos();
    } catch (e) {
        console.error("Erro ao carregar materiais:", e);
    }
}

export function atualizarTabelaMateriaisInsumos() {
    const tbody = document.querySelector('#tabela-materiais-insumos tbody');
    if(!tbody) return;
    tbody.innerHTML = '';

    materiais.forEach(m => {
        const row = tbody.insertRow();
        
        let detalhes = "-";
        if (m.tipo === 'comprimento') detalhes = `${m.comprimentoCm} cm`;
        else if (m.tipo === 'litro') detalhes = `${m.volumeMl} ml`;
        else if (m.tipo === 'quilo') detalhes = `${m.pesoG} g`;
        else if (m.tipo === 'area') detalhes = `${m.larguraCm}x${m.alturaCm} cm`;

        row.innerHTML = `
            <td>${m.nome}</td>
            <td>${m.tipo}</td>
            <td>${detalhes}</td>
            <td>${formatarMoeda(m.valorTotal)}</td>
            <td>${formatarMoeda(m.custoUnitario)} / ${getUnidadeSigla(m.tipo)}</td>
            <td>
                <button class="btn-editar-mat" onclick="editarMaterialInsumo('${m.id}')">Editar</button>
                <button class="btn-remover-mat" onclick="removerMaterialInsumo('${m.id}')">Remover</button>
            </td>
        `;
    });
}

export function toggleCamposMaterial(tipo) {
    const campos = ['comprimento', 'litro', 'quilo', 'area'];
    campos.forEach(c => {
        const el = document.getElementById(`campos-${c}`);
        if(el) el.style.display = 'none';
    });
    
    const target = document.getElementById(`campos-${tipo}`);
    if(target) target.style.display = 'block';
}

export async function cadastrarMaterialInsumo() {
    const nome = document.getElementById('nome-material').value;
    const radioChecked = document.querySelector('input[name="tipo-material"]:checked');
    const tipo = radioChecked ? radioChecked.value : 'comprimento';
    
    const valorTotal = parseFloat(document.getElementById('valor-total-material').value) || 0;

    const comprimentoCm = parseFloat(document.getElementById('comprimento-cm').value) || 0;
    const volumeMl = parseFloat(document.getElementById('volume-ml').value) || 0;
    const pesoG = parseFloat(document.getElementById('peso-g').value) || 0;
    const larguraCm = parseFloat(document.getElementById('largura-cm').value) || 0;
    const alturaCm = parseFloat(document.getElementById('altura-cm').value) || 0;

    if(!nome || valorTotal <= 0) {
        alert("Preencha o nome e o valor total corretamente.");
        return;
    }

    const custoUnitario = calcularCustoUnitario(tipo, valorTotal, comprimentoCm, volumeMl, pesoG, larguraCm, alturaCm);

    const materialData = {
        nome, tipo, valorTotal, 
        comprimentoCm, volumeMl, pesoG, larguraCm, alturaCm,
        custoUnitario
    };

    try {
        if(materialEmEdicao) {
            await updateDoc(doc(db, "materiais-insumos", materialEmEdicao.id), materialData);
            
            const idx = materiais.findIndex(m => m.id === materialEmEdicao.id);
            if(idx !== -1) materiais[idx] = { id: materialEmEdicao.id, ...materialData };
            
            if(onMaterialUpdateCallback) await onMaterialUpdateCallback(materiais[idx]);
            
            alert("Material atualizado com sucesso!");
            materialEmEdicao = null;
            const btn = document.querySelector('#cadastrar-material-insumo-btn');
            if(btn) btn.textContent = "Cadastrar Material";
        } else {
            const ref = await addDoc(collection(db, "materiais-insumos"), materialData);
            materialData.id = ref.id;
            materiais.push(materialData);
            alert("Material cadastrado!");
        }

        const form = document.getElementById('form-materiais-insumos');
        if(form) form.reset();
        toggleCamposMaterial('comprimento'); 
        atualizarTabelaMateriaisInsumos();

    } catch (e) {
        console.error(e);
        alert("Erro ao salvar material.");
    }
}

export function editarMaterialInsumo(id) {
    const m = materiais.find(x => x.id === id);
    if(!m) return;
    materialEmEdicao = m;
    
    const nomeEl = document.getElementById('nome-material');
    const valEl = document.getElementById('valor-total-material');
    if(nomeEl) nomeEl.value = m.nome;
    if(valEl) valEl.value = m.valorTotal;
    
    const radio = document.querySelector(`input[name="tipo-material"][value="${m.tipo}"]`);
    if(radio) {
        radio.checked = true;
        toggleCamposMaterial(m.tipo);
    }

    if(m.tipo === 'comprimento') document.getElementById('comprimento-cm').value = m.comprimentoCm;
    if(m.tipo === 'litro') document.getElementById('volume-ml').value = m.volumeMl;
    if(m.tipo === 'quilo') document.getElementById('peso-g').value = m.pesoG;
    if(m.tipo === 'area') {
        document.getElementById('largura-cm').value = m.larguraCm;
        document.getElementById('altura-cm').value = m.alturaCm;
    }
    
    const btn = document.querySelector('#cadastrar-material-insumo-btn');
    if(btn) btn.textContent = "Salvar Alterações";
    
    const section = document.getElementById('materiais-insumos');
    if(section) section.scrollIntoView({behavior: "smooth"});
}

export async function removerMaterialInsumo(id) {
    if(confirm("Deseja realmente excluir este material?")) {
        try {
            await deleteDoc(doc(db, "materiais-insumos", id));
            materiais = materiais.filter(m => m.id !== id);
            atualizarTabelaMateriaisInsumos();
        } catch(e) {
            console.error(e);
            alert("Erro ao remover material.");
        }
    }
}

export function buscarMateriaisCadastrados() {
    const buscaEl = document.getElementById('busca-material');
    if(!buscaEl) return;
    
    const termo = buscaEl.value.toLowerCase();
    const rows = document.querySelectorAll('#tabela-materiais-insumos tbody tr');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(termo) ? '' : 'none';
    });
}

// ==========================================
// MÓDULO: MÃO DE OBRA
// ==========================================

export async function carregarMaoDeObra() {
    try {
        const moDoc = await getDoc(doc(db, "configuracoes", "maoDeObra"));
        if (moDoc.exists()) maoDeObra = { ...maoDeObra, ...moDoc.data() };
        preencherCamposMaoDeObra();
    } catch (e) {
        console.error("Erro ao carregar Mão de Obra:", e);
    }
}

export async function salvarMaoDeObra() {
    const salarioEl = document.getElementById('salario-receber');
    const horasEl = document.getElementById('horas-trabalhadas');
    const feriasEl = document.getElementById('incluir-ferias-13o-sim');

    if(!salarioEl || !horasEl) return;

    const salario = parseFloat(salarioEl.value);
    const horas = parseFloat(horasEl.value);
    const incluirFerias = feriasEl ? feriasEl.checked : false;

    if(!salario || !horas) return alert("Preencha salário e horas.");

    const valorHora = salario / horas;
    
    // FÓRMULA CORRIGIDA: Encargos = (13º + 1/3 Férias)
    let custoEncargos = 0;
    if (incluirFerias) {
        const decimoTerceiro = salario;       
        const umTercoFerias = salario / 3;    
        const totalDireitosAnual = decimoTerceiro + umTercoFerias;
        custoEncargos = (totalDireitosAnual / 12) / horas;
    }

    maoDeObra = { salario, horas, valorHora, incluirFerias13o: incluirFerias, custoFerias13o: custoEncargos };

    try {
        await setDoc(doc(db, "configuracoes", "maoDeObra"), maoDeObra);
        preencherCamposMaoDeObra();
        toggleEdicaoMaoDeObra(false);
        atualizarTabelaCustosIndiretos(); // Atualiza pois depende da hora
        alert("Mão de Obra Salva!");
    } catch(e) {
        console.error(e);
        alert("Erro ao salvar configuração de mão de obra.");
    }
}

function preencherCamposMaoDeObra() {
    const elSalario = document.getElementById('salario-receber');
    const elHoras = document.getElementById('horas-trabalhadas');
    const elValorHora = document.getElementById('valor-hora');
    const elCustoExtra = document.getElementById('custo-ferias-13o');
    
    if(elSalario) elSalario.value = maoDeObra.salario;
    if(elHoras) elHoras.value = maoDeObra.horas;
    if(elValorHora) elValorHora.value = maoDeObra.valorHora.toFixed(2);
    if(elCustoExtra) elCustoExtra.value = maoDeObra.custoFerias13o.toFixed(2);
    
    if(maoDeObra.incluirFerias13o) {
        const sim = document.getElementById('incluir-ferias-13o-sim');
        if(sim) sim.checked = true;
    } else {
        const nao = document.getElementById('incluir-ferias-13o-nao');
        if(nao) nao.checked = true;
    }
    
    if (maoDeObra.salario === 0) {
        toggleEdicaoMaoDeObra(true);
    } else {
        toggleEdicaoMaoDeObra(false);
    }
}

export function editarMaoDeObraUI() {
    toggleEdicaoMaoDeObra(true);
}

function toggleEdicaoMaoDeObra(editando) {
    const salario = document.getElementById('salario-receber');
    const horas = document.getElementById('horas-trabalhadas');
    const btnSalvar = document.getElementById('btn-salvar-mao-de-obra');
    const btnEditar = document.getElementById('btn-editar-mao-de-obra');

    if(salario) salario.readOnly = !editando;
    if(horas) horas.readOnly = !editando;
    if(btnSalvar) btnSalvar.style.display = editando ? 'inline-block' : 'none';
    if(btnEditar) btnEditar.style.display = editando ? 'none' : 'inline-block';

    if (editando && salario && horas) {
        const updateCalculo = () => {
            const s = parseFloat(salario.value) || 0;
            const h = parseFloat(horas.value) || 0;
            const elValorHora = document.getElementById('valor-hora');
            if(h > 0 && elValorHora) {
                elValorHora.value = (s / h).toFixed(2);
            }
        };
        salario.oninput = updateCalculo;
        horas.oninput = updateCalculo;
    }
}

// ==========================================
// MÓDULO: CUSTOS INDIRETOS (COM CALCULADORA)
// ==========================================

export async function carregarCustosIndiretos() {
    try {
        custosIndiretosPredefinidos = JSON.parse(JSON.stringify(custosIndiretosPredefinidosBase));

        const ciPreSnap = await getDocs(collection(db, "custos-indiretos-predefinidos"));
        ciPreSnap.forEach(d => {
            const data = d.data();
            const idx = custosIndiretosPredefinidos.findIndex(c => c.descricao === data.descricao);
            if (idx !== -1) {
                // Carrega o valor e os parâmetros salvos (para persistência - Prioridade 2)
                custosIndiretosPredefinidos[idx] = data;
            }
        });

        const ciAddSnap = await getDocs(collection(db, "custos-indiretos-adicionais"));
        custosIndiretosAdicionais = [];
        ciAddSnap.forEach(d => custosIndiretosAdicionais.push({id: d.id, ...d.data()}));

        carregarCustosIndiretosPredefinidosUI();
        atualizarTabelaCustosIndiretos();
    } catch(e) {
        console.error("Erro ao carregar custos indiretos:", e);
    }
}

// ATUALIZADO: Inclusão do botão de calculadora
export function carregarCustosIndiretosPredefinidosUI() {
    const lista = document.getElementById('lista-custos-indiretos');
    if(!lista) return;
    lista.innerHTML = '';

    // Renderiza Predefinidos
    custosIndiretosPredefinidosBase.forEach((base, idx) => {
        const atual = custosIndiretosPredefinidos.find(c => c.descricao === base.descricao) || base;
        
        // Verifica se existe calculadora para este item no calculadorasConfig
        const temCalculadora = calculadorasConfig.hasOwnProperty(base.descricao);
        
        // Ícone SVG de Calculadora
        const btnCalcHTML = temCalculadora 
            ? `<button class="btn-calc-trigger" onclick="abrirCalculadoraCustos('${base.descricao}', ${idx})" title="Assistente de Cálculo" type="button" style="background:none; border:none; cursor:pointer; vertical-align:middle; color:#7aa2a9;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                   <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                   <line x1="8" y1="6" x2="16" y2="6"></line>
                   <line x1="16" y1="14" x2="16" y2="14"></line>
                   <line x1="8" y1="14" x2="8" y2="14"></line>
                   <line x1="12" y1="14" x2="12" y2="14"></line>
                   <line x1="16" y1="18" x2="16" y2="18"></line>
                   <line x1="8" y1="18" x2="8" y2="18"></line>
                   <line x1="12" y1="18" x2="12" y2="18"></line>
                 </svg>
               </button>` 
            : '';

        const li = document.createElement('li');
        li.innerHTML = `
            <div class="custo-item-nome">
                ${base.descricao}
                ${btnCalcHTML}
            </div>
            <input type="number" id="ci-pref-${idx}" value="${(atual.valorMensal || 0).toFixed(2)}" step="0.01">
            <button onclick="salvarCustoIndiretoPredefinido('${base.descricao}', ${idx})">Salvar</button>
        `;
        lista.appendChild(li);
    });

    // Renderiza Adicionais
    custosIndiretosAdicionais.forEach(add => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="custo-item-nome">${add.descricao}</div>
            <input type="number" value="${add.valorMensal.toFixed(2)}" readonly>
            <button onclick="removerCustoIndiretoAdicional('${add.id}')">Remover</button>
        `;
        lista.appendChild(li);
    });
}

// ATUALIZADO: Suporte a salvar parâmetros opcionais
export async function salvarCustoIndiretoPredefinido(descricao, idx, parametrosOpcionais = null) {
    const input = document.getElementById(`ci-pref-${idx}`);
    let val = 0;
    
    if (input) {
        val = parseFloat(input.value) || 0;
    } else if (idx === -1) { 
        val = 0;
    } else {
        return; 
    }

    // Se vierem parâmetros da calculadora, usa-os. Se não, tenta manter os existentes ou nulo.
    const arrIdx = custosIndiretosPredefinidos.findIndex(c => c.descricao === descricao);
    const paramsAtuais = (arrIdx !== -1) ? custosIndiretosPredefinidos[arrIdx].parametros : null;
    
    const finalParams = parametrosOpcionais || paramsAtuais || null;

    const item = { 
        descricao, 
        valorMensal: val, 
        valorPorHora: val / maoDeObra.horas,
        parametros: finalParams // Salva os dados técnicos (Watts, Horas, etc.)
    };
    
    if(arrIdx !== -1) custosIndiretosPredefinidos[arrIdx] = item;
    else custosIndiretosPredefinidos.push(item);
    
    try {
        await setDoc(doc(db, "custos-indiretos-predefinidos", descricao), item);
        atualizarTabelaCustosIndiretos();
        // Não alerta se for zeramento automático ou chamada interna da calculadora
        if(idx !== -1 && !parametrosOpcionais) alert("Custo salvo!"); 
    } catch(e) {
        console.error(e);
        if(idx !== -1) alert("Erro ao salvar custo.");
    }
}

export function adicionarNovoCustoIndireto() {
    const lista = document.getElementById('lista-custos-indiretos');
    if(!lista) return;

    const li = document.createElement('li');
    li.innerHTML = `
        <input type="text" placeholder="Nome do Custo" class="novo-ci-nome">
        <input type="number" placeholder="Valor Mensal" class="novo-ci-valor">
        <button class="btn-salvar-novo-ci">Salvar</button>
    `;
    lista.appendChild(li);
    
    const btn = li.querySelector('.btn-salvar-novo-ci');
    if(btn) {
        btn.onclick = async () => {
            const nome = li.querySelector('.novo-ci-nome').value;
            const valor = parseFloat(li.querySelector('.novo-ci-valor').value);
            
            if(nome && valor >= 0) {
                const novo = { descricao: nome, valorMensal: valor, valorPorHora: valor / maoDeObra.horas };
                try {
                    const ref = await addDoc(collection(db, "custos-indiretos-adicionais"), novo);
                    novo.id = ref.id;
                    custosIndiretosAdicionais.push(novo);
                    carregarCustosIndiretosPredefinidosUI(); 
                    atualizarTabelaCustosIndiretos();
                } catch(e) {
                    console.error(e);
                    alert("Erro ao adicionar custo extra.");
                }
            }
        };
    }
}

export async function removerCustoIndiretoAdicional(id) {
    if(confirm("Remover este custo adicional?")) {
        try {
            await deleteDoc(doc(db, "custos-indiretos-adicionais", id));
            custosIndiretosAdicionais = custosIndiretosAdicionais.filter(c => c.id !== id);
            carregarCustosIndiretosPredefinidosUI();
            atualizarTabelaCustosIndiretos();
        } catch(e) {
            console.error(e);
            alert("Erro ao remover custo.");
        }
    }
}

export async function zerarCustoIndireto(descricao, idOpcional) {
    if(!confirm(`Deseja zerar o custo de "${descricao}"? Ele sairá desta lista.`)) return;

    if (idOpcional && idOpcional !== 'undefined' && idOpcional !== undefined) {
        await removerCustoIndiretoAdicional(idOpcional);
    } else {
        const item = { descricao, valorMensal: 0, valorPorHora: 0, parametros: null }; // Reseta parâmetros também
        const arrIdx = custosIndiretosPredefinidos.findIndex(c => c.descricao === descricao);
        if(arrIdx !== -1) custosIndiretosPredefinidos[arrIdx] = item;
        
        try {
            await setDoc(doc(db, "custos-indiretos-predefinidos", descricao), item);
            carregarCustosIndiretosPredefinidosUI(); 
            atualizarTabelaCustosIndiretos(); 
        } catch(e) { 
            console.error("Erro ao zerar custo predefinido:", e); 
        }
    }
}

export function atualizarTabelaCustosIndiretos() {
    const tbody = document.querySelector('#tabela-custos-indiretos tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const todos = [...custosIndiretosPredefinidos, ...custosIndiretosAdicionais];
    
    todos.filter(c => c.valorMensal > 0).forEach(c => {
        const row = tbody.insertRow();
        const horasDivisor = maoDeObra.horas || 220;
        const vHora = c.valorMensal / horasDivisor;
        
        const idParam = c.id ? `'${c.id}'` : 'undefined';
        
        row.innerHTML = `
            <td>${c.descricao}</td>
            <td>${formatarMoeda(c.valorMensal)}</td>
            <td>${formatarMoeda(vHora)}</td>
            <td>
                <button class="btn-zerar" onclick="zerarCustoIndireto('${c.descricao}', ${idParam})">Zerar</button>
            </td>
        `;
    });
}

export function buscarCustosIndiretosCadastrados() {
    const el = document.getElementById('busca-custo-indireto');
    if(!el) return;

    const termo = el.value.toLowerCase();
    const rows = document.querySelectorAll('#tabela-custos-indiretos tbody tr');
    rows.forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(termo) ? '' : 'none';
    });
}

// ==========================================
// FUNÇÕES DA CALCULADORA (JANELA MODAL)
// ==========================================

window.abrirCalculadoraCustos = function(descricao, index) {
    const config = calculadorasConfig[descricao];
    if (!config) return; 

    inputDestinoAtualId = `ci-pref-${index}`;
    indexDestinoAtual = index;
    
    // Prioridade 2: Buscar parâmetros salvos para preencher
    const itemSalvo = custosIndiretosPredefinidos.find(c => c.descricao === descricao);
    const paramsSalvos = itemSalvo ? itemSalvo.parametros : {};

    // Configurar título e corpo
    document.getElementById('titulo-calculadora').innerText = config.titulo;
    const form = document.getElementById('form-calculadora-dinamica');
    form.innerHTML = ''; 

    config.campos.forEach(campo => {
        // Prioridade de valor: Parâmetro Salvo > Valor Padrão da Config > Vazio
        const valorInicial = paramsSalvos && paramsSalvos[campo.id] !== undefined 
            ? paramsSalvos[campo.id] 
            : (campo.value !== undefined ? campo.value : '');

        const div = document.createElement('div');
        div.className = 'calc-group';
        div.innerHTML = `
            <label>${campo.label}</label>
            <input type="number" step="0.01" id="calc-${campo.id}" value="${valorInicial}" oninput="recalcularPrevia('${descricao}')">
            ${campo.help ? `<div class="calc-help">${campo.help}</div>` : ''}
        `;
        form.appendChild(div);
    });

    // Resetar prévia ou calcular se já tiver dados
    if (paramsSalvos && Object.keys(paramsSalvos).length > 0) {
        window.recalcularPrevia(descricao);
    } else {
        document.querySelector('#resultado-previo-calc strong').innerText = 'R$ 0,00';
    }
    
    // Exibir Modal
    const modal = document.getElementById('modal-calculadora-custos');
    if(modal) modal.style.display = 'flex';
    
    // Configurar botão de confirmação
    const btnConfirm = document.getElementById('btn-confirmar-calculo');
    if(btnConfirm) {
        // Remove listeners antigos clonando o nó (solução rápida para evitar múltiplos binds)
        const newBtn = btnConfirm.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
        newBtn.onclick = () => aplicarCalculo(descricao);
    }
};

window.recalcularPrevia = function(descricao) {
    const config = calculadorasConfig[descricao];
    const valores = {};
    
    config.campos.forEach(c => {
        const val = parseFloat(document.getElementById(`calc-${c.id}`).value);
        valores[c.id] = isNaN(val) ? 0 : val;
    });

    const resultado = config.calcular(valores);
    document.querySelector('#resultado-previo-calc strong').innerText = formatarMoeda(resultado);
};

function aplicarCalculo(descricao) {
    const config = calculadorasConfig[descricao];
    const valoresParametros = {};
    
    // Captura os valores dos inputs da calculadora
    config.campos.forEach(c => {
        const val = parseFloat(document.getElementById(`calc-${c.id}`).value);
        valoresParametros[c.id] = isNaN(val) ? 0 : val;
    });

    // Calcula o valor final
    const resultadoFinal = config.calcular(valoresParametros);

    // Injeta no input original da lista visual
    const inputAlvo = document.getElementById(inputDestinoAtualId);
    if(inputAlvo) {
        inputAlvo.value = resultadoFinal.toFixed(2);
    }

    // Salva no Firestore: Valor + Parâmetros (Prioridade 2)
    salvarCustoIndiretoPredefinido(descricao, indexDestinoAtual, valoresParametros);

    window.fecharCalculadoraCustos();
}

window.fecharCalculadoraCustos = function() {
    const modal = document.getElementById('modal-calculadora-custos');
    if(modal) modal.style.display = 'none';
};

// ==========================================
// EXPOR FUNÇÕES AO ESCOPO GLOBAL (WINDOW)
// ==========================================

window.editarMaterialInsumo = editarMaterialInsumo;
window.removerMaterialInsumo = removerMaterialInsumo;
window.buscarMateriaisCadastrados = buscarMateriaisCadastrados;

window.editarMaoDeObraUI = editarMaoDeObraUI;

window.salvarCustoIndiretoPredefinido = salvarCustoIndiretoPredefinido;
window.removerCustoIndiretoAdicional = removerCustoIndiretoAdicional;
window.buscarCustosIndiretosCadastrados = buscarCustosIndiretosCadastrados;
window.zerarCustoIndireto = zerarCustoIndireto;
