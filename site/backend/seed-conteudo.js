'use strict';
// Carga pedagógica de demonstração. Executada SOMENTE via npm run seed:conteudo.
// Não apaga registros, não substitui edições da professora e não ativa atividades.
const fs = require('node:fs');
const path = require('node:path');
const { contosCompativeis } = require('./acervo');

const DATA_FILE = path.join(__dirname, 'data', 'sete-corvos.json');

function validarConteudo(dados) {
  if (!dados?.id || !dados?.titulo || !Array.isArray(dados.trechos)) throw new Error('Dados do conto inválidos.');
  if (dados.trechos.length < 1 || dados.trechos.length > 16) throw new Error('O modelo precisa de 1 a 16 trechos.');
  const ordens = dados.trechos.map(t => t.ordemCorreta);
  const letras = dados.trechos.map(t => t.letra);
  if (new Set(ordens).size !== ordens.length || new Set(letras).size !== letras.length
    || ordens.some(n => !Number.isInteger(n) || n < 1 || n > 16)
    || letras.some(letra => !/^[A-P]$/.test(letra))) throw new Error('Ordem ou letra de trecho duplicada/inválida.');
  for (const campo of ['perguntas', 'dicas', 'desafios']) {
    if (!Array.isArray(dados[campo])) throw new Error(`Lista ${campo} inválida.`);
  }
  return dados;
}

async function seedPedagogico(prisma, dados, logger = console) {
  validarConteudo(dados);
  const atual = await prisma.conto.findUnique({ where: { id: dados.id } });
  if (!atual) {
    await prisma.conto.create({ data: { id: dados.id, titulo: dados.titulo, autor: dados.autor || null, resumo: dados.resumo || null } });
  }
  let criados = 0;
  for (const [nome, modelo, campos] of [
    ['perguntas', prisma.pergunta, ['pergunta', 'resposta']],
    ['desafios', prisma.desafio, ['momento', 'texto']]
  ]) {
    for (const item of dados[nome]) {
      const where = { contoId_ordem: { contoId: dados.id, ordem: item.ordem } };
      if (await modelo.findUnique({ where })) continue;
      const data = Object.fromEntries(campos.map(campo => [campo, item[campo] ?? null]));
      await modelo.create({ data: { contoId: dados.id, ordem: item.ordem, ...data } });
      criados++;
    }
  }
  for (const trecho of dados.trechos) {
    const atual = await prisma.trechoEmbaralhar.findFirst({ where: {
      letra: trecho.letra, OR: [{ conto: dados.titulo }, { conto: dados.id }]
    } });
    if (atual) continue;
    await prisma.trechoEmbaralhar.create({ data: {
      conto: dados.titulo, letra: trecho.letra, ordemCorreta: trecho.ordemCorreta, texto: trecho.texto
    } });
    criados++;
  }
  for (const dica of dados.dicas) {
    const where = { contoId_ordem: { contoId: dados.id, ordem: dica.ordem } };
    if (await prisma.dica.findUnique({ where })) continue;
    let trechoId = null;
    if (dica.trechoLetra) {
      const trecho = await prisma.trechoEmbaralhar.findFirst({ where: {
        letra: dica.trechoLetra, OR: [{ conto: dados.titulo }, { conto: dados.id }]
      } });
      if (!trecho) throw new Error(`Trecho ${dica.trechoLetra} não existe para associar a dica.`);
      trechoId = trecho.id;
    }
    await prisma.dica.create({ data: { contoId: dados.id, ordem: dica.ordem, texto: dica.texto, trechoId } });
    criados++;
  }
  logger.log(`Conteúdo de ${dados.titulo}: ${criados} registro(s) novos; os existentes foram preservados.`);
  return { criados };
}

async function seedAtividadeModelo(prisma, dados, logger = console) {
  // Usa o conteúdo ATUAL do banco, não substitui edições por valores do arquivo JSON.
  const [conto, trechos, atividades] = await Promise.all([
    prisma.conto.findUnique({ where: { id: dados.id } }),
    prisma.trechoEmbaralhar.findMany({ where: { OR: [{ conto: dados.titulo }, { conto: dados.id }] }, orderBy: { ordemCorreta: 'asc' } }),
    prisma.atividade.findMany({ include: { frases: { orderBy: { indice: 'asc' } } } })
  ]);
  if (!conto || trechos.length !== dados.trechos.length ||
      new Set(trechos.map(t => t.letra)).size !== trechos.length) {
    throw new Error('Trechos ausentes/duplicados. Corrija o conteúdo antes de criar a atividade modelo.');
  }
  const compat = atividades.find(atividade => contosCompativeis(atividade, [conto], trechos).includes(conto.id));
  if (compat) {
    logger.log(`Atividade ${compat.id} já corresponde ao conto; nenhuma atividade adicional foi criada.`);
    return { criada: false, id: compat.id };
  }
  const codigos = trechos.map((t, index) => ({
    indice: t.ordemCorreta,
    codigoBinario: (t.letra.toUpperCase().charCodeAt(0) - 65).toString(2).padStart(4, '0'),
    texto: t.texto
  }));
  if (new Set(codigos.map(f => f.codigoBinario)).size !== codigos.length ||
      codigos.some(f => !/^[01]{4}$/.test(f.codigoBinario))) throw new Error('Cartas sem códigos binários únicos de 4 bits.');
  const nova = await prisma.atividade.create({ data: {
    textoAlvo: trechos.map(t => t.texto).join(' | '),
    ativa: false, // nunca tomar o lugar da atividade ativa da professora
    frases: { create: codigos }
  } });
  logger.log(`Atividade modelo ${nova.id} criada como INATIVA, sem leituras ou pontuação.`);
  return { criada: true, id: nova.id };
}

async function executar() {
  require('dotenv').config();
  const { prisma } = require('./prisma');
  const dados = validarConteudo(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  try {
    await seedPedagogico(prisma, dados);
    await seedAtividadeModelo(prisma, dados);
    console.log('Seed finalizada. Nenhuma sessão, leitura, pontuação ou atividade anterior foi excluída.');
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) executar().catch(err => { console.error(err); process.exitCode = 1; });
module.exports = { validarConteudo, seedPedagogico, seedAtividadeModelo };
