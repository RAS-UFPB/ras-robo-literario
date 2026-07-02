const crypto = require('crypto');

const sessions = new Map();

const TOKEN_EXPIRATION_MS = 60 * 60 * 1000; // 1 hora

function getAdminAccessKey() {
  return process.env.ADMIN_ACCESS_KEY;
}

function isAuthConfigured() {
  return Boolean(getAdminAccessKey());
}

function createAdminToken() {
  return crypto.randomBytes(32).toString('hex');
}

function loginAdmin(accessKey) {
  if (!isAuthConfigured()) {
    return {
      ok: false,
      status: 500,
      error: 'ADMIN_ACCESS_KEY não foi configurada no .env.'
    };
  }

  if (!accessKey || accessKey !== getAdminAccessKey()) {
    return {
      ok: false,
      status: 401,
      error: 'Chave de acesso inválida.'
    };
  }

  const token = createAdminToken();
  const now = Date.now();

  sessions.set(token, {
    createdAt: now,
    expiresAt: now + TOKEN_EXPIRATION_MS
  });

  return {
    ok: true,
    token,
    expiresInSeconds: TOKEN_EXPIRATION_MS / 1000
  };
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }

  return null;
}

function isExpired(session) {
  return !session || Date.now() > session.expiresAt;
}

function isValidAdminRequest(req) {
  const token = getTokenFromRequest(req);

  if (!token) return false;

  const session = sessions.get(token);

  if (isExpired(session)) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function requireAdmin(req, res, sendJson) {
  if (!isAuthConfigured()) {
    sendJson(res, 500, {
      error: 'ADMIN_ACCESS_KEY não foi configurada no .env.'
    });

    return false;
  }

  if (!isValidAdminRequest(req)) {
    sendJson(res, 401, {
      error: 'Acesso negado. Faça login novamente como admin/dev. O token pode estar ausente ou expirado.'
    });

    return false;
  }

  return true;
}

function clearExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}

setInterval(clearExpiredSessions, 10 * 60 * 1000); // limpa tokens vencidos a cada 10 min

module.exports = {
  loginAdmin,
  requireAdmin
};