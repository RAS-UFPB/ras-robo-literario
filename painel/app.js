let fraseCorreta = [];
let atividadeFrases = [];
let equipeAtual = 'Equipe 1';
let leiturasEquipeAtual = [];
let lastQRId = null;
let qrRequestEmAndamento = false;
const leituraIdsRenderizadas = new Set();
const PONTOS_FRASE_NO_LUGAR = 10;
const PONTOS_DUPLA_EM_SEQUENCIA = 5;


// conteúdo pedagógico inicial da aba "Contos e perguntas".
// os conteúdos cadastrados pela professora são salvos no navegador (por enquanto).
const STORAGE_KEY_CONTOS = 'led-contos-professora-v1';

const CONTOS_PADRAO = [
  {
    id: 'sete-corvos',
    titulo: 'Os Sete Corvos',
    autor: 'Irmãos Grimm',
    resumo: 'Uma menina parte em busca dos sete irmãos, transformados em corvos depois de uma maldição dita pelo pai em um momento de raiva.',
    perguntas: [
      {
        tema: 'Causa e consequência',
        trecho: 'O pai, angustiado com a demora dos filhos, conclui que eles ficaram brincando. Irritado, deseja que todos se transformem em corvos e, logo depois, vê sete corvos voando sobre a casa.',
        pergunta: 'O que provocou a transformação dos sete irmãos em corvos?',
        resposta: 'O pai, impaciente com a demora dos filhos, desejou com raiva que eles se transformassem em corvos. A fala acabou se tornando uma maldição.'
      },
      {
        tema: 'Motivação da personagem',
        trecho: 'Depois de descobrir que tinha sete irmãos e que o seu nascimento estava ligado ao acontecimento que os afastou da família, a menina passa a se culpar e decide sair de casa para encontrá-los.',
        pergunta: 'Por que a menina decide procurar os irmãos mesmo sem saber onde eles estão?',
        resposta: 'Porque se sente responsável pelo que aconteceu e quer salvá-los. A culpa e o desejo de reencontrar a família motivam a viagem.'
      },
      {
        tema: 'Elementos fantásticos',
        trecho: 'Na viagem, a menina encontra o sol e a lua, mas foge deles. As estrelas a recebem com bondade, e a Estrela D’Alva lhe entrega um pequeno osso que serviria para abrir a Montanha de Cristal.',
        pergunta: 'Qual foi a importância da ajuda da Estrela D’Alva para a busca da menina?',
        resposta: 'A Estrela D’Alva indica onde os irmãos estavam e entrega o objeto necessário para abrir a Montanha de Cristal, orientando a menina para a etapa seguinte da busca.'
      },
      {
        tema: 'Características da personagem',
        trecho: 'Ao chegar à Montanha de Cristal, a menina percebe que perdeu o objeto que abriria o portão. Mesmo assim, procura outra maneira de entrar e faz um grande sacrifício para conseguir abrir a passagem.',
        pergunta: 'O que a atitude da menina diante do portão revela sobre sua personalidade?',
        resposta: 'Revela determinação, coragem e disposição para se sacrificar pelos irmãos, pois ela não abandona a busca mesmo depois de perder a chave.'
      },
      {
        tema: 'Objeto simbólico',
        trecho: 'Enquanto espera os corvos, a menina prova um pouco da comida e da bebida deles e deixa cair no último copo o anel que havia levado de casa. Quando os irmãos chegam, um deles reconhece o anel dos pais.',
        pergunta: 'Como o anel ajuda os irmãos a perceber que a irmã está por perto?',
        resposta: 'O anel funciona como uma prova de ligação com a família. Ao reconhecê-lo, o sétimo corvo entende que a irmã pode estar ali e manifesta o desejo de encontrá-la.'
      },
      {
        tema: 'Desfecho',
        trecho: 'Quando um dos corvos deseja que a irmã esteja ali para que possam ser salvos, a menina sai de trás da porta. Nesse instante, os sete corvos recuperam a forma humana e todos voltam felizes para casa.',
        pergunta: 'Como a presença da irmã resolve o conflito principal do conto?',
        resposta: 'Ao encontrar os irmãos e se apresentar a eles, a irmã rompe a situação que os mantinha transformados em corvos. Eles recuperam a forma humana e a família pode se reunir novamente.'
      }
    ]
  }
];

function clonarContosPadrao() {
  return JSON.parse(JSON.stringify(CONTOS_PADRAO));
}

function carregarContosSalvos() {
  try {
    const salvos = JSON.parse(localStorage.getItem(STORAGE_KEY_CONTOS));
    if (Array.isArray(salvos) && salvos.length > 0) return salvos;
  } catch (error) {
    console.warn('Não foi possível carregar os contos salvos.', error);
  }

  return clonarContosPadrao();
}

let CONTOS = carregarContosSalvos();
let contoSelecionadoId = CONTOS[0]?.id || null;
let perguntaSelecionadaIndex = 0;

function salvarContosNoNavegador() {
  try {
    localStorage.setItem(STORAGE_KEY_CONTOS, JSON.stringify(CONTOS));
  } catch (error) {
    console.warn('Não foi possível salvar os contos no navegador.', error);
  }
}

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

  // preserve the order in which readings were received (as returned by the API).
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

  // não chama /api/placar aqui, porque placar é a rota mais pesada.
  // o placar é atualizado ao validar e em intervalo separado.
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

  // atualiza a tela na hora, sem esperar outra chamada em /api/leituras e /api/placar.
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

  // atualiza a visualização da frase com a pontuação obtida na validação.
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

function configurarNavegacao() {
  document.querySelectorAll('.nav-links a[data-page]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      trocarPagina(link.dataset.page);
    });
  });

  document.addEventListener('fullscreenchange', () => {
    const palco = document.getElementById('presentation-stage');
    if (!document.fullscreenElement && palco && !palco.classList.contains('presentation-fallback')) {
      palco.hidden = true;
      palco.setAttribute('aria-hidden', 'true');
    }
  });

  document.addEventListener('keydown', event => {
    const palco = document.getElementById('presentation-stage');
    const apresentando = Boolean(document.fullscreenElement === palco || palco?.classList.contains('presentation-fallback'));
    if (!apresentando) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      proximaPergunta();
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      perguntaAnterior();
    }

    if (event.key === 'Escape' && palco?.classList.contains('presentation-fallback')) {
      fecharApresentacao();
    }
  });
}

function trocarPagina(nomePagina) {
  const paginas = {
    dashboard: document.getElementById('pagina-dashboard'),
    contos: document.getElementById('pagina-contos'),
    relatorios: document.getElementById('pagina-relatorios')
  };

  Object.entries(paginas).forEach(([nome, elemento]) => {
    if (!elemento) return;
    const ativa = nome === nomePagina;
    elemento.hidden = !ativa;
    elemento.classList.toggle('active', ativa);
  });

  document.querySelectorAll('.nav-links a[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === nomePagina);
  });

  if (nomePagina === 'contos') renderizarContos();
}

function obterContoSelecionado() {
  return CONTOS.find(conto => conto.id === contoSelecionadoId) || CONTOS[0] || null;
}

function popularSelectContos() {
  const select = document.getElementById('conto-select');
  const gerenciarSelect = document.getElementById('gerenciar-conto-select');

  [select, gerenciarSelect].forEach(elemento => {
    if (!elemento) return;
    const valorAnterior = elemento.value;
    elemento.innerHTML = '';

    CONTOS.forEach(conto => {
      const option = document.createElement('option');
      option.value = conto.id;
      option.textContent = conto.titulo;
      elemento.appendChild(option);
    });

    const valorDesejado = CONTOS.some(conto => conto.id === valorAnterior)
      ? valorAnterior
      : contoSelecionadoId;

    if (valorDesejado) elemento.value = valorDesejado;
  });
}

function renderizarContos() {
  popularSelectContos();

  const conto = obterContoSelecionado();
  if (!conto) return;

  const perguntas = Array.isArray(conto.perguntas) ? conto.perguntas : [];
  if (perguntaSelecionadaIndex >= perguntas.length) perguntaSelecionadaIndex = 0;

  const item = perguntas[perguntaSelecionadaIndex] || null;
  const titulo = document.getElementById('conto-titulo');
  const autor = document.getElementById('conto-autor');
  const resumo = document.getElementById('conto-resumo');
  const trecho = document.getElementById('conto-trecho');
  const pergunta = document.getElementById('conto-pergunta');
  const resposta = document.getElementById('resposta-texto');
  const indicador = document.getElementById('pergunta-indicador');
  const tema = document.getElementById('pergunta-tema');
  const respostaBox = document.getElementById('resposta-esperada');
  const btnResposta = document.getElementById('btn-resposta');

  if (titulo) titulo.textContent = conto.titulo;
  if (autor) autor.textContent = conto.autor || 'Autor não informado';
  if (resumo) {
    resumo.textContent = conto.resumo || '';
    resumo.hidden = !conto.resumo;
  }

  if (!item) {
    if (trecho) trecho.textContent = 'Este conto ainda não possui trechos e perguntas cadastrados.';
    if (pergunta) pergunta.textContent = 'Abra “Gerenciar conteúdo” para adicionar a primeira pergunta.';
    if (resposta) resposta.textContent = '';
    if (indicador) indicador.textContent = 'Nenhuma pergunta cadastrada';
    if (tema) tema.textContent = 'Sem perguntas';
  } else {
    if (trecho) trecho.textContent = item.trecho;
    if (pergunta) pergunta.textContent = item.pergunta;
    if (resposta) resposta.textContent = item.resposta || 'Nenhuma resposta esperada foi cadastrada.';
    if (indicador) indicador.textContent = `Pergunta ${perguntaSelecionadaIndex + 1} de ${perguntas.length}`;
    if (tema) tema.textContent = item.tema || 'Compreensão';
  }

  if (respostaBox) respostaBox.hidden = true;
  if (btnResposta) btnResposta.textContent = 'Mostrar resposta esperada';

  atualizarApresentacao();
}

function selecionarConto(id) {
  if (!CONTOS.some(conto => conto.id === id)) return;
  contoSelecionadoId = id;
  perguntaSelecionadaIndex = 0;
  renderizarContos();

  const gerenciarSelect = document.getElementById('gerenciar-conto-select');
  if (gerenciarSelect) gerenciarSelect.value = id;
  renderizarPerguntasGerenciador();
}

function proximaPergunta() {
  const conto = obterContoSelecionado();
  if (!conto || !conto.perguntas?.length) return;

  perguntaSelecionadaIndex = (perguntaSelecionadaIndex + 1) % conto.perguntas.length;
  renderizarContos();
}

function perguntaAnterior() {
  const conto = obterContoSelecionado();
  if (!conto || !conto.perguntas?.length) return;

  perguntaSelecionadaIndex = (perguntaSelecionadaIndex - 1 + conto.perguntas.length) % conto.perguntas.length;
  renderizarContos();
}

function alternarResposta() {
  const box = document.getElementById('resposta-esperada');
  const botao = document.getElementById('btn-resposta');
  if (!box || !botao) return;

  box.hidden = !box.hidden;
  botao.textContent = box.hidden ? 'Mostrar resposta esperada' : 'Ocultar resposta esperada';
}

function atualizarApresentacao() {
  const conto = obterContoSelecionado();
  const item = conto?.perguntas?.[perguntaSelecionadaIndex] || null;

  const titulo = document.getElementById('presentation-title');
  const autor = document.getElementById('presentation-author');
  const trecho = document.getElementById('presentation-trecho');
  const pergunta = document.getElementById('presentation-pergunta');
  const progresso = document.getElementById('presentation-progress');

  if (titulo) titulo.textContent = conto?.titulo || 'Conto';
  if (autor) autor.textContent = conto?.autor || 'Autor não informado';
  if (trecho) trecho.textContent = item?.trecho || 'Nenhum trecho cadastrado para este conto.';
  if (pergunta) pergunta.textContent = item?.pergunta || 'Nenhuma pergunta cadastrada.';
  if (progresso) {
    progresso.textContent = item
      ? `Pergunta ${perguntaSelecionadaIndex + 1} de ${conto.perguntas.length}`
      : 'Sem perguntas cadastradas';
  }
}

async function abrirApresentacao() {
  const palco = document.getElementById('presentation-stage');
  if (!palco) return;

  atualizarApresentacao();
  palco.hidden = false;
  palco.setAttribute('aria-hidden', 'false');

  try {
    if (palco.requestFullscreen) {
      await palco.requestFullscreen();
    } else {
      palco.classList.add('presentation-fallback');
      document.body.classList.add('presentation-open');
    }
  } catch (error) {
    palco.classList.add('presentation-fallback');
    document.body.classList.add('presentation-open');
  }
}

async function fecharApresentacao() {
  const palco = document.getElementById('presentation-stage');
  if (!palco) return;

  palco.classList.remove('presentation-fallback');
  document.body.classList.remove('presentation-open');

  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn('Não foi possível sair da tela cheia.', error);
    }
  }

  palco.hidden = true;
  palco.setAttribute('aria-hidden', 'true');
}

function abrirGerenciadorConteudo() {
  const dialog = document.getElementById('conteudo-dialog');
  if (!dialog) return;

  popularSelectContos();
  const select = document.getElementById('gerenciar-conto-select');
  if (select) select.value = contoSelecionadoId;
  cancelarEdicaoPergunta();
  renderizarPerguntasGerenciador();

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function fecharGerenciadorConteudo() {
  const dialog = document.getElementById('conteudo-dialog');
  if (!dialog) return;

  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function criarIdConto(titulo) {
  const base = String(titulo || 'conto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'conto';

  return `${base}-${Date.now()}`;
}

function adicionarConto(event) {
  event.preventDefault();

  const tituloInput = document.getElementById('novo-conto-titulo');
  const autorInput = document.getElementById('novo-conto-autor');
  const resumoInput = document.getElementById('novo-conto-resumo');
  const titulo = tituloInput?.value.trim();

  if (!titulo) return;

  const novoConto = {
    id: criarIdConto(titulo),
    titulo,
    autor: autorInput?.value.trim() || 'Autor não informado',
    resumo: resumoInput?.value.trim() || '',
    perguntas: []
  };

  CONTOS.push(novoConto);
  contoSelecionadoId = novoConto.id;
  perguntaSelecionadaIndex = 0;
  salvarContosNoNavegador();
  renderizarContos();
  popularSelectContos();

  const gerenciarSelect = document.getElementById('gerenciar-conto-select');
  if (gerenciarSelect) gerenciarSelect.value = novoConto.id;

  event.target.reset();
  renderizarPerguntasGerenciador();
}

function salvarPerguntaGerenciada(event) {
  event.preventDefault();

  const select = document.getElementById('gerenciar-conto-select');
  const conto = CONTOS.find(item => item.id === select?.value);
  if (!conto) return;

  const trecho = document.getElementById('gerenciar-trecho')?.value.trim();
  const pergunta = document.getElementById('gerenciar-pergunta')?.value.trim();
  if (!trecho || !pergunta) return;

  const novoItem = {
    tema: document.getElementById('gerenciar-tema')?.value.trim() || 'Compreensão',
    trecho,
    pergunta,
    resposta: document.getElementById('gerenciar-resposta')?.value.trim() || ''
  };

  const indiceInput = document.getElementById('gerenciar-edicao-index');
  const indice = indiceInput?.value === '' ? null : Number(indiceInput.value);

  if (Number.isInteger(indice) && indice >= 0 && indice < conto.perguntas.length) {
    conto.perguntas[indice] = novoItem;
    perguntaSelecionadaIndex = indice;
  } else {
    conto.perguntas.push(novoItem);
    perguntaSelecionadaIndex = conto.perguntas.length - 1;
  }

  contoSelecionadoId = conto.id;
  salvarContosNoNavegador();
  cancelarEdicaoPergunta();
  renderizarContos();
  renderizarPerguntasGerenciador();
}

function cancelarEdicaoPergunta() {
  const campos = ['gerenciar-tema', 'gerenciar-trecho', 'gerenciar-pergunta', 'gerenciar-resposta'];
  campos.forEach(id => {
    const elemento = document.getElementById(id);
    if (elemento) elemento.value = '';
  });

  const indice = document.getElementById('gerenciar-edicao-index');
  const cancelar = document.getElementById('btn-cancelar-edicao');
  const salvar = document.getElementById('btn-salvar-pergunta');

  if (indice) indice.value = '';
  if (cancelar) cancelar.hidden = true;
  if (salvar) salvar.textContent = 'Adicionar pergunta';
}

function editarPerguntaGerenciada(indice) {
  const select = document.getElementById('gerenciar-conto-select');
  const conto = CONTOS.find(item => item.id === select?.value);
  const item = conto?.perguntas?.[indice];
  if (!item) return;

  document.getElementById('gerenciar-tema').value = item.tema || '';
  document.getElementById('gerenciar-trecho').value = item.trecho || '';
  document.getElementById('gerenciar-pergunta').value = item.pergunta || '';
  document.getElementById('gerenciar-resposta').value = item.resposta || '';
  document.getElementById('gerenciar-edicao-index').value = String(indice);
  document.getElementById('btn-cancelar-edicao').hidden = false;
  document.getElementById('btn-salvar-pergunta').textContent = 'Salvar alterações';
  document.getElementById('gerenciar-trecho').focus();
}

function excluirPerguntaGerenciada(indice) {
  const select = document.getElementById('gerenciar-conto-select');
  const conto = CONTOS.find(item => item.id === select?.value);
  if (!conto?.perguntas?.[indice]) return;

  const confirmar = window.confirm('Excluir esta pergunta e o trecho associado?');
  if (!confirmar) return;

  conto.perguntas.splice(indice, 1);
  perguntaSelecionadaIndex = Math.min(perguntaSelecionadaIndex, Math.max(conto.perguntas.length - 1, 0));
  contoSelecionadoId = conto.id;
  salvarContosNoNavegador();
  cancelarEdicaoPergunta();
  renderizarContos();
  renderizarPerguntasGerenciador();
}

function renderizarPerguntasGerenciador() {
  const select = document.getElementById('gerenciar-conto-select');
  const lista = document.getElementById('gerenciar-lista-perguntas');
  const total = document.getElementById('gerenciar-total-perguntas');
  if (!lista || !select) return;

  const conto = CONTOS.find(item => item.id === select.value) || obterContoSelecionado();
  const perguntas = Array.isArray(conto?.perguntas) ? conto.perguntas : [];

  if (total) total.textContent = `${perguntas.length} ${perguntas.length === 1 ? 'pergunta' : 'perguntas'}`;
  lista.innerHTML = '';

  if (perguntas.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'gerenciar-empty';
    vazio.textContent = 'Nenhuma pergunta cadastrada para este conto.';
    lista.appendChild(vazio);
    return;
  }

  perguntas.forEach((item, indice) => {
    const linha = document.createElement('article');
    linha.className = 'gerenciar-pergunta-item';

    const texto = document.createElement('div');
    const tema = document.createElement('span');
    const pergunta = document.createElement('strong');
    tema.textContent = item.tema || 'Compreensão';
    pergunta.textContent = item.pergunta;
    texto.append(tema, pergunta);

    const acoes = document.createElement('div');
    acoes.className = 'gerenciar-item-actions';

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.textContent = 'Editar';
    editar.addEventListener('click', () => editarPerguntaGerenciada(indice));

    const excluir = document.createElement('button');
    excluir.type = 'button';
    excluir.textContent = 'Excluir';
    excluir.addEventListener('click', () => excluirPerguntaGerenciada(indice));

    acoes.append(editar, excluir);
    linha.append(texto, acoes);
    lista.appendChild(linha);
  });
}

window.onload = async () => {
  configurarNavegacao();
  renderizarContos();
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

  // evita chuva de requisições. se uma ainda estiver rodando, a próxima é ignorada.
  setInterval(fetchQRReading, 3000);
  setInterval(carregarPlacar, 15000);
};
