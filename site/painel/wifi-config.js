/* QR de Wi-Fi e autorização, gerados localmente. Nunca transfere credenciais à API.
 * Site não sabe se a ESP leu o QR: só dispositivo/Monitor Serial pode confirmar.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  let limparDepois = null;
  let qrAtual = null;
  const tempoVisivel = 90000;

  function status(texto, erro = false) {
    const el = $('wifi-config-status');
    if (!el) return;
    el.textContent = texto;
    el.style.color = erro ? 'var(--red)' : 'var(--text-muted)';
  }
  function apagarQR() {
    if (limparDepois) clearTimeout(limparDepois);
    limparDepois = null;
    $('wifi-qr-area')?.replaceChildren();
    if ($('wifi-qr-area')) $('wifi-qr-area').hidden = true;
    if ($('wifi-config-resultado')) $('wifi-config-resultado').hidden = true;
    qrAtual = null;
    if ($('wifi-senha')) $('wifi-senha').value = '';
    if ($('wifi-pin')) $('wifi-pin').value = '';
  }
  function construirSvg(matriz) {
    const borda = 4, n = matriz.length, view = n + 2 * borda;
    const svg = document.createElementNS(NS, 'svg');
    for (const [k,v] of Object.entries({viewBox:`0 0 ${view} ${view}`,role:'img',
      'aria-label':'QR temporário confidencial de configuração do robô',
      'shape-rendering':'crispEdges'})) svg.setAttribute(k,v);
    const bg = document.createElementNS(NS,'rect');
    for (const [k,v] of Object.entries({x:0,y:0,width:view,height:view,fill:'#ffffff'})) bg.setAttribute(k,v);
    svg.appendChild(bg);
    let caminho='';
    for (let y=0;y<n;y++) for(let x=0;x<n;x++) if(matriz[y][x]) caminho += `M${x+borda} ${y+borda}h1v1h-1z`;
    const path=document.createElementNS(NS,'path');
    path.setAttribute('d',caminho);
    path.setAttribute('fill','#111111');
    svg.appendChild(path);
    return svg;
  }
  function exibir(payload, mensagem) {
    try {
      if (typeof window.RoboQRCodeMatrix !== 'function') throw new Error('Sem gerador');
      if (new TextEncoder().encode(payload).length > 240) {
        status('QR grande demais. Reduza os dados.', true); return;
      }
      const qr=construirSvg(window.RoboQRCodeMatrix(payload));
      const el=$('wifi-qr-area');
      apagarQR();
      el.replaceChildren(qr);
      el.hidden=false;
      $('wifi-config-resultado').hidden=false;
      qrAtual=payload;
      limparDepois=setTimeout(() => { apagarQR();status('QR ocultado automaticamente. Gere outro se precisar.'); }, tempoVisivel);
      status(mensagem);
    } catch (_) { apagarQR(); status('Não foi possível gerar o QR. Confira o gerador local.', true); }
  }
  function pinValido(pin) { return /^[0-9]{8,12}$/.test(pin); }
  function tipo() { return $('wifi-tipo')?.value || 'primeiro'; }
  function gerarAutorizacao() {
    const pin=$('wifi-pin')?.value || '';
    if (tipo() !== 'trocar') { status('A autorização só é necessária para trocar uma rede já cadastrada.', true); return; }
    if (!pinValido(pin)) { status('Informe o PIN de 8 a 12 números criado na primeira configuração.', true); return; }
    exibir(JSON.stringify({t:'wifi-auth',k:pin}), 'Mostre primeiro este QR à câmera, fora de uma atividade. Depois gere o QR da nova rede dentro de 3 minutos.');
  }
  function gerarQR(evento) {
    evento.preventDefault();
    const ssid=$('wifi-ssid')?.value || '';
    const senha=$('wifi-senha')?.value || '';
    const pin=$('wifi-pin')?.value || '';
    const enc=new TextEncoder();
    if (!ssid || enc.encode(ssid).length > 32 || ssid.includes('\u0000')) {
      apagarQR();status('Informe um nome de rede (até 32 bytes).', true);return;
    }
    if (senha.includes('\u0000') || !(senha === '' ||
         (enc.encode(senha).length>=8 && enc.encode(senha).length<=63) ||
         (senha.length===64 && /^[0-9a-fA-F]{64}$/.test(senha)))) {
      apagarQR();status('Senha Wi-Fi inválida: use 8 a 63 bytes, 64 hexadecimais ou deixe vazia para rede aberta.',true);return;
    }
    if (tipo()==='primeiro' && !pinValido(pin)) {
      apagarQR(); status('No primeiro uso, crie um PIN de 8 a 12 números e guarde-o.',true);return;
    }
    const dados={t:'wifi',s:ssid,p:senha};
    if(tipo()==='primeiro') dados.k=pin;
    exibir(JSON.stringify(dados),tipo()==='primeiro'
      ? 'Primeiro cadastro: mostre o QR à câmera dentro de 3 minutos após ligar. Guarde o PIN para futuras mudanças.'
      : 'Troca de rede: mostre este QR à câmera depois que a ESP aceitar o QR de autorização.');
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('wifi-config-form')?.addEventListener('submit', gerarQR);
    $('wifi-gerar-autorizacao')?.addEventListener('click', gerarAutorizacao);
    $('wifi-tipo')?.addEventListener('change', () => {
      apagarQR();
      const troca=tipo()==='trocar';
      $('wifi-gerar-autorizacao').hidden=!troca;
      $('wifi-etapa-orientacao').textContent=troca
        ? '1. Sem atividade em andamento, gere e mostre o QR de autorização. 2. Depois, gere o QR da nova rede e mostre em até 3 minutos.'
        : '1. Ligue a ESP sem Wi-Fi cadastrado. 2. Crie um PIN (guarde-o!) e mostre o QR da rede à câmera em até 3 minutos.';
      status('O site não verifica a ESP. Confira bipes/LEDs ou Monitor Serial.');
    });
    $('wifi-apagar-qr')?.addEventListener('click',()=> {apagarQR();status('QR ocultado. Dados não enviados ao site.');});
    $('wifi-copiar-wokwi')?.addEventListener('click',async()=> {
      if(!qrAtual){status('Gere um QR primeiro.',true);return;}
      try {
        const dados=JSON.parse(qrAtual);
        // Só permitir credenciais fictícias no simulador, jamais PIN ou senha reais.
        const ambienteTeste=(dados.t==='wifi' && dados.s==='Wokwi-GUEST' && dados.p===''
          && (dados.k===undefined || dados.k==='87654321')) ||
          (dados.t==='wifi-auth' && dados.k==='87654321');
        if(!ambienteTeste){status('Para copiar ao Wokwi, use Wokwi-GUEST, senha vazia e PIN fictício 87654321. Não copie dados reais.',true);return;}
        await navigator.clipboard.writeText('SIM:QR:'+qrAtual);
        status('Comando de teste copiado. Cole no Monitor Serial do Wokwi e pressione Enter.');
      } catch(_) { status('Não foi possível copiar. Use localhost/HTTPS e autorize a área de transferência.',true); }
    });
    document.addEventListener('robo:fechar-wifi',()=>{if(qrAtual) apagarQR();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden && qrAtual) apagarQR();});
  });
})();
