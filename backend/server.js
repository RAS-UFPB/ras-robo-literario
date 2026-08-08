require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const { sendSwaggerJson, sendSwaggerUi } = require('./swagger');
const { loginAdmin, requireAdmin } = require('./auth');
const { prisma } = require('./prisma');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const PAINEL_DIR = path.join(ROOT, 'painel');

let atividadeCache = null;
let atividadeCacheAt = 0;
const ATIVIDADE_CACHE_MS = 5000;

// Usado para deixar a leitura do QR instantânea no painel.
// O Supabase continua sendo o banco oficial, mas o painel não precisa esperar o banco
// a cada leitura do QR.
let ultimoQrLido = null;
const escritasPendentes = new Set();

function aguardarEscritasPendentes() {
  if (escritasPendentes.size === 0) return Promise.resolve();
  return Promise.allSettled([...escritasPendentes]);
}

function salvarEmSegundoPlano(promise) {
  escritasPendentes.add(promise);
  promise
    .catch(error => {
      console.error('Erro ao salvar leitura no Supabase:', error);
    })
    .finally(() => {
      escritasPendentes.delete(promise);
    });
}

function invalidateCache() {
  atividadeCache = null;
  atividadeCacheAt = 0;
  ultimoQrLido = null;
}

function sendJson(res, status, data, startedAt = null) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (startedAt) headers['Server-Timing'] = `app;dur=${Math.round(performance.now() - startedAt)}`;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('JSON inválido'));
      }
    });
  });
}

function splitTextoEmBlocos(texto) {
  const separador = texto.includes('|') ? 'pipe' : 'palavra';
  return separador === 'pipe'
    ? texto.split('|').map(item => item.trim()).filter(Boolean)
    : texto.trim().split(/\s+/).filter(Boolean);
}

function normalizarNomeEquipe(nomeEquipe) {
  const valor = String(nomeEquipe || '').trim();
  if (!valor) return null;
  if (/^\d+$/.test(valor)) return `Equipe ${valor}`;
  const matchEquipeNumero = valor.match(/^equipe\s*(\d+)$/i);
  if (matchEquipeNumero) return `Equipe ${matchEquipeNumero[1]}`;
  return valor;
}

function validarNomeEquipe(nomeEquipe) {
  const nome = normalizarNomeEquipe(nomeEquipe);
  if (!nome) {
    return { valido: false, error: 'Informe o número ou nome da equipe. Ex: Equipe 1 ou apenas 1.' };
  }
  if (/^equipe$/i.test(nome)) {
    return { valido: false, error: 'Informe o número da equipe. Ex: Equipe 1, Equipe 2 ou apenas 2.' };
  }
  return { valido: true, nome };
}

async function getAtividadeAtivaCached() {
  const agora = Date.now();
  if (atividadeCache && agora - atividadeCacheAt < ATIVIDADE_CACHE_MS) return atividadeCache;

  atividadeCache = await prisma.atividade.findFirst({
    where: { ativa: true },
    orderBy: { createdAt: 'desc' },
    include: { frases: { orderBy: { indice: 'asc' } } }
  });
  atividadeCacheAt = agora;
  return atividadeCache;
}

async function getAtividadeAtivaId() {
  const atividade = await getAtividadeAtivaCached();
  return atividade ? atividade.id : null;
}

async function getOrCreateEquipe(nomeEquipe) {
  const validacao = validarNomeEquipe(nomeEquipe);
  if (!validacao.valido) throw new Error(validacao.error);

  const equipeExistente = await prisma.equipe.findFirst({
    where: { nome: { equals: validacao.nome, mode: 'insensitive' } }
  });

  if (equipeExistente) return equipeExistente;
  return prisma.equipe.create({ data: { nome: validacao.nome } });
}

async function findEquipeByNome(nomeEquipe) {
  const validacao = validarNomeEquipe(nomeEquipe);
  if (!validacao.valido) return null;

  return prisma.equipe.findFirst({
    where: { nome: { equals: validacao.nome, mode: 'insensitive' } }
  });
}

function toFraseApi(frase) {
  return {
    id: frase.id,
    indice: frase.indice,
    codigoBinario: frase.codigoBinario,
    texto: frase.texto,
    createdAt: frase.createdAt
  };
}

function toLeituraApi(leitura) {
  return {
    id: leitura.id,
    equipeId: leitura.equipeId,
    equipe: leitura.equipe?.nome,
    fraseId: leitura.fraseId,
    index: leitura.frase?.indice ?? leitura.ordem,
    ordem: leitura.ordem,
    codigoBinario: leitura.codigoBinario,
    fragment: leitura.fragmento,
    fragmento: leitura.fragmento,
    createdAt: leitura.createdAt
  };
}

async function getLeiturasEquipe(atividadeId, equipeId) {
  return prisma.leitura.findMany({
    where: { atividadeId, equipeId },
    include: { equipe: true, frase: true },
    orderBy: { id: 'asc' }
  });
}

const PONTOS_FRASE_NO_LUGAR = 10;
const PONTOS_DUPLA_EM_SEQUENCIA = 5;

function avaliarComDados(frasesOrdenadas, leiturasEquipe) {
  let corretas = 0;
  const posicoesCorretas = [];

  for (let i = 0; i < frasesOrdenadas.length; i++) {
    const fraseEsperada = frasesOrdenadas[i];
    const leituraRecebida = leiturasEquipe[i];
    if (!leituraRecebida) continue;

    if (leituraRecebida.frase?.indice === fraseEsperada.indice) {
      corretas++;
      posicoesCorretas.push({
        posicao: i + 1,
        indice: fraseEsperada.indice,
        texto: fraseEsperada.texto
      });
    }
  }

  const indicesEsperados = frasesOrdenadas.map(item => item.indice);
  const indicesLidos = leiturasEquipe.map(item => item.frase?.indice).filter(Boolean);
  const textosPorIndice = new Map(frasesOrdenadas.map(item => [item.indice, item.texto]));

  const paresEsperados = new Set();
  for (let i = 0; i < indicesEsperados.length - 1; i++) {
    paresEsperados.add(`${indicesEsperados[i]}-${indicesEsperados[i + 1]}`);
  }

  const paresJaPontuados = new Set();
  const duplasEmSequencia = [];

  for (let i = 0; i < indicesLidos.length - 1; i++) {
    const primeiro = indicesLidos[i];
    const segundo = indicesLidos[i + 1];
    const chave = `${primeiro}-${segundo}`;

    // Pontua apenas duplas vizinhas que aparecem na mesma ordem da frase ideal.
    // O Set evita pontuar a mesma dupla repetida várias vezes.
    if (paresEsperados.has(chave) && !paresJaPontuados.has(chave)) {
      paresJaPontuados.add(chave);
      duplasEmSequencia.push({
        posicaoRecebida: i + 1,
        indices: [primeiro, segundo],
        textos: [textosPorIndice.get(primeiro), textosPorIndice.get(segundo)].filter(Boolean)
      });
    }
  }

  const duplasCorretas = duplasEmSequencia.length;
  const blocosEncontrados = indicesLidos.filter(index => indicesEsperados.includes(index)).length;
  const total = frasesOrdenadas.length;
  const lidas = leiturasEquipe.length;
  const faltando = Math.max(total - blocosEncontrados, 0);
  const pontuacaoPosicao = corretas * PONTOS_FRASE_NO_LUGAR;
  const pontuacaoSequencia = duplasCorretas * PONTOS_DUPLA_EM_SEQUENCIA;
  const pontuacao = pontuacaoPosicao + pontuacaoSequencia;
  const pontuacaoMaxima = (total * PONTOS_FRASE_NO_LUGAR) + (Math.max(total - 1, 0) * PONTOS_DUPLA_EM_SEQUENCIA);

  return {
    corretas,
    blocosEncontrados,
    total,
    lidas,
    faltando,
    pontuacao,
    pontuacaoPosicao,
    pontuacaoSequencia,
    pontuacaoMaxima,
    pontosPorFraseNoLugar: PONTOS_FRASE_NO_LUGAR,
    pontosPorDuplaEmSequencia: PONTOS_DUPLA_EM_SEQUENCIA,
    duplasCorretas,
    posicoesCorretas,
    duplasEmSequencia,
    sequenciaEsperada: indicesEsperados,
    sequenciaRecebida: indicesLidos
  };
}

async function avaliarEquipe(atividade, equipeId) {
  const leiturasEquipe = await getLeiturasEquipe(atividade.id, equipeId);
  return avaliarComDados(atividade.frases, leiturasEquipe);
}

function criarAssinaturaLeiturasDeLista(leiturasEquipe) {
  if (!leiturasEquipe || leiturasEquipe.length === 0) return null;
  return leiturasEquipe.map(item => item.codigoBinario).join('|');
}

async function salvarPontuacaoEquipe(atividade, equipeId, avaliacao, leiturasEquipe) {
  const assinaturaAtual = criarAssinaturaLeiturasDeLista(leiturasEquipe);

  if (!assinaturaAtual) {
    return { pontuacao: 0, jaValidouEssaMesmaSequencia: false };
  }

  let pontuacao = await prisma.pontuacao.findUnique({
    where: { atividadeId_equipeId: { atividadeId: atividade.id, equipeId } }
  });

  if (!pontuacao) {
    pontuacao = await prisma.pontuacao.create({
      data: {
        atividadeId: atividade.id,
        equipeId,
        pontuacao: 0,
        corretas: 0,
        total: avaliacao.total,
        ultimaPontuacaoRodada: 0,
        ultimaAssinatura: ''
      }
    });
  }

  const jaValidouEssaMesmaSequencia = pontuacao.ultimaAssinatura === assinaturaAtual;

  if (!jaValidouEssaMesmaSequencia) {
    pontuacao = await prisma.pontuacao.update({
      where: { id: pontuacao.id },
      data: {
        pontuacao: pontuacao.pontuacao + avaliacao.pontuacao,
        ultimaPontuacaoRodada: avaliacao.pontuacao,
        corretas: avaliacao.corretas,
        total: avaliacao.total,
        ultimaAssinatura: assinaturaAtual
      }
    });
  }

  return { ...pontuacao, jaValidouEssaMesmaSequencia };
}


async function registrarLeituraNoBanco({ atividade, nomeEquipe, frase }) {
  const equipe = await getOrCreateEquipe(nomeEquipe);
  const ordem = await prisma.leitura.count({ where: { atividadeId: atividade.id, equipeId: equipe.id } });

  return prisma.leitura.create({
    data: {
      atividadeId: atividade.id,
      equipeId: equipe.id,
      fraseId: frase.id,
      ordem: ordem + 1,
      codigoBinario: frase.codigoBinario,
      fragmento: frase.texto
    },
    include: { equipe: true, frase: true }
  });
}

async function resetarSupabase() {
  await prisma.leitura.deleteMany();
  await prisma.pontuacao.deleteMany();
  await prisma.frase.deleteMany();
  await prisma.equipe.deleteMany();
  await prisma.atividade.deleteMany();
  invalidateCache();

  return { ok: true, mensagem: 'Dados do Supabase apagados com sucesso.' };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
  };
  return types[ext] || 'application/octet-stream';
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.normalize(path.join(PAINEL_DIR, urlPath));

  if (!filePath.startsWith(PAINEL_DIR)) {
    res.writeHead(403);
    return res.end('Acesso negado');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Arquivo não encontrado');
  }

  res.writeHead(200, { 'Content-Type': getContentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/ping' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, mensagem: 'API do Robô Literário online' }, startedAt);
    }

    if (url.pathname === '/api/atividade' && req.method === 'GET') {
      const atividade = await getAtividadeAtivaCached();
      return sendJson(res, 200, {
        frases: atividade ? atividade.frases.map(toFraseApi) : [],
        total: atividade ? atividade.frases.length : 0
      }, startedAt);
    }

    if (url.pathname === '/api/atividade' && req.method === 'POST') {
      const body = await parseBody(req);
      const textoAlvo = String(body.textoAlvo || body.texto || '').trim();

      if (!textoAlvo) return sendJson(res, 400, { error: 'Envie textoAlvo para iniciar a atividade.' }, startedAt);

      const blocos = splitTextoEmBlocos(textoAlvo);
      if (blocos.length === 0) return sendJson(res, 400, { error: 'A atividade precisa ter pelo menos um bloco.' }, startedAt);

      const atividade = await prisma.$transaction(async tx => {
        await tx.atividade.updateMany({ where: { ativa: true }, data: { ativa: false } });

        return tx.atividade.create({
          data: {
            textoAlvo,
            ativa: true,
            frases: {
              create: blocos.map((texto, index) => ({
                indice: index + 1,
                codigoBinario: index.toString(2).padStart(4, '0'),
                texto
              }))
            }
          },
          include: { frases: { orderBy: { indice: 'asc' } } }
        });
      });

      invalidateCache();
      return sendJson(res, 201, {
        mensagem: 'Atividade iniciada com sucesso.',
        atividadeId: atividade.id,
        frases: atividade.frases.map(toFraseApi)
      }, startedAt);
    }

    if (url.pathname === '/api/qr/latest' && req.method === 'GET') {
      return sendJson(res, 200, ultimoQrLido, startedAt);
    }

    if (url.pathname === '/api/qr' && req.method === 'POST') {
      const body = await parseBody(req);
      const atividade = await getAtividadeAtivaCached();

      if (!atividade) return sendJson(res, 400, { error: 'Nenhuma atividade foi iniciada ainda.' }, startedAt);

      const validacaoEquipe = validarNomeEquipe(body.equipe || body.nomeEquipe);
      if (!validacaoEquipe.valido) {
        return sendJson(res, 400, { error: validacaoEquipe.error }, startedAt);
      }

      const codigoBinario = String(body.codigoBinario || '').trim();
      if (!/^[01]+$/.test(codigoBinario)) {
        return sendJson(res, 400, { error: 'Código binário inválido. Use apenas 0 e 1. Ex: 0000, 0001, 0010.' }, startedAt);
      }

      const indice = parseInt(codigoBinario, 2) + 1;
      const frase = atividade.frases.find(item => item.codigoBinario === codigoBinario || item.indice === indice);

      if (!frase) return sendJson(res, 404, { error: `Nenhum bloco encontrado para o código ${codigoBinario}.` }, startedAt);

      const leituraApi = {
        id: `mem-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        equipeId: null,
        equipe: validacaoEquipe.nome,
        fraseId: frase.id,
        index: frase.indice,
        ordem: null,
        codigoBinario: frase.codigoBinario,
        fragment: frase.texto,
        fragmento: frase.texto,
        createdAt: new Date().toISOString()
      };

      ultimoQrLido = leituraApi;

      salvarEmSegundoPlano(
        registrarLeituraNoBanco({ atividade, nomeEquipe: validacaoEquipe.nome, frase })
      );

      return sendJson(res, 200, {
        mensagem: 'Leitura registrada com sucesso.',
        ...leituraApi,
        leitura: leituraApi
      }, startedAt);
    }

    if (url.pathname === '/api/validar' && req.method === 'POST') {
      const body = await parseBody(req);
      const atividade = await getAtividadeAtivaCached();

      if (!atividade) {
        return sendJson(res, 400, { error: 'Nenhuma atividade foi iniciada ainda. Inicie uma frase antes de verificar a resposta.' }, startedAt);
      }

      await aguardarEscritasPendentes();

      const equipe = await findEquipeByNome(body.equipe || body.nomeEquipe);
      if (!equipe) return sendJson(res, 400, { error: 'Essa equipe ainda não existe. Envie uma leitura primeiro antes de verificar.' }, startedAt);

      const leiturasEquipe = await getLeiturasEquipe(atividade.id, equipe.id);
      if (leiturasEquipe.length === 0) {
        return sendJson(res, 400, { error: `A ${equipe.nome} ainda não enviou nenhum bloco. Envie pelo menos uma leitura antes de verificar.` }, startedAt);
      }

      const avaliacao = avaliarComDados(atividade.frases, leiturasEquipe);
      const pontuacaoSalva = await salvarPontuacaoEquipe(atividade, equipe.id, avaliacao, leiturasEquipe);

      return sendJson(res, 200, {
        equipe: equipe.nome,
        ...avaliacao,
        pontuacaoRodada: avaliacao.pontuacao,
        pontuacao: pontuacaoSalva.pontuacao,
        jaValidouEssaMesmaSequencia: pontuacaoSalva.jaValidouEssaMesmaSequencia
      }, startedAt);
    }

    if (url.pathname === '/api/placar' && req.method === 'GET') {
      const atividade = await getAtividadeAtivaCached();
      if (!atividade) return sendJson(res, 200, { placar: [] }, startedAt);

      const pontuacoes = await prisma.pontuacao.findMany({
        where: { atividadeId: atividade.id },
        include: { equipe: true },
        orderBy: [{ pontuacao: 'desc' }, { updatedAt: 'asc' }]
      });

      const placar = pontuacoes.map(item => ({
        equipe: item.equipe.nome,
        corretas: item.corretas,
        blocosEncontrados: item.corretas,
        total: item.total,
        lidas: item.total,
        faltando: Math.max(item.total - item.corretas, 0),
        pontuacao: item.pontuacao,
        ultimaPontuacaoRodada: item.ultimaPontuacaoRodada
      }));

      return sendJson(res, 200, { placar }, startedAt);
    }

    if (url.pathname === '/api/leituras' && req.method === 'GET') {
      const atividade = await getAtividadeAtivaCached();
      const nomeEquipe = String(url.searchParams.get('equipe') || 'Equipe 1').trim();

      if (!atividade) {
        return sendJson(res, 200, {
          equipe: normalizarNomeEquipe(nomeEquipe) || nomeEquipe,
          leituras: [],
          avaliacao: { corretas: 0, blocosEncontrados: 0, total: 0, lidas: 0, faltando: 0, pontuacao: 0 },
          pontuacao: 0
        }, startedAt);
      }

      const equipe = await findEquipeByNome(nomeEquipe);
      if (!equipe) {
        return sendJson(res, 200, {
          equipe: normalizarNomeEquipe(nomeEquipe) || nomeEquipe,
          leituras: [],
          avaliacao: {
            corretas: 0,
            blocosEncontrados: 0,
            total: atividade.frases.length,
            lidas: 0,
            faltando: atividade.frases.length,
            pontuacao: 0
          },
          pontuacao: 0
        }, startedAt);
      }

      const [leituras, pontuacaoSalva] = await Promise.all([
        getLeiturasEquipe(atividade.id, equipe.id),
        prisma.pontuacao.findUnique({ where: { atividadeId_equipeId: { atividadeId: atividade.id, equipeId: equipe.id } } })
      ]);

      const avaliacao = avaliarComDados(atividade.frases, leituras);

      return sendJson(res, 200, {
        equipe: equipe.nome,
        leituras: leituras.map(toLeituraApi),
        avaliacao,
        pontuacao: pontuacaoSalva ? pontuacaoSalva.pontuacao : avaliacao.pontuacao
      }, startedAt);
    }

    if (url.pathname === '/api/reset-equipe' && req.method === 'POST') {
      const body = await parseBody(req);
      await aguardarEscritasPendentes();
      const atividade = await getAtividadeAtivaCached();
      const nomeEquipe = body.equipe || body.nomeEquipe;
      const equipe = await findEquipeByNome(nomeEquipe);

      if (!atividade || !equipe) {
        return sendJson(res, 200, {
          mensagem: 'Equipe ainda não existe. Nada para limpar.',
          equipe: normalizarNomeEquipe(nomeEquipe) || nomeEquipe
        }, startedAt);
      }

      await prisma.leitura.deleteMany({ where: { atividadeId: atividade.id, equipeId: equipe.id } });

      // Como /api/qr/latest usa memória para ficar rápido, precisamos apagar
      // a última leitura em memória quando a mesa daquela equipe for limpa.
      if (ultimoQrLido && String(ultimoQrLido.equipe || '').toLowerCase() === String(equipe.nome || '').toLowerCase()) {
        ultimoQrLido = null;
      }

      return sendJson(res, 200, {
        mensagem: `Mesa da ${equipe.nome} limpa com sucesso.`,
        equipe: equipe.nome
      }, startedAt);
    }

    if (url.pathname === '/api/supabase/status' && req.method === 'GET') {
      await prisma.$queryRaw`SELECT 1`;
      return sendJson(res, 200, { conectado: true, mensagem: 'Supabase conectado com Prisma.' }, startedAt);
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const resultado = loginAdmin(body.accessKey);

      if (!resultado.ok) return sendJson(res, resultado.status, { error: resultado.error }, startedAt);
      return sendJson(res, 200, { mensagem: 'Login admin realizado com sucesso.', token: resultado.token }, startedAt);
    }

    if (url.pathname === '/api/admin/reset-json' && req.method === 'POST') {
      if (!requireAdmin(req, res, sendJson)) return;
      return sendJson(res, 410, { error: 'O db.json não é mais usado. Use /api/admin/reset-supabase.' }, startedAt);
    }

    if (url.pathname === '/api/admin/reset-supabase' && req.method === 'POST') {
      if (!requireAdmin(req, res, sendJson)) return;
      const resultado = await resetarSupabase();
      return sendJson(res, 200, resultado, startedAt);
    }

    if (url.pathname === '/api/admin/reset-tudo' && req.method === 'POST') {
      if (!requireAdmin(req, res, sendJson)) return;
      const resultado = await resetarSupabase();
      return sendJson(res, 200, { mensagem: 'Reset executado.', supabase: resultado }, startedAt);
    }

    if (url.pathname === '/api/docs.json' && req.method === 'GET') return sendSwaggerJson(res, sendJson);
    if (url.pathname === '/docs' && req.method === 'GET') return sendSwaggerUi(res);

    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Rota da API não encontrada.' }, startedAt);

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Erro interno no servidor.' }, startedAt);
  }
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});