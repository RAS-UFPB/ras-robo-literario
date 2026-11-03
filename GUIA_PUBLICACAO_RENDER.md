# Robô Literário — publicação no Render (frontend e backend juntos)

Este guia foi preparado a partir dos **arquivos deste projeto**. O backend usa HTTP nativo do Node.js, **não Express**. O Render disponibilizará **um único Web Service** com frontend e API no mesmo domínio. O PostgreSQL e os PDFs continuam no **projeto existente do Supabase**; não crie outro banco, não publique chaves no navegador e não execute `prisma db push`, `prisma migrate reset` ou a seed no deploy.

## Antes de começar

Você precisará ter uma conta no GitHub, no Render e acesso ao projeto existente no Supabase. Instale [Git](https://git-scm.com/download/win) e Node.js 22.16.0 (ou outra versão Node 22 compatível com Prisma 7) caso queira testar localmente. O **ZIP entregue não inclui `.env` real nem `node_modules`**. Não envie o ZIP original com `.env` para o GitHub.

**Atenção às credenciais:** o ZIP enviado originalmente continha `site/.env` preenchido. Ele não está nesta versão. Se já foi compartilhado publicamente, enviado a outra pessoa ou commitado, gere novas credenciais no Supabase, troque a chave administrativa e atualize Render e ESP conforme as regras de acesso. Não poste nem envie as chaves em capturas de tela.

## Parte A — Criar o repositório no GitHub

1. Entre em https://github.com e escolha **New repository** (ou clique no `+` > **New repository**).
2. Nome sugerido: `robo-literario`. Marque **Private**. Deixe a criação de README e `.gitignore` pelo GitHub desmarcada, porque o projeto já possui arquivos.
3. Descompacte **`robo_literario_render_completo.zip`**. Abra o PowerShell **na pasta `robo_literario_pdf_completo_atualizado`**, ou seja, a pasta que contém `esp/`, `site/` e `render.yaml`.
4. Execute (substituindo `SEU_USUARIO` pelo seu usuário do GitHub):

   ```powershell
   git init
   git branch -M main
   git add .
   git status --short
   git ls-files | Select-String '(^|/)(\.env$|secrets\.h$|node_modules/|db\.json$)'
   ```

   O último comando **não deve listar segredos**. O arquivo `.env.example` é permitido: contém apenas exemplos. Na lista de alterações devem aparecer as pastas `esp`, `site`, `render.yaml` e o guia, sem `node_modules`.

5. Quando conferir os arquivos:

   ```powershell
   git commit -m "Preparar hospedagem no Render"
   git remote add origin https://github.com/SEU_USUARIO/robo-literario.git
   git push -u origin main
   ```

   O GitHub pode solicitar autenticação pelo navegador/Git Credential Manager. Se necessário, configure `git config --global user.name "Seu nome"` e `git config --global user.email "seu-email"` antes do commit.

6. Volte ao site do GitHub, abra o repositório privado e verifique que **não aparecem `.env`, `node_modules`, `secrets.h` nem credenciais**. O `.gitignore` da raiz e o do site protegem esses arquivos.

> Caso prefira GitHub Desktop, escolha **File > Add Local Repository** (ou crie o repositório local), confira as mudanças, faça **Publish repository** com **Keep this code private** ativado. Verifique os arquivos antes de publicar.

## Parte B — Criar o Web Service no Render

1. Acesse https://dashboard.render.com, crie uma conta e vincule o GitHub. Autorize o Render a acessar o repositório privado `robo-literario`.
2. Clique em **New > Web Service**. Escolha **Build and deploy from a Git repository** e selecione `SEU_USUARIO/robo-literario`.
3. Preencha exatamente os campos conhecidos:

   | Campo no Render | Preencher |
   |---|---|
   | Name | `robo-literario` (ou outro nome ainda disponível) |
   | Language / Runtime | `Node` |
   | Branch | `main` |
   | Root Directory | `site` |
   | Build Command | `npm ci && npx prisma generate` |
   | Start Command | `npm start` |
   | Instance Type / Plan | `Free` para testes |
   | Health Check Path, se disponível | `/api/ping` |
   | Region | Prefira a região disponível mais próxima do Supabase |

4. Na área **Environment / Environment Variables**, crie as variáveis **antes do deploy**:

   | Chave | Valor / como preencher |
   |---|---|
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22.16.0` |
   | `DATABASE_URL` | String de conexão **Session Pooler** do **Supabase existente**; veja Parte C |
   | `ADMIN_ACCESS_KEY` | Chave longa, única e aleatória para acesso da professora |
   | `SUPABASE_URL` | URL do projeto Supabase existente, `https://...supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Chave privada do Supabase **somente no Render**, nunca no GitHub/HTML |
   | `ESP_IMPORTACAO_AUTOMATICA` | Opcional. `true` (padrão), ou `false` apenas para depuração |

   **Não precisa definir** `PORT`: o Render fornece. **Não precisa definir** `API_SECRET_KEY`: o backend atual não utiliza essa variável. Não adicione uma seed automática, migration nem qualquer banco Render.

5. Clique em **Create Web Service / Deploy Web Service**. Abra **Events / Deploys / Logs** e acompanhe a instalação do npm, a geração do Prisma e o início do Node. Ao concluir, o Render fornece uma URL parecida com `https://robo-literario.onrender.com` (o nome só será esse se estiver disponível).
6. Confira `https://SUA-URL.onrender.com/api/ping`. O retorno esperado é JSON com `ok: true`. Abra a URL principal; a tela do painel deve aparecer.

**Configuração por `render.yaml`:** o projeto também inclui um arquivo **na raiz** que descreve **somente um serviço web gratuito**, sem banco Render. Alternativamente, em Render, **New > Blueprint** e selecione o repositório. O Render deverá solicitar os valores marcados `sync: false` (segredos), sem guardá-los no YAML. **Escolha UM método:** Web Service manual OU Blueprint, para não criar dois serviços.

## Parte C — Usar o Supabase já existente

1. Entre em https://supabase.com/dashboard e abra o **projeto que já armazena as atividades**.
2. Clique em **Connect**, selecione a string do **Session Pooler** (porta **5432**) e copie-a para `DATABASE_URL` do Render. A string costuma ter formato `postgresql://postgres.PROJECT_REF:SENHA@HOST_POOLER:5432/postgres`; acrescente `?sslmode=require` se não existir query string, ou `&sslmode=require` se já houver parâmetros. **Não use a string com placeholders sem substituí-los.**
3. Se a senha PostgreSQL tiver caracteres especiais (como `@`, `#`, `%`, `/`), use a versão **codificada para URL**. Não cole a senha avulsa em código.
4. Em **Project Settings > API Keys** (a nomenclatura pode variar), identifique a URL do projeto e a chave privada **service_role / secret** suportada pelo SDK; preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no Render. Essas informações são apenas para o **backend**. A chave pública/anon que o firmware utiliza não é a mesma chave privada do backend.
5. Em **Storage**, confirme que o bucket `contos-pdf` **já existe e continua privado**. Os PDFs são lidos pelo backend e enviados ao navegador por `/api/contos/<id>/pdf`; não é preciso tornar o bucket público. As operações de escrita no site exigem a chave administrativa.
6. Em **Table Editor**, confira as tabelas existentes, incluindo `contos`, `atividades`, `sessoes_esp` e `importacoes_sessoes_esp`. **Não execute o SQL de criação incluído como documentação nem a seed novamente**. Confirme o acesso em `https://SUA-URL.onrender.com/api/contos`: deverá retornar a listagem atual, e não contos de outro projeto.
7. Caso os logs indiquem erro SSL, autenticação ou pooler: confira string, usuário `postgres.<project-ref>`, senha com codificação, host, porta `5432` e `sslmode=require`. Não exponha a URL completa nos logs enviados para suporte.

## Parte D — Testar o funcionamento pela internet

1. Abra o endereço do Render no navegador do computador e também no celular. A professora **não precisa instalar nada** para acessar o painel.
2. Confira **Contos e atividades** e **Acervo**; os registros devem ser os mesmos já vistos localmente.
3. Em **Dashboard**, inicie uma atividade de teste. No **primeiro comando que altera dados**, o navegador pedirá a **chave administrativa** do Render. Isso é intencional: visitante sem a chave pode consultar, mas não criar, alterar, apagar ou pontuar. Digite a chave; o token fica **somente na memória da aba** e expira em aproximadamente 1 hora ou no reinício do servidor. No próximo comando de alteração, a chave poderá ser solicitada novamente.
4. Gere e confira os QR Codes de início e equipe. **A implementação, os códigos e o firmware não foram alterados**.
5. No **Simulador de leitura**, selecione uma equipe e registre `0000`, por exemplo. Se repetir a carta na mesma equipe/atividade, o sistema deve ignorá-la. Use **Mesa de montagem**, **Verificar resposta** e **Placar** para conferir a leitura e a pontuação. Prefira usar uma atividade de teste para não misturar leituras com sessões reais da ESP.
6. Na apresentação de um conto, confira a narração por voz (depende das vozes do dispositivo/navegador) e a visualização do PDF existente. Teste o envio/substituição/remoção **somente em um conto de teste**, verificando depois o bucket Supabase. Não foi reintroduzido destaque no PDF.
7. No robô físico, mantenha **cenário A**: início -> equipe -> cartas -> fim. A ESP envia a sessão ao **Supabase**, não ao endereço do Render. Quando o servidor estiver ativo, a rotina consulta as sessões a cada cerca de **5 segundos** e importa as novas. Caso o site não mostre a montagem, abra-o para acordar o Render gratuito, aguarde o backend ficar ativo e verifique logs `[ESP]`.
8. Se ocorrer erro, no Render vá a **Logs** e filtre por `[ESP]` ou `[API]`. Não compartilhe tokens, URLs com senhas ou logs que revelem dados privados.

## Parte E — Fazer alterações futuras e reverter

1. Faça backup do repositório ou crie uma branch para testar. Edite apenas os arquivos desejados.
2. No PowerShell, dentro da pasta do projeto:

   ```powershell
   git status
   git add .
   git diff --cached --stat
   git commit -m "Descrever alteracao"
   git push origin main
   ```

3. Como o deploy automático é por commit na branch `main`, o Render deverá iniciar um novo build quando receber o push. Confira **Deploys** e **Logs**, depois `/api/ping` e o painel.
4. Se o deploy falhar, o Render normalmente mantém a versão anterior. Confira os detalhes de **Deploys**. Para reverter um commit enviado, use `git revert HASH_DO_COMMIT`, depois `git push origin main`. Se necessário, em Render, selecione **Manual Deploy > Deploy a specific commit** conforme as opções disponíveis na sua conta.
5. Se modificar a senha do Supabase ou a chave administrativa, atualize o ambiente do Render. **Não grave essas chaves nos arquivos versionados.**

## Executar localmente no Windows 11

Entre em `site` pelo PowerShell e execute:

```powershell
Copy-Item .env.example .env
# Abra o arquivo .env e substitua os exemplos por valores do seu próprio Supabase.
# Mantenha NODE_ENV=development e PORT=3000 no uso local.
npm ci
npx prisma generate
npm test
npm start
```

Abra **http://localhost:3000**. Use `Ctrl + C` para encerrar. **Não execute o comando de seed para configurar a hospedagem**: o conteúdo já está no banco. Para testar sem conectar à ESP, use `ESP_IMPORTACAO_AUTOMATICA=false` apenas durante a investigação; no Render deixe `true` ou não defina.

## Limitações do Render gratuito (verificadas na documentação)

- O Render **suspende um Web Service gratuito após 15 minutos sem tráfego HTTP/WebSocket de entrada**. Consultas do próprio servidor ao Supabase **não mantêm o serviço acordado**. A reativação após nova visita leva **aproximadamente um minuto**, podendo variar.
- Enquanto estiver suspenso, **não ocorre a importação periódica** das sessões da ESP. As sessões já gravadas no Supabase permanecem no banco e, ao acordar, o importador pode recuperá-las. A implementação atual examina as **100 sessões mais recentes por ciclo**, o que deve ser considerado se houver um acúmulo muito grande durante a suspensão.
- O armazenamento do serviço é temporário. Este projeto não depende dele para os PDFs ou banco, pois ficam no Supabase. Tokens administrativos em memória desaparecem em reinícios; a professora fará login novamente quando necessário.
- O plano Free tem **750 horas de instância por workspace/mês** e limites de saída de dados e de minutos de build. A documentação informa que serviços com tráfego de saída incomumente alto, inclusive consultas a bancos externos, podem ser suspensos.
- Se o robô precisar ser acompanhado e importado **continuamente**, mesmo sem ninguém com o site aberto, **um plano pago de Web Service sem hibernação é necessário na arquitetura atual**. Para demonstrações e testes, o plano gratuito é suficiente desde que se considere o despertar.
- A arquitetura atual deve utilizar **uma única instância** do site. A prevenção de sessões duplicadas é persistente no banco, mas cache local e login são armazenados em memória da instância.

Documentação oficial consultada: https://render.com/docs/free , https://render.com/docs/web-services , https://render.com/docs/deploys , https://render.com/docs/node-version e https://supabase.com/docs/guides/database/connecting-to-postgres .

## O que foi testado nesta entrega

- `npm test` — **44 de 44 testes passaram** (43 existentes + 1 integração nova que inicia servidor e simula banco/Storage).
- Inicialização de servidor Node com `PORT` e ambiente de produção fictício — **passou**; `/api/ping` e `/` deram HTTP 200 e `/api/atividade` sem autenticação deu HTTP 401.
- O teste de Prisma Client `prisma generate` **não pôde concluir neste ambiente**, porque a tentativa de baixar o motor do Prisma de `binaries.prisma.sh` falhou por DNS/acesso externo (`EAI_AGAIN`). A instalação `npm ci` limpa também não concluiu por indisponibilidade do registro npm neste ambiente. O ZIP original incluía `node_modules` local, **que não foi colocado nas entregas**. O primeiro deploy no Render precisará instalar dependências e baixar o motor normalmente.
- **Não houve** testes reais no Render, Supabase real, navegador automatizado completo ou ESP física. Testes com dados externos, rede e hardware deverão ser realizados após autorização/publicação.
