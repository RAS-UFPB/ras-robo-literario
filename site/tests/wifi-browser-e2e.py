"""Testa gerador QR no Chromium sem backend / Supabase. Requer playwright e cv2.
Uso: python tests/wifi-browser-e2e.py
"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import cv2
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / 'painel'
with TemporaryDirectory() as pasta, sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=2)
    requests, errors = [], []
    page.on('request', lambda req: requests.append(req.url))
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.set_content((ROOT / 'index.html').read_text(encoding='utf8'), wait_until='domcontentloaded')
    page.add_style_tag(content=(ROOT / 'style.css').read_text(encoding='utf8'))
    page.add_script_tag(content=(ROOT / 'qr-local.js').read_text(encoding='utf8'))
    page.add_script_tag(content=(ROOT / 'wifi-config.js').read_text(encoding='utf8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")

    def decodificar_qr():
        arquivo = Path(pasta)/'codigo.png'
        page.locator('#wifi-qr-area svg').screenshot(path=str(arquivo))
        imagem = cv2.imread(str(arquivo))
        detector = cv2.QRCodeDetector()
        texto, _, _ = detector.detectAndDecode(imagem)
        if not texto:
            for tamanho in (320, 160, 480):
                mini = cv2.resize(imagem, (tamanho, tamanho), interpolation=cv2.INTER_AREA)
                texto, _, _ = detector.detectAndDecode(mini)
                if texto: break
        assert texto, 'QR não foi decodificado'
        return json.loads(texto)

    page.locator('#wifi-ssid').fill('Escola Ação')
    page.locator('#wifi-senha').fill('ação12345')
    page.locator('#wifi-pin').fill('12345678')
    page.locator('#wifi-config-form button[type=submit]').click()
    assert decodificar_qr()=={'t':'wifi','s':'Escola Ação','p':'ação12345','k':'12345678'}
    assert page.locator('#wifi-senha').input_value()==''
    assert page.locator('#wifi-pin').input_value()==''
    # A professora não vê atalhos técnicos do Wokwi nesta versão.
    assert not page.locator('#wifi-copiar-wokwi').count()
    assert 'Wokwi' not in page.locator('#configuracao-wifi-esp').inner_text()

    # PIN curto não pode entrar no QR do primeiro uso.
    page.locator('#wifi-pin').fill('1234')
    page.locator('#wifi-config-form button[type=submit]').click()
    assert 'PIN' in page.locator('#wifi-config-status').inner_text()
    assert not page.locator('#wifi-config-resultado').is_visible()

    page.locator('#wifi-tipo').select_option('trocar')
    assert page.locator('#wifi-gerar-autorizacao').is_visible()
    page.locator('#wifi-pin').fill('87654321')
    page.locator('#wifi-gerar-autorizacao').click()
    assert decodificar_qr()=={'t':'wifi-auth','k':'87654321'}
    page.locator('#wifi-ssid').fill('Wokwi-GUEST')
    page.locator('#wifi-senha').fill('')
    page.locator('#wifi-config-form button[type=submit]').click()
    assert decodificar_qr()=={'t':'wifi','s':'Wokwi-GUEST','p':''}
    page.locator('#wifi-tipo').select_option('primeiro')
    page.locator('#wifi-pin').fill('87654321')
    page.locator('#wifi-config-form button[type=submit]').click()
    assert decodificar_qr()=={'t':'wifi','s':'Wokwi-GUEST','p':'','k':'87654321'}
    page.locator('#wifi-apagar-qr').click()
    assert not page.locator('#wifi-config-resultado').is_visible()
    assert all(url.startswith('https://fonts.googleapis.com/') for url in requests), f'Requisições inesperadas: {requests}'
    assert not any('12345678' in url or 'ação12345' in url for url in requests)
    assert not errors, errors
    browser.close()
print('PASS: Primeiro uso, autorização, troca, QR decodificado, PIN inválido, sem atalho Wokwi na interface e sem requisições.')
