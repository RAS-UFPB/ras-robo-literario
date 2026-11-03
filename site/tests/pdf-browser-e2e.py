"""Teste local de interface com PDF real e respostas HTTP simuladas; não acessa o Storage real."""
import base64, os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1] / 'painel'
def pdf_de_teste():
    """PDF sintético de três páginas, gerado só em memória."""
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>',
            b'<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>']
    for i in range(3):
        content = f'BT /F1 22 Tf 60 700 Td (Pagina {i + 1} de 3) Tj ET'.encode()
        objs.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4+2*i} 0 R /Resources << /Font << /F1 9 0 R >> >> >>'.encode(),
                    b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream'])
    objs.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    out = bytearray(b'%PDF-1.4\n'); offsets = [0]
    for i, obj in enumerate(objs,1):
        offsets.append(len(out)); out.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
    xref = len(out); out.extend(f'xref\n0 {len(offsets)}\n'.encode()+b'0000000000 65535 f \n')
    for pos in offsets[1:]: out.extend(f'{pos:010d} 00000 n \n'.encode())
    out.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(out)

PDF_TESTE = pdf_de_teste()
CONTOS=[{'id':'sete-corvos','titulo':'Os Sete Corvos','autor':'Irmãos Grimm','resumo':'', 'possuiPdf':True, 'perguntas':[{'id':1,'ordem':1,'pergunta':'Quem são os protagonistas?','resposta':'Os irmãos.'}], 'dicas':[],'desafios':[], 'trechos':[{'id':1,'letra':'A','ordemCorreta':1,'texto':'Um trecho de teste.'}]},{'id':'sem-pdf','titulo':'Sem PDF','autor':'','resumo':'','possuiPdf':False,'perguntas':[],'dicas':[],'desafios':[],'trechos':[]}]

def executar():
 assert PDF_TESTE.startswith(b'%PDF-')
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path=os.getenv('CHROMIUM_BIN','/usr/bin/chromium'),args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1280,'height':800})
  errors=[]
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.set_content((ROOT/'index.html').read_text(encoding='utf8'), wait_until='domcontentloaded')
  page.add_style_tag(content=(ROOT/'style.css').read_text(encoding='utf8'))
  from_base64=base64.b64encode(PDF_TESTE).decode('ascii')
  page.evaluate(r"""([contos,arquivo]) => {
    window.__falsoPDF=Uint8Array.from(atob(arquivo),ch=>ch.charCodeAt(0));
    window.__fakeContos=contos;
    window.__pdfGet=0; window.__pdfPut=0; window.__pdfDelete=0;
    window.fetch=async (url, options={}) => {
      if (url === '/api/contos') return new Response(JSON.stringify({contos: window.__fakeContos}), {status:200, headers:{'Content-Type':'application/json'}});
      if (/^\/api\/contos\/[^/]+\/pdf$/.test(url)) {
        if (options.method === 'PUT') { window.__pdfPut++; window.__fakeContos[0].possuiPdf=true; return new Response(JSON.stringify({possuiPdf:true}), {status:200, headers:{'Content-Type':'application/json'}}); }
        if (options.method === 'DELETE') { window.__pdfDelete++; window.__fakeContos[0].possuiPdf=false; return new Response(JSON.stringify({possuiPdf:false}), {status:200, headers:{'Content-Type':'application/json'}}); }
        window.__pdfGet++; return new Response(window.__falsoPDF, {status:200, headers:{'Content-Type':'application/pdf'}});
      }
      if (url === '/api/auth/login') return new Response(JSON.stringify({token:'fake-admin-token'}), {status:200, headers:{'Content-Type':'application/json'}});
      const responses={
        '/api/atividade':{atividadeId:null,frases:[]},'/api/placar':{placar:[]},'/api/leituras':{leituras:[]},'/api/ping':{ok:true},'/api/qr/latest':{},'/api/esp/importacao/status':{},'/api/acervo/atividades':{atividades:[]}
      };
      return new Response(JSON.stringify(responses[url] ?? {}), {status:200,headers:{'Content-Type':'application/json'}});
    }
  }""", [CONTOS,from_base64])
  for js in ['qr-local.js','wifi-config.js','narracao.js','app.js','acervo.js']:
   page.add_script_tag(content=(ROOT/js).read_text(encoding='utf8'))
  page.evaluate('(async () => await window.onload())()')
  page.locator('[data-page="contos"]').click()
  page.evaluate('abrirApresentacao()')
  assert page.locator('#presentation-question').is_visible()
  page.locator('#presentation-modo-pdf').click()
  page.wait_for_function("document.getElementById('presentation-pdf-frame').src.startsWith('blob:')")
  assert page.locator('#presentation-pdf').is_visible()
  assert page.locator('#presentation-question').is_hidden()
  assert page.locator('#presentation-controls').is_hidden()
  assert page.locator('#presentation-pdf-aviso').is_hidden()
  assert page.evaluate('window.__pdfGet') > 0
  # O leitor ocupa a área útil com seu próprio contexto de rolagem.
  width,height=page.locator('#presentation-pdf-frame').evaluate('(el)=>[el.getBoundingClientRect().width,el.getBoundingClientRect().height]')
  assert width>800 and height>350, (width,height)
  assert page.locator('.presentation-exit').is_visible()
  assert page.locator('.presentation-tool-dica').is_visible()
  assert page.evaluate('!!document.fullscreenElement || document.getElementById("presentation-stage").classList.contains("presentation-fallback")')
  if os.getenv('GUARDAR_CAPTURAS'): page.screenshot(path='/mnt/data/pdf_impl/pdf-desktop.png')
  page.locator('#presentation-modo-pergunta').click()
  assert page.locator('#presentation-question').is_visible()
  assert page.locator('#presentation-pdf').is_hidden()
  assert not page.locator('#presentation-pdf-frame').get_attribute('src')
  page.locator('#presentation-modo-trechos').click()
  assert page.locator('#presentation-trechos').is_visible()
  page.locator('#presentation-modo-pdf').click()
  page.wait_for_function("document.getElementById('presentation-pdf-frame').src.startsWith('blob:')")
  assert page.locator('#presentation-trechos').is_hidden()
  page.locator('.presentation-exit').click()
  assert page.locator('#presentation-stage').is_hidden()
  page.locator('#conto-select').select_option('sem-pdf')
  page.evaluate('abrirApresentacao()')
  page.locator('#presentation-modo-pdf').click()
  assert 'ainda não possui PDF' in page.locator('#presentation-pdf-aviso').inner_text()
  page.locator('.presentation-exit').click()
  # PDF manager: seleciona conto, substitui/remove, sem enviar chave do Supabase pelo navegador.
  page.evaluate('abrirGerenciadorConteudo()')
  page.locator('#gerenciar-conto-select').select_option('sete-corvos')
  assert page.locator('#gerenciar-pdf-remover').is_visible()
  page.locator('#gerenciar-pdf-arquivo').set_input_files({'name':'conto.pdf','mimeType':'application/pdf','buffer':PDF_TESTE})
  page.on('dialog',lambda d:d.accept('admin-teste'))
  page.locator('#gerenciar-pdf-enviar').click()
  page.wait_for_function('window.__pdfPut===1')
  assert page.locator('#gerenciar-pdf-remover').is_visible()
  page.locator('#gerenciar-pdf-remover').click()
  page.wait_for_function('window.__pdfDelete===1')
  page.wait_for_function("document.getElementById('gerenciar-pdf-remover').hidden")
  assert page.locator('#gerenciar-pdf-remover').is_hidden()
  assert not errors, errors
  page.evaluate('fecharGerenciadorConteudo()')
  page.set_viewport_size({'width':390,'height':844})
  page.locator('#conto-select').select_option('sete-corvos')
  page.evaluate('abrirApresentacao()')
  page.locator('#presentation-modo-pdf').click()
  assert page.locator('#presentation-pdf-aviso').is_visible()  # Removido na etapa anterior
  assert page.locator('.presentation-exit').is_visible()
  # A seção permanece dentro do palco, sem ultrapassar limites horizontais.
  assert page.locator('#presentation-pdf').evaluate('(el)=>el.getBoundingClientRect().right <= innerWidth+2')
  browser.close()
 print('PASS: PDF real carregado no iframe, tela cheia, alternância com pergunta/trechos, gerenciamento simulado, aviso de ausência e responsividade')

if __name__ == '__main__': executar()
