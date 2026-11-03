/* Entrada independente; a chave não é armazenada, somente token temporário na aba. */
'use strict';
const LOGIN_SESSION_KEY = 'robo-literario-admin-temporario';
const LOGIN_DESTINO = '/index.html';

function obterSessaoSalva() {
  try {
    const salvo = JSON.parse(sessionStorage.getItem(LOGIN_SESSION_KEY) || 'null');
    return salvo && typeof salvo.token === 'string' && salvo.token
      && Number.isFinite(salvo.expiraEm) && Date.now() < salvo.expiraEm ? salvo : null;
  } catch { return null; }
}
function esquecerSessao() {
  try { sessionStorage.removeItem(LOGIN_SESSION_KEY); } catch { /* storage indisponível */ }
}
function salvarSessao(token, segundos) {
  const duracao = Number(segundos);
  const segundosValidos = Number.isFinite(duracao) && duracao > 0 ? Math.min(3600, duracao) : 3600;
  const expiraEm = Date.now() + Math.max(0, segundosValidos * 1000 - 30000);
  sessionStorage.setItem(LOGIN_SESSION_KEY, JSON.stringify({ token, expiraEm }));
}

async function validarSessaoSalva() {
  const sessao = obterSessaoSalva();
  if (!sessao) { esquecerSessao(); return false; }
  try {
    const resposta = await fetch('/api/auth/sessao', {
      headers: { Authorization: `Bearer ${sessao.token}` }, cache: 'no-store'
    });
    if (resposta.ok) { location.replace(LOGIN_DESTINO); return true; }
  } catch { /* login permanece disponível */ }
  esquecerSessao();
  return false;
}

async function entrar(evento) {
  evento.preventDefault();
  const senha = document.getElementById('login-chave');
  const botao = document.getElementById('login-entrar');
  const aviso = document.getElementById('login-erro');
  if (!senha.value.trim()) { aviso.textContent = 'Informe a chave de acesso.'; senha.focus(); return; }
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  aviso.textContent = '';
  try {
    const resposta = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: senha.value })
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !dados.token) throw new Error(dados.error || 'Não foi possível entrar.');
    salvarSessao(dados.token, dados.expiresInSeconds);
    senha.value = '';
    location.replace(LOGIN_DESTINO);
  } catch (erro) {
    senha.value = '';
    aviso.textContent = erro.message || 'Não foi possível conectar ao servidor.';
    senha.focus();
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar no painel';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const aviso = document.getElementById('login-erro');
  if (new URLSearchParams(location.search).has('expirada')) {
    aviso.textContent = 'Sua sessão terminou. Entre novamente para continuar.';
  }
  const visibilidade = document.getElementById('login-visibilidade');
  const senha = document.getElementById('login-chave');
  visibilidade.addEventListener('click', () => {
    const mostrar = senha.type === 'password';
    senha.type = mostrar ? 'text' : 'password';
    visibilidade.textContent = mostrar ? 'Ocultar' : 'Mostrar';
    visibilidade.setAttribute('aria-label', mostrar ? 'Ocultar chave de acesso' : 'Mostrar chave de acesso');
    visibilidade.setAttribute('aria-pressed', String(mostrar));
  });
  document.getElementById('login-form').addEventListener('submit', entrar);
  await validarSessaoSalva();
});
