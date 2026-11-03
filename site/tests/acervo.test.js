const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAtividadesAcervo } = require('../backend/acervo');

const contos = [{ id: 'conto-a', titulo: 'Conto A' }, { id: 'conto-b', titulo: 'Conto B' }];
const trechos = [
  { conto: 'Conto A', ordemCorreta: 2, texto: 'Fim.' },
  { conto: 'Conto A', ordemCorreta: 1, texto: 'Início.' },
  { conto: 'conto-b', ordemCorreta: 1, texto: 'Outro.' }
];
const atividade = (id, frases) => ({ id, ativa: id === 1, createdAt: new Date(0), textoAlvo: 'texto', frases });
const f = (indice, texto) => ({ id: indice, indice, texto, codigoBinario: indice.toString(2).padStart(4, '0') });

test('associa apenas correspondências completas com ordem e texto exatos', () => {
  const result = montarAtividadesAcervo([
    atividade(1, [f(2, 'Fim.'), f(1, 'Início.')]),
    atividade(2, [f(1, 'Início.')]),
    atividade(3, [f(1, 'Início.'), f(2, 'Outro fim.')]),
    atividade(4, [f(1, 'Outro.')])
  ], contos, trechos);
  assert.deepEqual(result.map(a => a.contosCompativeisIds), [['conto-a'], [], [], ['conto-b']]);
  assert.deepEqual(result[0].frases.map(f => f.indice), [1, 2]);
});

test('sem blocos não produz associação especulativa', () => {
  assert.deepEqual(montarAtividadesAcervo([atividade(5, [])], contos, trechos)[0].contosCompativeisIds, []);
});
