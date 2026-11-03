let fraseCorreta = [];
let atividadeFrases = [];
let equipeAtual = 'Equipe 1';
let leiturasEquipeAtual = [];
let lastQRId = null;
let atividadeIdParaFinalizacaoEsp = null;
let pedidoFinalizacaoEmCurso = false;
let qrRequestEmAndamento = false;
let consultaEquipeNumero = 0;
let tipoQrSelecionado = 'inicio';
const leituraIdsRenderizadas = new Set();
const PONTOS_FRASE_NO_LUGAR = 10;
const PONTOS_DUPLA_EM_SEQUENCIA = 5;


// Conteúdo pedagógico permanente carregado do banco.
let CONTOS = [];
let contoSelecionadoId = null;
let perguntaSelecionadaIndex = 0;
let desafioSelecionadoIndex = -1;
let dicaSelecionadaIndex = -1;
let ultimaAvaliacaoSequencia = null;
let modoApresentacao = 'pergunta';
let trechoSelecionadoIndex = 0;
let narradorTrechos = null;
let pdfApresentacaoUrl = null;
let pdfCarregamentoId = 0;
let tokenAdminPdf = null;

async function carregarContosDoBanco() {
  const dados = await apiFetch('/api/contos');
  CONTOS = Array.isArray(dados?.contos) ? dados.contos : [];

  if (!CONTOS.some(conto => conto.id === contoSelecionadoId)) {
    contoSelecionadoId = CONTOS[0]?.id || null;
  }

  atualizarSelecaoContosDashboard();
  const conto = CONTOS.find(item => item.id === contoSelecionadoId);
  const totalPerguntas = conto?.perguntas?.length || 0;
  if (perguntaSelecionadaIndex >= totalPerguntas) perguntaSelecionadaIndex = 0;
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
    const exigeAdmin = !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase());
    let configuracao = options;
    if (exigeAdmin) {
      const token = await obterTokenAdminPdf();
      if (!token) return null; // A professora cancelou o login.
      configuracao = { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } };
    }
    let response = await fetch(url, configuracao);
    if (exigeAdmin && response.status === 401) {
      // Token temporário perdido após reinício do Render ou depois de 1 hora.
      tokenAdminPdf = null;
      const token = await obterTokenAdminPdf();
      if (!token) return null;
      response = await fetch(url, { ...configuracao, headers: { ...configuracao.headers, Authorization: `Bearer ${token}` } });
    }
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
    // Sem modificar a interface: a autenticação abre somente um alerta em caso de falha.
    if (/chave administrativa|Chave de acesso|chave de acesso|login/i.test(String(error.message || ''))) {
      window.alert(error.message || 'Não foi possível autenticar.');
    }
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

// A mesa, o simulador e o QR sempre usam a mesma equipe selecionada.
function obterEquipeAtual() {
  return equipeAtual;
}

function equipeNumeroValido(nomeEquipe) {
  const match = normalizarEquipe(nomeEquipe).match(/^Equipe (\d+)$/i);
  if (!match) return null;
  const numero = Number(match[1]);
  return Number.isInteger(numero) && numero >= 1 && numero <= 255 && `Equipe ${numero}` === normalizarEquipe(nomeEquipe) ? numero : null;
}

function preencherSeletoresDeEquipe() {
  for (const id of ['mesa-equipe-seletor', 'qr-equipe-seletor']) {
    const seletor = document.getElementById(id);
    if (!seletor) continue;
    for (let numero = 1; numero <= 10; numero++) {
      if (Array.from(seletor.options).some(opcao => opcao.value === `Equipe ${numero}`)) continue;
      const opcao = document.createElement('option');
      opcao.value = `Equipe ${numero}`;
      opcao.textContent = opcao.value;
      seletor.appendChild(opcao);
    }
  }
  sincronizarEquipeNaInterface(equipeAtual);
}

function sincronizarEquipeNaInterface(nomeEquipe) {
  const equipe = normalizarEquipe(nomeEquipe);
  for (const id of ['mesa-equipe-seletor', 'qr-equipe-seletor']) {
    const seletor = document.getElementById(id);
    if (!seletor) continue;
    if (!Array.from(seletor.options).some(opcao => opcao.value === equipe)) {
      const opcao = document.createElement('option');
      opcao.value = equipe;
      opcao.textContent = equipe;
      seletor.appendChild(opcao);
    }
    seletor.value = equipe;
  }
  const inputEquipe = document.getElementById('input-equipe');
  const inputEquipeConto = document.getElementById('input-equipe-conto');
  if (inputEquipe) inputEquipe.value = equipe;
  if (inputEquipeConto) inputEquipeConto.value = equipe;
  atualizarTituloEquipe(equipe);
  mostrarQrEquipe(equipe);
}

function atualizarTituloEquipe(nomeEquipe) {
  const titulo = document.getElementById('titulo-mesa-equipe');
  if (titulo) titulo.textContent = `Mesa de montagem - ${nomeEquipe}`;
}

async function selecionarEquipeDashboard(nomeEquipe) {
  const equipe = normalizarEquipe(nomeEquipe);
  // Indica a equipe na interface imediatamente e consulta somente seus dados.
  sincronizarEquipeNaInterface(equipe);
  await carregarEquipe(equipe);
  await carregarPlacar();
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
  const feedbacks = [
    document.getElementById('resultado-validacao'),
    document.getElementById('resultado-validacao-conto')
  ].filter(Boolean);

  feedbacks.forEach(feedback => {
    feedback.textContent = texto;
    feedback.style.color = tipo === 'sucesso'
      ? 'var(--green)'
      : tipo === 'erro'
        ? 'var(--red)'
        : 'var(--text-muted)';
  });
}

function alternarExibicaoQr(forcarExibicao = null) {
  const conteudo = document.getElementById('qr-atividade-conteudo');
  const botao = document.getElementById('qr-atividade-toggle');
  const area = document.getElementById('qr-atividade-area');
  if (!conteudo || !botao || area?.hidden) return;
  const exibir = typeof forcarExibicao === 'boolean' ? forcarExibicao : conteudo.hidden;
  conteudo.hidden = !exibir;
  botao.textContent = exibir ? 'Ocultar QR Codes' : 'Mostrar QR Codes';
  botao.setAttribute('aria-expanded', String(exibir));
  if (!exibir) fecharQrInicio();
}

function selecionarTipoQr(tipo) {
  tipoQrSelecionado = tipo === 'equipe' ? 'equipe' : 'inicio';
  const inicio = document.getElementById('qr-inicio-esp');
  const equipe = document.getElementById('qr-equipe-esp');
  if (inicio) inicio.hidden = tipoQrSelecionado !== 'inicio';
  if (equipe) equipe.hidden = tipoQrSelecionado !== 'equipe';
  for (const nome of ['inicio', 'equipe']) {
    const botao = document.getElementById(`qr-aba-${nome}`);
    if (!botao) continue;
    const ativa = nome === tipoQrSelecionado;
    botao.classList.toggle('ativa', ativa);
    botao.setAttribute('aria-pressed', String(ativa));
  }
  if (tipoQrSelecionado === 'equipe') mostrarQrEquipe(equipeAtual);
}

function mostrarQrEquipe(nomeEquipe) {
  const visual = document.getElementById('qr-equipe-esp-visual');
  const texto = document.getElementById('qr-equipe-esp-texto');
  const status = document.getElementById('qr-equipe-esp-status');
  const ampliar = document.getElementById('qr-equipe-esp-ampliar');
  if (!visual || !texto) return;
  const numero = equipeNumeroValido(nomeEquipe);
  const conteudo = numero === null ? '' : JSON.stringify({ t: 'equipe', eq: numero });
  visual.replaceChildren();
  texto.textContent = conteudo;
  if (status) status.hidden = true;
  if (ampliar) ampliar.hidden = true;
  if (!conteudo) {
    if (status) {
      status.textContent = 'Para gerar o QR, escolha uma equipe numerada de 1 a 255.';
      status.hidden = false;
    }
    return;
  }
  try {
    const matriz = window.RoboQRCodeMatrix(conteudo);
    visual.appendChild(criarSvgQrInicio(matriz));
    if (ampliar) ampliar.hidden = false;
  } catch (erro) {
    console.warn('Não foi possível gerar o QR da equipe:', erro);
    if (status) {
      status.textContent = 'Não foi possível exibir o QR da equipe.';
      status.hidden = false;
    }
  }
}

function mostrarQrInicio(qrInicio, atividadeId = null) {
  // Usa o valor do backend, ou o mesmo formato que a ESP reconhece.
  const area = document.getElementById('qr-atividade-area');
  const codigo = document.getElementById('qr-inicio-esp-texto');
  if (!area || !codigo) return;

  const id = Number(atividadeId);
  const qr = (typeof qrInicio === 'string' && qrInicio.trim())
    ? qrInicio.trim()
    : (Number.isSafeInteger(id) && id > 0
      ? JSON.stringify({ t: 'inicio', sid: `ATV-${id}` })
      : '');

  const visual = document.getElementById('qr-inicio-esp-visual');
  const ampliado = document.getElementById('qr-inicio-esp-ampliado');
  const status = document.getElementById('qr-inicio-esp-status');
  const botaoAmpliar = document.getElementById('qr-inicio-esp-ampliar');
  fecharQrInicio();
  visual?.replaceChildren();
  ampliado?.replaceChildren();
  codigo.textContent = qr;
  area.hidden = !qr;
  if (!qr) {
    alternarExibicaoQr(false);
    const conteudo = document.getElementById('qr-atividade-conteudo');
    const toggle = document.getElementById('qr-atividade-toggle');
    if (conteudo) conteudo.hidden = true;
    if (toggle) { toggle.textContent = 'Mostrar QR Codes'; toggle.setAttribute('aria-expanded', 'false'); }
  }
  if (status) status.hidden = true;
  if (botaoAmpliar) botaoAmpliar.hidden = true;
  if (!qr || !visual) return;

  try {
    const matriz = window.RoboQRCodeMatrix(qr);
    visual.appendChild(criarSvgQrInicio(matriz));
    if (ampliado) ampliado.appendChild(criarSvgQrInicio(matriz));
    if (botaoAmpliar) botaoAmpliar.hidden = false;
  } catch (erro) {
    console.warn('Não foi possível gerar o QR de início:', erro);
    if (status) {
      status.textContent = 'Não foi possível exibir o QR Code de início.';
      status.hidden = false;
    }
  }
  mostrarQrEquipe(equipeAtual);
  selecionarTipoQr(tipoQrSelecionado);
}

function criarSvgQrInicio(matriz) {
  const ns = 'http://www.w3.org/2000/svg';
  const borda = 4;
  const tamanho = matriz.length + borda * 2;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${tamanho} ${tamanho}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  const fundo = document.createElementNS(ns, 'rect');
  fundo.setAttribute('width', tamanho);
  fundo.setAttribute('height', tamanho);
  fundo.setAttribute('fill', '#ffffff');
  svg.appendChild(fundo);
  const pontos = document.createElementNS(ns, 'path');
  let caminho = '';
  for (let y = 0; y < matriz.length; y++) {
    for (let x = 0; x < matriz.length; x++) {
      if (matriz[y][x]) caminho += `M${x + borda} ${y + borda}h1v1h-1z`;
    }
  }
  pontos.setAttribute('d', caminho);
  pontos.setAttribute('fill', '#111111');
  svg.appendChild(pontos);
  return svg;
}

function abrirQrAmpliado(tipo) {
  const dialog = document.getElementById('qr-inicio-esp-dialog');
  const ampliado = document.getElementById('qr-inicio-esp-ampliado');
  const titulo = document.getElementById('qr-dialog-titulo');
  const descricao = document.getElementById('qr-dialog-descricao');
  if (!dialog || !ampliado || document.getElementById('qr-atividade-conteudo')?.hidden) return;
  const origem = document.getElementById(tipo === 'equipe' ? 'qr-equipe-esp-visual' : 'qr-inicio-esp-visual');
  const svg = origem?.querySelector('svg');
  if (!svg) return;
  ampliado.replaceChildren(svg.cloneNode(true));
  if (titulo) titulo.textContent = tipo === 'equipe' ? `Identificar ${equipeAtual}` : 'Iniciar atividade no robô';
  if (descricao) descricao.textContent = tipo === 'equipe'
    ? 'Mostre este QR ao robô antes de apresentar as cartas desta equipe.'
    : 'Aponte a câmera da ESP32-CAM para este QR Code.';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function ampliarQrInicio() { abrirQrAmpliado('inicio'); }
function ampliarQrEquipe() { abrirQrAmpliado('equipe'); }

async function copiarQrEquipe() {
  const texto = document.getElementById('qr-equipe-esp-texto')?.textContent;
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
    atualizarStatusSimulador('Conteúdo do QR da equipe copiado.', 'sucesso');
  } catch {
    atualizarStatusSimulador('Não foi possível copiar o código da equipe.', 'erro');
  }
}

function fecharQrInicio() {
  const dialog = document.getElementById('qr-inicio-esp-dialog');
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function copiarQrInicio() {
  const texto = document.getElementById('qr-inicio-esp-texto')?.textContent;
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
    atualizarStatusSimulador('Conteúdo do QR de início copiado.', 'sucesso');
  } catch {
    atualizarStatusSimulador('Selecione e copie o QR de início manualmente.', 'erro');
  }
}

function renderizarBinarioDaFrase(frases, avaliacao = null) {
  const area = document.getElementById('frase-binaria');
  const status = document.getElementById('status-frase-alvo');
  const detalhes = document.getElementById('detalhes-atividade-ativa');
  const encerrar = document.getElementById('dashboard-encerrar-atividade');
  const finalizar = document.getElementById('dashboard-finalizar-leitura');
  const statusFinalizacao = document.getElementById('dashboard-status-finalizacao');
  if (!area || !status) return;

  const blocos = Array.isArray(frases) ? [...frases].sort((a, b) => a.indice - b.indice) : [];
  area.replaceChildren();
  if (!blocos.length) {
    status.textContent = 'Nenhuma atividade em andamento. Escolha um conto ou digite uma frase para começar.';
    status.style.color = 'var(--text-muted)';
    if (detalhes) { detalhes.hidden = true; detalhes.open = false; }
    if (encerrar) encerrar.hidden = true;
    if (finalizar) finalizar.hidden = true;
    if (statusFinalizacao) statusFinalizacao.hidden = true;
    return;
  }

  const totalPontosPadrao = (blocos.length * PONTOS_FRASE_NO_LUGAR)
    + (Math.max(blocos.length - 1, 0) * PONTOS_DUPLA_EM_SEQUENCIA);
  const totalPontos = Number(avaliacao?.pontuacaoMaxima ?? totalPontosPadrao);
  const pontosGanhos = Number(avaliacao?.pontuacao ?? 0);
  status.textContent = `Atividade em andamento • ${blocos.length} blocos • Pontuação: ${pontosGanhos}/${totalPontos} pts`;
  status.style.color = 'var(--accent-dark)';
  if (detalhes) detalhes.hidden = false;
  if (encerrar) encerrar.hidden = false;
  if (finalizar) finalizar.hidden = false;
  if (statusFinalizacao) statusFinalizacao.hidden = false;
  for (const item of blocos) {
    const chip = document.createElement('span');
    chip.className = 'binary-chip';
    const texto = document.createElement('span');
    texto.textContent = item.texto;
    const codigo = document.createElement('strong');
    codigo.textContent = item.codigoBinario;
    chip.append(texto, codigo);
    area.appendChild(chip);
  }
}

function atualizarSelecaoContosDashboard() {
  const select = document.getElementById('dashboard-conto-trechos');
  const botao = document.getElementById('dashboard-iniciar-trechos');
  if (!select || !botao) return;
  const atual = select.value;
  const disponiveis = CONTOS.filter(conto => Array.isArray(conto.trechos) && conto.trechos.length);
  select.replaceChildren();
  for (const conto of disponiveis) {
    const option = document.createElement('option');
    option.value = conto.id;
    option.textContent = conto.titulo;
    select.appendChild(option);
  }
  if (disponiveis.some(conto => conto.id === atual)) select.value = atual;
  else if (disponiveis.some(conto => conto.id === contoSelecionadoId)) select.value = contoSelecionadoId;
  if (!disponiveis.length) {
    const option = document.createElement('option');
    option.textContent = 'Nenhum conto com trechos';
    select.appendChild(option);
  }
  botao.disabled = disponiveis.length === 0;
}

function renderizarMesaDeMontagem(leituras, avaliacao = ultimaAvaliacaoSequencia) {
  const mesas = [
    document.getElementById('mesa-montagem'),
    document.getElementById('mesa-montagem-conto')
  ].filter(Boolean);

  const leiturasOrdenadas = Array.isArray(leituras) ? [...leituras] : [];

  mesas.forEach(mesa => {
    mesa.innerHTML = '';

    leiturasOrdenadas.forEach((item, indice) => {
      const bloco = document.createElement('div');
      bloco.className = 'bloco-palavra';

      const texto = document.createElement('span');
      texto.textContent = item.fragment || item.fragmento || '';
      bloco.appendChild(texto);

      if (avaliacao) {
        const esperado = atividadeFrases[indice];
        const fraseLida = atividadeFrases.find(frase => frase.codigoBinario === item.codigoBinario);
        const indiceLido = Number(item.index ?? fraseLida?.indice);
        const correto = Boolean(esperado) && indiceLido === esperado.indice;

        bloco.classList.add(correto ? 'bloco-correto' : 'bloco-incorreto');

        if (!correto) {
          const correcao = document.createElement('small');
          correcao.className = 'correcao-bloco';
          correcao.textContent = esperado
            ? `Correto aqui: ${esperado.texto}`
            : 'Não há trecho esperado nesta posição.';
          bloco.appendChild(correcao);
        }
      }

      mesa.appendChild(bloco);
    });
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
  const numeroConsulta = ++consultaEquipeNumero;
  equipeAtual = equipe;
  sincronizarEquipeNaInterface(equipe);
  // Remove imediatamente os blocos da equipe anterior durante a troca.
  leiturasEquipeAtual = [];
  ultimaAvaliacaoSequencia = null;
  leituraIdsRenderizadas.clear();
  renderizarMesaDeMontagem([]);
  const marcadorPontuacao = document.getElementById('pontuacao-atual');
  if (marcadorPontuacao) marcadorPontuacao.textContent = '0';
  atualizarResultado('Carregando mesa da equipe...', 'neutro');

  const dados = await apiFetch(`/api/leituras?equipe=${encodeURIComponent(equipe)}`);
  if (numeroConsulta !== consultaEquipeNumero) return;
  if (!dados) {
    atualizarResultado(`Não foi possível carregar a mesa da ${equipe}.`, 'erro');
    return;
  }
  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');

  leituraIdsRenderizadas.clear();
  ultimaAvaliacaoSequencia = null;
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
  atividadeIdParaFinalizacaoEsp = Number(dados?.atividadeId) || null;
  mostrarQrInicio(dados?.qrInicio, dados?.atividadeId);
  if (!dados || !Array.isArray(dados.frases) || dados.frases.length === 0) {
    fraseCorreta = [];
    atividadeFrases = [];
    renderizarBinarioDaFrase([]);
    atualizarStatusSimulador('Nenhuma atividade definida no momento.');
    return;
  }

  const frasesOrdenadas = [...dados.frases].sort((a, b) => a.indice - b.indice);
  atividadeFrases = frasesOrdenadas;
  fraseCorreta = frasesOrdenadas.map(item => String(item.texto || '').toLowerCase());
  renderizarBinarioDaFrase(atividadeFrases);
  void atualizarStatusFinalizacaoEsp();
}

// Este status é consultado no backend, nunca diretamente com a chave privada do Supabase.
async function atualizarStatusFinalizacaoEsp() {
  const id = atividadeIdParaFinalizacaoEsp;
  const status = document.getElementById('dashboard-status-finalizacao');
  const botao = document.getElementById('dashboard-finalizar-leitura');
  if (!id || !status || !botao || status.hidden) return;
  try {
    const resposta = await fetch(`/api/esp/finalizacao/status?atividadeId=${id}`, { cache: 'no-store' });
    if (!resposta.ok) throw new Error('Status indisponível');
    const dados = await resposta.json();
    if (atividadeIdParaFinalizacaoEsp !== id) return;
    if (dados.importado) {
      status.textContent = 'Leitura recebida e importada! Confira a mesa e a pontuação.';
      botao.disabled = true;
      botao.textContent = 'Leitura finalizada';
    } else if (dados.recebido) {
      status.textContent = 'A ESP enviou a sessão. Aguardando importação pelo site…';
      botao.disabled = true;
      botao.textContent = 'Aguardando importação';
    } else if (dados.solicitado) {
      status.textContent = 'Encerramento solicitado. Mantenha a ESP ligada e conectada à Internet.';
      botao.disabled = true;
      botao.textContent = 'Aguardando robô';
    } else {
      status.textContent = 'Depois que todas as equipes lerem suas cartas, finalize a leitura por aqui.';
      botao.disabled = pedidoFinalizacaoEmCurso;
      botao.textContent = 'Finalizar leitura do robô';
    }
  } catch {
    status.textContent = 'Não foi possível consultar a finalização. Verifique a conexão e a tabela comandos_esp.';
    botao.disabled = pedidoFinalizacaoEmCurso;
    botao.textContent = 'Finalizar leitura do robô';
  }
}

async function finalizarLeituraEsp() {
  if (!atividadeIdParaFinalizacaoEsp || pedidoFinalizacaoEmCurso) return;
  if (!window.confirm('Finalizar a leitura das cartas no robô? A ESP enviará a sessão completa quando estiver conectada.')) return;
  const botao = document.getElementById('dashboard-finalizar-leitura');
  const status = document.getElementById('dashboard-status-finalizacao');
  pedidoFinalizacaoEmCurso = true;
  if (botao) botao.disabled = true;
  if (status) status.textContent = 'Registrando pedido de finalização…';
  try {
    const resposta = await apiFetch('/api/esp/finalizar-leitura', { method: 'POST' });
    if (status) status.textContent = resposta
      ? 'Pedido enviado! Aguardando a ESP consultar o Supabase.'
      : 'Não foi possível solicitar a finalização. Verifique o servidor e tente novamente.';
  } finally {
    pedidoFinalizacaoEmCurso = false;
    await atualizarStatusFinalizacaoEsp();
  }
}

async function encerrarAtividadeAtual() {
  if (!window.confirm('Encerrar a atividade atual? As leituras e a pontuação já salvas serão preservadas.')) return;
  const resposta = await apiFetch('/api/atividade/encerrar', { method: 'POST' });
  if (!resposta) {
    atualizarStatusSimulador('Não foi possível encerrar a atividade.', 'erro');
    return;
  }
  ultimaAvaliacaoSequencia = null;
  leiturasEquipeAtual = [];
  leituraIdsRenderizadas.clear();
  renderizarMesaDeMontagem([]);
  atualizarResultado('Atividade encerrada. Os resultados anteriores foram preservados.', 'neutro');
  await carregarAtividadeAtual();
  await carregarEquipe(obterEquipeAtual());
  await carregarPlacar();
}

async function fetchQRReading() {
  if (qrRequestEmAndamento) return;
  qrRequestEmAndamento = true;
  try {
    // Busca a lista completa, não só o último QR: evita perder leituras
    // quando várias cartas são apresentadas entre dois intervalos de polling.
    // No cenário A, o backend importa as sessões completas após o QR de fim.
    const equipeNoInicio = equipeAtual;
    const dados = await apiFetch(`/api/leituras?equipe=${encodeURIComponent(equipeNoInicio)}`);
    if (!dados || equipeAtual !== equipeNoInicio || !Array.isArray(dados.leituras)) return;
    const recebidas = dados.leituras;
    const atual = leiturasEquipeAtual.map(item => String(item.id)).join('|');
    const nova = recebidas.map(item => String(item.id)).join('|');
    if (atual === nova) return;

    const anteriores = new Set(leiturasEquipeAtual.map(item => String(item.codigoBinario) + '/' + String(item.id)));
    leiturasEquipeAtual = recebidas;
    leituraIdsRenderizadas.clear();
    recebidas.forEach(item => leituraIdsRenderizadas.add(item.id));
    ultimaAvaliacaoSequencia = null;
    renderizarMesaDeMontagem(recebidas);
    const ultima = recebidas[recebidas.length - 1];
    if (ultima && !anteriores.has(String(ultima.codigoBinario) + '/' + String(ultima.id))) {
      atualizarStatusRobo(`Palavra lida: "${ultima.fragment || ultima.fragmento || ''}"`, 'sucesso');
    }
  } catch (erro) {
    console.warn('Falha ao sincronizar leituras da ESP:', erro);
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
  mostrarQrInicio(resposta.qrInicio, resposta.atividadeId);
  selecionarTipoQr('inicio');
  alternarExibicaoQr(true);

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

  if (equipe !== equipeAtual) await carregarEquipe(equipe);

  const resposta = await apiFetch('/api/qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipe, codigoBinario })
  });

  if (!resposta) {
    atualizarStatusSimulador('Não foi possível enviar a leitura.', 'erro');
    return;
  }

  if (resposta.ignorada && resposta.motivo === 'duplicada') {
    atualizarStatusSimulador(resposta.mensagem || 'Essa carta já foi utilizada pela equipe.', 'erro');
    return;
  }

  const leitura = resposta.leitura || {};
  const mensagem = `Leitura enviada para ${equipe}: "${leitura.fragment || leitura.fragmento || 'bloco registrado'}"`;

  atualizarStatusSimulador(mensagem, 'sucesso');
  atualizarStatusRobo(`Palavra lida: "${leitura.fragment || leitura.fragmento || ''}"`, 'sucesso');
  inputBinario.value = '';

  // atualiza a tela na hora, sem esperar outra chamada em /api/leituras e /api/placar.
  if (equipe === equipeAtual && leitura.id && !leituraIdsRenderizadas.has(leitura.id)) {
    leituraIdsRenderizadas.add(leitura.id);
    ultimaAvaliacaoSequencia = null;
    leiturasEquipeAtual.push(leitura);
    renderizarMesaDeMontagem(leiturasEquipeAtual);
  }
}

async function validarSequencia() {
  if (fraseCorreta.length === 0) {
    atualizarResultado('Inicie a atividade dos trechos antes de validar.', 'erro');
    return;
  }

  if (!equipeAtual) {
    atualizarResultado('Escolha uma equipe antes de validar a sequência.', 'erro');
    return;
  }

  if (leiturasEquipeAtual.length < atividadeFrases.length) {
    atualizarResultado(
      `Leia todos os ${atividadeFrases.length} trechos antes de verificar. Já foram lidos ${leiturasEquipeAtual.length}.`,
      'erro'
    );
    return;
  }

  const resposta = await apiFetch('/api/validar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipe: equipeAtual })
  });

  if (!resposta) {
    atualizarResultado('Não foi possível validar a sequência agora.', 'erro');
    return;
  }

  ultimaAvaliacaoSequencia = resposta;
  renderizarMesaDeMontagem(leiturasEquipeAtual, resposta);

  const total = Number(resposta.total ?? fraseCorreta.length);
  const corretas = Number(resposta.corretas ?? 0);

  if (corretas === total && total > 0) {
    atualizarResultado(`Sequência correta! ${corretas}/${total} trechos estão no lugar certo.`, 'sucesso');
  } else {
    atualizarResultado(
      `${corretas}/${total} trechos estão no lugar certo. Os trechos em vermelho mostram qual deveria estar naquela posição.`,
      'erro'
    );
  }

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
  ultimaAvaliacaoSequencia = null;
  leiturasEquipeAtual = [];
  leituraIdsRenderizadas.clear();
  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');
  atualizarStatusSimulador(`Mesa da ${equipe} limpa com sucesso.`, 'sucesso');
  atualizarStatusRobo('Aguardando comandos...', 'neutro');

  await carregarEquipe(equipe);
}

function reiniciarAtividadeLocal() {
  ultimaAvaliacaoSequencia = null;
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
      pararNarracao();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pararNarracao();
  });
  window.addEventListener('pagehide', () => pararNarracao());

  document.addEventListener('keydown', event => {
    const palco = document.getElementById('presentation-stage');
    const apresentando = Boolean(document.fullscreenElement === palco || palco?.classList.contains('presentation-fallback'));
    if (!apresentando) return;

    const camadaIntervencao = document.getElementById('presentation-intervention-layer');
    const intervencaoAberta = Boolean(camadaIntervencao && !camadaIntervencao.hidden);

    if (intervencaoAberta) {
      if (event.key === 'Escape') {
        event.preventDefault();
        fecharIntervencaoApresentacao();
      }
      return;
    }

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
    acervo: document.getElementById('pagina-acervo'),
    wifi: document.getElementById('pagina-wifi')
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

  if (nomePagina !== 'wifi') document.dispatchEvent(new Event('robo:fechar-wifi'));
  if (nomePagina !== 'contos') pararNarracao();
  if (nomePagina === 'contos') renderizarContos();
  if (nomePagina === 'acervo') entrarAcervo();
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
  const pergunta = document.getElementById('conto-pergunta');
  const resposta = document.getElementById('resposta-texto');
  const indicador = document.getElementById('pergunta-indicador');
  const respostaBox = document.getElementById('resposta-esperada');
  const btnResposta = document.getElementById('btn-resposta');

  if (titulo) titulo.textContent = conto.titulo;
  if (autor) autor.textContent = conto.autor || 'Autor não informado';
  if (resumo) {
    resumo.textContent = conto.resumo || '';
    resumo.hidden = !conto.resumo;
  }

  if (!item) {
    if (pergunta) pergunta.textContent = 'Nenhuma pergunta cadastrada para este conto.';
    if (resposta) resposta.textContent = '';
    if (indicador) indicador.textContent = 'Nenhuma pergunta cadastrada';
  } else {
    if (pergunta) pergunta.textContent = item.pergunta;
    if (resposta) resposta.textContent = item.resposta || 'Nenhuma resposta esperada foi cadastrada.';
    if (indicador) indicador.textContent = `Pergunta ${perguntaSelecionadaIndex + 1} de ${perguntas.length}`;
  }

  if (respostaBox) respostaBox.hidden = true;
  if (btnResposta) btnResposta.textContent = 'Mostrar resposta esperada';

  renderizarDesafioAtual();
  renderizarDicaAtual();
  atualizarApresentacao();
  renderizarMesaDeMontagem(leiturasEquipeAtual);
}

function selecionarConto(id) {
  if (!CONTOS.some(conto => conto.id === id)) return;
  if (contoSelecionadoId !== id) {
    pararNarracao();
    trechoSelecionadoIndex = 0;
  }
  contoSelecionadoId = id;
  perguntaSelecionadaIndex = 0;
  desafioSelecionadoIndex = -1;
  dicaSelecionadaIndex = -1;
  renderizarContos();

  const gerenciarSelect = document.getElementById('gerenciar-conto-select');
  if (gerenciarSelect) gerenciarSelect.value = id;
  renderizarPerguntasGerenciador();
  atualizarPdfGerenciador();
  if (!document.getElementById('pagina-acervo')?.hidden) renderizarAcervo();
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

function renderizarDesafioAtual() {
  const conto = obterContoSelecionado();
  const desafios = Array.isArray(conto?.desafios) ? conto.desafios : [];
  const conteudo = document.getElementById('desafio-conteudo');
  const indicador = document.getElementById('desafio-indicador');
  const momento = document.getElementById('desafio-momento');
  const texto = document.getElementById('desafio-texto');
  const botao = document.getElementById('btn-proximo-desafio');

  if (!conteudo || !indicador || !texto || !botao) return;

  const desafio = desafios[desafioSelecionadoIndex] || null;
  conteudo.hidden = !desafio;

  if (!desafio) {
    if (momento) momento.hidden = true;
    botao.disabled = desafios.length === 0;
    botao.textContent = desafios.length ? 'Iniciar desafio' : 'Nenhum desafio cadastrado';
    return;
  }

  indicador.textContent = `Missão ${desafioSelecionadoIndex + 1} de ${desafios.length}`;
  if (momento) {
    momento.textContent = desafio.momento ? `Momento: ${desafio.momento}` : '';
    momento.hidden = !desafio.momento;
  }
  texto.textContent = desafio.texto;
  botao.textContent = desafioSelecionadoIndex === desafios.length - 1
    ? 'Voltar ao primeiro desafio'
    : 'Próximo desafio';
}

function mostrarProximoDesafio() {
  const conto = obterContoSelecionado();
  const desafios = Array.isArray(conto?.desafios) ? conto.desafios : [];
  if (!desafios.length) return;

  desafioSelecionadoIndex = (desafioSelecionadoIndex + 1) % desafios.length;
  renderizarDesafioAtual();

  const conteudo = document.getElementById('desafio-conteudo');
  if (!conteudo) return;
  conteudo.classList.remove('animar-desafio');
  void conteudo.offsetWidth;
  conteudo.classList.add('animar-desafio');
}

function renderizarDicaAtual() {
  const conto = obterContoSelecionado();
  const dicas = Array.isArray(conto?.dicas) ? conto.dicas : [];
  const conteudo = document.getElementById('dica-conteudo');
  const indicador = document.getElementById('dica-indicador');
  const texto = document.getElementById('dica-texto');
  const botao = document.getElementById('btn-proxima-dica');

  if (!conteudo || !indicador || !texto || !botao) return;

  const dica = dicas[dicaSelecionadaIndex] || null;
  conteudo.hidden = !dica;

  if (!dica) {
    botao.disabled = dicas.length === 0;
    botao.textContent = dicas.length ? 'Preciso de uma dica' : 'Nenhuma dica cadastrada';
    return;
  }

  indicador.textContent = `Dica ${dicaSelecionadaIndex + 1} de ${dicas.length}`;
  texto.textContent = dica.texto;
  botao.textContent = dicaSelecionadaIndex === dicas.length - 1
    ? 'Voltar à primeira dica'
    : 'Outra dica';
}

function mostrarProximaDica() {
  const conto = obterContoSelecionado();
  const dicas = Array.isArray(conto?.dicas) ? conto.dicas : [];
  if (!dicas.length) return;

  dicaSelecionadaIndex = (dicaSelecionadaIndex + 1) % dicas.length;
  renderizarDicaAtual();
}

async function iniciarTrechosDoConto() {
  const id = document.getElementById('dashboard-conto-trechos')?.value;
  const conto = CONTOS.find(item => item.id === id);
  if (!conto) return;

  if (!conto.trechos?.length) {
    atualizarResultado('Este conto não possui trechos cadastrados.', 'erro');
    return;
  }

  const resposta = await apiFetch(`/api/contos/${encodeURIComponent(conto.id)}/iniciar-trechos`, {
    method: 'POST'
  });

  if (!resposta || !Array.isArray(resposta.frases)) {
    atualizarResultado('Não foi possível iniciar a atividade dos trechos.', 'erro');
    return;
  }

  atividadeFrases = resposta.frases.slice().sort((a, b) => a.indice - b.indice);
  fraseCorreta = atividadeFrases.map(item => String(item.texto || '').toLowerCase());
  ultimaAvaliacaoSequencia = null;
  lastQRId = null;
  leiturasEquipeAtual = [];
  leituraIdsRenderizadas.clear();

  renderizarMesaDeMontagem([]);
  renderizarBinarioDaFrase(atividadeFrases);
  mostrarQrInicio(resposta.qrInicio, resposta.atividadeId);
  selecionarTipoQr('inicio');
  alternarExibicaoQr(true);
  atualizarResultado('Atividade iniciada. Mostre o QR de início à ESP e leia as cartas.', 'neutro');
  atualizarStatusSimulador(`Atividade de "${conto.titulo}" iniciada.`, 'sucesso');
  await carregarEquipe(equipeAtual);
  await carregarPlacar();
}

function selecionarEquipeConto(valor) {
  return selecionarEquipeDashboard(valor);
}

function atualizarApresentacao() {
  fecharIntervencaoApresentacao();

  const conto = obterContoSelecionado();
  const item = conto?.perguntas?.[perguntaSelecionadaIndex] || null;

  const titulo = document.getElementById('presentation-title');
  const autor = document.getElementById('presentation-author');
  const pergunta = document.getElementById('presentation-pergunta');
  const progresso = document.getElementById('presentation-progress');

  if (titulo) titulo.textContent = conto?.titulo || 'Conto';
  if (autor) autor.textContent = conto?.autor || 'Autor não informado';
  if (pergunta) pergunta.textContent = item?.pergunta || 'Nenhuma pergunta cadastrada.';
  if (progresso) {
    progresso.textContent = item
      ? `Pergunta ${perguntaSelecionadaIndex + 1} de ${conto.perguntas.length}`
      : 'Sem perguntas cadastradas';
  }
  atualizarModoApresentacao();
}

function obterContextoApresentacao() {
  const conto = obterContoSelecionado();
  const total = conto?.perguntas?.length || 0;
  const partePergunta = total
    ? `Pergunta ${perguntaSelecionadaIndex + 1} de ${total}`
    : 'Sem pergunta selecionada';

  return `${conto?.titulo || 'Conto'} • ${partePergunta}`;
}

function fecharIntervencaoApresentacao() {
  const layer = document.getElementById('presentation-intervention-layer');
  const card = document.getElementById('presentation-intervention');
  const botaoProximo = document.getElementById('presentation-intervention-next');

  if (layer) layer.hidden = true;

  if (card) {
    card.classList.remove(
      'modo-dica',
      'modo-desafio',
      'modo-resposta',
      'animar-intervencao'
    );
  }

  if (botaoProximo) {
    botaoProximo.hidden = true;
    botaoProximo.onclick = null;
  }
}

function abrirIntervencaoApresentacao({
  tipo,
  label,
  texto,
  textoBotao = '',
  acaoBotao = null
}) {
  const layer = document.getElementById('presentation-intervention-layer');
  const card = document.getElementById('presentation-intervention');
  const labelEl = document.getElementById('presentation-intervention-label');
  const contextoEl = document.getElementById('presentation-intervention-context');
  const textoEl = document.getElementById('presentation-intervention-text');
  const botaoProximo = document.getElementById('presentation-intervention-next');

  if (!layer || !card || !labelEl || !contextoEl || !textoEl || !botaoProximo) return;

  card.classList.remove(
    'modo-dica',
    'modo-desafio',
    'modo-resposta',
    'animar-intervencao'
  );
  card.classList.add(`modo-${tipo}`);

  labelEl.textContent = label || '';
  contextoEl.textContent = obterContextoApresentacao();
  textoEl.textContent = texto || '';

  if (textoBotao && typeof acaoBotao === 'function') {
    botaoProximo.hidden = false;
    botaoProximo.textContent = textoBotao;
    botaoProximo.onclick = acaoBotao;
  } else {
    botaoProximo.hidden = true;
    botaoProximo.onclick = null;
  }

  layer.hidden = false;
  void card.offsetWidth;
  card.classList.add('animar-intervencao');
}

function limparChamadaDesafio(texto) {
  return String(texto || '')
    .replace(/^ATENÇÃO,\s*ESCRITORES!\s*/i, '')
    .trim();
}

function mostrarDicaApresentacao() {
  const conto = obterContoSelecionado();
  const dicas = Array.isArray(conto?.dicas) ? conto.dicas : [];

  if (!dicas.length) {
    abrirIntervencaoApresentacao({
      tipo: 'dica',
      label: 'Dica',
      texto: 'Este conto ainda não possui dicas cadastradas.'
    });
    return;
  }

  dicaSelecionadaIndex = (dicaSelecionadaIndex + 1) % dicas.length;
  const dica = dicas[dicaSelecionadaIndex];

  renderizarDicaAtual();

  abrirIntervencaoApresentacao({
    tipo: 'dica',
    label: `Dica ${dicaSelecionadaIndex + 1} de ${dicas.length}`,
    texto: dica.texto,
    textoBotao: dicaSelecionadaIndex === dicas.length - 1
      ? 'Voltar à primeira dica'
      : 'Outra dica',
    acaoBotao: mostrarDicaApresentacao
  });
}

function mostrarDesafioApresentacao() {
  const conto = obterContoSelecionado();
  const desafios = Array.isArray(conto?.desafios) ? conto.desafios : [];

  if (!desafios.length) {
    abrirIntervencaoApresentacao({
      tipo: 'desafio',
      label: 'Desafio',
      texto: 'Este conto ainda não possui desafios cadastrados.'
    });
    return;
  }

  desafioSelecionadoIndex = (desafioSelecionadoIndex + 1) % desafios.length;
  const desafio = desafios[desafioSelecionadoIndex];

  renderizarDesafioAtual();

  abrirIntervencaoApresentacao({
    tipo: 'desafio',
    label: `Missão ${desafioSelecionadoIndex + 1} de ${desafios.length}`,
    texto: limparChamadaDesafio(desafio.texto),
    textoBotao: desafioSelecionadoIndex === desafios.length - 1
      ? 'Voltar à primeira missão'
      : 'Próxima missão',
    acaoBotao: mostrarDesafioApresentacao
  });
}

function mostrarRespostaApresentacao() {
  const conto = obterContoSelecionado();
  const pergunta = conto?.perguntas?.[perguntaSelecionadaIndex] || null;

  abrirIntervencaoApresentacao({
    tipo: 'resposta',
    label: 'Resposta esperada',
    texto: pergunta?.resposta || 'Nenhuma resposta esperada foi cadastrada.'
  });
}

async function abrirApresentacao(modo = 'pergunta') {
  if (modo !== modoApresentacao) pararNarracao();
  modoApresentacao = ['trechos', 'pdf'].includes(modo) ? modo : 'pergunta';
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
  pararNarracao();
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
  liberarPdfApresentacao();
}

function abrirGerenciadorConteudo() {
  const dialog = document.getElementById('conteudo-dialog');
  if (!dialog) return;

  popularSelectContos();
  const select = document.getElementById('gerenciar-conto-select');
  if (select) select.value = contoSelecionadoId;
  cancelarEdicaoPergunta();
  renderizarPerguntasGerenciador();
  atualizarPdfGerenciador();

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function fecharGerenciadorConteudo() {
  const dialog = document.getElementById('conteudo-dialog');
  if (!dialog) return;

  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function adicionarConto(event) {
  event.preventDefault();

  const tituloInput = document.getElementById('novo-conto-titulo');
  const autorInput = document.getElementById('novo-conto-autor');
  const resumoInput = document.getElementById('novo-conto-resumo');
  const titulo = tituloInput?.value.trim();
  if (!titulo) return;

  const resposta = await apiFetch('/api/contos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo,
      autor: autorInput?.value.trim() || '',
      resumo: resumoInput?.value.trim() || ''
    })
  });

  if (!resposta?.conto) return;

  contoSelecionadoId = resposta.conto.id;
  perguntaSelecionadaIndex = 0;
  desafioSelecionadoIndex = -1;
  dicaSelecionadaIndex = -1;
  await carregarContosDoBanco();

  event.target.reset();
  renderizarContos();

  const gerenciarSelect = document.getElementById('gerenciar-conto-select');
  if (gerenciarSelect) gerenciarSelect.value = contoSelecionadoId;
  renderizarPerguntasGerenciador();
  atualizarPdfGerenciador();
}

async function salvarPerguntaGerenciada(event) {
  event.preventDefault();

  const select = document.getElementById('gerenciar-conto-select');
  const conto = CONTOS.find(item => item.id === select?.value);
  if (!conto) return;

  const pergunta = document.getElementById('gerenciar-pergunta')?.value.trim();
  const resposta = document.getElementById('gerenciar-resposta')?.value.trim() || '';
  if (!pergunta) return;

  const indiceInput = document.getElementById('gerenciar-edicao-index');
  const indice = indiceInput?.value === '' ? null : Number(indiceInput.value);
  const itemExistente = Number.isInteger(indice) ? conto.perguntas?.[indice] : null;

  const endpoint = itemExistente ? `/api/perguntas/${itemExistente.id}` : '/api/perguntas';
  const method = itemExistente ? 'PUT' : 'POST';
  const payload = itemExistente
    ? { pergunta, resposta }
    : { contoId: conto.id, pergunta, resposta };

  const salvo = await apiFetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!salvo) return;

  contoSelecionadoId = conto.id;
  perguntaSelecionadaIndex = itemExistente ? indice : conto.perguntas.length;
  await carregarContosDoBanco();

  cancelarEdicaoPergunta();
  renderizarContos();

  const gerenciarSelect = document.getElementById('gerenciar-conto-select');
  if (gerenciarSelect) gerenciarSelect.value = contoSelecionadoId;
  renderizarPerguntasGerenciador();
}

function cancelarEdicaoPergunta() {
  ['gerenciar-pergunta', 'gerenciar-resposta'].forEach(id => {
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

  document.getElementById('gerenciar-pergunta').value = item.pergunta || '';
  document.getElementById('gerenciar-resposta').value = item.resposta || '';
  document.getElementById('gerenciar-edicao-index').value = String(indice);
  document.getElementById('btn-cancelar-edicao').hidden = false;
  document.getElementById('btn-salvar-pergunta').textContent = 'Salvar alterações';
  document.getElementById('gerenciar-pergunta').focus();
}

async function excluirPerguntaGerenciada(indice) {
  const select = document.getElementById('gerenciar-conto-select');
  const conto = CONTOS.find(item => item.id === select?.value);
  const item = conto?.perguntas?.[indice];
  if (!item) return;

  if (!window.confirm('Excluir esta pergunta?')) return;

  const resposta = await apiFetch(`/api/perguntas/${item.id}`, { method: 'DELETE' });
  if (!resposta) return;

  contoSelecionadoId = conto.id;
  perguntaSelecionadaIndex = Math.min(
    perguntaSelecionadaIndex,
    Math.max(conto.perguntas.length - 2, 0)
  );

  await carregarContosDoBanco();
  cancelarEdicaoPergunta();
  renderizarContos();

  const gerenciarSelect = document.getElementById('gerenciar-conto-select');
  if (gerenciarSelect) gerenciarSelect.value = contoSelecionadoId;
  renderizarPerguntasGerenciador();
  atualizarPdfGerenciador();
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

  if (!perguntas.length) {
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
    const pergunta = document.createElement('strong');
    pergunta.textContent = item.pergunta;
    texto.appendChild(pergunta);

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

// Uma única instância gerencia o speechSynthesis e todos os controles.
function inicializarNarracao() {
  if (!window.NarradorTrechos) return;
  narradorTrechos = new window.NarradorTrechos(window.speechSynthesis, window.SpeechSynthesisUtterance);
  narradorTrechos.onChange = sincronizarControlesNarracao;
  narradorTrechos.atualizarVozes();
}

function sincronizarControlesNarracao() {
  const voz = document.getElementById('narracao-voz');
  const ouvir = document.getElementById('narracao-reproduzir');
  const pausar = document.getElementById('narracao-pausar');
  const parar = document.getElementById('narracao-parar');
  const status = document.getElementById('narracao-status');
  if (!voz || !narradorTrechos) return;

  voz.replaceChildren();
  if (narradorTrechos.vozes.length) {
    narradorTrechos.vozes.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.voiceURI;
      opt.textContent = item.name;
      voz.appendChild(opt);
    });
    voz.value = narradorTrechos.vozId;
  } else {
    const opt = document.createElement('option');
    opt.textContent = 'Automática (tentar pt-BR)';
    opt.value = '';
    voz.appendChild(opt);
  }

  voz.disabled = !narradorTrechos.vozes.length;
  if (ouvir) ouvir.disabled = !narradorTrechos.disponivel || !obterTrechoApresentacao();
  if (pausar) {
    pausar.disabled = !['lendo', 'pausado'].includes(narradorTrechos.estado);
    pausar.textContent = narradorTrechos.estado === 'pausado' ? '▶ Continuar' : '⏸ Pausar';
  }
  if (parar) parar.disabled = !['lendo', 'pausado'].includes(narradorTrechos.estado);
  if (status) status.textContent = narradorTrechos.mensagem;
}

function obterTrechoApresentacao() {
  return obterContoSelecionado()?.trechos?.[trechoSelecionadoIndex] || null;
}

function atualizarModoApresentacao() {
  const trechoAberto = modoApresentacao === 'trechos';
  const pdfAberto = modoApresentacao === 'pdf';
  const pergunta = document.getElementById('presentation-question');
  const trechos = document.getElementById('presentation-trechos');
  const controles = document.getElementById('presentation-controls');
  const kicker = document.getElementById('presentation-kicker');
  const botaoModo = document.getElementById('presentation-modo-trechos');
  if (pergunta) pergunta.hidden = trechoAberto || pdfAberto;
  if (trechos) trechos.hidden = !trechoAberto;
  if (controles) controles.hidden = trechoAberto || pdfAberto;
  if (kicker) kicker.textContent = trechoAberto ? 'Leitura dos trechos' : pdfAberto ? 'Texto do conto' : 'Pergunta';
  const pdfSecao = document.getElementById('presentation-pdf');
  if (pdfSecao) pdfSecao.hidden = !pdfAberto;
  for (const [id, ativo] of [['presentation-modo-pergunta', !pdfAberto && !trechoAberto], ['presentation-modo-pdf', pdfAberto]]) {
    const botao = document.getElementById(id);
    if (botao) botao.setAttribute('aria-pressed', String(ativo));
  }
  if (pdfAberto) carregarPdfApresentacao();
  else liberarPdfApresentacao();
  if (botaoModo) {
    botaoModo.querySelector('span').textContent = trechoAberto ? 'Perguntas' : 'Trechos';
    botaoModo.title = trechoAberto ? 'Voltar às perguntas' : 'Mostrar trechos e narração';
    botaoModo.setAttribute('aria-label', botaoModo.title);
  }
  const select = document.getElementById('presentation-trecho-select');
  const texto = document.getElementById('presentation-trecho-texto');
  if (select && texto) {
    const lista = obterContoSelecionado()?.trechos || [];
    if (trechoSelecionadoIndex >= lista.length) trechoSelecionadoIndex = 0;
    select.replaceChildren();
    lista.forEach((item, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `Trecho ${item.letra || i + 1} • ordem ${item.ordemCorreta}`;
      select.appendChild(option);
    });
    select.disabled = !lista.length;
    select.value = String(trechoSelecionadoIndex);
    texto.textContent = obterTrechoApresentacao()?.texto || 'Este conto ainda não possui trechos cadastrados.';
  }
  sincronizarControlesNarracao();
}

function alternarModoApresentacao() {
  pararNarracao();
  modoApresentacao = modoApresentacao === 'trechos' ? 'pergunta' : 'trechos';
  fecharIntervencaoApresentacao();
  atualizarModoApresentacao();
}

function selecionarTrechoApresentacao(indice) {
  const valor = Number(indice);
  if (!Number.isInteger(valor) || valor < 0) return;
  if (!obterContoSelecionado()?.trechos?.[valor]) return;
  pararNarracao();
  trechoSelecionadoIndex = valor;
  atualizarModoApresentacao();
}

function reproduzirTrecho() {
  const trecho = obterTrechoApresentacao();
  if (trecho && narradorTrechos) narradorTrechos.falar(trecho.texto);
}

function pausarOuContinuarNarracao() {
  narradorTrechos?.pausarOuContinuar();
}

function pararNarracao() {
  if (narradorTrechos && narradorTrechos.estado !== 'parado') narradorTrechos.parar();
}

function alterarVozNarracao(valor) {
  narradorTrechos?.selecionarVoz(valor);
}

function alterarVelocidadeNarracao(valor) {
  narradorTrechos?.ajustarVelocidade(valor);
}

// PDF: consulta e arquivo privados no Storage, acessados apenas pelo backend.
function urlPdfConto(id) {
  return `/api/contos/${encodeURIComponent(id)}/pdf`;
}

function liberarPdfApresentacao() {
  pdfCarregamentoId++;
  const frame = document.getElementById('presentation-pdf-frame');
  if (frame) frame.removeAttribute('src');
  if (pdfApresentacaoUrl) URL.revokeObjectURL(pdfApresentacaoUrl);
  pdfApresentacaoUrl = null;
}

async function carregarPdfApresentacao() {
  liberarPdfApresentacao();
  const idPedido = pdfCarregamentoId;
  const secao = document.getElementById('presentation-pdf');
  const aviso = document.getElementById('presentation-pdf-aviso');
  const frame = document.getElementById('presentation-pdf-frame');
  const conto = obterContoSelecionado();
  if (!secao || !aviso || !frame || !conto || modoApresentacao !== 'pdf') return;
  const dizer = texto => { aviso.textContent = texto; aviso.hidden = !texto; };
  frame.hidden = true;
  if (!conto.possuiPdf) return dizer('Este conto ainda não possui PDF cadastrado.');
  dizer('Carregando texto do conto…');
  try {
    const resposta = await fetch(urlPdfConto(conto.id), { cache: 'no-store' });
    if (!resposta.ok || !(resposta.headers.get('content-type') || '').includes('application/pdf')) {
      throw new Error('Não foi possível abrir o PDF.');
    }
    const arquivo = await resposta.blob();
    if (idPedido !== pdfCarregamentoId || modoApresentacao !== 'pdf' || obterContoSelecionado()?.id !== conto.id) return;
    pdfApresentacaoUrl = URL.createObjectURL(arquivo);
    frame.src = pdfApresentacaoUrl;
    frame.hidden = false;
    dizer('');
  } catch (error) {
    if (idPedido === pdfCarregamentoId) dizer(error.message || 'Não foi possível abrir o PDF.');
  }
}

function selecionarVisualizacaoApresentacao(modo) {
  if (!['pergunta', 'pdf'].includes(modo) || modoApresentacao === modo) return;
  pararNarracao();
  modoApresentacao = modo;
  fecharIntervencaoApresentacao();
  atualizarModoApresentacao();
}

function contoPdfGerenciado() {
  const id = document.getElementById('gerenciar-conto-select')?.value;
  return CONTOS.find(item => item.id === id) || null;
}

function atualizarPdfGerenciador(mensagem = '') {
  const conto = contoPdfGerenciado();
  const estado = document.getElementById('gerenciar-pdf-estado');
  const remover = document.getElementById('gerenciar-pdf-remover');
  const enviar = document.getElementById('gerenciar-pdf-enviar');
  if (estado) estado.textContent = mensagem || (!conto ? 'Selecione um conto.' : conto.possuiPdf ? 'PDF cadastrado para este conto.' : 'Este conto não possui PDF cadastrado.');
  if (remover) remover.hidden = !conto?.possuiPdf;
  if (enviar) { enviar.disabled = !conto; enviar.textContent = conto?.possuiPdf ? 'Substituir PDF' : 'Anexar PDF'; }
}

async function obterTokenAdminPdf() {
  if (tokenAdminPdf) return tokenAdminPdf;
  const chave = window.prompt('Para alterar atividades, contos ou PDFs, informe a chave administrativa do site:');
  if (!chave) return null;
  const resposta = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessKey: chave })
  });
  const dados = await resposta.json();
  if (!resposta.ok || !dados.token) throw new Error(dados.error || 'Chave administrativa inválida.');
  tokenAdminPdf = dados.token; // Apenas em memória; nunca vai para o Storage nem para localStorage.
  return tokenAdminPdf;
}

async function requisicaoPdfAdmin(contoId, metodo, arquivo) {
  let token = await obterTokenAdminPdf();
  if (!token) return null;
  let resposta = await fetch(urlPdfConto(contoId), {
    method: metodo,
    headers: { 'Authorization': `Bearer ${token}`, ...(arquivo ? { 'Content-Type': 'application/pdf' } : {}) },
    ...(arquivo ? { body: arquivo } : {})
  });
  // Uma sessão administrativa expirada exige novo login na próxima tentativa.
  if (resposta.status === 401) tokenAdminPdf = null;
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || `Erro ${resposta.status} ao atualizar o PDF.`);
  return dados;
}

async function atualizarContosAposPdf(contoId, mensagem) {
  await carregarContosDoBanco();
  const gerenciar = document.getElementById('gerenciar-conto-select');
  if (gerenciar) gerenciar.value = contoId;
  atualizarPdfGerenciador(mensagem);
  if (!document.getElementById('pagina-acervo')?.hidden) renderizarAcervo();
}

async function enviarPdfGerenciador() {
  const conto = contoPdfGerenciado();
  const arquivo = document.getElementById('gerenciar-pdf-arquivo')?.files?.[0];
  if (!conto) return atualizarPdfGerenciador('Selecione um conto.');
  if (!arquivo) return atualizarPdfGerenciador('Escolha um arquivo PDF.');
  if (arquivo.size > 10 * 1024 * 1024 || arquivo.size === 0 || !/\.pdf$/i.test(arquivo.name)) {
    return atualizarPdfGerenciador('Selecione um PDF válido de até 10 MB.');
  }
  atualizarPdfGerenciador('Enviando PDF…');
  try {
    const resultado = await requisicaoPdfAdmin(conto.id, 'PUT', arquivo);
    if (!resultado) return atualizarPdfGerenciador();
    document.getElementById('gerenciar-pdf-arquivo').value = '';
    await atualizarContosAposPdf(conto.id, resultado.aviso || 'PDF salvo no Supabase.');
  } catch (error) { atualizarPdfGerenciador(error.message); }
}

async function removerPdfGerenciador() {
  const conto = contoPdfGerenciado();
  if (!conto?.possuiPdf || !window.confirm(`Remover o PDF de "${conto.titulo}"?`)) return;
  atualizarPdfGerenciador('Removendo PDF…');
  try {
    const resultado = await requisicaoPdfAdmin(conto.id, 'DELETE');
    if (resultado) await atualizarContosAposPdf(conto.id, resultado.aviso || 'PDF removido.');
    else atualizarPdfGerenciador();
  } catch (error) { atualizarPdfGerenciador(error.message); }
}

window.onload = async () => {
  configurarNavegacao();
  inicializarNarracao();
  startClock();
  startConnectionMonitor();

  await carregarContosDoBanco();
  renderizarContos();

  const inputEquipe = document.getElementById('input-equipe');
  const inputEquipeConto = document.getElementById('input-equipe-conto');
  const inputBinario = document.getElementById('input-binario');

  preencherSeletoresDeEquipe();
  if (inputEquipe) {
    inputEquipe.addEventListener('change', () => {
      selecionarEquipeDashboard(inputEquipe.value);
    });
  }

  if (inputBinario) {
    inputBinario.addEventListener('keydown', event => {
      if (event.key === 'Enter') simularLeitura();
    });
  }

  sincronizarEquipeNaInterface(equipeAtual);

  atualizarResultado('Aguardando leitura dos blocos...', 'neutro');
  await carregarAtividadeAtual();
  await carregarEquipe(equipeAtual);
  await carregarPlacar();

  setInterval(fetchQRReading, 2000);
  setInterval(atualizarStatusFinalizacaoEsp, 5000);
  setInterval(carregarPlacar, 15000);
};
