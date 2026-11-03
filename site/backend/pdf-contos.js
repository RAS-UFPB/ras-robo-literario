// PDFs de contos no bucket privado já existente. Nenhum arquivo é gravado em disco.
const { randomUUID } = require('node:crypto');

const LIMITE_PDF = 10 * 1024 * 1024;

function erroHttp(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

function validarPdf(arquivo) {
  if (!Buffer.isBuffer(arquivo) || !arquivo.length) throw erroHttp(400, 'Selecione um PDF.');
  if (arquivo.length > LIMITE_PDF) throw erroHttp(413, 'O PDF deve ter no máximo 10 MB.');
  // Assinatura PDF e marcador de fim: impedem o envio casual de outros formatos.
  // Não substituem um antivírus/verificador de PDFs em instalações públicas.
  if (arquivo.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !arquivo.subarray(-1024).toString('latin1').includes('%%EOF')) {
    throw erroHttp(415, 'O arquivo enviado não parece ser um PDF válido.');
  }
  return arquivo;
}

async function lerPdfRequisicao(req) {
  if (!/^application\/pdf(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
    throw erroHttp(415, 'Envie o PDF com Content-Type application/pdf.');
  }
  const tamanho = Number(req.headers['content-length']);
  if (Number.isFinite(tamanho) && tamanho > LIMITE_PDF) throw erroHttp(413, 'O PDF deve ter no máximo 10 MB.');
  let total = 0;
  const partes = [];
  for await (const parte of req) {
    total += parte.length;
    if (total > LIMITE_PDF) throw erroHttp(413, 'O PDF deve ter no máximo 10 MB.');
    partes.push(parte);
  }
  return validarPdf(Buffer.concat(partes));
}

function criarServicoPdf({ prisma, storage }) {
  async function encontrar(id) {
    const conto = await prisma.conto.findUnique({ where: { id }, select: { id: true, pdfPath: true } });
    if (!conto) throw erroHttp(404, 'Conto não encontrado.');
    return conto;
  }

  async function apagarStorage(caminho) {
    if (!caminho) return null;
    const { error } = await storage.remove([caminho]);
    return error || null;
  }

  return {
    async salvar(id, arquivo) {
      validarPdf(arquivo);
      const conto = await encontrar(id);
      // O identificador vai codificado na pasta; o nome não vem do usuário.
      const pasta = Buffer.from(conto.id, 'utf8').toString('base64url');
      const caminho = `contos/${pasta}/${randomUUID()}.pdf`;
      const { error: erroUpload } = await storage.upload(caminho, arquivo, {
        contentType: 'application/pdf', cacheControl: '0', upsert: false
      });
      if (erroUpload) throw erroHttp(502, 'Não foi possível enviar o PDF ao Storage. Confira o bucket e as credenciais.');

      try {
        const atualizado = await prisma.conto.updateMany({
          where: { id, pdfPath: conto.pdfPath }, data: { pdfPath: caminho }
        });
        if (atualizado.count !== 1) throw erroHttp(409, 'O PDF deste conto mudou. Atualize a página e tente novamente.');
      } catch (error) {
        try { await apagarStorage(caminho); } catch (limpeza) { console.error('Falha ao desfazer upload do PDF:', limpeza); }
        throw error;
      }

      let aviso;
      if (conto.pdfPath && conto.pdfPath !== caminho) {
        try {
          if (await apagarStorage(conto.pdfPath)) aviso = 'PDF atualizado, mas o arquivo antigo precisa de limpeza no Storage.';
        } catch (error) {
          console.error('Falha ao limpar PDF substituído:', error);
          aviso = 'PDF atualizado, mas o arquivo antigo precisa de limpeza no Storage.';
        }
      }
      return { possuiPdf: true, ...(aviso && { aviso }) };
    },

    async obter(id) {
      const conto = await encontrar(id);
      if (!conto.pdfPath) throw erroHttp(404, 'Este conto ainda não possui PDF.');
      const { data, error } = await storage.download(conto.pdfPath);
      if (error || !data) throw erroHttp(502, 'Não foi possível consultar o PDF no Storage.');
      const arquivo = Buffer.from(await data.arrayBuffer());
      if (arquivo.length > LIMITE_PDF) throw erroHttp(413, 'O PDF armazenado excede 10 MB.');
      return validarPdf(arquivo);
    },

    async remover(id) {
      const conto = await encontrar(id);
      if (!conto.pdfPath) return { possuiPdf: false };
      const alterado = await prisma.conto.updateMany({
        where: { id, pdfPath: conto.pdfPath }, data: { pdfPath: null }
      });
      if (alterado.count !== 1) throw erroHttp(409, 'O PDF mudou. Atualize a página e tente novamente.');
      let aviso;
      try {
        if (await apagarStorage(conto.pdfPath)) aviso = 'Referência removida, mas o arquivo precisa de limpeza no Storage.';
      } catch (error) {
        console.error('Falha ao apagar PDF no Storage:', error);
        aviso = 'Referência removida, mas o arquivo precisa de limpeza no Storage.';
      }
      return { possuiPdf: false, ...(aviso && { aviso }) };
    }
  };
}

function enviarPdfInline(req, res, arquivo) {
  const cabecalhos = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="conto.pdf"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes'
  };
  // Suporta a leitura parcial usada por alguns leitores de PDF dos navegadores.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (req.headers.range && !range) {
    res.writeHead(416, { ...cabecalhos, 'Content-Range': `bytes */${arquivo.length}` });
    return res.end();
  }
  if (range) {
    let inicio = range[1] ? Number(range[1]) : null;
    let fim = range[2] ? Number(range[2]) : null;
    if (inicio === null && fim !== null && fim > 0) { inicio = Math.max(0, arquivo.length - fim); fim = arquivo.length - 1; }
    else { inicio ??= 0; fim ??= arquivo.length - 1; }
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || inicio < 0 || fim < inicio || inicio >= arquivo.length) {
      res.writeHead(416, { ...cabecalhos, 'Content-Range': `bytes */${arquivo.length}` });
      return res.end();
    }
    fim = Math.min(fim, arquivo.length - 1);
    res.writeHead(206, { ...cabecalhos, 'Content-Range': `bytes ${inicio}-${fim}/${arquivo.length}`, 'Content-Length': fim - inicio + 1 });
    return res.end(arquivo.subarray(inicio, fim + 1));
  }
  res.writeHead(200, { ...cabecalhos, 'Content-Length': arquivo.length });
  return res.end(arquivo);
}

module.exports = { LIMITE_PDF, validarPdf, lerPdfRequisicao, criarServicoPdf, enviarPdfInline };
