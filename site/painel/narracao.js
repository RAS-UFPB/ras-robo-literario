/* Motor único de narração. Sem armazenamento de áudio e sem serviços externos. */
(function (root) {
  'use strict';

  // Conserva TODOS os caracteres do texto original, inclusive pontuação e espaços.
  // Cortes curtos evitam falhas com falas muito extensas em alguns navegadores.
  function dividirTexto(texto, limite = 180) {
    const original = String(texto ?? '');
    const partes = [];
    let posicao = 0;
    while (posicao < original.length) {
      let fim = Math.min(posicao + limite, original.length);
      if (fim < original.length) {
        const parte = original.slice(posicao, fim);
        const pausa = Math.max(parte.lastIndexOf('. '), parte.lastIndexOf('! '), parte.lastIndexOf('? '));
        const espaco = parte.lastIndexOf(' ');
        if (pausa > Math.floor(limite / 3)) fim = posicao + pausa + 2;
        else if (espaco > Math.floor(limite / 3)) fim = posicao + espaco + 1;
      }
      partes.push(original.slice(posicao, fim));
      posicao = fim;
    }
    return partes;
  }

  class NarradorTrechos {
    constructor(synth, Utterance) {
      this.synth = synth || null;
      this.Utterance = Utterance || null;
      this.vozes = [];
      this.vozId = '';
      this.velocidade = 1;
      this.estado = 'parado';
      this.mensagem = 'Pronto para ouvir.';
      this.geracao = 0;
      this.partes = [];
      this.indice = 0;
      this.reiniciarParteAoContinuar = false;
      this.usandoVozAutomatica = false;
      this.onChange = null;
      if (this.synth && typeof this.synth.addEventListener === 'function') {
        this.synth.addEventListener('voiceschanged', () => this.atualizarVozes());
      }
      this.atualizarVozes();
    }

    get disponivel() {
      // getVoices pode retornar [] mesmo que o sintetizador aceite um idioma.
      // Sem voz escolhida, a Web Speech API tenta a voz padrao para utterance.lang.
      return Boolean(this.synth && this.Utterance && typeof this.synth.speak === 'function');
    }

    notificar() {
      if (typeof this.onChange === 'function') this.onChange(this);
    }

    atualizarVozes() {
      const disponiveis = (this.synth && typeof this.synth.getVoices === 'function')
        ? this.synth.getVoices() : [];
      this.vozes = [...disponiveis].filter(voz =>
        String(voz.lang || '').replace('_', '-').toLowerCase() === 'pt-br'
      );
      if (!this.vozes.some(voz => voz.voiceURI === this.vozId)) {
        this.vozId = this.vozes[0]?.voiceURI || '';
      }
      const perdeuVozAtiva = !this.vozes.length && !this.usandoVozAutomatica
        && ['lendo', 'pausado'].includes(this.estado);
      if (perdeuVozAtiva) {
        this.parar();
        this.mensagem = 'A voz pt-BR ficou indisponível e a leitura parou. Tente novamente com a voz automática.';
      }
      if (this.estado === 'parado' && !perdeuVozAtiva) {
        this.mensagem = !this.synth || !this.Utterance
          ? 'Este navegador não oferece narração por voz.'
          : this.vozes.length ? 'Pronto para ouvir em português brasileiro.'
            : 'Sem voz pt-BR listada. É possível tentar a voz automática, mas o idioma e o áudio não são garantidos.';
      }
      this.notificar();
    }

    selecionarVoz(voiceURI) {
      if (!this.vozes.some(voz => voz.voiceURI === voiceURI)) return false;
      if (this.vozId !== voiceURI) this.parar();
      this.vozId = voiceURI;
      this.notificar();
      return true;
    }

    ajustarVelocidade(valor) {
      const velocidade = Number(valor);
      if (!Number.isFinite(velocidade) || velocidade < 0.5 || velocidade > 2) return false;
      this.velocidade = velocidade;
      // A velocidade será aplicada a uma nova leitura (não corta a fala atual).
      this.notificar();
      return true;
    }

    falar(texto) {
      this.parar();
      // Algumas vozes são carregadas depois de abrir a página, sem evento confiável.
      this.atualizarVozes();
      if (!this.disponivel) {
        this.estado = 'erro';
        this.mensagem = 'Este navegador não oferece o recurso de narração por voz.';
        this.notificar();
        return false;
      }
      if (!String(texto || '').trim()) {
        this.mensagem = 'Este trecho não possui texto cadastrado.';
        this.notificar();
        return false;
      }
      this.partes = dividirTexto(texto);
      this.indice = 0;
      this.reiniciarParteAoContinuar = false;
      this.usandoVozAutomatica = !this.vozes.length;
      this.estado = 'lendo';
      this.mensagem = this.usandoVozAutomatica
        ? 'Tentando voz automática com idioma pt-BR. O resultado depende do dispositivo…'
        : 'Lendo trecho…';
      const geracao = this.geracao;
      this.notificar();
      this.falarProximaParte(geracao);
      return true;
    }

    falarProximaParte(geracao) {
      if (geracao !== this.geracao || this.estado === 'parado') return;
      if (this.indice >= this.partes.length) {
        this.estado = 'parado';
        this.mensagem = 'Leitura concluída.';
        this.notificar();
        return;
      }
      const frase = new this.Utterance(this.partes[this.indice]);
      frase.lang = 'pt-BR';
      frase.rate = this.velocidade;
      const vozBrasileira = this.vozes.find(voz => voz.voiceURI === this.vozId) || this.vozes[0];
      // Não atribuir uma voz inexistente: o navegador pode escolher a padrão pt-BR.
      if (vozBrasileira) frase.voice = vozBrasileira;
      frase.onend = () => {
        if (geracao !== this.geracao) return;
        if (this.estado === 'pausado') {
          // Android pode encerrar a fala ao pausar: retoma esta parte desde o início.
          this.reiniciarParteAoContinuar = true;
          return;
        }
        this.indice += 1;
        this.falarProximaParte(geracao);
      };
      frase.onerror = (evento) => {
        if (geracao !== this.geracao) return;
        this.geracao += 1;
        this.estado = 'erro';
        this.partes = [];
        this.mensagem = `Não foi possível reproduzir a narração (${evento?.error || 'erro de voz'}). Verifique as vozes instaladas ou tente outro navegador.`;
        this.synth.cancel();
        this.notificar();
      };
      try {
        this.synth.speak(frase);
      } catch {
        frase.onerror({ error: 'indisponível' });
      }
    }

    pausarOuContinuar() {
      if (!this.synth) return;
      try {
        if (this.estado === 'lendo') {
          this.synth.pause();
          this.estado = 'pausado';
          this.mensagem = 'Leitura pausada.';
        } else if (this.estado === 'pausado') {
          this.synth.resume();
          this.estado = 'lendo';
          this.mensagem = 'Lendo trecho…';
          if (this.reiniciarParteAoContinuar) {
            this.reiniciarParteAoContinuar = false;
            this.falarProximaParte(this.geracao);
          }
        }
      } catch {
        this.parar();
        this.mensagem = 'Não foi possível pausar ou continuar neste dispositivo.';
      }
      this.notificar();
    }

    parar() {
      this.geracao += 1;
      this.partes = [];
      this.indice = 0;
      this.reiniciarParteAoContinuar = false;
      this.usandoVozAutomatica = false;
      this.estado = 'parado';
      if (this.synth) {
        try { this.synth.cancel(); } catch { /* mecanismo do dispositivo indisponível */ }
      }
      this.mensagem = this.vozes.length ? 'Leitura interrompida.'
        : this.disponivel ? 'Leitura interrompida. Voz automática disponível para tentativa.'
          : 'Recurso de voz indisponível neste navegador.';
      this.notificar();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NarradorTrechos, dividirTexto };
  }
  if (root) {
    root.NarradorTrechos = NarradorTrechos;
  }
})(typeof window !== 'undefined' ? window : null);
