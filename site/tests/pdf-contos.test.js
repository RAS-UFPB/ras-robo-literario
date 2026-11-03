const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { validarPdf, lerPdfRequisicao, criarServicoPdf, enviarPdfInline, LIMITE_PDF } = require('../backend/pdf-contos');
const pdf1 = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const pdf2 = Buffer.from('%PDF-1.7\n2 0 obj\n<<>>\nendobj\n%%EOF\n');

function simular() {
  const rows = new Map([['conto-1', { id: 'conto-1', pdfPath: null }], ['conto-2', { id: 'conto-2', pdfPath: null }]]);
  const files = new Map();
  const chamadas = [];
  let falharUpload = false;
  const prisma = { conto: {
    async findUnique({ where }) { return rows.get(where.id) ? { ...rows.get(where.id) } : null; },
    async updateMany({ where, data }) {
      const row = rows.get(where.id);
      if (!row || row.pdfPath !== where.pdfPath) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }
  }};
  const storage = {
    async upload(path, buffer, options) {
      chamadas.push(['upload', path, options.contentType, options.upsert]);
      if (falharUpload) return { error: new Error('Storage offline') };
      files.set(path, Buffer.from(buffer));
      return { error: null };
    },
    async download(path) {
      chamadas.push(['download', path]);
      const b = files.get(path);
      return b ? { data: new Blob([b]), error: null } : { data: null, error: new Error('not found') };
    },
    async remove(paths) {
      chamadas.push(['remove', ...paths]);
      paths.forEach(p => files.delete(p));
      return { error: null };
    }
  };
  return { rows, files, chamadas, service: criarServicoPdf({ prisma, storage }), setFalharUpload(x) { falharUpload=x; } };
}

test('valida PDF real, assinatura, EOF e máximo de 10 MB', () => {
  assert.equal(validarPdf(pdf1), pdf1);
  assert.throws(() => validarPdf(Buffer.from('not pdf')), e => e.status === 415);
  assert.throws(() => validarPdf(Buffer.from('%PDF-1.4\nno end')), e => e.status === 415);
  assert.throws(() => validarPdf(Buffer.alloc(LIMITE_PDF + 1)), e => e.status === 413);
});

test('recebe somente PDF bruto, recusa conteúdo excessivo e tipo diferente', async () => {
  const req = Readable.from([pdf1]); req.headers = {'content-type': 'application/pdf', 'content-length': String(pdf1.length)};
  assert.deepEqual(await lerPdfRequisicao(req), pdf1);
  const bad = Readable.from([pdf1]); bad.headers = {'content-type': 'text/plain'};
  await assert.rejects(lerPdfRequisicao(bad), e => e.status === 415);
  const big = Readable.from([Buffer.alloc(LIMITE_PDF + 1)]); big.headers={'content-type':'application/pdf'};
  await assert.rejects(lerPdfRequisicao(big), e => e.status === 413);
});

test('vincula ao conto correto; substitui com novo caminho e remove o arquivo anterior', async () => {
  const { rows, files, chamadas, service } = simular();
  await service.salvar('conto-1', pdf1);
  const a = rows.get('conto-1').pdfPath;
  assert.match(a, /^contos\/[A-Za-z0-9_-]+\/[a-f0-9-]+\.pdf$/);
  assert.equal(rows.get('conto-2').pdfPath, null);
  assert.deepEqual(await service.obter('conto-1'), pdf1);
  await service.salvar('conto-1', pdf2);
  const b = rows.get('conto-1').pdfPath;
  assert.notEqual(a,b);
  assert(!files.has(a));
  assert.deepEqual(await service.obter('conto-1'), pdf2);
  assert(chamadas.some(([op, path]) => op==='remove' && path===a));
  await service.remover('conto-1');
  assert.equal(rows.get('conto-1').pdfPath, null);
  assert(!files.has(b));
  await assert.rejects(service.obter('conto-1'), e => e.status === 404);
  await assert.rejects(service.salvar('inexistente', pdf1), e => e.status === 404);
});

test('falha no upload não modifica o vínculo do banco', async () => {
  const { rows, files, service, setFalharUpload } = simular();
  await service.salvar('conto-1', pdf1);
  const before = rows.get('conto-1').pdfPath;
  setFalharUpload(true);
  await assert.rejects(service.salvar('conto-1', pdf2), e => e.status === 502);
  assert.equal(rows.get('conto-1').pdfPath, before);
  assert.equal(files.size, 1);
});

test('resposta PDF inline, parcial e range inválido', () => {
  function reqRange(range) {
    const result = { status: null, headers: null, body: null };
    const res = { writeHead(s,h) { result.status=s; result.headers=h; }, end(b) { result.body=b; } };
    enviarPdfInline({ headers: range ? {range} : {} }, res, pdf1);
    return result;
  }
  const completo = reqRange();
  assert.equal(completo.status, 200);
  assert.equal(completo.headers['Content-Type'], 'application/pdf');
  assert.equal(completo.headers['Content-Disposition'], 'inline; filename="conto.pdf"');
  assert.deepEqual(completo.body, pdf1);
  const parcial = reqRange('bytes=0-4');
  assert.equal(parcial.status, 206);
  assert.equal(parcial.body.toString('ascii'), '%PDF-');
  assert.equal(reqRange('bytes=999999-').status, 416);
});
