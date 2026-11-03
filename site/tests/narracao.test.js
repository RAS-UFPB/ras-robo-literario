const test = require('node:test');
const assert = require('node:assert/strict');
const { NarradorTrechos, dividirTexto } = require('../painel/narracao');

const voz = { name: 'Teste BR', lang: 'pt-BR', voiceURI: 'pt-br-teste' };
class FraseFalsa { constructor(text) { this.text = text; } }
function ambiente(vozes = [voz]) {
  const chamadas = [], handlers = {};
  const synth = {
    calls: chamadas, cancelou: 0, pausou: 0, continuou: 0,
    getVoices: () => vozes,
    addEventListener: (nome, fn) => { handlers[nome] = fn; },
    speak(frase) { chamadas.push(frase); },
    pause() { this.pausou++; }, resume() { this.continuou++; },
    cancel() { this.cancelou++; }
  };
  return { narrador: new NarradorTrechos(synth, FraseFalsa), synth, handlers };
}

test('segmenta textos extensos sem mudar nem perder um caractere', () => {
  const texto = 'Era uma vez, uma história. '.repeat(90);
  const partes = dividirTexto(texto);
  assert.ok(partes.length > 3);
  assert.equal(partes.join(''), texto);
  assert.ok(partes.every(parte => parte.length <= 180));
});

test('reproduz, pausa, continua, termina e para', () => {
  const { narrador, synth } = ambiente();
  assert.equal(narrador.falar('Olá, turma.'), true);
  assert.equal(synth.calls[0].text, 'Olá, turma.');
  assert.equal(synth.calls[0].lang, 'pt-BR');
  narrador.pausarOuContinuar();
  assert.equal(narrador.estado, 'pausado');
  narrador.pausarOuContinuar();
  assert.equal(narrador.estado, 'lendo');
  assert.equal(synth.pausou, 1);
  assert.equal(synth.continuou, 1);
  synth.calls[0].onend();
  assert.equal(narrador.estado, 'parado');
  narrador.falar('Outro trecho');
  narrador.parar();
  assert.equal(narrador.estado, 'parado');
});

test('substitui trecho anterior sem continuar a fila cancelada', () => {
  const { narrador, synth } = ambiente();
  narrador.falar('Texto longo. '.repeat(80));
  const antigo = synth.calls[0];
  narrador.falar('Novo trecho exato');
  assert.equal(synth.calls.at(-1).text, 'Novo trecho exato');
  const quantidade = synth.calls.length;
  antigo.onend();
  assert.equal(synth.calls.length, quantidade);
  assert.ok(synth.cancelou >= 2);
});

test('sem voz pt-BR permite tentar voz padrão sem prometer sotaque brasileiro', () => {
  const { narrador, synth, handlers } = ambiente([{ name: 'PT Portugal', lang: 'pt-PT', voiceURI: 'pt' }]);
  assert.equal(narrador.vozes.length, 0);
  assert.match(narrador.mensagem, /voz automática/);
  assert.equal(narrador.disponivel, true);
  assert.equal(narrador.falar('Oi'), true);
  assert.equal(synth.calls.length, 1);
  assert.equal(synth.calls[0].lang, 'pt-BR');
  assert.equal(synth.calls[0].voice, undefined);
  handlers.voiceschanged();
  assert.equal(narrador.vozes.length, 0);
  narrador.parar();
});

test('lista inicialmente vazia permite a tentativa automática; vozes tardias passam a ser selecionadas', () => {
  const vozes = [];
  const { narrador, synth, handlers } = ambiente(vozes);
  assert.equal(narrador.falar('Olá'), true);
  assert.equal(synth.calls[0].voice, undefined);
  vozes.push(voz);
  handlers.voiceschanged();
  narrador.falar('Outra fala');
  assert.equal(synth.calls[1].voice, voz);
});

test('sem sintetizador ou construtor não tenta reproduzir', () => {
  const narrador = new NarradorTrechos(null, FraseFalsa);
  assert.equal(narrador.disponivel, false);
  assert.equal(narrador.falar('Oi'), false);
});

test('erro no modo automático informa a falha e interrompe sem enfileirar mais falas', () => {
  const { narrador, synth } = ambiente([]);
  narrador.falar('Um texto grande. '.repeat(30));
  const primeira = synth.calls[0];
  primeira.onerror({ error: 'voice-unavailable' });
  assert.equal(narrador.estado, 'erro');
  assert.match(narrador.mensagem, /voice-unavailable/);
  const total = synth.calls.length;
  primeira.onend();
  assert.equal(synth.calls.length, total);
});

test('erro do sintetizador cancela estado sem reproduzir outras partes', () => {
  const { narrador, synth } = ambiente();
  narrador.falar('texto. '.repeat(80));
  const primeiro = synth.calls[0];
  primeiro.onerror({ error: 'synthesis-failed' });
  assert.equal(narrador.estado, 'erro');
  const qt = synth.calls.length;
  primeiro.onend();
  assert.equal(synth.calls.length, qt);
});

test('permite escolher outra voz brasileira e ajustar velocidade', () => {
  const outra = { name: 'Segunda voz', lang: 'pt-BR', voiceURI: 'outra' };
  const { narrador, synth } = ambiente([voz, outra, {name:'Inglês', lang:'en-US', voiceURI:'en'}]);
  assert.equal(narrador.vozes.length, 2);
  assert.equal(narrador.selecionarVoz('outra'), true);
  assert.equal(narrador.ajustarVelocidade(1.5), true);
  narrador.falar('Oi');
  assert.equal(synth.calls[0].rate, 1.5);
  assert.equal(synth.calls[0].voice, outra);
});

test('se a pausa encerrar uma fala, retoma a mesma parte sem sobreposição', () => {
  const { narrador, synth } = ambiente();
  narrador.falar('Um trecho mais longo. '.repeat(20));
  narrador.pausarOuContinuar();
  synth.calls[0].onend();
  assert.equal(synth.calls.length, 1);
  narrador.pausarOuContinuar();
  assert.equal(synth.calls.length, 2);
  assert.equal(synth.calls[1].text, synth.calls[0].text);
});
