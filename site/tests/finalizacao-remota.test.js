const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.resolve(__dirname, '../..');
const ler = caminho => fs.readFileSync(path.join(raiz, caminho), 'utf8');

test('RLS da tabela de comandos permite somente leitura anônima e escrita no backend', () => {
  const sql = ler('site/supabase/comandos_finalizacao_esp.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.comandos_esp/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.comandos_esp FROM anon, authenticated/);
  assert.match(sql, /GRANT SELECT ON public\.comandos_esp TO anon/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON public\.comandos_esp TO anon/);
  assert.match(sql, /expira_em > now\(\)/);
});

test('firmware consulta o comando sem alterar POST cenário A e Wokwi simula offline', () => {
  const fw = ler('esp/robo_literario_codigo.ino');
  const sketch = ler('esp/wokwi/sketch.ino');
  assert.match(fw, /#define CONSULTA_FIM_MS 5000/);
  assert.match(fw, /if \(estado != LENDO_CARTAS && estado != AGUARD_EQUIPE\) return;/);
  assert.match(fw, /if \(!temCartaLida\) return;/);
  assert.match(fw, /endpoint\.endsWith\("\/sessoes_esp"\)/);
  assert.match(fw, /comandos_esp\?select=comando&sessao_id=eq\./);
  assert.match(fw, /processarQR\("\{\\"t\\":\\"fim\\"\}"\)/);
  assert.match(fw, /SIM:COMANDO:FIM/);
  assert.match(fw, /POST fictício ACEITO/);
  assert.match(sketch, /#define ROBO_SIMULADOR_WOKWI 1/);
  assert.doesNotMatch(fw, /#define ROBO_SIMULADOR_WOKWI 1/);
});

test('dashboard separa finalização do robô e encerramento pedagógico', () => {
  const html = ler('site/painel/index.html');
  const js = ler('site/painel/app.js');
  assert.match(html, /id="dashboard-finalizar-leitura"/);
  assert.match(html, /id="dashboard-encerrar-atividade"/);
  assert.match(js, /apiFetch\('\/api\/esp\/finalizar-leitura'/);
  assert.match(js, /api\/esp\/finalizacao\/status\?atividadeId=/);
});
