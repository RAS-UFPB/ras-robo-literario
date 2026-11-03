// Cenário A: uma sessão completa chega à tabela sessoes_esp após QR "fim".
// Importação atômica + marca persistente evitam leituras duplicadas se o backend
// reiniciar ou a ESP repetir o POST por perda de confirmação de rede.

const INTERVALO_PADRAO_MS = 5000;

function extrairAtividadeId(sessaoId) {
  const match = /^ATV-([1-9]\d*)$/.exec(String(sessaoId || ''));
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

function normalizarCodigo(valor) {
  if (Number.isInteger(valor) && valor >= 0 && valor <= 15) {
    return valor.toString(2).padStart(4, '0');
  }
  if (typeof valor === 'string' && /^[01]{4}$/.test(valor)) return valor;
  throw new Error(`Código de carta inválido: ${JSON.stringify(valor)}`);
}

function prepararLeituras(sessao, atividade) {
  if (!Array.isArray(sessao.rodadas)) throw new Error('A sessão não contém uma lista de rodadas.');
  if (sessao.rodadas.length > 10) throw new Error('Sessão excedeu o limite de 10 rodadas da ESP.');

  const frases = new Map(atividade.frases.map(frase => [frase.codigoBinario, frase]));
  const leituras = [];
  const ordemPorEquipe = new Map();

  for (const [indiceRodada, rodada] of sessao.rodadas.entries()) {
    const equipe = Number(rodada?.equipe);
    if (!Number.isInteger(equipe) || equipe < 1 || equipe > 255) {
      throw new Error(`Número de equipe inválido na rodada ${indiceRodada + 1}.`);
    }
    if (!Array.isArray(rodada?.sequencia) || rodada.sequencia.length > 16) {
      throw new Error(`Sequência inválida na rodada ${indiceRodada + 1}.`);
    }

    const codigosDestaRodada = new Set();
    for (const valor of rodada.sequencia) {
      const codigo = normalizarCodigo(valor);
      if (codigosDestaRodada.has(codigo)) continue; // Leitura repetida não ocupa outra posição.
      const frase = frases.get(codigo);
      if (!frase) throw new Error(`Código ${codigo} não está cadastrado na atividade ${atividade.id}.`);
      codigosDestaRodada.add(codigo);
      const nomeEquipe = `Equipe ${equipe}`;
      const proximaOrdem = (ordemPorEquipe.get(nomeEquipe) || 0) + 1;
      ordemPorEquipe.set(nomeEquipe, proximaOrdem);
      leituras.push({ nomeEquipe, ordem: proximaOrdem, frase });
    }
  }

  if (leituras.length === 0) throw new Error('A sessão não possui cartas para importar.');
  return leituras;
}

async function importarSessao(prisma, sessao) {
  const atividadeId = extrairAtividadeId(sessao.sessaoId);
  if (!atividadeId) return { status: 'ignorada', motivo: 'O QR de início não segue o padrão ATV-<id>.' };

  const atividade = await prisma.atividade.findUnique({
    where: { id: atividadeId },
    include: { frases: { orderBy: { indice: 'asc' } } }
  });
  if (!atividade) throw new Error(`Atividade ${atividadeId} não existe no banco.`);

  // Validamos tudo antes da transação: código desconhecido aborta a sessão,
  // em vez de importar somente uma parte e alterar a pontuação.
  const leituras = prepararLeituras(sessao, atividade);

  try {
    const total = await prisma.$transaction(async tx => {
      // Deve ser a primeira gravação: a constraint UNIQUE de sessao_id impede
      // duplicidade quando o mesmo POST é repetido como um NOVO registro.
      await tx.importacaoSessaoEsp.create({
        data: {
          sessaoEspId: sessao.id,
          sessaoId: sessao.sessaoId,
          atividadeId,
          quantidadeLeituras: leituras.length
        }
      });

      const equipes = new Map();
      for (const nomeEquipe of new Set(leituras.map(item => item.nomeEquipe))) {
        let equipe = await tx.equipe.findFirst({ where: { nome: { equals: nomeEquipe, mode: 'insensitive' } } });
        if (!equipe) equipe = await tx.equipe.create({ data: { nome: nomeEquipe } });
        const anteriores = await tx.leitura.count({ where: { atividadeId, equipeId: equipe.id } });
        if (anteriores > 0) {
          throw new Error(`${nomeEquipe} já possui ${anteriores} leitura(s) nessa atividade. Limpe a mesa antes de importar, para não misturar com testes manuais.`);
        }
        equipes.set(nomeEquipe, equipe);
      }

      await tx.leitura.createMany({
        data: leituras.map(item => ({
          atividadeId,
          equipeId: equipes.get(item.nomeEquipe).id,
          fraseId: item.frase.id,
          ordem: item.ordem,
          codigoBinario: item.frase.codigoBinario,
          fragmento: item.frase.texto
        }))
      });
      return leituras.length;
    }, { timeout: 20000 });

    return { status: 'importada', quantidadeLeituras: total, atividadeId };
  } catch (error) {
    // P2002: unique(sessao_esp_id) ou unique(sessao_id) já foi registrada.
    // Como marca e leituras estão na mesma transação, o estado está íntegro.
    if (error?.code === 'P2002') return { status: 'duplicada', atividadeId };
    throw error;
  }
}

function erroAutenticacaoPostgres(error) {
  // PrismaPg costuma encapsular o erro do Postgres em `cause`.
  const partes = [];
  let atual = error;
  for (let i = 0; atual && i < 5; i++) {
    partes.push(atual.code, atual.originalCode, atual.message, atual.originalMessage);
    atual = atual.cause;
  }
  const mensagem = partes.filter(Boolean).join(' ').toLowerCase();
  return /ecircuitbreaker|too many authentication failures|password authentication failed|invalid password|authentication failed|28p01/.test(mensagem);
}

function criarSincronizador(prisma, { intervaloMs = INTERVALO_PADRAO_MS, logger = console } = {}) {
  let executando = false;
  let timer;
  let pausadoPorAutenticacao = false;
  let erroAnterior = null;
  const avisos = new Map();
  const estado = { ultimaImportacao: null, ultimoErro: null, ultimaVerificacao: null, pausadoPorAutenticacao: false };

  async function sincronizar() {
    if (executando) return { status: 'em_andamento' };
    executando = true;
    const resultado = { importadas: 0, duplicadas: 0, erros: 0 };
    try {
      const sessoes = await prisma.sessaoEsp.findMany({
        where: { sessaoId: { startsWith: 'ATV-' } },
        orderBy: { id: 'desc' },
        take: 100
      });
      const ids = sessoes.map(item => item.id);
      const importacoes = ids.length
        ? await prisma.importacaoSessaoEsp.findMany({ where: { sessaoEspId: { in: ids } }, select: { sessaoEspId: true, sessaoId: true } })
        : [];
      const processadas = new Set(importacoes.map(item => String(item.sessaoEspId)));
      const sessaoIdsProcessados = new Set(importacoes.map(item => item.sessaoId));

      for (const sessao of [...sessoes].reverse()) {
        if (processadas.has(String(sessao.id)) || sessaoIdsProcessados.has(sessao.sessaoId)) continue;
        try {
          const resposta = await importarSessao(prisma, sessao);
          if (resposta.status === 'importada') {
            resultado.importadas++;
            estado.ultimaImportacao = { sessaoId: sessao.sessaoId, quantidadeLeituras: resposta.quantidadeLeituras, atividadeId: resposta.atividadeId };
            estado.ultimoErro = null;
            logger.info(`[ESP] ${sessao.sessaoId}: ${resposta.quantidadeLeituras} leitura(s) importadas automaticamente.`);
            sessaoIdsProcessados.add(sessao.sessaoId);
          } else if (resposta.status === 'duplicada') {
            resultado.duplicadas++;
            sessaoIdsProcessados.add(sessao.sessaoId);
          }
          avisos.delete(String(sessao.id));
        } catch (error) {
          resultado.erros++;
          const msg = process.env.NODE_ENV === 'production'
            ? 'Não foi possível importar a sessão. Verifique a conexão e os dados no servidor.'
            : String(error.message || error);
          estado.ultimoErro = { sessaoId: sessao.sessaoId, mensagem: msg };
          if (avisos.get(String(sessao.id)) !== msg) {
            avisos.set(String(sessao.id), msg);
            logger.warn(`[ESP] Não foi possível importar ${sessao.sessaoId}: ${msg}`);
          }
        }
      }
      estado.ultimaVerificacao = new Date().toISOString();
    } finally {
      executando = false;
    }
    return resultado;
  }

  async function executarAgendado() {
    if (pausadoPorAutenticacao) return;
    try {
      await sincronizar();
      erroAnterior = null;
    } catch (error) {
      if (erroAutenticacaoPostgres(error)) {
        pausadoPorAutenticacao = true;
        estado.pausadoPorAutenticacao = true;
        estado.ultimoErro = {
          sessaoId: null,
          mensagem: 'Falha de autenticação do PostgreSQL. Confira DATABASE_URL no .env e reinicie o servidor.'
        };
        parar();
        logger.error('[ESP] Conexão PostgreSQL recusada por autenticação. Importação automática pausada para não provocar novas tentativas. Corrija DATABASE_URL e reinicie o site.');
      } else {
        // Evita imprimir a mesma exceção a cada 5 segundos enquanto há falhas de rede.
        const mensagem = process.env.NODE_ENV === 'production'
          ? 'Banco temporariamente indisponível. A importação será tentada novamente.'
          : String(error?.message || error);
        estado.ultimoErro = { sessaoId: null, mensagem };
        if (mensagem !== erroAnterior) {
          logger.error('[ESP] Erro ao consultar sessoes_esp:',
            process.env.NODE_ENV === 'production' ? (error?.code || error?.name || 'Falha de conexão') : error);
          erroAnterior = mensagem;
        }
      }
    }
  }

  function iniciar() {
    if (timer || pausadoPorAutenticacao) return;
    void executarAgendado();
    timer = setInterval(() => { void executarAgendado(); }, intervaloMs);
    timer.unref?.();
  }
  function parar() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { iniciar, parar, sincronizar, estado };
}

module.exports = { extrairAtividadeId, normalizarCodigo, prepararLeituras, importarSessao, criarSincronizador, erroAutenticacaoPostgres };
