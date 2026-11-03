'use strict';
// Limpeza seletiva de atividades vazias, por ID. Sem --confirmar, NÃO apaga nada.
// Nunca apaga atividade em andamento ou associada a leituras/sessões/importações/pontuações.

function lerIds(valor) {
  if (!/^\d+(,\d+)*$/.test(valor || '')) throw new Error('Informe IDs numéricos: --apagar=3,4');
  const ids = valor.split(',').map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('ID inválido.');
  return [...new Set(ids)];
}

async function inspecionar(prisma, id) {
  const atividade = await prisma.atividade.findUnique({ where: { id }, include: { _count: { select: { frases: true, leituras: true, pontuacoes: true } } } });
  if (!atividade) return { id, existe: false, elegivel: false, motivo: 'não encontrada' };
  const [sessoes, importacoes] = await Promise.all([
    prisma.sessaoEsp.count({ where: { sessaoId: `ATV-${id}` } }),
    prisma.importacaoSessaoEsp.count({ where: { atividadeId: id } })
  ]);
  const elegivel = !atividade.ativa && !atividade._count.leituras && !atividade._count.pontuacoes && !sessoes && !importacoes;
  return {
    id, existe: true, elegivel, ativa: atividade.ativa,
    blocos: atividade._count.frases, leituras: atividade._count.leituras,
    pontuacoes: atividade._count.pontuacoes, sessoes, importacoes,
    amostra: atividade.textoAlvo.slice(0, 80)
  };
}

async function executar(args = process.argv.slice(2)) {
  require('dotenv').config();
  const { prisma } = require('./prisma');
  const flag = args.find(arg => arg.startsWith('--apagar='));
  const confirmar = args.includes('--confirmar');
  try {
    const ids = flag ? lerIds(flag.slice('--apagar='.length))
      : (await prisma.atividade.findMany({ select: { id: true }, orderBy: { id: 'desc' } })).map(a => a.id);
    const lista = [];
    for (const id of ids) lista.push(await inspecionar(prisma, id));
    console.table(lista);
    if (!flag || !confirmar) {
      console.log('Prévia somente. Para apagar IDs específicos inativos e sem registros: node backend/limpar-atividades-teste.js --apagar=3,4 --confirmar');
      return;
    }
    if (lista.some(i => !i.existe || !i.elegivel)) throw new Error('Limpeza recusada: algum ID está ativo, ausente ou possui registros relacionados. Nenhum ID foi apagado.');
    // Reinspeciona antes de apagar, evitando excluir dados adicionados após a prévia.
    await prisma.$transaction(async tx => {
      for (const id of ids) {
        if (!(await inspecionar(tx, id)).elegivel) throw new Error(`Atividade ${id} não está mais elegível; transação cancelada.`);
        await tx.atividade.delete({ where: { id } });
      }
    });
    console.log(`Apagadas somente as atividades vazias solicitadas: ${ids.join(', ')}.`);
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) executar().catch(err => { console.error('Nenhum apagamento adicional:', err.message); process.exitCode = 1; });
module.exports = { lerIds, inspecionar };
