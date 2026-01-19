// assets/js/firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    orderBy,
    runTransaction, 
    setDoc, 
    getDoc,
    writeBatch // [CORREÇÃO PRIORIDADE 1] Importação adicionada para uso no Estoque
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC4xXSGw91MPLbC3ikCsdJ4pkNu1GZTqKQ",
  authDomain: "teste-da-perola.firebaseapp.com",
  projectId: "teste-da-perola",
  storageBucket: "teste-da-perola.firebasestorage.app",
  messagingSenderId: "845747978306",
  appId: "1:845747978306:web:90314c25caf38106bc6ddb",
  measurementId: "G-BLJ0S9GZLE"
};

// Declaração das variáveis
let app, auth, db;

// [MELHORIA PRIORIDADE 3] Blindagem de Inicialização com Aviso Visual
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("Firebase Core: Inicializado com sucesso."); // Health Check
} catch (error) {
    console.error("FATAL: Erro ao inicializar Firebase.", error);
    // Aviso visual para o usuário não ficar com tela branca eterna em caso de falha grave de config
    alert("Erro crítico de sistema: Falha na conexão com o banco de dados. Por favor, verifique sua internet e recarregue a página.");
}

// Exportamos as instâncias e funções utilitárias do Firestore
export { 
    app, 
    auth, 
    db,
    // Exportações de Funções do Firestore
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    orderBy,
    runTransaction, 
    setDoc,         
    getDoc,
    writeBatch // [CORREÇÃO PRIORIDADE 1] Exportação adicionada para corrigir o SyntaxError
};
