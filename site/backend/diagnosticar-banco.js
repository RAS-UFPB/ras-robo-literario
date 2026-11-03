// Testa a conexao PostgreSQL usada pelo site sem imprimir usuario, host ou senha.
// Execute dentro de `site/`: node backend/diagnosticar-banco.js
require('dotenv').config();

function verificarFormato(valor) {
  if (!valor) throw new Error('DATABASE_URL nao foi definida. Verifique site/.env.');
  if (/^https?:\/\//i.test(valor)) {
    throw new Error('DATABASE_URL recebeu uma URL HTTP(S). Use a string PostgreSQL da opcao Connect do Supabase.');
  }
  if (/^(sb_publishable_|sb_secret_|eyJ)/.test(valor)) {
    throw new Error('DATABASE_URL nao e uma chave da API. Use a connection string PostgreSQL.');
  }
  let url;
  try { url = new URL(valor); }
  catch { throw new Error('DATABASE_URL nao e uma URL valida.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL deve comecar com postgresql:// ou postgres://.');
  }
  if (!url.hostname || !url.username || !url.password) {
    throw new Error('DATABASE_URL precisa de host, usuario e senha de banco.');
  }
  if (/[\[\]<>]/.test(url.password) || /YOUR-PASSWORD|SENHA|PASSWORD/i.test(decodeURIComponent(url.password))) {
    throw new Error('DATABASE_URL parece conter um placeholder de senha.');
  }
  return true;
}

async function main() {
  verificarFormato(process.env.DATABASE_URL);
  const { prisma } = require('./prisma');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[OK] Conexao PostgreSQL autenticada. O site pode consultar o banco.');
  } catch (error) {
    const cadeia = [error, error?.cause, error?.cause?.cause].filter(Boolean);
    const diagnostico = cadeia.map(e => `${e.code || ''} ${e.originalCode || ''} ${e.message || ''} ${e.originalMessage || ''}`).join(' ').toLowerCase();
    if (/ecircuitbreaker|authentication failures/.test(diagnostico)) {
      console.error('[ERRO] Supabase bloqueou temporariamente novas tentativas por falhas de autenticacao. Pare outros clientes, confira o .env e aguarde o bloqueio terminar antes de tentar novamente.');
    } else if (/28p01|password authentication failed|invalid password|authentication failed/.test(diagnostico)) {
      console.error('[ERRO] Usuario ou senha de PostgreSQL incorretos. Copie a string atual em Supabase > Connect.');
    } else if (/enotfound|eai_again/.test(diagnostico)) {
      console.error('[ERRO] Host PostgreSQL nao encontrado. Confira a string copiada de Supabase > Connect.');
    } else if (/timeout|etimedout|enetwork|enetunreach|econnrefused/.test(diagnostico)) {
      console.error('[ERRO] Nao foi possivel alcancar o banco. Confira o tipo de conexao, a rede e a porta.');
    } else {
      console.error('[ERRO] Falha de conexao/consulta. Codigo:', error?.code || error?.cause?.code || 'indefinido');
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[ERRO]', error.message);
  process.exitCode = 1;
});
