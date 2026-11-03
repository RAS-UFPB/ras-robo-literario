'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../painel/app.js'), 'utf8');
const loginJs = fs.readFileSync(path.join(__dirname, '../painel/login.js'), 'utf8');
const painelHtml = fs.readFileSync(path.join(__dirname, '../painel/index.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(__dirname, '../painel/login.html'), 'utf8');
const K = 'robo-literario-admin-temporario';
function trecho(inicio, fim) {
  const i = app.indexOf(inicio), j = app.indexOf(fim, i + inicio.length);
  assert.ok(i >= 0 && j > i, `Trecho não localizado: ${inicio}`);
  return app.slice(i, j);
}
const appTrecho = [
  trecho('let tokenAdminPdf = null;', 'async function carregarContosDoBanco()'),
  trecho('async function apiFetch(', 'function normalizarEquipe('),
  trecho('async function finalizarLeituraEsp()', 'async function encerrarAtividadeAtual()'),
  trecho('function atualizarIndicadorAdmin()', 'async function requisicaoPdfAdmin(')
].join('\n');

function base(armazenamento = new Map()) {
  const caminhos = [];
  const sessionStorage = {
    getItem: key => armazenamento.get(key) ?? null,
    setItem: (key, val) => armazenamento.set(key, val),
    removeItem: key => armazenamento.delete(key)
  };
  const location = { search: '', replace: url => caminhos.push(url) };
  return { caminhos, armazenamento, sessionStorage, location };
}
function ambienteLogin(b = base(), { senhaCorreta = true, tokenAceito = true } = {}) {
  const chamadas = [];
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, value: '', textContent: '', disabled: false, type: 'password',
      focus() {}, setAttribute() {}, addEventListener(nome, fn) { this[nome] = fn; } });
    return els.get(id);
  };
  let iniciado;
  const document = { getElementById: el, addEventListener(nome, fn) { if (nome === 'DOMContentLoaded') iniciado = fn; } };
  const fetch = async (url, op = {}) => {
    chamadas.push({ url, op });
    if (url === '/api/auth/sessao') return { ok: tokenAceito, status: tokenAceito ? 200 : 401 };
    if (url === '/api/auth/login') return { ok: senhaCorreta, status: senhaCorreta ? 200 : 401,
      json: async () => senhaCorreta ? { token: 'token-de-teste', expiresInSeconds: 3600 } : { error: 'Chave inválida.' } };
    throw new Error(url);
  };
  const ctx = vm.createContext({ sessionStorage: b.sessionStorage, location: b.location, document, fetch,
    URLSearchParams, Date, Number, JSON, String });
  vm.runInContext(loginJs, ctx);
  return { ...b, chamadas, el, iniciar: () => iniciado(), enviar: () => vm.runInContext('entrar({ preventDefault() {} })', ctx) };
}
function ambientePainel(b = base(), { rejeitarToken = false, confirmar = true } = {}) {
  const chamadas = [];
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { hidden: true, textContent: '' });
    return els.get(id);
  };
  const window = {
    sessionStorage: b.sessionStorage, location: b.location,
    confirm() { return confirmar; }, alert() { throw new Error('Sem alert de login'); },
    prompt() { throw new Error('Não deve abrir janela prompt'); }
  };
  const fetch = async (url, op = {}) => {
    chamadas.push({ url, op });
    const status = (rejeitarToken && (url === '/api/auth/sessao' || url === '/api/esp/finalizar-leitura')) ? 401 : 200;
    return { status, ok: status === 200, headers: { get: () => 'application/json' },
      json: async () => status === 200 ? { ok: true } : { error: 'Sessão expirada' } };
  };
  const ctx = vm.createContext({ window, document: { getElementById: el }, fetch, Date, Number, JSON, String, Error,
    Promise, atualizarStatusFinalizacaoEsp: async () => {} });
  vm.runInContext(appTrecho, ctx);
  vm.runInContext('let atividadeIdParaFinalizacaoEsp = 23; let pedidoFinalizacaoEmCurso = false;', ctx);
  return { ...b, chamadas, el, executar: expr => vm.runInContext(expr, ctx) };
}

const sessaoValida = () => new Map([[K, JSON.stringify({ token: 'token-teste', expiraEm: Date.now() + 180000 })]]);

test('login é uma página própria, sem formulário modal ou prompt no dashboard', () => {
  assert.match(loginHtml, /<h1 id="login-titulo">Bem-vinda ao Robô Literário!/);
  assert.match(loginHtml, /id="login-chave"[^>]*type="password"/);
  assert.match(loginHtml, /src="login.js"/);
  assert.doesNotMatch(painelHtml, /admin-login-dialog|enviarLoginAdministrativo/);
  assert.match(painelHtml, /id="admin-sair"/);
  assert.match(painelHtml, /visibility: hidden/);
  assert.doesNotMatch(app, /window\.prompt\(/);
  assert.match(app, /window\.confirm\('Tem certeza que deseja finalizar a leitura/);
});

test('login correto salva só token temporário e leva para o painel', async () => {
  const t = ambienteLogin();
  await t.iniciar();
  t.el('login-chave').value = 'chave-teste';
  await t.enviar();
  assert.equal(t.caminhos.at(-1), '/index.html');
  assert.equal(t.chamadas.filter(c => c.url === '/api/auth/login').length, 1);
  assert.ok(JSON.parse(t.armazenamento.get(K)).token);
  assert.equal(t.armazenamento.get(K).includes('chave-teste'), false);
  assert.equal(t.el('login-chave').value, '');
});

test('login incorreto não salva sessão, mostra erro e mantém a página', async () => {
  const t = ambienteLogin(base(), { senhaCorreta: false });
  await t.iniciar();
  t.el('login-chave').value = 'errada';
  await t.enviar();
  assert.equal(t.caminhos.length, 0);
  assert.equal(t.armazenamento.has(K), false);
  assert.match(t.el('login-erro').textContent, /inválida/);
});

test('com token válido, atualizar página reutiliza a mesma sessão', async () => {
  const t = ambienteLogin(base(sessaoValida()));
  await t.iniciar();
  assert.equal(t.caminhos.at(-1), '/index.html');
  assert.equal(t.chamadas.filter(c => c.url === '/api/auth/login').length, 0);
  const painel = ambientePainel(base(t.armazenamento));
  assert.equal(await painel.executar('inicializarAreaAdministrativa()'), true);
  assert.equal(painel.chamadas.filter(c => c.url === '/api/auth/sessao').length, 1);
  await painel.executar('finalizarLeituraEsp()');
  assert.equal(painel.chamadas.filter(c => c.url === '/api/esp/finalizar-leitura').length, 1);
});

test('sessão inválida redireciona sem repetir gravações', async () => {
  const t = ambientePainel(base(sessaoValida()), { rejeitarToken: true });
  assert.equal(await t.executar('inicializarAreaAdministrativa()'), false);
  assert.equal(t.caminhos.at(-1), '/login.html?expirada=1');
  assert.equal(t.armazenamento.has(K), false);
  assert.equal(t.chamadas.some(c => c.url === '/api/esp/finalizar-leitura'), false);
});

test('sair revoga o token no servidor e volta para login', async () => {
  const t = ambientePainel(base(sessaoValida()));
  await t.executar('sairDaAreaAdministrativa()');
  assert.equal(t.caminhos.at(-1), '/login.html');
  assert.equal(t.armazenamento.has(K), false);
  assert.equal(t.chamadas.filter(c => c.url === '/api/auth/logout').length, 1);
});

test('cancelar confirmação da finalização não envia comando', async () => {
  const t = ambientePainel(base(sessaoValida()), { confirmar: false });
  await t.executar('finalizarLeituraEsp()');
  assert.equal(t.chamadas.some(c => c.url === '/api/esp/finalizar-leitura'), false);
});
