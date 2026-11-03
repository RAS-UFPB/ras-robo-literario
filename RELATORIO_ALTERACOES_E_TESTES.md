# Relatório de alterações — Robô Literário no Render

## Inspeção inicial

- Projeto original: frontend HTML/CSS/JS em `site/painel/` e backend HTTP nativo (sem Express) em `site/backend/server.js`.
- `npm start` executa `node backend/server.js`; `process.env.PORT` já existia.
- Prisma 7 com `@prisma/adapter-pg`; o PostgreSQL é externo (Supabase).
- `site/backend/pdf-contos.js` já contém upload, consulta e remoção no bucket privado `contos-pdf`, limite de 10 MB.
- `site/backend/importador-sessoes-esp.js` tem importação periódica (5 s), transação e índices de unicidade para deduplicação.
- Login administrativo já utilizava `ADMIN_ACCESS_KEY` e token de 1 hora, anteriormente aplicado a PDFs e resets; agora também protege outras gravações.
- `site/.env` original estava preenchido. Não será distribuído. Recomendável rotacionar credenciais se o arquivo foi exposto publicamente.

## Arquivos modificados e criados

- `.gitignore` — Proteção de segredos e arquivos temporários em todas as pastas do repositório.
- `GUIA_PUBLICACAO_RENDER.md` — Tutorial iniciante para GitHub, Render, Supabase, execução local, validação e manutenção.
- `render.yaml` — Um único serviço Node gratuito com pasta site, comandos reais e segredos definidos somente no painel Render.
- `site/.env.example` — Exemplos de variáveis realmente necessárias no Render, sem senhas reais.
- `site/.gitignore` — Ignora credenciais, node_modules e artefatos locais.
- `site/backend/auth.js` — Reaproveita tokens temporários, compara a chave em tempo constante e limita tentativas repetidas de login.
- `site/backend/importador-sessoes-esp.js` — Oculta mensagens internas de banco nos logs e estado de produção; preserva o cenário A e a deduplicação.
- `site/backend/server.js` — Protege as rotas de escrita e diagnósticos, responde erros sem revelar detalhes, limita JSON, endurece entrega de arquivos estáticos, mantém PORT e adiciona SIGTERM.
- `site/painel/app.js` — Anexa Bearer token existente a todas as requisições de escrita; permite login/relogin sem nova tela ou armazenamento persistente.
- `site/tests/deploy-security.test.js` — Revisão vinculada à publicação.
- `site/tests/fixtures/server-mock.js` — Revisão vinculada à publicação.

## Comparação com o ZIP original

- Arquivos de código/documentação preservados sem alterações: **72**.
- Arquivos de código/documentação modificados ou criados: **11**.
- Arquivos removidos por mudança de conteúdo: **0** (nenhum).
- Excluídos intencionalmente dos pacotes: `site/.env` real; dependências em `site/node_modules/`; `site/backend/db.json` (arquivo legado ignorado e não utilizado); qualquer `secrets.h` real.
- Nenhum arquivo de firmware ou Wokwi (`esp/`) foi modificado; tampouco esquema Prisma, SQL, seed, HTML, CSS ou QR Code.
- O patch contém diferenças dos arquivos do projeto; não há diff do `.env` real, pois isso publicaria credenciais.

## Resultados dos testes

- `npm test`: **44/44 passaram** (43 testes originais e 1 novo teste HTTP completo em ambiente simulado).
- `node --check`: sem erros de sintaxe nos arquivos JS modificados.
- Smoke test local com processo Node em `NODE_ENV=production`, ambiente fictício e importador desligado: `GET /api/ping` = 200, `GET /` = 200, `POST /api/atividade` sem token = 401.
- Novo teste: frontend e recursos estáticos OK; GET contos e atividade OK; 13 rotas de gravação sem token recebem 401; login inválido 401, válido 200; criação de conto e atividade 201; PDF enviado, lido e removido no Storage simulado; JSON inválido 400.
- `prisma generate`: **não concluiu** por falha `EAI_AGAIN` ao consultar `binaries.prisma.sh` neste ambiente. `npm ci` não concluiu devido a falha de acesso ao registro npm. Testes Node realizados com dependências extraídas do ZIP original somente para o ambiente de teste; elas NÃO estão nas entregas.
- Render, Supabase real, navegador de ponta a ponta e ESP física: **não testados** nesta sessão; não houve alteração de banco, migração ou seed.

## Limitações importantes

- A rotina consulta até as 100 sessões mais recentes por ciclo. Um acúmulo maior que isso após uma longa hibernação exige revisão adicional.
- O plano gratuito hiberna após 15 min sem tráfego externo e não executa cron/timer durante o sono; o banco Supabase guarda as sessões até o backend voltar.
- Leituras e PDFs continuam consultáveis em rotas GET públicas do site; operações de gravação precisam de token administrativo. O bucket do Storage permanece privado.
- Tokens de login ficam na memória do servidor e do navegador, portanto um reinício exige novo login. Evite múltiplas instâncias porque o estado de UI/cache não é compartilhado.
- Se `ADMIN_ACCESS_KEY` for perdida ou for necessária troca de senha, atualize a variável apenas no Render.

## Comandos do serviço

```text
Root Directory: site
Build Command: npm ci && npx prisma generate
Start Command: npm start
NODE_ENV=production
NODE_VERSION=22.16.0
```

Para detalhes de publicação, consulte `GUIA_PUBLICACAO_RENDER.md`.
