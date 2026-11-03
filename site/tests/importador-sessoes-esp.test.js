const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararLeituras, extrairAtividadeId, importarSessao, criarSincronizador } = require('../backend/importador-sessoes-esp');

function criarBancoFalso() {
  const state = {
    atividades: [{ id: 23, frases: [
      { id: 1, indice: 1, codigoBinario: '0000', texto: 'O gato' },
      { id: 2, indice: 2, codigoBinario: '0001', texto: 'encontrou' },
      { id: 3, indice: 3, codigoBinario: '0010', texto: 'uma estrela' }
    ] }],
    sessoes: [{ id: 1n, sessaoId: 'ATV-23', rodadas: [
      { equipe: 1, sequencia: ['0000', '0010', '0001'] },
      { equipe: 2, sequencia: [0, 1, 2] }
    ] }],
    equipes: [], leituras: [], importacoes: []
  };
  const prisma = {
    atividade: {
      async findUnique({ where }) { return state.atividades.find(a => a.id === where.id) ?? null; }
    },
    sessaoEsp: {
      async findMany({ where, orderBy, take }) {
        return state.sessoes.filter(s => s.sessaoId.startsWith(where.sessaoId.startsWith)).sort((a,b) => a.id > b.id ? -1 : 1).slice(0,take);
      }
    },
    importacaoSessaoEsp: {
      async findMany() { return state.importacoes.map(m => ({ sessaoEspId: m.sessaoEspId, sessaoId: m.sessaoId })); }
    },
    async $transaction(fn) {
      const staged = structuredClone({ equipes: state.equipes, leituras: state.leituras, importacoes: state.importacoes });
      const tx = {
        importacaoSessaoEsp: {
          async create({ data }) {
            if (staged.importacoes.some(m => m.sessaoId === data.sessaoId || m.sessaoEspId === data.sessaoEspId)) {
              const e = new Error('duplicate'); e.code = 'P2002'; throw e;
            }
            staged.importacoes.push(data);
          }
        },
        equipe: {
          async findFirst({ where }) { return staged.equipes.find(e => e.nome.toLowerCase() === where.nome.equals.toLowerCase()) || null; },
          async create({ data }) {
            const equipe = { id: staged.equipes.length + 1, ...data };
            staged.equipes.push(equipe);
            return equipe;
          }
        },
        leitura: {
          async count({ where }) { return staged.leituras.filter(l => l.atividadeId === where.atividadeId && l.equipeId === where.equipeId).length; },
          async createMany({ data }) {
            data.forEach(item => staged.leituras.push({ id: staged.leituras.length + 1, ...item }));
            return { count: data.length };
          }
        }
      };
      const resultado = await fn(tx);
      state.equipes = staged.equipes;
      state.leituras = staged.leituras;
      state.importacoes = staged.importacoes;
      return resultado;
    }
  };
  return { state, prisma };
}

test('sid do QR corresponde ao ID exato da atividade', () => {
  assert.equal(extrairAtividadeId('ATV-23'), 23);
  assert.equal(extrairAtividadeId('AULA01'), null);
  assert.equal(extrairAtividadeId('ATV-0'), null);
});

test('prepara códigos binários e numéricos sem reordenar as cartas', () => {
  const { state } = criarBancoFalso();
  const dados = prepararLeituras(state.sessoes[0], state.atividades[0]);
  assert.deepEqual(dados.map(i => [i.nomeEquipe, i.ordem, i.frase.codigoBinario]), [
    ['Equipe 1',1,'0000'],['Equipe 1',2,'0010'],['Equipe 1',3,'0001'],
    ['Equipe 2',1,'0000'],['Equipe 2',2,'0001'],['Equipe 2',3,'0010']
  ]);
});

test('importa duas equipes atomicamente, sem repetir ao reimportar', async () => {
  const { prisma, state } = criarBancoFalso();
  const primeira = await importarSessao(prisma, state.sessoes[0]);
  assert.deepEqual(primeira, { status: 'importada', quantidadeLeituras: 6, atividadeId: 23 });
  assert.equal(state.leituras.length, 6);
  assert.equal(state.importacoes.length, 1);
  const segunda = await importarSessao(prisma, state.sessoes[0]);
  assert.equal(segunda.status, 'duplicada');
  assert.equal(state.leituras.length, 6);
  // Se o POST foi repetido como outra linha (novo id), sessao_id impede duplicata.
  assert.equal((await importarSessao(prisma, { ...state.sessoes[0], id: 2n })).status, 'duplicada');
  assert.equal(state.leituras.length, 6);
});

test('não salva parte de sessão com QR inválido', async () => {
  const { prisma, state } = criarBancoFalso();
  state.sessoes[0].rodadas[1].sequencia.push('1111');
  await assert.rejects(importarSessao(prisma, state.sessoes[0]), /não está cadastrado/);
  assert.equal(state.leituras.length, 0);
  assert.equal(state.importacoes.length, 0);
});

test('não mistura importação com leituras já existentes de testes manuais', async () => {
  const { prisma, state } = criarBancoFalso();
  state.equipes.push({ id: 1, nome: 'Equipe 1' });
  state.leituras.push({ id: 1, atividadeId: 23, equipeId: 1, fraseId: 1, ordem: 1 });
  await assert.rejects(importarSessao(prisma, state.sessoes[0]), /já possui/);
  assert.equal(state.leituras.length, 1);
  assert.equal(state.importacoes.length, 0);
});

test('sincronizador importa e segunda execução não duplica', async () => {
  const { prisma, state } = criarBancoFalso();
  const logs = [];
  const sync = criarSincronizador(prisma, { logger: { info: s => logs.push(s), warn: s => logs.push(s) } });
  const primeira = await sync.sincronizar();
  const segunda = await sync.sincronizar();
  assert.equal(primeira.importadas, 1);
  assert.equal(segunda.importadas, 0);
  assert.equal(state.leituras.length, 6);
  assert.equal(state.importacoes.length, 1);
  assert.equal(logs.length, 1);
});


test('pausa consultas repetidas ao receber circuit breaker de autenticação', async () => {
  let tentativas = 0;
  const logs = [];
  const erro = new Error('DriverAdapterError');
  erro.cause = { originalMessage: '(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked' };
  const prisma = { sessaoEsp: { async findMany() { tentativas++; throw erro; } } };
  const sync = criarSincronizador(prisma, {
    intervaloMs: 10,
    logger: { error: msg => logs.push(msg) }
  });
  sync.iniciar();
  await new Promise(resolve => setTimeout(resolve, 80));
  sync.parar();
  assert.equal(tentativas, 1);
  assert.equal(sync.estado.pausadoPorAutenticacao, true);
  assert.equal(logs.length, 1);
});
