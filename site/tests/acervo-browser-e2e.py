"""Teste de navegador com dados simulados, sem acesso ao Supabase.
Execute: python tests/acervo-browser-e2e.py
Requer Playwright Python e Chromium instalado.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / 'painel'
TRECHOS = [
    {'id': 11, 'letra': 'A', 'ordemCorreta': 1, 'texto': 'Era uma vez a floresta com muitos animais.'},
    {'id': 12, 'letra': 'B', 'ordemCorreta': 2, 'texto': 'Todos se reuniram para ouvir uma história.'},
]
CONTOS = [
    {'id': 'conto-floresta', 'titulo': 'A Floresta', 'autor': 'Autora A', 'resumo': 'Um conto para crianças.',
     'perguntas': [{'id': 20, 'ordem': 1, 'pergunta': 'Quem vivia na floresta?', 'resposta': 'Os animais.'}],
     'dicas': [{'id': 21, 'ordem': 1, 'texto': 'Observe as árvores.', 'trechoId': 11, 'trechoLetra': 'A'}],
     'desafios': [{'id': 22, 'ordem': 1, 'texto': 'Desenhe a floresta.', 'momento': 'Abertura'}], 'trechos': TRECHOS},
    {'id': 'conto-sem-conteudo', 'titulo': 'Conto Vazio', 'autor': '', 'resumo': '',
     'perguntas': [], 'dicas': [], 'desafios': [], 'trechos': []}
]
ATIVIDADES = [
    {'id': 18, 'ativa': True, 'textoAlvo': 'Texto', 'createdAt': '2026-11-01T12:00:00Z',
     'contosCompativeisIds': ['conto-floresta'],
     'frases': [{'id': 111, 'indice': i + 1, 'codigoBinario': f'000{i}', 'texto': t['texto']} for i, t in enumerate(TRECHOS)]},
    {'id': 19, 'ativa': False, 'textoAlvo': 'Outro texto', 'createdAt': '2026-10-28T12:00:00Z',
     'contosCompativeisIds': [], 'frases': [{'id': 123, 'indice': 1, 'codigoBinario': '0000', 'texto': 'Texto próprio de outra atividade.'}]}
]

FAKE_SPEECH = r'''
(() => {
  const calls = [];
  const voices = [{name:'Voz BR de teste', lang:'pt-BR', voiceURI:'br-test'}];
  const synth = {
    calls, cancelCount: 0, pauseCount:0, resumeCount:0,
    getVoices(){return voices;},
    addEventListener(event, fn){this[`on_${event}`]=fn;},
    speak(utterance){calls.push(utterance);},
    cancel(){this.cancelCount++;},
    pause(){this.pauseCount++;}, resume(){this.resumeCount++;}
  };
  Object.defineProperty(window, 'speechSynthesis', {configurable:true, value:synth});
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable:true, value:class {constructor(text){this.text=text;}}});
  window.__tts = {synth, voices};
})();
'''

def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM_BIN', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.set_default_timeout(8000)
        # Neste ambiente, Chromium bloqueia navegação HTTP/file.
        # Carregamos HTML/CSS/JS reais em um documento em memória.
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        page.set_content(html, wait_until='domcontentloaded')
        page.add_style_tag(content=(ROOT / 'style.css').read_text(encoding='utf-8'))
        page.evaluate(FAKE_SPEECH)
        api = {'/api/contos': {'contos': CONTOS},
               '/api/acervo/atividades': {'atividades': ATIVIDADES},
               '/api/atividade': {'atividadeId': 18, 'frases': ATIVIDADES[0]['frases'], 'total': 2},
               '/api/placar': {'placar': []}, '/api/leituras': {'leituras': []},
               '/api/ping': {'ok': True}, '/api/qr/latest': None,
               '/api/esp/importacao/status': {}}
        page.evaluate(f"""(() => {{
          const api = {json.dumps(api)};
          window.fetch = async (url, options) => new Response(JSON.stringify(api[url] ?? {{}}),
            {{status: 200, headers: {{'Content-Type':'application/json'}}}});
        }})();""")
        page.on('pageerror', lambda e: errors.append(str(e)))
        for file in ['qr-local.js', 'wifi-config.js', 'narracao.js', 'app.js', 'acervo.js']:
            page.add_script_tag(content=(ROOT / file).read_text(encoding='utf-8'))
        page.evaluate('(async () => await window.onload())()')
        assert page.locator('#detalhes-atividade-ativa').is_visible()
        assert page.locator('#detalhes-atividade-ativa').get_attribute('open') is None
        assert 'Era uma vez a floresta' not in page.locator('#status-frase-alvo').inner_text()
        if os.getenv('GUARDAR_CAPTURAS'): page.screenshot(path='/mnt/data/robo_dashboard_limpo_qa.png', full_page=True)
        page.locator('[data-page="acervo"]').click()
        page.wait_for_function('document.getElementById("acervo-atividade").options.length === 2')
        assert page.locator('#acervo-titulo').inner_text() == 'A Floresta'
        assert page.locator('#dashboard-iniciar-trechos').is_enabled()
        assert 'A Floresta' in page.locator('#dashboard-conto-trechos').inner_text()
        assert not page.locator('#wifi-copiar-wokwi').count()
        assert not page.locator('.trechos-card').count()

        if os.getenv('GUARDAR_CAPTURAS'): page.screenshot(path='/mnt/data/acervo_qa.png', full_page=True)
        assert 'Era uma vez a floresta' in page.locator('#acervo-trechos').inner_text()
        assert 'Os animais.' in page.locator('#acervo-perguntas').inner_text()
        assert 'trecho A' in page.locator('#acervo-dicas').inner_text()
        assert 'Desenhe a floresta.' in page.locator('#acervo-desafios').inner_text()
        assert 'ainda não disponível' in page.locator('#acervo-pdf-status').inner_text()
        page.locator('#acervo-atividade').select_option('18')
        assert 'atividade preparada' in page.locator('#acervo-vinculo').inner_text()
        assert 'Bloco 1' in page.locator('#acervo-blocos-atividade').inner_text()
        assert '19' not in page.locator('#acervo-atividade').inner_text()
        assert page.locator('#acervo-apresentar').is_enabled()
        page.locator('#acervo-atividade').select_option('18')
        page.locator('#acervo-apresentar').click()
        assert page.locator('#presentation-stage').is_visible()
        assert page.locator('#presentation-trechos').is_visible()
        if os.getenv('GUARDAR_CAPTURAS'): page.screenshot(path='/mnt/data/apresentacao_qa.png')
        page.locator('#narracao-reproduzir').click()
        assert page.evaluate('window.__tts.synth.calls[0].text') == TRECHOS[0]['texto']
        page.locator('#narracao-pausar').click()
        assert page.evaluate('window.__tts.synth.pauseCount') == 1
        page.locator('#narracao-pausar').click()
        assert page.evaluate('window.__tts.synth.resumeCount') == 1
        cancels = page.evaluate('window.__tts.synth.cancelCount')
        page.locator('#presentation-trecho-select').select_option('1')
        assert page.evaluate('window.__tts.synth.cancelCount') > cancels
        assert page.locator('#narracao-pausar').is_disabled()
        page.locator('#narracao-reproduzir').click()
        assert page.evaluate('window.__tts.synth.calls.at(-1).text') == TRECHOS[1]['texto']
        page.locator('#narracao-parar').click()
        assert page.locator('#narracao-pausar').is_disabled()
        page.locator('#narracao-reproduzir').click()
        page.locator('#presentation-modo-trechos').click()
        assert page.locator('#presentation-question').is_visible()
        assert page.locator('#narracao-pausar').is_disabled()
        page.locator('#presentation-modo-trechos').click()
        page.locator('#narracao-reproduzir').click()
        page.locator('.presentation-exit').click()
        assert page.locator('#presentation-stage').is_hidden()
        assert page.evaluate('window.__tts.synth.cancelCount') >= 6
        page.locator('[data-page="acervo"]').click()
        page.locator('#acervo-conto').select_option('conto-sem-conteudo')
        assert 'Nenhum trecho cadastrado' in page.locator('#acervo-trechos').inner_text()
        assert 'Nenhuma pergunta cadastrada' in page.locator('#acervo-perguntas').inner_text()
        assert 'Nenhuma dica cadastrada' in page.locator('#acervo-dicas').inner_text()
        assert 'Nenhum desafio cadastrado' in page.locator('#acervo-desafios').inner_text()
        # Desktop: seção do acervo não ultrapassa o viewport horizontal.
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.locator('#acervo-conto').select_option('conto-floresta')
        page.locator('#acervo-apresentar').click()
        assert page.locator('#presentation-trechos').is_visible()
        assert page.locator('#narracao-reproduzir').is_visible()
        page.locator('#narracao-velocidade').select_option('1.25')
        page.locator('#narracao-reproduzir').click()
        assert page.evaluate('window.__tts.synth.calls.at(-1).rate') == 1.25
        # Sem vozes enumeradas, permite tentar a voz automática (sem garantir áudio audível).
        page.evaluate('window.__tts.voices.splice(0); window.__tts.synth.on_voiceschanged()')
        assert page.locator('#narracao-reproduzir').is_enabled()
        assert 'Automática' in page.locator('#narracao-voz').inner_text()
        page.locator('#narracao-reproduzir').click()
        assert page.evaluate('window.__tts.synth.calls.at(-1).lang') == 'pt-BR'
        assert page.evaluate('window.__tts.synth.calls.at(-1).voice == null')
        # Encerrar atividade desmarca a atividade no mock e remove a antiga da página.
        page.locator('.presentation-exit').click()
        page.locator('[data-page="dashboard"]').click()
        page.on('dialog', lambda dialog: dialog.accept())
        page.evaluate('''(() => {
          const anterior = window.fetch;
          window.fetch = (url, options) => {
            if (url === '/api/atividade/encerrar') {
              window.__encerrada = true;
              return Promise.resolve(new Response(JSON.stringify({encerradas:1}),
                {status:200, headers:{'Content-Type':'application/json'}}));
            }
            if (url === '/api/atividade' && window.__encerrada)
              return Promise.resolve(new Response(JSON.stringify({atividadeId:null,frases:[]}),
                {status:200, headers:{'Content-Type':'application/json'}}));
            return anterior(url,options);
          };
        })()''')
        page.locator('#dashboard-encerrar-atividade').click()
        page.wait_for_function('document.getElementById("dashboard-encerrar-atividade").hidden === true')
        assert 'Nenhuma atividade em andamento' in page.locator('#status-frase-alvo').inner_text()
        assert page.locator('#qr-inicio-esp').is_hidden()
        # Atenção: a síntese é simulada; não alegar áudio realmente ouvido.
        assert not errors, errors
        browser.close()
    print('OK: acervo, associações, conteúdos vazios, PDF indisponível, navegação, narração simulada, cancelamento, responsividade e sem erros JS')

if __name__ == '__main__':
    main()
