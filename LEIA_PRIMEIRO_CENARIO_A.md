# Robô Literário — Cenário A com importação automática (sem PowerShell)

Fonte: `integracao_esp_supabase_completa(1).zip` enviado pela equipe.

## O que faz

1. Professora cria uma atividade no site; aparece o conteúdo EXATO do QR de início:
   `{"t":"inicio","sid":"ATV-<ID REAL>"}`.
2. A ESP recebe esse QR, `{"t":"equipe","eq":1}`, os QRs de cartas de 4 bits e
   `{"t":"fim"}`. O firmware original **só envia a sessão inteira quando lê `fim`**.
3. O JSON é salvo na tabela `public.sessoes_esp`, que **já foi criada no cenário A**.
4. O backend (Node) consulta a tabela de cinco em cinco segundos; identifica a atividade
   por `ATV-ID`, valida todos os códigos contra as frases cadastradas e registra as leituras
   **na ordem recebida e para a equipe correspondente**.
5. A mesa do painel consulta novas leituras de três em três segundos. Para atribuir pontos,
   a professora continua usando **Verificar resposta** (10 pontos por posição correta,
   5 por dupla consecutiva correta), sem mudar o algoritmo atual.

## Etapas de instalação

1. **Salve uma cópia** do seu projeto atual e substitua os arquivos da pasta `site/`
   pelos do novo ZIP; mantenha o `.env` REAL que já funciona, fora do controle de versão.
2. No Supabase > SQL Editor execute, na ordem, caso ainda não tenha criado a primeira:
   - `site/supabase/integracao_esp.sql` (tabela `sessoes_esp`, do cenário A antigo);
   - **`site/supabase/importacao_automatica_cenario_a.sql` (NOVA)** — cria a tabela
     de controle `importacoes_sessoes_esp` e previne importações duplicadas.
3. No terminal **dentro da pasta `site`**, rode:

   ```bash
   npm install
   npx prisma generate
   npm start
   ```

4. Abra `http://localhost:3000` e crie uma atividade NOVA com:
   `O gato | encontrou | uma estrela`.
5. Copie **exatamente** o QR que aparecer abaixo da atividade, como:
   `{"t":"inicio","sid":"ATV-23"}` (ID é somente um exemplo!).
   O QR real deve conter exatamente esse texto JSON, sem aspas extras.
6. Passe no Wokwi cenário A ou na ESP (um por vez):

   ```text
   {"t":"inicio","sid":"ATV-23"}  # use ID real do site
   {"t":"equipe","eq":1}
   0000
   0001
   0010
   {"t":"equipe","eq":2}
   0000
   0010
   0001
   {"t":"fim"}
   ```

   No Wokwi, digite somente o JSON (sem o comentário `# use ID real ...`).
   No equipamento, use QRs com o mesmo conteúdo. **Não use a versão da opção B**
   que envia a cada carta para `eventos_esp`; use o firmware deste ZIP que envia
   a sessão inteira para `sessoes_esp`.

7. Aguarde a confirmação `HTTP 201` ou outra resposta HTTP 2xx na ESP;
   com o painel aberto, depois de alguns segundos a Equipe 1 aparecerá como
   `O gato / encontrou / uma estrela`, e a Equipe 2 como
   `O gato / uma estrela / encontrou` quando selecionada no campo Equipe.
   Clique em **Verificar resposta** na respectiva equipe:
   - Equipe 1 = 40/40 pontos;
   - Equipe 2 = 10/40 pontos.

## Como conferir se funcionou

- Supabase (sessão recebida):

  ```sql
  SELECT * FROM public.sessoes_esp ORDER BY id DESC LIMIT 5;
  ```

- Supabase (sessões já importadas pelo backend):

  ```sql
  SELECT * FROM public.importacoes_sessoes_esp ORDER BY importada_em DESC LIMIT 5;
  ```

- Backend: `http://localhost:3000/api/esp/importacao/status`
  (`ultimaImportacao` e `ultimoErro`).
- Leituras atuais: `http://localhost:3000/api/leituras?equipe=Equipe%201`
  (mostradas apenas para a atividade ativa).

## Pontos importantes

- **O QR `sid` precisa ser `ATV-<atividadeId>`**. Registros antigos com `AULA01`
  não são associados automaticamente, porque o banco não informa a qual atividade
  pertenciam. Isso evita associar uma aula à atividade errada.
- A sessão precisa estar completa (`fim`). **Não é tempo real a cada carta**.
- Não rode o script PowerShell antigo; ele não é necessário para sessões novas.
- Cada atividade foi tratada como **uma sessão completa**. Se a ESP repetir o envio
  devido a problema de rede, `sessao_id` é usado para impedir duplicações. Para
  uma nova sessão independente, crie uma **nova atividade** no site.
- Uma atividade criada com códigos além de `1111` não é compatível com este firmware
  de 4 bits (máximo de 16 códigos distintos por atividade).
- O backend não mistura uma importação com leituras manuais já cadastradas para
  aquela atividade/equipe. Se testar o simulador do site antes, comece outra atividade
  ou limpe as mesas antes do envio da ESP.
- Sessões recebidas atrasadas são associadas ao ID correto, mesmo que a atividade
  já não esteja ativa. O painel principal só mostra a atividade atualmente ativa.
- O resultado da importação é persistido no banco na mesma transação das leituras.
  A pontuação **não** é salva até a professora clicar em **Verificar resposta**.
- A antiga tabela `eventos_esp` da opção B, caso exista, **não é usada** aqui e não
  precisa ser apagada para executar o cenário A.
- Na versão atual, a rede Wi-Fi é configurada por QR e guardada na NVS, enquanto a URL REST e a chave pública/anon ficam no arquivo local `esp/secrets.h` (copie `esp/secrets.example.h`). Nunca versionar `.env`, `secrets.h` preenchido nem chaves secretas.
- Não foi feito teste real no Supabase nem compilação na ESP física. Foram executados
  testes automatizados da lógica de importação com banco simulado.

## Arquivos alterados/adicionados

- `site/backend/importador-sessoes-esp.js` — **novo**, sincroniza e importa com transação.
- `site/backend/server.js` — liga o sincronizador a cada 5s e expõe rota de diagnóstico.
- `site/prisma/schema.prisma` — adiciona `ImportacaoSessaoEsp`.
- `site/supabase/importacao_automatica_cenario_a.sql` — **novo**, tabela de controle.
- `site/painel/app.js` — mostra QR correto da atividade e atualiza mesa a cada 3s.
- `site/painel/index.html` e `style.css` — campo do QR e texto adequado ao cenário A.
- `site/tests/importador-sessoes-esp.test.js` — testes de importação (sem banco real).
- `esp/robo_literario_codigo.ino` — **inalterado** em relação ao ZIP recebido.

Teste unitário: `cd site && node --test tests/importador-sessoes-esp.test.js`.

> **Nota:** a seção anterior descreve o histórico da integração. Na versão com Wi-Fi por QR, consulte `esp/README.md` e `CONFIGURACAO_WIFI_ESP32_CAM.md` para instruções atualizadas.
