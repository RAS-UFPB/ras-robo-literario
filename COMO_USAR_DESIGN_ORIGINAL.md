# Painel com QR de início da ESP — cenário A

Esta versão mantém o **HTML e CSS exatos** enviados para o painel, incluindo a caixa visível "QR de início desta atividade". A integração permanece no cenário A: os cartões chegam ao banco ao ler o QR `{"t":"fim"}`, e o backend os importa para a mesa.

## Arquivos

- `site/painel/index.html`: arquivo enviado pelo usuário, sem alterações.
- `site/painel/style.css`: arquivo enviado pelo usuário, sem alterações.
- `site/painel/app.js`: arquivo enviado, com ajustes pontuais para mostrar o QR de início usando `atividadeId` retornado pela API e consultar as leituras sem perder os cartões recebidos em lote.
- `site/backend/` e `esp/`: preservados do cenário A com correção de conexão da versão anterior.

## Usar

1. Extraia o ZIP completo. Se já tiver um `.env` válido, mantenha-o em `site/.env` (nunca publique nem compartilhe).
2. No terminal da pasta `site`, rode `npm install`, `npx prisma generate` e `npm start`.
3. No painel, clique em **Iniciar atividade**. A caixa **QR de início desta atividade** aparecerá com um texto como `{"t":"inicio","sid":"ATV-23"}`. O botão **Copiar** copia o conteúdo para gerar o QR físico ou testar no Wokwi.
4. No Wokwi, envie uma linha de cada vez: QR de início, QR da equipe (`{"t":"equipe","eq":1}`), binários `0000`, `0001`, `0010`, e por último `{"t":"fim"}`.
5. Depois do HTTP 201, o backend precisa estar conectado ao PostgreSQL para importar, e as leituras devem aparecer na mesa em alguns segundos. A pontuação depende de clicar em **Verificar resposta**.

A caixa gera **o conteúdo do QR**; não cria nem inicia uma conexão Wi-Fi com a ESP automaticamente.

## Se já tem o site instalado

Você pode substituir somente `site/painel/index.html`, `site/painel/style.css` e `site/painel/app.js` pelos equivalentes do ZIP só do painel, sem mexer no backend nem no `.env`.
