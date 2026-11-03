/**
 * ═══════════════════════════════════════════════════════════════
 * app.js — Lógica do painel LED: Robô Literário
 * ═══════════════════════════════════════════════════════════════
 */

/* ───────────────────────────────────────────────────────────────
   1. UTILITÁRIOS GLOBAIS 
─────────────────────────────────────────────────────────────── */

/*function startClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  setInterval(() => {
    el.textContent = new Date().toLocaleTimeString('pt-BR');
  }, 1000);
}*/

function startConnectionMonitor() {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (!dot || !label) return;

  async function check() {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2000);
      await fetch('/api/ping', { signal: ctrl.signal });
      clearTimeout(timeout);

      dot.classList.add('online');
      dot.classList.remove('offline');
      label.textContent = 'Conectado';
    } catch (e) {
      dot.classList.add('offline');
      dot.classList.remove('online');
      label.textContent = 'Desconectado';
    }
  }

  check();
  setInterval(check, 3000);
}

async function apiFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* ───────────────────────────────────────────────────────────────
   2. LÓGICA DA ATIVIDADE: LEITURA E VALIDAÇÃO
─────────────────────────────────────────────────────────────── */

// Frase alvo (Gabarito). Tudo em minúsculo para facilitar a comparação.
let fraseCorreta = [];

// Controle de estado
let lastQRId = null;
const collectedFragments = [];

/**
 * Busca constantemente a última leitura feita pela ESP32-CAM.
 * Espera um JSON no formato: { "id": 123, "index": 1, "fragment": "O" }
 */
async function fetchQRReading() {
  const data = await apiFetch('/api/qr/latest');

  if (!data) return; // Sem resposta da placa
  if (data.id === lastQRId) return; // É o mesmo QR code que já lemos

  // Nova leitura detectada! Atualiza o ID.
  lastQRId = data.id;

  // Verifica se esse fragmento já foi lido antes para não duplicar pecinhas
  const jaExiste = collectedFragments.some(f => f.index === data.index && f.fragment === data.fragment);

  if (!jaExiste) {
    collectedFragments.push({
      index: data.index,
      fragment: data.fragment
    });

    // Atualiza a interface
    renderizarMesaDeMontagem();

    // Feedback opcional: atualiza um texto de status central
    const statusText = document.getElementById('status-robo');
    if (statusText) statusText.textContent = `Palavra lida: "${data.fragment}"`;
  }
}

function definirNovaFrase(){
  const inputEl = document.getElementById('input-nova-frase');
  const textoDigitado = inputEl.value.trim(); //Pega o texro e retira os espaços sobrando nas pontas

  if(textoDigitado === ""){
    alert("Por favor, digite uma frase primeiro!");
    return;
  }

  fraseCorreta = textoDigitado.toLowerCase().split(/\s+/);

  const statusEl = document.getElementById('status-frase-alvo');
  if(statusEl){
    statusEl.innerHTML = `frase-ativa: <strong>"${textoDigitado}"</strong> (${fraseCorreta.length} blocos separados)`;
    statusEl.style.color = "var(--accent)";
  }

  reiniciarAtividade();

  inputEl.value = "";
}

/**
 * Pega as palavras lidas e desenha na tela como "blocos" de montar.
 */
function renderizarMesaDeMontagem() {
  const mesa = document.getElementById('mesa-montagem');
  if (!mesa) return;

  mesa.innerHTML = ''; // Limpa a tela

  // Ordena pelo índice (posição na frase) que veio gravado no QR Code
  const fragmentosOrdenados = [...collectedFragments].sort((a, b) => a.index - b.index);

  fragmentosOrdenados.forEach(item => {
    const bloco = document.createElement('div');
    // Adiciona uma classe para estilizar lá no style.css
    bloco.className = 'bloco-palavra';
    bloco.textContent = item.fragment;

    // Efeito de entrada suave (opcional, requer CSS correspondente)
    bloco.style.animation = "fadeIn 0.3s ease-out";

    mesa.appendChild(bloco);
  });
}

/**
 * Botão "Validar Sequência" aciona esta função.
 * Compara o que está na mesa com a frase gabarito.
 */
function validarSequencia() {
  const feedback = document.getElementById('resultado-validacao');
  if (!feedback) return;

  if( fraseCorreta.length === 0){
    feedback.textContent = "Professor, defina a frase alvo no painel acima antes de validar!";
    feedback.style.color = "var(--accent2)";
    return;
  }

  if (collectedFragments.length === 0) {
    feedback.textContent = "Nenhuma palavra lida ainda. Aproxime os QR Codes do robô!";
    return;
  }

  // Ordena os fragmentos recolhidos e junta numa string única
  const fragmentosOrdenados = [...collectedFragments].sort((a, b) => a.index - b.index);

  // Converte tudo para minúsculo para evitar erros por causa de "O" vs "o"
  const fraseMontada = fragmentosOrdenados.map(f => f.fragment.toLowerCase()).join(" ");
  const fraseAlvo = fraseCorreta.join(" ");

  if (fraseMontada === fraseAlvo) {
    feedback.textContent = "✨ Excelente! A frase está correta!";
    feedback.style.color = "var(--green)"; // Verde sucesso

    // Manda a ESP32 fazer um sinal de sucesso (ex: piscar LED verde ou tocar buzzer)
    //apiFetch('/api/action?do=sucesso');

  } else {
    feedback.textContent = "🤔 Hum... Tem algo diferente. Faltam palavras ou estão fora de ordem. Tente novamente!";
    feedback.style.color = "var(--red)"; // Laranja/Vermelho erro

    // Manda a ESP32 fazer um sinal de erro
    //apiFetch('/api/action?do=erro');
  }
}

/**
 * Limpa a mesa de montagem para começar um novo livro/atividade
 */
function reiniciarAtividade() {
  collectedFragments.length = 0; // Zera o array
  lastQRId = null;
  renderizarMesaDeMontagem();

  const feedback = document.getElementById('resultado-validacao');
  if (feedback) {
    feedback.textContent = "Aguardando leitura dos blocos...";
    feedback.style.color = "var(--text-muted)";
  }
}

/* ───────────────────────────────────────────────────────────────
   3. INICIALIZAÇÃO
─────────────────────────────────────────────────────────────── */

window.onload = () => {
  startClock();
  startConnectionMonitor();

  // Inicia o "olho" do robô: busca novos QR codes a cada 800 milissegundos
  setInterval(fetchQRReading, 800);
};
