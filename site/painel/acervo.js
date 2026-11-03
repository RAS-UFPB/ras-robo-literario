/* Acervo de consulta: nenhuma gravação no banco e nenhum PDF local novo. */
let atividadesAcervo = [];
let atividadeAcervoSelecionadaId = '';
let acervoInicializado = false;

function elementoAcervo(tag, texto = '', classe = '') {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  el.textContent = texto;
  return el;
}

function preencherItensAcervo(id, itens, construir, mensagemVazia) {
  const destino = document.getElementById(id);
  if (!destino) return;
  destino.replaceChildren();
  if (!itens.length) {
    destino.appendChild(elementoAcervo('p', mensagemVazia, 'acervo-vazio'));
    return;
  }
  itens.forEach((item, index) => destino.appendChild(construir(item, index)));
}

function criarItemAcervo(rotulo, texto) {
  const artigo = elementoAcervo('article', '', 'acervo-item');
  artigo.append(elementoAcervo('strong', rotulo), elementoAcervo('p', texto || 'Não cadastrado.'));
  return artigo;
}

function selecionarAtividadeAcervo(id) {
  atividadeAcervoSelecionadaId = id;
  renderizarAcervo();
}

function renderizarAcervo() {
  const conto = obterContoSelecionado();
  const selConto = document.getElementById('acervo-conto');
  const selAtividade = document.getElementById('acervo-atividade');
  if (!selConto || !selAtividade) return;

  selConto.replaceChildren();
  CONTOS.forEach(item => {
    const opcao = elementoAcervo('option', item.titulo);
    opcao.value = item.id;
    selConto.appendChild(opcao);
  });
  if (conto) selConto.value = conto.id;

  const vinculadas = atividadesAcervo
    .filter(item => item.contosCompativeisIds.includes(conto?.id))
    .sort((a, b) => Number(b.ativa) - Number(a.ativa) || b.id - a.id);
  selAtividade.replaceChildren();
  const semAtividade = elementoAcervo('option', vinculadas.length ? 'Escolha uma atividade' : 'Nenhuma atividade vinculada');
  semAtividade.value = '';
  selAtividade.appendChild(semAtividade);
  for (const atividade of vinculadas) {
    const estado = atividade.ativa ? ' • em andamento' : '';
    const opcao = elementoAcervo('option', `Atividade ${atividade.id}${estado}`);
    opcao.value = String(atividade.id);
    selAtividade.appendChild(opcao);
  }
  if (atividadeAcervoSelecionadaId && vinculadas.some(item => String(item.id) === atividadeAcervoSelecionadaId)) {
    selAtividade.value = atividadeAcervoSelecionadaId;
  } else {
    atividadeAcervoSelecionadaId = '';
  }
  const atividade = vinculadas.find(item => String(item.id) === atividadeAcervoSelecionadaId);
  const msg = document.getElementById('acervo-vinculo');
  if (msg) msg.textContent = vinculadas.length
    ? vinculadas.length === 1 ? '1 atividade preparada para este conto.' : `${vinculadas.length} atividades preparadas para este conto.`
    : 'Nenhuma atividade preparada para este conto. Para iniciar, use o Dashboard.';
  const secaoBlocos = document.getElementById('acervo-blocos-secao');
  if (secaoBlocos) secaoBlocos.hidden = !atividade;

  document.getElementById('acervo-titulo').textContent = conto?.titulo || 'Nenhum conto cadastrado';
  document.getElementById('acervo-autor').textContent = conto?.autor ? `Autor: ${conto.autor}` : 'Autor não informado';
  document.getElementById('acervo-resumo-texto').textContent = conto?.resumo || 'Nenhum resumo cadastrado.';
  document.getElementById('acervo-pdf-status').textContent =
    conto?.possuiPdf ? 'PDF cadastrado. Consulte em Texto do conto, na apresentação.' : 'PDF original ainda não disponível (não cadastrado).';

  preencherItensAcervo('acervo-blocos-atividade', atividade?.frases || [], frase =>
    criarItemAcervo(`Bloco ${frase.indice} • ${frase.codigoBinario}`, frase.texto),
  atividade ? 'Esta atividade não possui blocos cadastrados.' : 'Selecione uma atividade para consultar seus blocos.');

  preencherItensAcervo('acervo-trechos', conto?.trechos || [], trecho =>
    criarItemAcervo(`Ordem ${trecho.ordemCorreta} • Carta ${trecho.letra}`, trecho.texto),
  'Nenhum trecho cadastrado para este conto.');

  preencherItensAcervo('acervo-perguntas', conto?.perguntas || [], (item, i) => {
    const artigo = criarItemAcervo(`Pergunta ${item.ordem ?? i + 1}`, item.pergunta);
    artigo.appendChild(elementoAcervo('p', `Resposta esperada: ${item.resposta || 'Não cadastrada.'}`, 'acervo-resposta'));
    return artigo;
  }, 'Nenhuma pergunta cadastrada para este conto.');

  preencherItensAcervo('acervo-dicas', conto?.dicas || [], (dica, i) => {
    const artigo = criarItemAcervo(`Dica ${dica.ordem ?? i + 1}`, dica.texto);
    const relacionado = dica.trechoId != null
      ? `Vinculada ao trecho ${dica.trechoLetra || `#${dica.trechoId}`}`
      : 'Dica geral do conto (sem trecho específico).';
    artigo.appendChild(elementoAcervo('small', relacionado, 'acervo-nota'));
    return artigo;
  }, 'Nenhuma dica cadastrada para este conto.');

  preencherItensAcervo('acervo-desafios', conto?.desafios || [], (desafio, i) => {
    const artigo = criarItemAcervo(`Desafio ${desafio.ordem ?? i + 1}`, desafio.texto);
    if (desafio.momento) artigo.appendChild(elementoAcervo('small', `Momento: ${desafio.momento}`, 'acervo-nota'));
    return artigo;
  }, 'Nenhum desafio cadastrado para este conto.');

  const apresentar = document.getElementById('acervo-apresentar');
  const podeApresentar = Boolean(conto);
  apresentar.disabled = !podeApresentar;
  apresentar.title = 'Mostrar os trechos deste conto';
}

async function entrarAcervo() {
  if (!acervoInicializado) {
    document.getElementById('acervo-conto').addEventListener('change', event => {
      atividadeAcervoSelecionadaId = '';
      selecionarConto(event.target.value);
      renderizarAcervo();
    });
    document.getElementById('acervo-atividade').addEventListener('change', event => selecionarAtividadeAcervo(event.target.value));
    document.getElementById('acervo-apresentar').addEventListener('click', () => {
      if (!obterContoSelecionado()) return;
      trocarPagina('contos');
      abrirApresentacao('trechos');
    });
    acervoInicializado = true;
  }

  const status = document.getElementById('acervo-carregamento');
  status.hidden = false;
  status.textContent = 'Consultando atividades cadastradas…';
  renderizarAcervo();
  try {
    const res = await fetch('/api/acervo/atividades');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const dados = await res.json();
    atividadesAcervo = Array.isArray(dados.atividades) ? dados.atividades : [];
    status.hidden = true;
  } catch {
    status.textContent = 'Não foi possível consultar as atividades. Os contos continuam disponíveis para consulta.';
  }
  renderizarAcervo();
}
