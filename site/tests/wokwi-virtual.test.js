const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const fw = fs.readFileSync(path.join(root,'esp/robo_literario_codigo.ino'),'utf8');
const sk = fs.readFileSync(path.join(root,'esp/wokwi/sketch.ino'),'utf8');
const diagram = JSON.parse(fs.readFileSync(path.join(root,'esp/wokwi/diagram.json'),'utf8'));
const html = fs.readFileSync(path.join(root,'site/painel/index.html'),'utf8');
const site = fs.readFileSync(path.join(root,'site/painel/wifi-config.js'),'utf8');
test('sketch gerado a partir do firmware físico', () => {
  const hdr = '// ARQUIVO GERADO: edite esp/robo_literario_codigo.ino, nunca este.\n// Para atualizar: python esp/wokwi/gerar_sketch.py\n#define ROBO_SIMULADOR_WOKWI 1\n\n';
  assert.equal(sk,hdr+fw);
  assert.doesNotMatch(fw,/#define ROBO_SIMULADOR_WOKWI 1/);
});
test('simulador mantém POST fictício, sem Supabase e passa pelo QR normal', () => {
  assert.match(fw,/void gerenciarSerialVirtual\(\)/);
  assert.match(fw,/bool lerQRCode\(String& resultado\) \{\s*#ifdef ROBO_SIMULADOR_WOKWI/);
  assert.match(fw,/#ifdef ROBO_SIMULADOR_WOKWI\s*\/\/ NÃO chama a API/);
  assert.match(fw,/postSimuladoLiberado = false/);
  assert.match(fw,/SIM:QR:\{\\"t\\":\\"wifi-auth/);
  assert.doesNotMatch(fw,/SIM:CONFIG|PIN_WIFI_CONFIG/);
});
test('Wokwi removeu botão CONFIG sem mudar LEDs e buzzer', () => {
  assert.ok(diagram.parts.some(p=>p.type==='board-esp32-devkit-c-v4'));
  assert.ok(!diagram.parts.some(p=>p.id==='config'));
  const conexoes=diagram.connections.map(e=>e.slice(0,2).join(' ')).join('\n');
  assert.doesNotMatch(conexoes,/config:/);
  for(const pin of ['13','2','14']) assert.match(conexoes,new RegExp('esp:'+pin));
  assert.equal(diagram.serialMonitor.newline,'lf');
  assert.match(fs.readFileSync(path.join(root,'esp/wokwi/partitions.csv'),'utf8'), /spiffs,\s+data, spiffs/);
});
test('Wokwi fica fora da interface da professora e cópia técnica segue restrita', () => {
  assert.doesNotMatch(html,/wifi-copiar-wokwi/);
  assert.match(site,/dados\.k==='87654321'/);
  assert.match(site,/dados\.s==='Wokwi-GUEST'/);
  assert.match(site,/navigator\.clipboard\.writeText\('SIM:QR:'\+qrAtual\)/);
  assert.doesNotMatch(site,/\bfetch\(|\bXMLHttpRequest|\bsendBeacon|localStorage/);
});
