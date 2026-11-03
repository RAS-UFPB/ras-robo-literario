# ras-robo-literario

Painel do professor para o Robô Literário. O projeto usa Node.js, Prisma e PostgreSQL/Supabase.

## Alterações desta versão

- perguntas dos contos possuem somente pergunta + resposta esperada;
- perguntas, desafios e dicas ficam permanentemente no banco;
- `trechos_embaralhar` continua sendo a tabela permanente dos trechos A-H;
- apresentação em tela cheia com a pergunta centralizada;
- atalhos de **Dica**, **Desafio** e **Resposta** dentro da apresentação;
- cartões de intervenção mais simples, com ícones e menos títulos repetidos;
- desafios possuem a coluna opcional `momento`, preenchida com os momentos definidos no material pedagógico;
- dicas possuem `trecho_id` opcional para permitir vínculo futuro com um trecho específico;
- as dicas fornecidas no PDF permanecem gerais (`trecho_id = NULL`), pois o material não informa qual dica pertence a qual trecho;
- os trechos aparecem conforme os QR Codes/binários são lidos;
- ao verificar a reconstrução, posições corretas ficam verdes e incorretas ficam vermelhas com o trecho esperado;
- o reset de rodadas não apaga o conteúdo pedagógico permanente.

## Atualizar o banco existente

O Supabase já contém as tabelas de execução (`atividades`, `frases`, `equipes`, `leituras`, `pontuacoes`) e `trechos_embaralhar`.

1. Abra o **SQL Editor** do Supabase.
2. Abra o arquivo `supabase/conteudo_pedagogico.sql` no projeto e **cole o conteúdo dele** no SQL Editor.
3. Clique em **Run**. O script pode ser executado novamente: ele usa `IF NOT EXISTS` e também atualiza instalações anteriores adicionando `desafios.momento` e `dicas.trecho_id`.
4. No terminal do projeto, execute:

```bash
npm install
npx prisma generate
npm run seed:conteudo
```

O seed cadastra/atualiza **Os Sete Corvos** sem duplicar perguntas, desafios, dicas ou os trechos A-H.

> Não execute apenas o texto `supabase/conteudo_pedagogico.sql` dentro do SQL Editor. Esse é o caminho do arquivo; o editor precisa receber o conteúdo SQL do arquivo.

## Rodar

```bash
npm start
```

Depois acesse `http://localhost:3000`.

## Dicas vinculadas a trechos

A estrutura já aceita uma dica específica para um trecho por meio de `dicas.trecho_id`.

Atualmente todas as cinco dicas do material ficam com `trecho_id = NULL`, portanto são dicas gerais do conto. Isso é intencional: os PDFs não determinam uma relação do tipo “Trecho A → Dica 2”. Quando a equipe pedagógica definir essas associações, basta preencher o vínculo; não é necessário mudar o schema novamente.

## QR/binário de teste dos trechos

Enquanto a integração definitiva com ESP/QR Code não for definida, a atividade usa a convenção de teste já compatível com o projeto:

- A = `0000`
- B = `0001`
- C = `0010`
- D = `0011`
- E = `0100`
- F = `0101`
- G = `0110`
- H = `0111`

A ordem correta da narrativa continua armazenada separadamente em `ordem_correta`.

## Integração ESP32 → Supabase

A integração física não usa mais `/api/qr` como destino da ESP. O endpoint `/api/qr` permanece no projeto para o simulador do painel, que envia uma leitura isolada no formato `{ equipe, codigoBinario }`.

A ESP envia diretamente para a tabela `public.sessoes_esp` uma sessão inteira:

```json
{
  "sessao_id": "AULA01",
  "rodadas": [
    { "equipe": 1, "sequencia": ["0000", "0010", "0001"] }
  ]
}
```

### Criar a tabela da ESP

1. Abra `supabase/integracao_esp.sql`.
2. Cole o conteúdo no SQL Editor do Supabase e execute.
3. Rode `npx prisma generate` depois de atualizar o `schema.prisma`.
4. Na ESP, configure a URL REST no formato `https://SEU-PROJETO.supabase.co/rest/v1/sessoes_esp` e a chave pública/anon.

O backend pode conferir o último envio já separado por equipe e sequência em:

```text
GET /api/esp/sessoes/latest
```

Exemplo de resposta:

```json
{
  "sessao": {
    "id": "12",
    "sessaoId": "AULA01",
    "rodadas": [
      {
        "ordemRodada": 1,
        "equipeNumero": 1,
        "equipe": "Equipe 1",
        "sequencia": ["0000", "0010", "0001"]
      }
    ]
  }
}
```

### Por que `sessoes_esp` é separada de `leituras`?

`leituras` exige `atividade_id`, `equipe_id` e `frase_id`. O firmware recebido não possui esses IDs: ele conhece apenas `sessao_id`, o número da equipe e os códigos das cartas. Por isso, gravar a ESP diretamente em `leituras` exigiria inventar uma associação que não existe no projeto.

A tabela `sessoes_esp` funciona como caixa de entrada bruta. O próximo passo para alimentar automaticamente a mesa de montagem é definir, de forma explícita, a relação entre `sessao_id` do QR de início e a `atividade` do banco. Esta versão não cria essa relação por conta própria.

### Tempo real

O firmware recebido acumula as cartas e envia a sessão somente quando lê o QR de `fim`. Assim, o registro em `sessoes_esp` aparece ao final da sessão, não a cada carta. O simulador do painel continua em tempo real porque usa `/api/qr` diretamente.

## Cenário A — importação automática das sessões da ESP

Ao ler o QR final `{"t":"fim"}`, a ESP envia o JSON completo para `sessoes_esp`.
O backend consulta essa tabela a cada cinco segundos e, se `sessao_id` for
`ATV-<ID da atividade>`, importa as leituras para a atividade correta. A mesa do
painel atualiza automaticamente após a importação, mas a pontuação continua
sendo salva ao clicar em **Verificar resposta**.

**Nova etapa no Supabase:** execute o SQL
`supabase/importacao_automatica_cenario_a.sql` e depois `npx prisma generate`.
Para configuração, instruções e restrições veja
`../LEIA_PRIMEIRO_CENARIO_A.md` no ZIP completo.

## Wi-Fi configurável da ESP32-CAM

O painel agora possui uma página **Configurar Wi-Fi**, acessível pela navegação principal (no lugar de Relatórios) e pelo ícone de Wi-Fi do cartão Status da integração no Dashboard. O formulário não ocupa mais espaço no Dashboard. O QR de Wi-Fi é criado **no próprio navegador** (`painel/qr-local.js`, `painel/wifi-config.js`) e não transita pelo backend. Não há endpoint novo, nem alteração no PostgreSQL/Supabase.

A ESP **não precisa de botão adicional**: o primeiro cadastro configura um PIN por QR e a troca de escola utiliza QR de autorização seguido de QR da nova rede. Consulte `../CONFIGURACAO_WIFI_ESP32_CAM.md` e `../esp/README.md`. A informação **Conexão API** não significa que a ESP esteja online.

Teste automatizado local sem depender do banco:

```bash
npm test
```


### Testar ESP virtualmente (sem a placa)

Abra `../TESTAR_NO_WOKWI.md`: o projeto `../esp/wokwi/` permite simular a ESP no Wokwi. O cartão Wi-Fi do dashboard tem botão **Copiar comando para Wokwi**, disponível apenas para a rede fictícia `Wokwi-GUEST` sem senha. Não há alteração no backend ou no esquema do banco.


### QR de início gerado automaticamente

Ao iniciar uma atividade, o dashboard exibe o QR de início pronto para a câmera da ESP32-CAM ler.
O botão **Ampliar QR Code** facilita a leitura quando a tela está distante do robô.
O conteúdo do QR continua idêntico ao recebido do backend; na ausência desse campo,
usa `{"t":"inicio","sid":"ATV-<id da atividade>"}`. O texto para testes técnicos
ainda pode ser visto em **Ver código em texto (opcional)**. A atividade encerrada
não mantém o QR antigo na tela. O QR é produzido localmente com `qr-local.js`;
não foram alterados firmware, API ou banco de dados.
