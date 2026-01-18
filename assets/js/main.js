// assets/js/main.js

// 1. IMPORTAÇÕES
import { auth } from './firebase-config.js'; // Nossa configuração central
import { onAuthStateChanged, signOut, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { initOrcamentos } from './orcamentos.js';
import { initPrecificacao } from './precificacao.js';
// Importação do módulo de Changelog
import { initChangelog } from './changelog.js';

// 2. REFERÊNCIAS AOS ELEMENTOS DO DOM (Telas)
const screens = {
    auth: document.getElementById('auth-screen'),
    hub: document.getElementById('hub-screen'),
    orcamentos: document.getElementById('module-orcamentos'),
    precificacao: document.getElementById('module-precificacao'),
    estoque: document.getElementById('estoque') // Nova referência para o módulo de Estoque
};

// Referências aos Botões e Inputs
const btnLogin = document.getElementById('loginBtn');
const btnLogout = document.getElementById('hubLogoutBtn');
const btnGoOrcamentos = document.getElementById('btn-go-orcamentos');
const btnGoPrecificacao = document.getElementById('btn-go-precificacao');
const btnsBackToHub = document.querySelectorAll('.btn-back-hub');
const authMessage = document.getElementById('auth-message');

// 3. FUNÇÃO DE NAVEGAÇÃO (ROTEAMENTO)
function navigateTo(screenName) {
    // Esconde todas as telas registradas
    Object.values(screens).forEach(el => {
        if(el) el.style.display = 'none';
    });

    // Mostra a tela desejada
    if(screens[screenName]) {
        screens[screenName].style.display = 'block';
    } else {
        console.error(`Tela "${screenName}" não encontrada.`);
    }
}

// 4. INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', () => {
    
    // Inicializar widget de versão
    initChangelog();

    // Controle Inicial da Splash Screen
    // Garantimos que ela comece OCULTA para não bloquear a tela de login.
    const splash = document.getElementById('splash-screen');
    if(splash) {
        splash.style.display = 'none';
    }
});

// 5. MONITOR DE ESTADO DE AUTENTICAÇÃO (O "Porteiro")
onAuthStateChanged(auth, (user) => {
    const splash = document.getElementById('splash-screen');
    const authScreen = document.getElementById('auth-screen');

    if (user) {
        // === USUÁRIO LOGADO ===
        console.log("Usuário autenticado:", user.email);
        
        // Atualiza interface do Hub (Badge de Usuário)
        const userDisplay = document.getElementById('user-email-display');
        if(userDisplay) userDisplay.textContent = user.email;

        // Inicializa os módulos em segundo plano (carrega dados)
        initOrcamentos();
        initPrecificacao();

        // LÓGICA DE TRANSIÇÃO (Splash como Boas-vindas)
        if (splash) {
            // Se a tela de Auth estiver visível, esconda imediatamente
            if(authScreen) authScreen.style.display = 'none';
            
            // Exibe o Splash para criar a transição suave para o Hub
            splash.style.display = 'flex';
            splash.style.opacity = '1';

            // Timer para a duração da Splash (Experiência de "Carregando/Bem-vindo")
            setTimeout(() => {
                // Efeito de Fade Out
                splash.style.opacity = '0';
                
                // Aguarda a transição CSS (0.5s) terminar para remover do DOM e mostrar o Hub
                setTimeout(() => {
                    splash.style.display = 'none';
                    navigateTo('hub'); 
                }, 500);
                
            }, 2000); // Exibe a Splash por 2 segundos antes de liberar o acesso
        } else {
            // Fallback caso não exista splash no HTML
            navigateTo('hub');
        }

    } else {
        // === USUÁRIO DESCONECTADO ===
        console.log("Nenhum usuário autenticado.");
        
        // Garante que a splash não esteja visível atrapalhando o login
        if (splash) splash.style.display = 'none';

        // Redireciona para a tela de Autenticação
        navigateTo('auth');
        
        // Nota: navigateTo usa 'block', mas auth usa flex no CSS para centralização. Ajuste:
        if(screens.auth) screens.auth.style.display = 'flex';
    }
});

// 6. LÓGICA DE LOGIN (Ação do botão Entrar)
if(btnLogin) {
    btnLogin.addEventListener('click', async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        if (!email || !password) {
            authMessage.textContent = "Por favor, preencha email e senha.";
            authMessage.style.color = "red";
            return;
        }

        authMessage.textContent = "Entrando...";
        authMessage.style.color = "#555";

        try {
            await signInWithEmailAndPassword(auth, email, password);
            // O onAuthStateChanged vai lidar com a transição (Splash -> Hub) automaticamente
            authMessage.textContent = "";
        } catch (error) {
            console.error("Erro no login:", error);
            let msg = "Erro ao entrar.";
            if(error.code === 'auth/wrong-password') msg = "Senha incorreta.";
            if(error.code === 'auth/user-not-found') msg = "Usuário não encontrado.";
            if(error.code === 'auth/invalid-email') msg = "Email inválido.";
            
            authMessage.textContent = msg;
            authMessage.style.color = "red";
        }
    });
}

// 7. LÓGICA DE LOGOUT (Sair do Sistema)
if(btnLogout) {
    btnLogout.addEventListener('click', async () => {
        try {
            await signOut(auth);
            // O onAuthStateChanged vai redirecionar para 'auth' imediatamente
        } catch (error) {
            console.error("Erro ao sair:", error);
            alert("Não foi possível sair no momento.");
        }
    });
}

// 8. NAVEGAÇÃO DO HUB (Botões dos Módulos)
if(btnGoOrcamentos) {
    btnGoOrcamentos.addEventListener('click', () => {
        navigateTo('orcamentos');
    });
}

if(btnGoPrecificacao) {
    btnGoPrecificacao.addEventListener('click', () => {
        navigateTo('precificacao');
    });
}

// 9. BOTÃO "VOLTAR AO MENU" (Presente nos módulos)
btnsBackToHub.forEach(btn => {
    btn.addEventListener('click', () => {
        navigateTo('hub');
    });
});
