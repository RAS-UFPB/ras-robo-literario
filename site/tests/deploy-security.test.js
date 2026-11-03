'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

async function portaLivre() {
  const srv = net.createServer();
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const porta = srv.address().port;
  await new Promise(resolve => srv.close(resolve));
  return porta;
}

test('servidor HTTP: arquivos, autenticação, escrita e PDF com dados simulados', { timeout: 20000 }, async t => {
  const porta = await portaLivre();
  const url = `http://127.0.0.1:${porta}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/server-mock.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(porta) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  t.after(() => { child.kill('SIGTERM'); });

  async function requisicao(caminho, options) { return fetch(`${url}${caminho}`, options); }
  let pronto = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) break;
    try { const r = await requisicao('/api/ping'); if (r.status === 200) { pronto = true; break; } }
    catch { /* aguardando serviço local */ }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  assert.ok(pronto, `Servidor de teste não iniciou: ${logs.join(' ').slice(0, 500)}`);

  for (const [caminho, tipo] of [
    ['/', 'text/html'], ['/index.html', 'text/html'], ['/style.css', 'text/css'],
    ['/app.js', 'application/javascript'], ['/narracao.js', 'application/javascript'],
    ['/wifi-config.js', 'application/javascript']
  ]) {
    const r = await requisicao(caminho);
    assert.equal(r.status, 200, caminho);
    assert.ok(r.headers.get('content-type').includes(tipo), caminho);
  }
  const inicioPublico = await requisicao('/');
  assert.equal(new URL(inicioPublico.url).pathname, '/login.html', 'a raiz deve abrir login');
  assert.match(await inicioPublico.text(), /Bem-vinda ao Robô Literário!/);
  assert.equal((await requisicao('/login.css')).status, 200);
  assert.equal((await requisicao('/login.js')).status, 200);
  assert.equal((await requisicao('/api/contos')).status, 200);
  assert.equal((await requisicao('/api/atividade')).status, 200);
  assert.equal((await requisicao('/api/placar')).status, 200); // atividade sem dados
  assert.equal((await requisicao('/../backend/auth.js')).status, 404); // normalizado pelo fetch
  const json = { 'Content-Type': 'application/json' };
  const envios = [
    ['/api/atividade', 'POST'], ['/api/atividade/encerrar', 'POST'],
    ['/api/esp/finalizar-leitura', 'POST'],
    ['/api/contos', 'POST'], ['/api/perguntas', 'POST'], ['/api/perguntas/1', 'PUT'],
    ['/api/perguntas/1', 'DELETE'], ['/api/contos/qualquer/iniciar-trechos', 'POST'],
    ['/api/qr', 'POST'], ['/api/validar', 'POST'], ['/api/reset-equipe', 'POST'],
    ['/api/admin/reset-tudo', 'POST'], ['/api/contos/qualquer/pdf', 'PUT'],
    ['/api/contos/qualquer/pdf', 'DELETE']
  ];
  for (const [caminho, method] of envios) {
    const r = await requisicao(caminho, { method, headers: json, body: '{}' });
    assert.equal(r.status, 401, `${method} ${caminho} deveria estar protegido`);
  }
  assert.equal((await requisicao('/api/auth/sessao')).status, 401);
  assert.equal((await requisicao('/api/esp/importacao/status')).status, 401);
  assert.equal((await requisicao('/api/supabase/status')).status, 401);
  const invalido = await requisicao('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ accessKey: 'errada' }) });
  assert.equal(invalido.status, 401);
  const login = await requisicao('/api/auth/login', { method: 'POST', headers: json,
    body: JSON.stringify({ accessKey: 'chave-local-exclusiva-dos-testes' }) });
  assert.equal(login.status, 200);
  const { token, expiresInSeconds } = await login.json();
  assert.equal(expiresInSeconds, 3600);
  assert.ok(token.length >= 48);
  const autorizado = { ...json, Authorization: `Bearer ${token}` };
  assert.equal((await requisicao('/api/auth/sessao', { headers: autorizado })).status, 200);

  const conto = await requisicao('/api/contos', { method: 'POST', headers: autorizado,
    body: JSON.stringify({ titulo: 'Conto para teste', autor: 'Escola' }) });
  assert.equal(conto.status, 201);
  const { conto: criado } = await conto.json();
  assert.equal((await requisicao('/api/contos')).status, 200);

  const semAtividade = await requisicao('/api/esp/finalizar-leitura', { method: 'POST', headers: autorizado });
  assert.equal(semAtividade.status, 409, 'Não deve enviar comando sem atividade ativa');
  const atividade = await requisicao('/api/atividade', { method: 'POST', headers: autorizado,
    body: JSON.stringify({ textoAlvo: 'Primeiro | Segundo' }) });
  assert.equal(atividade.status, 201);
  const criada = await atividade.json();
  assert.equal(criada.frases.length, 2);
  const statusAntes = await requisicao(`/api/esp/finalizacao/status?atividadeId=${criada.atividadeId}`);
  assert.equal(statusAntes.status, 200);
  assert.equal((await statusAntes.json()).solicitado, false);
  const finalizar = await requisicao('/api/esp/finalizar-leitura', { method: 'POST', headers: autorizado });
  assert.equal(finalizar.status, 202);
  assert.equal((await finalizar.json()).sessaoId, `ATV-${criada.atividadeId}`);
  const statusDepois = await requisicao(`/api/esp/finalizacao/status?atividadeId=${criada.atividadeId}`);
  assert.equal(statusDepois.status, 200);
  assert.deepEqual(await statusDepois.json(), {
    sessaoId: `ATV-${criada.atividadeId}`, solicitado: true, recebido: false, importado: false
  });
  assert.equal((await requisicao('/api/esp/finalizacao/status?atividadeId=nao-e-numero')).status, 400);
  // Mesmo pedido deve ser idempotente: não cria novo comando.
  assert.equal((await requisicao('/api/esp/finalizar-leitura', { method: 'POST', headers: autorizado })).status, 202);

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  const caminho = `/api/contos/${encodeURIComponent(criado.id)}/pdf`;
  const upload = await requisicao(caminho, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: pdf });
  assert.equal(upload.status, 200);
  const arquivo = await requisicao(caminho);
  assert.equal(arquivo.status, 200);
  assert.equal(arquivo.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await arquivo.arrayBuffer()).toString(), pdf.toString());
  assert.equal((await requisicao(caminho, { method: 'DELETE', headers: autorizado })).status, 200);
  assert.equal((await requisicao(caminho)).status, 404);

  const rejeitado = await requisicao('/api/atividade', { method: 'POST', headers: autorizado, body: '{não é json' });
  assert.equal(rejeitado.status, 400);
  const final = await requisicao('/api/atividade/encerrar', { method: 'POST', headers: autorizado, body: '{}' });
  assert.equal(final.status, 200);
  assert.equal((await requisicao('/api/auth/logout', { method: 'POST', headers: autorizado })).status, 200);
  assert.equal((await requisicao('/api/auth/sessao', { headers: autorizado })).status, 401);
});
