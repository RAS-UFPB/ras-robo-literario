require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');

const { sendSwaggerJson, sendSwaggerUi } = require('./swagger');
const { loginAdmin, requireAdmin } = require('./auth');

let supabase = null;

try {
  supabase = require('./supabase').supabase;
} catch (error) {
  console.warn('Supabase não configurado. O projeto continuará usando db.json.');
}

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const PAINEL_DIR = path.join(ROOT, 'painel');
const DB_PATH = path.join(__dirname, 'db.json');

function readDb() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

  if (!db.frases) db.frases = [];
  if (!db.equipes) db.equipes = [];
  if (!db.leituras) db.leituras = [];
  if (!db.pontuacoes) db.pontuacoes = [];

  if (!db.nextFraseId) db.nextFraseId = 1;
  if (!db.nextEquipeId) db.nextEquipeId = 1;
  if (!db.nextLeituraId) db.nextLeituraId = 1;
  if (!db.nextPontuacaoId) db.nextPontuacaoId = 1;

  if (db.latest === undefined) db.latest = null;

  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function criarDbVazio() {
  return {
    nextFraseId: 1,
    nextEquipeId: 1,
    nextLeituraId: 1,
    nextPontuacaoId: 1,
    frases: [],
    equipes: [],
    leituras: [],
    pontuacoes: [],
    latest: null
  };
}

function resetarJsonLocal() {
  const dbVazio = criarDbVazio();
  writeDb(dbVazio);
  return dbVazio;
}

async function resetarSupabase() {
  if (!supabase) {
    return {
      ok: false,
      mensagem: 'Supabase não está configurado no backend.'
    };
  }

  const tabelas = [
    'leituras',
    'pontuacoes',
    'frases',
    'equipes',
    'atividades'
  ];

  for (const tabela of tabelas) {
    const { error } = await supabase
      .from(tabela)
      .delete()
      .not('id', 'is', null);

    if (error) {
      throw new Error(`Erro ao limpar tabela ${tabela}: ${error.message}`);
    }
  }

  return {
    ok: true,
    mensagem: 'Dados do Supabase apagados com sucesso.'
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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
  // Para a demonstração: se usar |, cada trecho vira um bloco/frase.
  // Sem |, cada palavra vira um bloco.
  const separador = texto.includes('|') ? 'pipe' : 'palavra';
  const blocos = separador === 'pipe'
    ? texto.split('|').map(item => item.trim()).filter(Boolean)
    : texto.trim().split(/\s+/).filter(Boolean);

  return blocos;
}

function normalizarTexto(texto) {
  return String(texto || '').trim().toLowerCase();
}

function normalizarNomeEquipe(nomeEquipe) {
  const valor = String(nomeEquipe || '').trim();

  if (!valor) {
    return null;
  }

  // Se a pessoa digitar só "2", transforma em "Equipe 2"
  if (/^\d+$/.test(valor)) {
    return `Equipe ${valor}`;
  }

  // Se a pessoa digitar "equipe2", "Equipe 2", "EQUIPE 2", padroniza
  const matchEquipeNumero = valor.match(/^equipe\s*(\d+)$/i);

  if (matchEquipeNumero) {
    return `Equipe ${matchEquipeNumero[1]}`;
  }

  return valor;
}

function validarNomeEquipe(nomeEquipe) {
  const nome = normalizarNomeEquipe(nomeEquipe);

  if (!nome) {
    return {
      valido: false,
      error: 'Informe o número ou nome da equipe. Ex: Equipe 1 ou apenas 1.'
    };
  }

  // Bloqueia equipe sem número
  if (/^equipe$/i.test(nome)) {
    return {
      valido: false,
      error: 'Informe o número da equipe. Ex: Equipe 1, Equipe 2 ou apenas 2.'
    };
  }

  return {
    valido: true,
    nome
  };
}

function getOrCreateEquipe(db, nomeEquipe) {
  const validacao = validarNomeEquipe(nomeEquipe);

  if (!validacao.valido) {
    throw new Error(validacao.error);
  }

  const nome = validacao.nome;

  let equipe = db.equipes.find(item => {
    return item.nome.toLowerCase() === nome.toLowerCase();
  });

  if (!equipe) {
    equipe = {
      id: db.nextEquipeId++,
      nome,
      createdAt: new Date().toISOString()
    };

    db.equipes.push(equipe);
  }

  return equipe;
}

function findEquipeByNome(db, nomeEquipe) {
  const validacao = validarNomeEquipe(nomeEquipe);

  if (!validacao.valido) {
    return null;
  }

  const nome = validacao.nome;

  return db.equipes.find(item => {
    return item.nome.toLowerCase() === nome.toLowerCase();
  }) || null;
}

function findEquipeByNome(db, nomeEquipe) {
  const validacao = validarNomeEquipe(nomeEquipe);

  if (!validacao.valido) {
    return null;
  }

  const nome = validacao.nome;

  return db.equipes.find(item => {
    return item.nome.toLowerCase() === nome.toLowerCase();
  }) || null;
}

function codigoParaIndice(body) {
  if (body.indice !== undefined && body.indice !== null && body.indice !== '') {
    const indice = Number(body.indice);
    if (!Number.isInteger(indice) || indice < 1) {
      throw new Error('O índice precisa ser um número inteiro maior ou igual a 1.');
    }
    return indice;
  }

  const codigo = String(body.codigoBinario || body.codigo || '').trim();
  if (!/^[01]+$/.test(codigo)) {
    throw new Error('Envie codigoBinario no formato binário, exemplo: 0000, 0001, 0010.');
  }

  // Convenção do MVP: 0000 = bloco 1, 0001 = bloco 2, 0010 = bloco 3...
  return parseInt(codigo, 2) + 1;
}

function avaliarEquipe(db, equipeId) {
  const frasesOrdenadas = db.frases
    .slice()
    .sort((a, b) => a.indice - b.indice);

  const leiturasEquipe = db.leituras
    .filter(item => item.equipeId === equipeId)
    .sort((a, b) => a.id - b.id);

  let corretas = 0;

  for (let i = 0; i < frasesOrdenadas.length; i++) {
    const fraseEsperada = frasesOrdenadas[i];
    const leituraRecebida = leiturasEquipe[i];

    if (!leituraRecebida) continue;

    if (leituraRecebida.index === fraseEsperada.indice) {
      corretas++;
    }
  }

  const indicesEsperados = frasesOrdenadas.map(item => item.indice);
  const indicesLidos = leiturasEquipe.map(item => item.index);

  const blocosEncontrados = indicesLidos.filter(index => {
    return indicesEsperados.includes(index);
  }).length;

  const total = frasesOrdenadas.length;
  const lidas = leiturasEquipe.length;
  const faltando = Math.max(total - blocosEncontrados, 0);
  const pontuacao = corretas * 10;

  return {
    corretas,
    blocosEncontrados,
    total,
    lidas,
    faltando,
    pontuacao
  };
}
function criarAssinaturaLeituras(db, equipeId) {
  const leiturasEquipe = db.leituras
    .filter(item => item.equipeId === equipeId)
    .sort((a, b) => a.id - b.id);

  if (leiturasEquipe.length === 0) {
    return null;
  }

  return leiturasEquipe
    .map(item => item.codigoBinario)
    .join('|');
}

function salvarPontuacaoEquipe(db, equipeId, avaliacao) {
  const assinaturaAtual = criarAssinaturaLeituras(db, equipeId);

  if (!assinaturaAtual) {
    return {
      pontuacao: 0,
      jaValidouEssaMesmaSequencia: false
    };
  }

  let pontuacao = db.pontuacoes.find(item => item.equipeId === equipeId);

  if (!pontuacao) {
    pontuacao = {
      id: db.nextPontuacaoId++,
      equipeId,
      pontuacao: 0,
      corretas: 0,
      total: avaliacao.total,
      ultimaPontuacaoRodada: 0,
      ultimaAssinatura: '',
      updatedAt: new Date().toISOString()
    };

    db.pontuacoes.push(pontuacao);
  }

  const jaValidouEssaMesmaSequencia = pontuacao.ultimaAssinatura === assinaturaAtual;

  if (!jaValidouEssaMesmaSequencia) {
    pontuacao.pontuacao += avaliacao.pontuacao;
    pontuacao.ultimaPontuacaoRodada = avaliacao.pontuacao;
    pontuacao.corretas = avaliacao.corretas;
    pontuacao.total = avaliacao.total;
    pontuacao.ultimaAssinatura = assinaturaAtual;
    pontuacao.updatedAt = new Date().toISOString();
  }

  return {
    ...pontuacao,
    jaValidouEssaMesmaSequencia
  };
}

function getPontuacaoSalva(db, equipeId) {
  return db.pontuacoes.find(item => item.equipeId === equipeId) || null;
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
    '.svg': 'image/svg+xml'
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
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/ping' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, mensagem: 'API do Robô Literário online' });
    }

    if (url.pathname === '/api/atividade' && req.method === 'GET') {
      const db = readDb();
      return sendJson(res, 200, {
        frases: [...db.frases].sort((a, b) => a.indice - b.indice),
        total: db.frases.length
      });
    }

    if (url.pathname === '/api/atividade' && req.method === 'POST') {
      const body = await parseBody(req);
      const textoAlvo = String(body.textoAlvo || body.texto || '').trim();

      if (!textoAlvo) {
        return sendJson(res, 400, { error: 'Envie textoAlvo para iniciar a atividade.' });
      }

      const blocos = splitTextoEmBlocos(textoAlvo);
      if (blocos.length === 0) {
        return sendJson(res, 400, { error: 'A atividade precisa ter pelo menos um bloco.' });
      }

      const db = readDb();
      db.frases = blocos.map((texto, index) => ({
        id: db.nextFraseId++,
        indice: index + 1,
        codigoBinario: index.toString(2).padStart(4, '0'),
        texto
      }));
      db.leituras = [];
      db.latest = null;
      writeDb(db);

      return sendJson(res, 201, {
        mensagem: 'Atividade iniciada com sucesso.',
        frases: db.frases
      });
    }

    if (url.pathname === '/api/qr/latest' && req.method === 'GET') {
      const db = readDb();
      return sendJson(res, 200, db.latest || null);
    }

    if (url.pathname === '/api/qr' && req.method === 'POST') {
      const body = await parseBody(req);
      const db = readDb();

      if (db.frases.length === 0) {
        return sendJson(res, 400, {
          error: 'Nenhuma atividade foi iniciada ainda.'
        });
      }

      let equipe;

      try {
        equipe = getOrCreateEquipe(db, body.equipe || body.nomeEquipe);
      } catch (error) {
        return sendJson(res, 400, {
          error: error.message
        });
      }

      const codigoBinario = String(body.codigoBinario || '').trim();

      if (!/^[01]+$/.test(codigoBinario)) {
        return sendJson(res, 400, {
          error: 'Código binário inválido. Use apenas 0 e 1. Ex: 0000, 0001, 0010.'
        });
      }

      const index = parseInt(codigoBinario, 2) + 1;

      const frase = db.frases.find(item => {
        return item.codigoBinario === codigoBinario || item.indice === index;
      });

      if (!frase) {
        return sendJson(res, 404, {
          error: `Nenhum bloco encontrado para o código ${codigoBinario}.`
        });
      }

      const leitura = {
        id: db.nextLeituraId++,
        equipeId: equipe.id,
        equipe: equipe.nome,
        fraseId: frase.id,
        index: frase.indice,
        codigoBinario: frase.codigoBinario,
        fragment: frase.texto,
        fragmento: frase.texto,
        createdAt: new Date().toISOString()
      };

      db.leituras.push(leitura);

      const avaliacao = avaliarEquipe(db, equipe.id);

      db.latest = {
        ...leitura,
        pontuacao: avaliacao.pontuacao
      };

      writeDb(db);

      return sendJson(res, 200, {
        mensagem: 'Leitura registrada com sucesso.',
        ...leitura,
        avaliacao,
        pontuacao: avaliacao.pontuacao
      });
    }

    if (url.pathname === '/api/validar' && req.method === 'POST') {
      const body = await parseBody(req);
      const db = readDb();

      if (!db.frases || db.frases.length === 0) {
        return sendJson(res, 400, {
          error: 'Nenhuma atividade foi iniciada ainda. Inicie uma frase antes de verificar a resposta.'
        });
      }

      const nomeEquipe = body.equipe || body.nomeEquipe;
      const equipe = findEquipeByNome(db, nomeEquipe);

      if (!equipe) {
        return sendJson(res, 400, {
          error: 'Essa equipe ainda não existe. Envie uma leitura primeiro antes de verificar.'
        });
      }

      const leiturasEquipe = db.leituras.filter(item => item.equipeId === equipe.id);

      if (leiturasEquipe.length === 0) {
        return sendJson(res, 400, {
          error: `A ${equipe.nome} ainda não enviou nenhum bloco. Envie pelo menos uma leitura antes de verificar.`
        });
      }

      const avaliacao = avaliarEquipe(db, equipe.id);

      const pontuacaoSalva = salvarPontuacaoEquipe(db, equipe.id, avaliacao);

      writeDb(db);

      return sendJson(res, 200, {
        equipe: equipe.nome,
        ...avaliacao,
        pontuacaoRodada: avaliacao.pontuacao,
        pontuacao: pontuacaoSalva.pontuacao,
        jaValidouEssaMesmaSequencia: pontuacaoSalva.jaValidouEssaMesmaSequencia
      });
    }

    if (url.pathname === '/api/placar' && req.method === 'GET') {
      const db = readDb();

      const placar = db.equipes.map(equipe => {
        const avaliacaoAtual = avaliarEquipe(db, equipe.id);
        const pontuacaoSalva = getPontuacaoSalva(db, equipe.id);

        return {
          equipe: equipe.nome,
          ...avaliacaoAtual,
          pontuacao: pontuacaoSalva ? pontuacaoSalva.pontuacao : avaliacaoAtual.pontuacao,
          corretas: pontuacaoSalva ? pontuacaoSalva.corretas : avaliacaoAtual.corretas,
          total: pontuacaoSalva ? pontuacaoSalva.total : avaliacaoAtual.total
        };
      }).sort((a, b) => b.pontuacao - a.pontuacao);

      return sendJson(res, 200, { placar });
    }

    if (url.pathname === '/api/leituras' && req.method === 'GET') {
      const db = readDb();

      const nomeEquipe = String(url.searchParams.get('equipe') || 'Equipe 1').trim();
      const equipe = findEquipeByNome(db, nomeEquipe);

      if (!equipe) {
        return sendJson(res, 200, {
          equipe: normalizarNomeEquipe(nomeEquipe) || nomeEquipe,
          leituras: [],
          avaliacao: {
            corretas: 0,
            blocosEncontrados: 0,
            total: db.frases.length,
            lidas: 0,
            faltando: db.frases.length,
            pontuacao: 0
          },
          pontuacao: 0
        });
      }

      const leituras = db.leituras
        .filter(item => item.equipeId === equipe.id)
        .map(item => ({
          id: item.id,
          equipe: item.equipe,
          index: item.index,
          codigoBinario: item.codigoBinario,
          fragment: item.fragment,
          fragmento: item.fragmento,
          createdAt: item.createdAt
        }));

      const avaliacao = avaliarEquipe(db, equipe.id);
      const pontuacaoSalva = getPontuacaoSalva(db, equipe.id);

      return sendJson(res, 200, {
        equipe: equipe.nome,
        leituras,
        avaliacao,
        pontuacao: pontuacaoSalva ? pontuacaoSalva.pontuacao : avaliacao.pontuacao
      });
    }

    if (url.pathname === '/api/reset-equipe' && req.method === 'POST') {
      const body = await parseBody(req);
      const db = readDb();

      const nomeEquipe = body.equipe || body.nomeEquipe;
      const equipe = findEquipeByNome(db, nomeEquipe);

      if (!equipe) {
        return sendJson(res, 200, {
          mensagem: 'Equipe ainda não existe. Nada para limpar.',
          equipe: normalizarNomeEquipe(nomeEquipe) || nomeEquipe
        });
      }

      db.leituras = db.leituras.filter(item => item.equipeId !== equipe.id);

      if (db.latest && db.latest.equipe && db.latest.equipe.toLowerCase() === equipe.nome.toLowerCase()) {
        db.latest = null;
      }

      writeDb(db);

      return sendJson(res, 200, {
        mensagem: `Mesa da ${equipe.nome} limpa com sucesso.`,
        equipe: equipe.nome
      });
    }

    if (url.pathname === '/api/supabase/status' && req.method === 'GET') {
      if (!supabase) {
        return sendJson(res, 200, {
          conectado: false,
          mensagem: 'Supabase não está configurado. O sistema está usando db.json.'
        });
      }

      const { data, error } = await supabase
        .from('equipes')
        .select('id')
        .limit(1);

      if (error) {
        return sendJson(res, 500, {
          conectado: false,
          mensagem: 'Supabase configurado, mas houve erro ao consultar.',
          erro: error.message
        });
      }

      return sendJson(res, 200, {
        conectado: true,
        mensagem: 'Supabase conectado com sucesso.'
      });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);

      const resultado = loginAdmin(body.accessKey);

      if (!resultado.ok) {
        return sendJson(res, resultado.status, {
          error: resultado.error
        });
      }

      return sendJson(res, 200, {
        mensagem: 'Login admin realizado com sucesso.',
        token: resultado.token
      });
    }

    if (url.pathname === '/api/admin/reset-json' && req.method === 'POST') {
      if (!requireAdmin(req, res, sendJson)) return;

      resetarJsonLocal();

      return sendJson(res, 200, {
        mensagem: 'Banco local db.json apagado com sucesso.'
      });
    }

    if (url.pathname === '/api/admin/reset-supabase' && req.method === 'POST') {
      if (!requireAdmin(req, res, sendJson)) return;

      const resultado = await resetarSupabase();

      return sendJson(res, 200, resultado);
    }

    if (url.pathname === '/api/admin/reset-tudo' && req.method === 'POST') {
      if (!requireAdmin(req, res, sendJson)) return;

      resetarJsonLocal();

      let resultadoSupabase = {
        ok: false,
        mensagem: 'Supabase não foi resetado porque não está configurado.'
      };

      if (supabase) {
        resultadoSupabase = await resetarSupabase();
      }

      return sendJson(res, 200, {
        mensagem: 'Reset executado.',
        jsonLocal: 'db.json apagado com sucesso.',
        supabase: resultadoSupabase
      });
    }

    if (url.pathname === '/api/docs.json' && req.method === 'GET') {      
      return sendSwaggerJson(res, sendJson);
    }

    if (url.pathname === '/docs' && req.method === 'GET') {
      return sendSwaggerUi(res);
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Rota da API não encontrada.' });
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Erro interno no servidor.' });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
