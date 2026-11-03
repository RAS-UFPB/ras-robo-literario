'use strict';
// Servidor de integração isolado: nunca conecta ao Supabase verdadeiro.
process.env.NODE_ENV = 'test';
process.env.ADMIN_ACCESS_KEY = 'chave-local-exclusiva-dos-testes';
process.env.ESP_IMPORTACAO_AUTOMATICA = 'false';

const path = require('node:path');
const cache = (modulo, exports) => {
  const id = require.resolve(path.join(__dirname, '../../backend', modulo));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

let idAtividade = 20;
let atividadeAtiva = null;
const comandosEsp = new Map();
let idConto = 0;
const contos = new Map();
const arquivos = new Map();
const prisma = {
  conto: {
    async findMany() { return [...contos.values()].map(c => ({ ...c, perguntas: [], desafios: [], dicas: [] })); },
    async findUnique({ where }) { return contos.get(where.id) || null; },
    async create({ data }) { const conto = { ...data, pdfPath: null, perguntas: [], desafios: [], dicas: [] }; contos.set(data.id, conto); idConto++; return conto; },
    async updateMany({ where, data }) {
      const c = contos.get(where.id);
      if (!c || c.pdfPath !== where.pdfPath) return { count: 0 };
      Object.assign(c, data);
      return { count: 1 };
    }
  },
  trechoEmbaralhar: { async findMany() { return []; } },
  atividade: {
    async findFirst() { return atividadeAtiva; },
    async updateMany() { atividadeAtiva = null; return { count: 1 }; },
    async create({ data }) {
      atividadeAtiva = { id: ++idAtividade, ...data, frases: data.frases.create.map((f, i) => ({ id: i + 1, ...f })) };
      return atividadeAtiva;
    }
  },
  sessaoEsp: { async findFirst() { return null; } },
  importacaoSessaoEsp: { async findUnique() { return null; } },
  async $transaction(fn) { return fn(prisma); },
  async $disconnect() {}
};

const storage = {
  from(nome) {
    if (nome !== 'contos-pdf') throw new Error('Bucket inesperado');
    return {
      async upload(caminho, bytes) { arquivos.set(caminho, Buffer.from(bytes)); return { error: null }; },
      async remove(caminhos) { caminhos.forEach(c => arquivos.delete(c)); return { error: null }; },
      async download(caminho) {
        const buf = arquivos.get(caminho);
        if (!buf) return { error: new Error('Não encontrado'), data: null };
        return { error: null, data: { async arrayBuffer() { return buf; } } };
      }
    };
  }
};
cache('prisma.js', { prisma });
const comandos = {
  async upsert(linha, { onConflict }) {
    if (onConflict !== 'sessao_id') throw new Error('Conflito inesperado');
    comandosEsp.set(linha.sessao_id, linha);
    return { error: null };
  },
  select() {
    let sid = '';
    return {
      eq(campo, valor) {
        if (campo !== 'sessao_id') throw new Error('Filtro inesperado');
        sid = valor;
        return {
          gt(campoData, atual) {
            if (campoData !== 'expira_em') throw new Error('Coluna inesperada');
            return {
              async maybeSingle() {
                const registro = comandosEsp.get(sid);
                return { data: registro && registro.expira_em > atual ? registro : null, error: null };
              }
            };
          }
        };
      }
    };
  }
};
cache('supabase.js', { supabase: { storage, from(tabela) {
  if (tabela !== 'comandos_esp') throw new Error('Tabela de comando inesperada');
  return comandos;
} } });
require('../../backend/server');
