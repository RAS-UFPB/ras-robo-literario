'use strict';

// O schema atual não possui atividade.conto_id: apenas detectamos a igualdade
// integral entre os blocos da atividade e os trechos cadastrados do conto.
// Isso é uma correspondência verificável, não um vínculo de chave estrangeira.
function contosCompativeis(atividade, contos, trechos) {
  const frases = [...(atividade.frases || [])].sort((a, b) => a.indice - b.indice);
  if (!frases.length) return [];
  return contos.filter(conto => {
    const doConto = trechos.filter(item => item.conto === conto.id || item.conto === conto.titulo)
      .sort((a, b) => a.ordemCorreta - b.ordemCorreta);
    return doConto.length === frases.length && doConto.every((trecho, index) =>
      Number(trecho.ordemCorreta) === Number(frases[index].indice)
      && trecho.texto === frases[index].texto
    );
  }).map(conto => conto.id);
}

function montarAtividadesAcervo(atividades, contos, trechos) {
  return atividades.map(atividade => ({
    id: atividade.id,
    ativa: atividade.ativa,
    createdAt: atividade.createdAt,
    textoAlvo: atividade.textoAlvo,
    frases: [...(atividade.frases || [])].sort((a, b) => a.indice - b.indice).map(frase => ({
      id: frase.id, indice: frase.indice, texto: frase.texto, codigoBinario: frase.codigoBinario
    })),
    contosCompativeisIds: contosCompativeis(atividade, contos, trechos)
  }));
}

module.exports = { contosCompativeis, montarAtividadesAcervo };
