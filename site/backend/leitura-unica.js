// Registra cada código uma única vez por atividade/equipe no simulador do painel.
// Serialização por equipe evita que dois cliques rápidos ocupem duas posições.
function criarRegistradorLeiturasUnicas(prisma, obterEquipe) {
  const filas = new Map();

  return function registrar({ atividade, nomeEquipe, frase }) {
    const chave = `${atividade.id}:${nomeEquipe.toLocaleLowerCase('pt-BR')}`;
    const anterior = filas.get(chave) || Promise.resolve();
    const atual = anterior.catch(() => {}).then(async () => {
      const equipe = await obterEquipe(nomeEquipe);
      const existente = await prisma.leitura.findFirst({
        where: { atividadeId: atividade.id, equipeId: equipe.id, codigoBinario: frase.codigoBinario }
      });
      if (existente) return { duplicada: true, leitura: existente };

      const ordem = await prisma.leitura.count({ where: { atividadeId: atividade.id, equipeId: equipe.id } });
      const leitura = await prisma.leitura.create({
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
      return { duplicada: false, leitura };
    });
    filas.set(chave, atual);
    void atual.finally(() => { if (filas.get(chave) === atual) filas.delete(chave); }).catch(() => {});
    return atual;
  };
}

module.exports = { criarRegistradorLeiturasUnicas };
