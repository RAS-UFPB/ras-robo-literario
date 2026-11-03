const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const firmware = fs.readFileSync(path.join(root, 'esp/robo_literario_codigo.ino'), 'utf8');
const sketch = fs.readFileSync(path.join(root, 'esp/wokwi/sketch.ino'), 'utf8');
const template = fs.readFileSync(path.join(root, 'esp/secrets.example.h'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, 'esp/.gitignore'), 'utf8');

test('firmware fisico importa secrets.h e nao grava as credenciais no .ino', () => {
  assert.match(firmware, /#else\s*#include "secrets.h"\s*#endif/);
  assert.doesNotMatch(firmware, /https:\/\/SEU-PROJETO\.supabase\.co/);
  assert.match(gitignore, /^\/secrets\.h$/m);
  assert.match(template, /#define SUPABASE_REST_URL /);
  assert.match(template, /#define SUPABASE_ANON_KEY /);
  assert.ok(!fs.existsSync(path.join(root, 'esp/secrets.h')), 'o pacote nao deve conter secrets.h preenchido');
});

test('sketch Wokwi nao depende de secrets.h real e nao contem credenciais reais', () => {
  assert.match(sketch, /#define ROBO_SIMULADOR_WOKWI 1/);
  assert.match(firmware, /#ifdef ROBO_SIMULADOR_WOKWI\s*\/\/ A simula/);
  assert.match(firmware, /#define SUPABASE_REST_URL "https:\/\/example\.invalid/);
  assert.match(firmware, /#define SUPABASE_ANON_KEY "WOKWI_SEM_ACESSO_SUPABASE"/);
  assert.match(firmware, /bool salvarCredenciais\(/);
  assert.match(firmware, /#include <Preferences\.h>/);
});
