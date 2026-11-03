'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validarConteudo, seedPedagogico, seedAtividadeModelo } = require('../backend/seed-conteudo');
const { lerIds, inspecionar } = require('../backend/limpar-atividades-teste');
const dados = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backend/data/sete-corvos.json'), 'utf8'));

function prismaFalso() {
  const conteudo = { contos: [], perguntas: [], desafios: [], dicas: [], trechos: [], atividades: [] };
  const ordenado = (tabela) => ({
    async findUnique({where}) {
      const key = where.contoId_ordem;
      return conteudo[tabela].find(item => item.contoId === key.contoId && item.ordem === key.ordem) || null;
    },
    async create({data}) { const registro = { id: conteudo[tabela].length + 1, ...data }; conteudo[tabela].push(registro); return registro; }
  });
  const prisma = {
    conto: {
      async findUnique({where}) { return conteudo.contos.find(item => item.id === where.id) || null; },
      async create({data}) {conteudo.contos.push({...data});return data;}
    },
    pergunta: ordenado('perguntas'),
    desafio: ordenado('desafios'),
    dica: ordenado('dicas'),
    trechoEmbaralhar: {
      async findFirst({where}) {return conteudo.trechos.find(item => item.letra === where.letra && where.OR.some(alt => alt.conto === item.conto)) || null;},
      async findMany() {return conteudo.trechos.slice().sort((a,b) => a.ordemCorreta - b.ordemCorreta);},
      async create({data}) {const registro={id:conteudo.trechos.length+1,...data};conteudo.trechos.push(registro);return registro;}
    },
    atividade: {
      async findMany() {return conteudo.atividades;},
      async create({data}) {const registro={id:conteudo.atividades.length+1, ...data, frases:data.frases.create};conteudo.atividades.push(registro);return registro;}
    }
  };
  return { prisma, conteudo };
}

test('material pedagógico corresponde às 8 cartas de compreensão, 5 missões, 5 dicas e 8 trechos enviados', () => {
  assert.equal(validarConteudo(dados), dados);
  assert.deepEqual([dados.perguntas.length,dados.desafios.length,dados.dicas.length,dados.trechos.length], [8,5,5,8]);
  assert.equal(dados.trechos.find(t => t.letra === 'B').texto, 'Os irmãos vão buscar água, mas o cântaro cai na fonte.');
  assert.equal(dados.perguntas[0].resposta, 'Sete filhos, todos meninos.');
});

test('seed pedagógica não duplica nem sobrescreve registros editados ao rodar duas vezes', async () => {
  const {prisma, conteudo} = prismaFalso();
  const silencioso={log() {}};
  const primeira=await seedPedagogico(prisma,dados,silencioso);
  assert.equal(primeira.criados, 26);
  conteudo.perguntas[0].pergunta = 'Texto editado pela professora.';
  const segunda=await seedPedagogico(prisma,dados,silencioso);
  assert.equal(segunda.criados,0);
  assert.equal(conteudo.perguntas[0].pergunta, 'Texto editado pela professora.');
  assert.equal(conteudo.contos.length, 1);
  assert.equal(conteudo.trechos.length,8);
});

test('atividade modelo é inativa, usa códigos binários por letra e não se duplica', async () => {
  const {prisma, conteudo} = prismaFalso();
  const silencioso={log() {}};
  await seedPedagogico(prisma,dados,silencioso);
  const primeira=await seedAtividadeModelo(prisma,dados,silencioso);
  assert.equal(primeira.criada,true);
  assert.equal(conteudo.atividades[0].ativa,false);
  assert.equal(conteudo.atividades[0].frases.length,8);
  assert.deepEqual(conteudo.atividades[0].frases.find(f => f.codigoBinario === '0001').texto,
    'Os irmãos vão buscar água, mas o cântaro cai na fonte.');
  const segunda=await seedAtividadeModelo(prisma,dados,silencioso);
  assert.equal(segunda.criada,false);
  assert.equal(conteudo.atividades.length,1);
});

test('limpeza só aceita IDs explícitos e detecta atividade ativa, sessões, importações, leituras e pontuação', async () => {
  assert.deepEqual(lerIds('3,4,3'),[3,4]);
  assert.throws(() => lerIds('1; DROP TABLE atividades'), /IDs numéricos/);
  const fake = {
    atividade: {async findUnique({where}) {return { id:where.id, ativa:false, textoAlvo:'teste', _count:{frases:2,leituras:0,pontuacoes:0} };}},
    sessaoEsp: {async count() {return 0;}},
    importacaoSessaoEsp:{async count() {return 0;}}
  };
  assert.equal((await inspecionar(fake, 4)).elegivel,true);
  fake.sessaoEsp.count=async()=>1;
  assert.equal((await inspecionar(fake, 4)).elegivel,false);
  fake.sessaoEsp.count=async()=>0;
  fake.atividade.findUnique=async()=>({ativa:true,textoAlvo:'teste',_count:{frases:2,leituras:0,pontuacoes:0}});
  assert.equal((await inspecionar(fake, 4)).elegivel,false);
});
