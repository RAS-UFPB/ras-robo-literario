require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const { sendSwaggerJson, sendSwaggerUi } = require('./swagger');
const { loginAdmin, requireAdmin, logoutAdmin } = require('./auth');
const { prisma } = require('./prisma');
const { criarSincronizador } = require('./importador-sessoes-esp');
const { montarAtividadesAcervo } = require('./acervo');
const { criarRegistradorLeiturasUnicas } = require('./leitura-unica');
const { criarServicoPdf, lerPdfRequisicao, enviarPdfInline } = require('./pdf-contos');

const sincronizadorEsp = criarSincronizador(prisma);

// Render define PORT; o valor 3000 continua sendo o padrão local.
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV === 'production') {
  const obrigatorias = ['DATABASE_URL', 'ADMIN_ACCESS_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const faltando = obrigatorias.filter(nome => !process.env[nome]);
  if (faltando.length) throw new Error(`Configuração de produção incompleta: ${faltando.join(', ')}`);
}

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

function invalidateCache() {
  atividadeCache = null;
  atividadeCacheAt = 0;
  ultimoQrLido = null;
}

function sendJson(res, status, data, startedAt = null) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (startedAt) headers['Server-Timing'] = `app;dur=${Math.round(performance.now() - startedAt)}`;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

// Limita requisições JSON antes da alocação de memória (PDF tem limite próprio).
function parseBody(req) {
  const LIMITE_JSON = 256 * 1024;
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    let encerrada = false;
    const falhar = (status, mensagem) => {
      if (encerrada) return;
      encerrada = true;
      reject(Object.assign(new Error(mensagem), { status }));
    };
    req.on('data', chunk => {
      total += chunk.length;
      if (total > LIMITE_JSON) return falhar(413, 'Requisição JSON muito grande.');
      partes.push(chunk);
    });
    req.on('end', () => {
      if (encerrada) return;
      encerrada = true;
      const body = Buffer.concat(partes).toString('utf8');
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', () => falhar(400, 'Não foi possível ler a requisição.'));
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

function normalizarCodigoCartaEsp(valor) {
  if (Number.isInteger(valor) && valor >= 0 && valor <= 15) {
    return valor.toString(2).padStart(4, '0');
  }

  const texto = String(valor ?? '').trim();
  if (/^[01]{4}$/.test(texto)) return texto;
  return null;
}

function toSessaoEspApi(registro) {
  if (!registro) return null;

  const rodadasOriginais = Array.isArray(registro.rodadas) ? registro.rodadas : [];
  const rodadas = rodadasOriginais.map((rodada, indice) => {
    const numeroEquipe = Number(rodada?.equipe);
    const sequenciaOriginal = Array.isArray(rodada?.sequencia) ? rodada.sequencia : [];
    const sequencia = sequenciaOriginal
      .map(normalizarCodigoCartaEsp)
      .filter(Boolean);

    return {
      ordemRodada: indice + 1,
      equipeNumero: Number.isInteger(numeroEquipe) ? numeroEquipe : null,
      equipe: Number.isInteger(numeroEquipe) ? normalizarNomeEquipe(String(numeroEquipe)) : null,
      sequencia
    };
  });

  return {
    id: String(registro.id),
    sessaoId: registro.sessaoId,
    createdAt: registro.createdAt,
    rodadas
  };
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


async function toContoApi(conto) {
  const trechos = await prisma.trechoEmbaralhar.findMany({
    where: {
      OR: [
        { conto: conto.titulo },
        { conto: conto.id }
      ]
    },
    orderBy: { ordemCorreta: 'asc' }
  });

  return {
    id: conto.id,
    titulo: conto.titulo,
    autor: conto.autor || '',
    resumo: conto.resumo || '',
    possuiPdf: Boolean(conto.pdfPath),
    perguntas: (conto.perguntas || []).map(item => ({
      id: item.id,
      ordem: item.ordem,
      pergunta: item.pergunta,
      resposta: item.resposta
    })),
    desafios: (conto.desafios || []).map(item => ({
      id: item.id,
      ordem: item.ordem,
      momento: item.momento || '',
      texto: item.texto
    })),
    dicas: (conto.dicas || []).map(item => ({
      id: item.id,
      ordem: item.ordem,
      texto: item.texto,
      trechoId: item.trechoId || null,
      trechoLetra: item.trecho?.letra || null
    })),
    trechos: trechos.map(item => ({
      id: item.id,
      letra: item.letra,
      ordemCorreta: item.ordemCorreta,
      texto: item.texto
    }))
  };
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

function codigoBinarioTesteTrecho(trecho, fallbackIndex) {
  const letra = String(trecho.letra || '').trim().toUpperCase();
  const posicaoLetra = /^[A-Z]$/.test(letra) ? letra.charCodeAt(0) - 65 : fallbackIndex;
  return Math.max(posicaoLetra, 0).toString(2).padStart(4, '0');
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


const registrarLeituraUnica = criarRegistradorLeiturasUnicas(prisma, getOrCreateEquipe);

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
  const filePath = path.resolve(PAINEL_DIR, `.${urlPath}`);
  const relativo = path.relative(PAINEL_DIR, filePath);

  if (relativo.startsWith('..') || path.isAbsolute(relativo) || relativo.split(path.sep).some(parte => parte.startsWith('.'))) {
    res.writeHead(403);
    return res.end('Acesso negado');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Arquivo não encontrado');
  }

  res.writeHead(200, { 'Content-Type': getContentType(filePath), 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  // A URL usa um host local fixo: cabeçalhos Host malformados não devem afetar o roteamento.
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/api/ping' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, mensagem: 'API do Robô Literário online' }, startedAt);
    }

    // Cenário A: a ESP publica sessões DIRETAMENTE no Supabase. Nenhuma rota
    // de escrita do site precisa ser pública, inclusive simulação e pontuação.
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        && !(url.pathname === '/api/auth/login' && req.method === 'POST')) {
      if (!requireAdmin(req, res, sendJson)) return;
    }
    // Diagnósticos internos podem conter mensagens de falha do banco.
    if (req.method === 'GET' && ['/api/esp/importacao/status', '/api/supabase/status'].includes(url.pathname)) {
      if (!requireAdmin(req, res, sendJson)) return;
    }

    if (url.pathname === '/api/acervo/atividades' && req.method === 'GET') {
      // Consulta somente leitura. Reaproveita as tabelas já existentes.
      const [atividades, contos, trechos] = await Promise.all([
        prisma.atividade.findMany({
          orderBy: { createdAt: 'desc' },
          include: { frases: { orderBy: { indice: 'asc' } } }
        }),
        prisma.conto.findMany({ select: { id: true, titulo: true } }),
        prisma.trechoEmbaralhar.findMany({
          select: { conto: true, ordemCorreta: true, texto: true }
        })
      ]);
      return sendJson(res, 200, {
        atividades: montarAtividadesAcervo(atividades, contos, trechos)
          .filter(atividade => atividade.contosCompativeisIds.length > 0),
        criterio: 'correspondencia-exata-de-trechos-sem-vinculo-formal'
      }, startedAt);
    }

    const pdfMatch = url.pathname.match(/^\/api\/contos\/([^/]+)\/pdf$/);
    if (pdfMatch && ['GET', 'PUT', 'DELETE'].includes(req.method)) {
      const contoId = decodeURIComponent(pdfMatch[1]);
      // Acesso a gravações exige a autenticação administrativa já existente.
      if (req.method !== 'GET' && !requireAdmin(req, res, sendJson)) return;
      const { supabase } = require('./supabase');
      const pdf = criarServicoPdf({ prisma, storage: supabase.storage.from('contos-pdf') });
      if (req.method === 'PUT') {
        try {
          const arquivo = await lerPdfRequisicao(req);
          const resultado = await pdf.salvar(contoId, arquivo);
          return sendJson(res, 200, resultado, startedAt);
        } catch (error) {
          if (error.status) return sendJson(res, error.status, { error: error.message }, startedAt);
          throw error;
        }
      }
      if (req.method === 'DELETE') {
        try { return sendJson(res, 200, await pdf.remover(contoId), startedAt); }
        catch (error) {
          if (error.status) return sendJson(res, error.status, { error: error.message }, startedAt);
          throw error;
        }
      }
      try {
        const arquivo = await pdf.obter(contoId);
        return enviarPdfInline(req, res, arquivo);
      } catch (error) {
        if (error.status) return sendJson(res, error.status, { error: error.message }, startedAt);
        throw error;
      }
    }

    if (url.pathname === '/api/contos' && req.method === 'GET') {
      const contos = await prisma.conto.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          perguntas: { orderBy: { ordem: 'asc' } },
          desafios: { orderBy: { ordem: 'asc' } },
          dicas: {
            orderBy: { ordem: 'asc' },
            include: { trecho: true }
          }
        }
      });

      const contosApi = await Promise.all(contos.map(toContoApi));
      return sendJson(res, 200, { contos: contosApi }, startedAt);
    }

    if (url.pathname === '/api/contos' && req.method === 'POST') {
      const body = await parseBody(req);
      const titulo = String(body.titulo || '').trim();
      const autor = String(body.autor || '').trim();
      const resumo = String(body.resumo || '').trim();

      if (!titulo) {
        return sendJson(res, 400, { error: 'Informe o título do conto.' }, startedAt);
      }

      const conto = await prisma.conto.create({
        data: {
          id: criarIdConto(titulo),
          titulo,
          autor: autor || null,
          resumo: resumo || null
        },
        include: { perguntas: true, desafios: true, dicas: true }
      });

      return sendJson(res, 201, { conto: await toContoApi(conto) }, startedAt);
    }

    if (url.pathname === '/api/perguntas' && req.method === 'POST') {
      const body = await parseBody(req);
      const contoId = String(body.contoId || '').trim();
      const pergunta = String(body.pergunta || '').trim();
      const resposta = String(body.resposta || '').trim();

      if (!contoId || !pergunta) {
        return sendJson(res, 400, { error: 'Informe o conto e a pergunta.' }, startedAt);
      }

      const maiorOrdem = await prisma.pergunta.aggregate({
        where: { contoId },
        _max: { ordem: true }
      });

      const item = await prisma.pergunta.create({
        data: {
          contoId,
          ordem: (maiorOrdem._max.ordem || 0) + 1,
          pergunta,
          resposta
        }
      });

      return sendJson(res, 201, { pergunta: item }, startedAt);
    }

    const perguntaMatch = url.pathname.match(/^\/api\/perguntas\/(\d+)$/);

    if (perguntaMatch && req.method === 'PUT') {
      const body = await parseBody(req);
      const pergunta = String(body.pergunta || '').trim();
      const resposta = String(body.resposta || '').trim();

      if (!pergunta) {
        return sendJson(res, 400, { error: 'Informe a pergunta.' }, startedAt);
      }

      const item = await prisma.pergunta.update({
        where: { id: Number(perguntaMatch[1]) },
        data: { pergunta, resposta }
      });

      return sendJson(res, 200, { pergunta: item }, startedAt);
    }

    if (perguntaMatch && req.method === 'DELETE') {
      await prisma.pergunta.delete({ where: { id: Number(perguntaMatch[1]) } });
      return sendJson(res, 200, { mensagem: 'Pergunta excluída.' }, startedAt);
    }

    const iniciarTrechosMatch = url.pathname.match(/^\/api\/contos\/([^/]+)\/iniciar-trechos$/);

    if (iniciarTrechosMatch && req.method === 'POST') {
      const contoId = decodeURIComponent(iniciarTrechosMatch[1]);
      const conto = await prisma.conto.findUnique({ where: { id: contoId } });

      if (!conto) {
        return sendJson(res, 404, { error: 'Conto não encontrado.' }, startedAt);
      }

      const trechos = await prisma.trechoEmbaralhar.findMany({
        where: {
          OR: [
            { conto: conto.titulo },
            { conto: conto.id }
          ]
        },
        orderBy: { ordemCorreta: 'asc' }
      });

      if (trechos.length === 0) {
        return sendJson(res, 400, { error: 'Este conto não possui trechos cadastrados.' }, startedAt);
      }

      // Os binários abaixo continuam sendo apenas a convenção de teste já usada pelo projeto:
      // A=0000, B=0001, C=0010... A integração definitiva com os QR Codes/ESP pode trocar
      // apenas esse mapeamento depois, sem alterar a ordem correta guardada no banco.
      const atividade = await prisma.$transaction(async tx => {
        await tx.atividade.updateMany({ where: { ativa: true }, data: { ativa: false } });

        return tx.atividade.create({
          data: {
            textoAlvo: trechos.map(item => item.texto).join(' | '),
            ativa: true,
            frases: {
              create: trechos.map((item, index) => ({
                indice: item.ordemCorreta,
                codigoBinario: codigoBinarioTesteTrecho(item, index),
                texto: item.texto
              }))
            }
          },
          include: { frases: { orderBy: { indice: 'asc' } } }
        });
      });

      invalidateCache();
      return sendJson(res, 201, {
        mensagem: `Atividade de trechos de "${conto.titulo}" iniciada.`,
        atividadeId: atividade.id,
        frases: atividade.frases.map(toFraseApi)
      }, startedAt);
    }

    // A professora solicita o encerramento sem exibir QR de fim. O pedido
    // persiste no Supabase; a ESP o consulta e envia a sessão no cenário A.
    if (url.pathname === '/api/esp/finalizar-leitura' && req.method === 'POST') {
      const atividade = await getAtividadeAtivaCached();
      if (!atividade) return sendJson(res, 409, { error: 'Não há atividade ativa para finalizar.' }, startedAt);
      const sessaoId = `ATV-${atividade.id}`;
      const { supabase } = require('./supabase');
      const { error } = await supabase.from('comandos_esp').upsert({
        sessao_id: sessaoId,
        comando: 'fim',
        expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }, { onConflict: 'sessao_id' });
      if (error) {
        console.error('[ESP] Falha ao registrar comando de fim:', error.code || error.name || 'Erro Supabase');
        return sendJson(res, 503, { error: 'Não foi possível solicitar o fim. Confira se a tabela comandos_esp foi criada.' }, startedAt);
      }
      return sendJson(res, 202, { mensagem: 'Pedido de finalização registrado. Aguardando a ESP.', sessaoId }, startedAt);
    }

    if (url.pathname === '/api/esp/finalizacao/status' && req.method === 'GET') {
      const atividadeId = Number(url.searchParams.get('atividadeId'));
      if (!Number.isSafeInteger(atividadeId) || atividadeId < 1) {
        return sendJson(res, 400, { error: 'Identificador da atividade inválido.' }, startedAt);
      }
      const sessaoId = `ATV-${atividadeId}`;
      const { supabase } = require('./supabase');
      const [{ data: comando, error }, sessao, importacao] = await Promise.all([
        supabase.from('comandos_esp').select('sessao_id').eq('sessao_id', sessaoId).gt('expira_em', new Date().toISOString()).maybeSingle(),
        prisma.sessaoEsp.findFirst({ where: { sessaoId }, select: { id: true } }),
        prisma.importacaoSessaoEsp.findUnique({ where: { sessaoId }, select: { sessaoId: true } })
      ]);
      if (error) return sendJson(res, 503, { error: 'Status indisponível. Confira a tabela comandos_esp.' }, startedAt);
      return sendJson(res, 200, {
        sessaoId,
        solicitado: Boolean(comando),
        recebido: Boolean(sessao),
        importado: Boolean(importacao)
      }, startedAt);
    }

    if (url.pathname === '/api/atividade/encerrar' && req.method === 'POST') {
      // Encerrar não é apagar: mantém as frases, leituras, sessões e pontuações salvas.
      const resultado = await prisma.atividade.updateMany({
        where: { ativa: true }, data: { ativa: false }
      });
      invalidateCache();
      return sendJson(res, 200, {
        mensagem: 'Atividade encerrada. O histórico e a pontuação foram preservados.',
        encerradas: resultado.count
      }, startedAt);
    }

    if (url.pathname === '/api/atividade' && req.method === 'GET') {
      const atividade = await getAtividadeAtivaCached();
      return sendJson(res, 200, {
        atividadeId: atividade ? atividade.id : null,
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

    if (url.pathname === '/api/esp/importacao/status' && req.method === 'GET') {
      return sendJson(res, 200, sincronizadorEsp.estado, startedAt);
    }

    if (url.pathname === '/api/esp/sessoes/latest' && req.method === 'GET') {
      const sessao = await prisma.sessaoEsp.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      });

      return sendJson(res, 200, { sessao: toSessaoEspApi(sessao) }, startedAt);
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

      const registroPendente = registrarLeituraUnica({ atividade, nomeEquipe: validacaoEquipe.nome, frase });
      escritasPendentes.add(registroPendente);
      let registro;
      try {
        registro = await registroPendente;
      } finally {
        escritasPendentes.delete(registroPendente);
      }

      if (registro.duplicada) {
        return sendJson(res, 200, {
          ignorada: true,
          motivo: 'duplicada',
          mensagem: `A carta ${frase.codigoBinario} já foi utilizada pela ${validacaoEquipe.nome}.`
        }, startedAt);
      }

      const leituraApi = toLeituraApi(registro.leitura);
      ultimoQrLido = leituraApi;
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

    if (url.pathname === '/api/auth/sessao' && req.method === 'GET') {
      if (!requireAdmin(req, res, sendJson)) return;
      return sendJson(res, 200, { autenticado: true }, startedAt);
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      logoutAdmin(req);
      return sendJson(res, 200, { mensagem: 'Sessão encerrada.' }, startedAt);
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const resultado = loginAdmin(body.accessKey, req.socket.remoteAddress);

      if (!resultado.ok) return sendJson(res, resultado.status, { error: resultado.error }, startedAt);
      return sendJson(res, 200, { mensagem: 'Login admin realizado com sucesso.', token: resultado.token, expiresInSeconds: resultado.expiresInSeconds }, startedAt);
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

    if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { error: 'Método não permitido.' }, startedAt);
    // Endereço público abre a tela de login; o painel continua em /index.html.
    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
      return res.end();
    }
    return serveStatic(req, res);
  } catch (error) {
    if (error.status && error.status >= 400 && error.status < 500) {
      return sendJson(res, error.status, { error: error.message }, startedAt);
    }
    // Evita devolver strings do driver (possivelmente com endereço/credenciais) à internet.
    if (process.env.NODE_ENV === 'production') {
      console.error('[API] Erro interno:', error.code || error.name || 'Erro desconhecido');
    } else {
      console.error('[API] Erro interno:', error);
    }
    return sendJson(res, 500, { error: 'Erro interno no servidor.' }, startedAt);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  if (process.env.ESP_IMPORTACAO_AUTOMATICA === 'false') {
    console.log('[ESP] Importação automática desativada temporariamente no .env.');
  } else {
    sincronizadorEsp.iniciar();
  }
});

for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, async () => {
  sincronizadorEsp.parar();
  await prisma.$disconnect();
  process.exit(0);
});