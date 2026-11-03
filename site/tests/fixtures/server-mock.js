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
    async findFirst() { return null; },
    async updateMany() { return { count: 0 }; },
    async create({ data }) { return { id: ++idAtividade, ...data, frases: data.frases.create.map((f, i) => ({ id: i + 1, ...f })) }; }
  },
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
cache('supabase.js', { supabase: { storage } });
require('../../backend/server');
