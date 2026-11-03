# PDFs originais dos contos — somente mudanças necessárias

## O que já existe no Supabase

O banco enviado já contém `public.contos.pdf_path` (text) e o Storage já contém o bucket `contos-pdf` com uma pasta `contos`. Não crie outro bucket, pasta local ou tabela. A coluna `pdf_path` é opcional; cada conto mantém seu próprio arquivo. O Prisma agora declara `pdfPath @map("pdf_path")`. Campos antigos `pdf_versao`, `pdf_destaques`, `pdf_revisao` não são usados nem alterados por esta implementação.

Confira que o bucket tem `public=false` em **Storage → Edit bucket**. O SQL de verificação está em `supabase/pdf_contos_storage.sql`. Não é necessário criar policies públicas: o backend usa a service role, que deve ficar **somente** no `.env` local do servidor.

## Configuração local

1. Em `site/.env`, mantenha a `DATABASE_URL` e a `ADMIN_ACCESS_KEY` que já utilizava. Configure também `SUPABASE_URL=https://...supabase.co` e `SUPABASE_SERVICE_ROLE_KEY=...` no backend. **Nunca** coloque service role em HTML/JS público e não compartilhe o `.env`.
2. Dentro de `site/`: `npm install`, `npx prisma generate`, `npm start`.
3. **Não rode uma migração nova**: a coluna já existe no banco informado. Em outro banco que não tenha a coluna, use o SQL incluído, depois `npx prisma generate`.

## Uso da professora

- Em **Contos → Gerenciar contos e perguntas**, escolha o conto no seletor de perguntas; a seção **PDF do conto** usa a mesma seleção.
- Escolha PDF de até 10 MB e clique em **Anexar PDF** ou **Substituir PDF**. Para gravar/remover, a interface solicita a `ADMIN_ACCESS_KEY` que já existe no servidor. O login retorna um token temporário mantido apenas em memória pelo navegador; a chave do Supabase nunca é enviada para o cliente.
- Clique em **Remover PDF** para desvincular o conto e excluir o objeto do Storage.
- Na apresentação, escolha **Texto do conto**. O PDF é carregado pelo backend dentro de um `iframe` usando o leitor nativo do navegador; a rolagem é interna ao leitor. Clique em **Pergunta** para voltar. **Trechos**, voz, Dica, Desafio e Resposta seguem como estavam.
- Se não houver PDF, aparece apenas o aviso discreto de ausência, sem cabeçalho de número de páginas e sem ferramenta de marca-texto.

## API (upload bruto, sem multipart nem arquivos locais)

- `PUT /api/contos/:id/pdf`, `Content-Type: application/pdf`, corpo binário, `Authorization: Bearer <token-admin>`.
- `GET /api/contos/:id/pdf` retorna `application/pdf` inline por proxy do bucket privado, para leitura no painel (sem revelar a URL nem a chave do Storage).
- `DELETE /api/contos/:id/pdf` requer token admin e remove o vínculo e o objeto correspondente.
- `GET /api/contos` inclui `possuiPdf: true/false`. Não retorna o caminho no Storage.

**Observação de acesso:** como o painel existente permite consultas aos contos sem login, o endpoint GET também segue esse modelo. O bucket é privado para acesso direto ao Supabase, mas qualquer pessoa que consiga acessar a API do próprio site poderá consultar o PDF por essa rota. Se for publicar o painel na internet, será necessário colocar autenticação de leitura no site inteiro antes de utilizá-lo com documentos reservados.

## Testes

- `npm test` (testes originais + testes unitários de PDF com Prisma/Storage simulados).
- `python tests/acervo-browser-e2e.py`, `python tests/wifi-browser-e2e.py`, `python tests/pdf-browser-e2e.py` (Chromium e Playwright). O novo teste usa um PDF de três páginas criado em memória e APIs simuladas; não faz upload real ao Supabase.
- No Supabase real, confira o objeto no bucket, a coluna `pdf_path`, substituição, remoção, visualização e a rolagem do leitor no Firefox ou Edge/Chrome. O visualizador é **nativo do navegador**; a aparência, as ferramentas de PDF e o comportamento interno de rolagem podem variar. Em navegador sem leitor PDF embutido, o iframe pode não renderizar.

Não alteramos firmware, Wi-Fi, ESP, importação de sessões, dados da seed, perguntas, dicas, desafios nem pontuação.
