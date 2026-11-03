const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const painel = path.join(__dirname, '..', 'painel');
const firmware = fs.readFileSync(path.join(__dirname, '..', '..', 'esp', 'robo_literario_codigo.ino'), 'utf8');
const html = fs.readFileSync(path.join(painel, 'index.html'), 'utf8');
const wifi = fs.readFileSync(path.join(painel, 'wifi-config.js'), 'utf8');
function matrix(payload) {
  const ctx = {window: {}, TextEncoder};
  vm.runInNewContext(fs.readFileSync(path.join(painel, 'qr-local.js'),'utf8'), ctx);
  return ctx.window.RoboQRCodeMatrix(payload);
}
test('QRs do primeiro uso, autorização e troca são UTF-8 e locais', () => {
  for (const payload of [
    JSON.stringify({t:'wifi',s:'Escola Ação',p:'opção12345',k:'87654321'}),
    JSON.stringify({t:'wifi-auth',k:'87654321'}),
    JSON.stringify({t:'wifi',s:'Outra Escola',p:'SenhaNova123'})
  ]) {
    const grid=matrix(payload);
    assert.ok(grid.length>=21 && grid.length<=177);
    assert.ok(grid.every(row => row.length===grid.length));
  }
});
test('interface não envia segredos ao servidor, não confunde API com ESP', () => {
  assert.match(html,/Conexão API/);
  assert.match(html,/não verificado pelo painel/);
  assert.match(html,/id="wifi-gerar-autorizacao"/);
  assert.match(html,/id="wifi-tipo"/);
  assert.match(wifi, /evento\.preventDefault\(\)/);
  assert.match(wifi, /pinValido/);
  assert.match(wifi,/dados\.k=pin/);
  assert.match(wifi,/t:'wifi-auth',k:pin/);
  assert.doesNotMatch(wifi,/\bfetch\(|\bXMLHttpRequest|\bsendBeacon|localStorage|sessionStorage/);
});
test('firmware mantém cenário A, autenticação com salt e nunca PIN em texto puro', () => {
  for (const t of ['"inicio"','"equipe"','"carta"','"fim"']) assert.ok(firmware.includes(t));
  for (const x of ['#define FLASH_FILE    "/sessao.json"','http.POST(body)','Preferences prefs;',
                   'registrarProgresso()','salvarEmFlash()','restaurarProgresso()',
                   'mbedtls_md(','esp_random()','MAX_FALHAS_PIN','BLOQUEIO_PIN_MS',
                   'processarAutorizacaoWiFi(payload)','wifiPinHash']) assert.ok(firmware.includes(x),x);
  assert.doesNotMatch(firmware,/PIN_WIFI_CONFIG|gerenciarBotaoWiFi|SIM:CONFIG/);
  assert.match(firmware,/estado == ENVIANDO && envioPendente/);
  assert.match(firmware,/strcmp\(tipo, "wifi-auth"\)/);
});
