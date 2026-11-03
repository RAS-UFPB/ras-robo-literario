const test = require('node:test');
const assert = require('node:assert/strict');
const { criarRegistradorLeiturasUnicas } = require('../backend/leitura-unica');
const { prepararLeituras } = require('../backend/importador-sessoes-esp');
const fs = require('node:fs');
const path = require('node:path');

const atividade = { id: 23, frases: [
  { id: 1, indice: 1, codigoBinario: '0000', texto: 'A' },
  { id: 2, indice: 2, codigoBinario: '0001', texto: 'B' },
  { id: 3, indice: 3, codigoBinario: '0010', texto: 'C' }
] };

function bancoFalso() {
  let nextId = 1;
  const leituras = [];
  const prisma = { leitura: {
    async findFirst({ where }) {
      return leituras.find(item => item.atividadeId === where.atividadeId && item.equipeId === where.equipeId && item.codigoBinario === where.codigoBinario) || null;
    },
    async count({ where }) {
      return leituras.filter(item => item.atividadeId === where.atividadeId && item.equipeId === where.equipeId).length;
    },
    async create({ data }) {
      const criada = { id: nextId++, ...data };
      leituras.push(criada);
      return criada;
    }
  }};
  const obterEquipe = async nome => ({ id: Number(nome.split(' ')[1]), nome });
  return { leituras, registrar: criarRegistradorLeiturasUnicas(prisma, obterEquipe) };
}

test('simulador ignora código repetido mesmo com chamadas simultâneas', async () => {
  const { registrar, leituras } = bancoFalso();
  const params = { atividade, nomeEquipe: 'Equipe 1', frase: atividade.frases[0] };
  const [primeira, segunda, terceira] = await Promise.all([registrar(params), registrar(params), registrar(params)]);
  assert.equal(primeira.duplicada, false);
  assert.equal(segunda.duplicada, true);
  assert.equal(terceira.duplicada, true);
  assert.equal(leituras.length, 1);
  assert.equal(leituras[0].ordem, 1);
});

test('carta diferente ocupa próxima posição; outra equipe pode reutilizar o mesmo código', async () => {
  const { registrar, leituras } = bancoFalso();
  await registrar({ atividade, nomeEquipe: 'Equipe 1', frase: atividade.frases[0] });
  await registrar({ atividade, nomeEquipe: 'Equipe 1', frase: atividade.frases[2] });
  await registrar({ atividade, nomeEquipe: 'Equipe 2', frase: atividade.frases[0] });
  assert.deepEqual(leituras.map(l => [l.equipeId, l.codigoBinario, l.ordem]), [
    [1, '0000', 1], [1, '0010', 2], [2, '0000', 1]
  ]);
});

test('limpar a mesa no banco libera o mesmo QR e uma nova atividade também', async () => {
  const { registrar, leituras } = bancoFalso();
  const p = { atividade, nomeEquipe: 'Equipe 1', frase: atividade.frases[0] };
  await registrar(p);
  leituras.length = 0; // equivale ao endpoint de limpeza da equipe
  assert.equal((await registrar(p)).duplicada, false);
  assert.equal((await registrar({ ...p, atividade: { id: 24 } })).duplicada, false);
});

test('importador ignora repetições na mesma rodada sem consumir posições', () => {
  const dados = prepararLeituras({ rodadas: [
    { equipe: 1, sequencia: ['0000', '0000', '0010', '0000', '0001'] },
    { equipe: 2, sequencia: ['0000', '0000', '0001'] }
  ] }, atividade);
  assert.deepEqual(dados.map(x => [x.nomeEquipe, x.ordem, x.frase.codigoBinario]), [
    ['Equipe 1', 1, '0000'], ['Equipe 1', 2, '0010'], ['Equipe 1', 3, '0001'],
    ['Equipe 2', 1, '0000'], ['Equipe 2', 2, '0001']
  ]);
});

test('importador libera o código na rodada seguinte da mesma equipe', () => {
  const dados = prepararLeituras({ rodadas: [
    { equipe: 1, sequencia: ['0000'] },
    { equipe: 1, sequencia: ['0000', '0001'] }
  ] }, atividade);
  assert.deepEqual(dados.map(x => x.ordem), [1, 2, 3]);
});

test('firmware verifica ambas as formas de carta e preserva estado recuperado', () => {
  const firmware = fs.readFileSync(path.join(__dirname, '../../esp/robo_literario_codigo.ino'), 'utf8');
  assert.equal((firmware.match(/cartaJaRegistrada\(rodadaAtual, idCarta\)/g) || []).length, 2);
  assert.match(firmware, /for \(uint8_t i = 0; i < rodada\.numCartas; i\+\+\)/);
  assert.match(firmware, /restaurarProgresso\(\)/);
});
