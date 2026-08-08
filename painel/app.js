let fraseCorreta = [];
let atividadeFrases = [];
let equipeAtual = 'Equipe 1';
let leiturasEquipeAtual = [];
let lastQRId = null;
let qrRequestEmAndamento = false;
const leituraIdsRenderizadas = new Set();
const PONTOS_FRASE_NO_LUGAR = 10;
const PONTOS_DUPLA_EM_SEQUENCIA = 5;

function startClock() {
  const el = document.getElementById('clock');
  if (!el) return;

  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('pt-BR');
  };

  tick();
  setInterval(tick, 1000);
}

function startConnectionMonitor() {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (!dot || !label) return;

  async function check() {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2000);
      const response = await fetch('/api/ping', { signal: ctrl.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error('ping indisponível');

      dot.classList.add('online');
      dot.classList.remove('offline');
      label.textContent = 'Conectado';
    } catch (error) {
      dot.classList.add('offline');
      dot.classList.remove('online');
      label.textContent = 'Desconectado';
    }
  }

  check();
  setInterval(check, 10000);
}

async function apiFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const error = new Error(payload?.error || payload?.mensagem || `HTTP ${response.status}`);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function normalizarEquipe(nomeEquipe) {
  const valor = String(nomeEquipe || '').trim();
  if (!valor) return 'Equipe 1';

  if (/^\d+$/.test(valor)) {
    return `Equipe ${valor}`;
  }

  const match = valor.match(/^equipe\s*(\d+)$/i);
  if (match) {
    return `Equipe ${match[1]}`;
  }

  return valor;
}

function obterEquipeAtual() {
  const inputEquipe = document.getElementById('input-equipe');
  return normalizarEquipe(inputEquipe ? inputEquipe.value : equipeAtual);
}

function atualizarTituloEquipe(nomeEquipe) {
  const titulo = document.getElementById('titulo-mesa-equipe');
  if (titulo) {
    titulo.textContent = `Mesa de montagem - ${nomeEquipe}`;
  }
}

function atualizarStatusSimulador(texto, tipo = 'neutro') {
  const status = document.getElementById('status-simulador');
  if (!status) return;

  status.textContent = texto;
  status.style.color = tipo === 'sucesso'
    ? 'var(--green)'
    : tipo === 'erro'
      ? 'var(--red)'
      : 'var(--text-muted)';
}

function atualizarStatusRobo(texto, tipo = 'neutro') {
  const status = document.getElementById('status-robo');
  if (!status) return;

  status.textContent = texto;
  status.style.color = tipo === 'sucesso'
    ? 'var(--green)'
    : tipo === 'erro'
      ? 'var(--red)'
      : 'var(--text-main)';
}

function atualizarResultado(texto, tipo = 'neutro') {
  const feedback = document.getElementById('resultado-validacao');
  if (!feedback) return;

  feedback.textContent = texto;
  feedback.style.color = tipo === 'sucesso'
    ? 'var(--green)'
    : tipo === 'erro'
      ? 'var(--red)'
      : 'var(--text-muted)';
}

function renderizarBinarioDaFrase(frases, avaliacao = null) {
  const area = document.getElementById('frase-binaria');
  const status = document.getElementById('status-frase-alvo');
  if (!area || !status) return;

  const blocos = Array.isArray(frases) ? frases : [];

  if (blocos.length === 0) {
    area.innerHTML = '';
    status.textContent = 'Nenhuma frase definida';
    status.style.color = 'var(--text-muted)';
    return;
  }

  const blocosOrdenados = [...blocos].sort((a, b) => a.indice - b.indice);
  const textoFrase = blocosOrdenados.map(item => item.texto).join(' | ');

  const totalPontosPadrao = (blocosOrdenados.length * PONTOS_FRASE_NO_LUGAR)
    + (Math.max(blocosOrdenados.length - 1, 0) * PONTOS_DUPLA_EM_SEQUENCIA);
  const totalPontos = Number(avaliacao?.pontuacaoMaxima ?? totalPontosPadrao);
  const pontosGanhos = Number(avaliacao?.pontuacao ?? 0);
  const duplasCorretas = Number(avaliacao?.duplasCorretas ?? 0);

  status.innerHTML = `Frase ativa: <strong>"${textoFrase}"</strong> (${blocosOrdenados.length} blocos) — Pontuação: ${pontosGanhos}/${totalPontos} pts — Duplas em sequência: ${duplasCorretas}/${Math.max(blocosOrdenados.length - 1, 0)}`;
  status.style.color = 'var(--accent-dark)';
  area.innerHTML = blocosOrdenados
    .map(item => `<span class="binary-chip">${item.texto} <strong>${item.codigoBinario}</strong></span>`)
    .join('');
}

function renderizarMesaDeMontagem(leituras) {
  const mesa = document.getElementById('mesa-montagem');
  if (!mesa) return;

  mesa.innerHTML = '';

  // Preserve the order in which readings were received (as returned by the API).
  const leiturasOrdenadas = Array.isArray(leituras) ? [...leituras] : [];

  leiturasOrdenadas.forEach(item => {
    const bloco = document.createElement('div');
    bloco.className = 'bloco-palavra';
    bloco.textContent = item.fragment || item.fragmento || '';
    mesa.appendChild(bloco);
  });
}

function renderizarPlacar(placar) {
  const area = document.getElementById('placar');
  const pontuacaoAtual = document.getElementById('pontuacao-atual');
  if (!area || !pontuacaoAtual) return;

  const ranking = Array.isArray(placar) ? placar : [];
  const equipeDaTela = equipeAtual.toLowerCase();
  const destaque = ranking.find(item => String(item.equipe || '').toLowerCase() === equipeDaTela);
  pontuacaoAtual.textContent = String(destaque?.pontuacao ?? 0);

  if (ranking.length === 0) {
    area.innerHTML = '<div class="empty-state">Nenhuma equipe avaliada ainda.</div>';
    return;
  }

  const maiorPontuacao = Math.max(...ranking.map(item => Number(item.pontuacao) || 0), 1);

  area.innerHTML = ranking.map(item => {
    const pontuacao = Number(item.pontuacao) || 0;
    const corretas = Number(item.corretas) || 0;
    const total = Number(item.total) || 0;
    const largura = Math.max(12, Math.round((pontuacao / maiorPontuacao) * 100));

    return `
      <div class="placar-item">
        <div class="placar-item-topo">
          <strong>${item.equipe}</strong>
          <span>${pontuacao} pts</span>
        </div>
        <div class="placar-metrica">
          <span>${corretas}/${total} no lugar certo</span>
          <span>última rodada: ${Number(item.ultimaPontuacaoRodada) || 0} pts</span>
        </div>
        <div class="placar-barra"><span style="width: ${largura}%"></span></div>
      </div>
    `;
  }).join('');
}

async function carregarPlacar() {
  const placar = await apiFetch('/api/placar');
  if (!placar || !Array.isArray(placar.placar)) return;
  renderizarPlacar(placar.placar);
}

async function carregarEquipe(nomeEquipe) {
  const equipe = normalizarEquipe(nomeEquipe);
  equipeAtual = equipe;
  atualizarTituloEquipe(equipe);

  const dados = await apiFetch(`/api/leituras?equipe=${encodeURIComponent(equipe)}`);
  if (!dados) return;

  leituraIdsRenderizadas.clear();
  leiturasEquipeAtual = Array.isArray(dados.leituras) ? dados.leituras : [];
  leiturasEquipeAtual.forEach(item => leituraIdsRenderizadas.add(item.id));
  renderizarMesaDeMontagem(leiturasEquipeAtual);

  const avaliacao = dados.avaliacao || {};
  const pontuacao = Number(dados.pontuacao ?? avaliacao.pontuacao ?? 0);
  const pontuacaoAtual = document.getElementById('pontuacao-atual');
  if (pontuacaoAtual) {
    pontuacaoAtual.textContent = String(pontuacao);
  }

  if (leiturasEquipeAtual.length > 0) {
    const ultimaLeitura = leiturasEquipeAtual[leiturasEquipeAtual.length - 1];
    atualizarStatusRobo(`Palavra lida: "${ultimaLeitura.fragment || ultimaLeitura.fragmento || ''}"`, 'sucesso');
  }

  // Não chama /api/placar aqui, porque placar é a rota mais pesada.
  // O placar é atualizado ao validar e em intervalo separado.
  renderizarBinarioDaFrase(atividadeFrases, avaliacao);
}

async function carregarAtividadeAtual() {
  const dados = await apiFetch('/api/atividade');
  if (!dados || !Array.isArray(dados.frases) || dados.frases.length === 0) {
    fraseCorreta = [];
    atualizarStatusSimulador('Nenhuma atividade definida no momento.');
    return;
  }

  const frasesOrdenadas = [...dados.frases].sort((a, b) => a.indice - b.indice);
  atividadeFrases = frasesOrdenadas;
  fraseCorreta = frasesOrdenadas.map(item => String(item.texto || '').toLowerCase());
  renderizarBinarioDaFrase(atividadeFrases);
}

async function fetchQRReading() {
  if (qrRequestEmAndamento) return;
  qrRequestEmAndamento = true;

  try {
    const data = await apiFetch('/api/qr/latest');
    if (!data || !data.id || data.id === lastQRId || leituraIdsRenderizadas.has(data.id)) return;

    lastQRId = data.id;
    const leituraEquipe = normalizarEquipe(data.equipe || equipeAtual);

    atualizarStatusRobo(`Palavra lida: "${data.fragment || data.fragmento || ''}"`, 'sucesso');

    if (String(leituraEquipe).toLowerCase() === equipeAtual.toLowerCase()) {
      leituraIdsRenderizadas.add(data.id);
      leiturasEquipeAtual.push(data);
      renderizarMesaDeMontagem(leiturasEquipeAtual);
    }
  } finally {
    qrRequestEmAndamento = false;
  }
}

async function definirNovaFrase() {
  const inputEl = document.getElementById('input-nova-frase');
  const textoDigitado = String(inputEl?.value || '').trim();

  if (!textoDigitado) {
    alert('Por favor, digite uma frase primeiro!');
    return;
  }

  const resposta = await apiFetch('/api/atividade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ textoAlvo: textoDigitado })
  });

  if (!resposta) {
    atualizarResultado('Não foi possível iniciar a atividade agora.', 'erro');
    return;
  }

  if (Array.isArray(resposta.frases)) {
    const ordenadas = resposta.frases.slice().sort((a, b) => a.indice - b.indice);
    atividadeFrases = ordenadas;
    fraseCorreta = ordenadas.map(item => String(item.texto || '').toLowerCase());
  } else {
    atividadeFrases = [];
    fraseCorreta = textoDigitado.toLowerCase().split(/\s+/);
  }

  renderizarBinarioDaFrase(atividadeFrases);

  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');
  atualizarStatusSimulador('Atividade iniciada com sucesso.', 'sucesso');
  inputEl.value = '';

  await carregarEquipe(obterEquipeAtual());
  await carregarPlacar();
}

async function simularLeitura() {
  const inputEquipe = document.getElementById('input-equipe');
  const inputBinario = document.getElementById('input-binario');
  const equipe = normalizarEquipe(inputEquipe?.value);
  const codigoBinario = String(inputBinario?.value || '').trim();

  if (!codigoBinario) {
    atualizarStatusSimulador('Digite um código binário para simular a leitura.', 'erro');
    return;
  }

  equipeAtual = equipe;
  atualizarTituloEquipe(equipeAtual);

  const resposta = await apiFetch('/api/qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipe, codigoBinario })
  });

  if (!resposta) {
    atualizarStatusSimulador('Não foi possível enviar a leitura.', 'erro');
    return;
  }

  const leitura = resposta.leitura || {};
  const mensagem = `Leitura enviada para ${equipe}: "${leitura.fragment || leitura.fragmento || 'bloco registrado'}"`;

  atualizarStatusSimulador(mensagem, 'sucesso');
  atualizarStatusRobo(`Palavra lida: "${leitura.fragment || leitura.fragmento || ''}"`, 'sucesso');
  inputBinario.value = '';

  // Atualiza a tela na hora, sem esperar outra chamada em /api/leituras e /api/placar.
  if (leitura.id && !leituraIdsRenderizadas.has(leitura.id)) {
    leituraIdsRenderizadas.add(leitura.id);
    leiturasEquipeAtual.push(leitura);
    renderizarMesaDeMontagem(leiturasEquipeAtual);
  }
}

async function validarSequencia() {
  const feedback = document.getElementById('resultado-validacao');
  if (!feedback) return;

  if (fraseCorreta.length === 0) {
    feedback.textContent = 'Professor, defina a frase alvo no painel acima antes de validar!';
    feedback.style.color = 'var(--accent-warm)';
    return;
  }

  if (!equipeAtual) {
    feedback.textContent = 'Escolha uma equipe antes de validar a sequência.';
    feedback.style.color = 'var(--accent-warm)';
    return;
  }

  const resposta = await apiFetch('/api/validar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipe: equipeAtual })
  });

  if (!resposta) {
    feedback.textContent = 'Não foi possível validar a sequência agora.';
    feedback.style.color = 'var(--red)';
    return;
  }

  const total = Number(resposta.total ?? fraseCorreta.length);
  const corretas = Number(resposta.corretas ?? 0);
  const pontuacao = Number(resposta.pontuacao ?? 0);
  const pontuacaoRodada = Number(resposta.pontuacaoRodada ?? resposta.pontuacao ?? 0);
  const pontuacaoPosicao = Number(resposta.pontuacaoPosicao ?? 0);
  const pontuacaoSequencia = Number(resposta.pontuacaoSequencia ?? 0);
  const duplasCorretas = Number(resposta.duplasCorretas ?? 0);
  const totalDuplas = Math.max(total - 1, 0);

  if (corretas === total && total > 0) {
    feedback.textContent = `Excelente! ${equipeAtual} montou a frase corretamente. Rodada: ${pontuacaoRodada} pts (${pontuacaoPosicao} por posição + ${pontuacaoSequencia} por sequência). Total acumulado: ${pontuacao} pts.`;
    feedback.style.color = 'var(--green)';
  } else {
    feedback.textContent = `Ainda tem algo diferente. ${corretas}/${total} blocos no lugar certo e ${duplasCorretas}/${totalDuplas} duplas em sequência. Rodada: ${pontuacaoRodada} pts (${pontuacaoPosicao} + ${pontuacaoSequencia}). Total acumulado: ${pontuacao} pts.`;
    feedback.style.color = 'var(--red)';
  }

  // Atualiza a visualização da frase com a pontuação obtida na validação.
  renderizarBinarioDaFrase(atividadeFrases, resposta);

  await carregarPlacar();
}

async function limparMesaEquipeAtual() {
  const equipe = obterEquipeAtual();

  const resposta = await apiFetch('/api/reset-equipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipe })
  });

  if (!resposta) {
    atualizarResultado('Não foi possível limpar a mesa da equipe.', 'erro');
    return;
  }

  lastQRId = null;
  leiturasEquipeAtual = [];
  leituraIdsRenderizadas.clear();
  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');
  atualizarStatusSimulador(`Mesa da ${equipe} limpa com sucesso.`, 'sucesso');
  atualizarStatusRobo('Aguardando comandos...', 'neutro');

  await carregarEquipe(equipe);
}

function reiniciarAtividadeLocal() {
  leiturasEquipeAtual = [];
  renderizarMesaDeMontagem([]);
  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');
}

window.onload = async () => {
  startClock();
  startConnectionMonitor();

  const inputEquipe = document.getElementById('input-equipe');
  const inputBinario = document.getElementById('input-binario');

  if (inputEquipe) {
    inputEquipe.addEventListener('input', () => {
      equipeAtual = normalizarEquipe(inputEquipe.value);
      atualizarTituloEquipe(equipeAtual);
    });
  }

  if (inputBinario) {
    inputBinario.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        simularLeitura();
      }
    });
  }

  equipeAtual = obterEquipeAtual();
  atualizarTituloEquipe(equipeAtual);
  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');
  await carregarAtividadeAtual();
  await carregarEquipe(equipeAtual);
  await carregarPlacar();

  // Evita chuva de requisições. Se uma ainda estiver rodando, a próxima é ignorada.
  setInterval(fetchQRReading, 3000);
  setInterval(carregarPlacar, 15000);
};
