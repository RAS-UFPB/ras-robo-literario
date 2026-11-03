# Revisão da integração ESP32-CAM ↔ Supabase ↔ painel

## O que existia nos arquivos recebidos

### Firmware ESP32

O firmware trabalha com uma máquina de estados:

1. `inicio` cria uma sessão pelo campo `sid`;
2. `equipe` abre uma rodada pelo campo `eq`;
3. `carta` acrescenta IDs à sequência da equipe;
4. `fim` serializa a sessão e envia por HTTP.

O JSON de sessão já existente era:

```json
{
  "sessao_id": "AULA01",
  "rodadas": [
    { "equipe": 1, "sequencia": [3, 1, 4, 2] }
  ]
}
```

Porém o `enviarHTTP()` ativo estava apontando para um servidor Node local em `/api/qr`.

### Backend/site

O `/api/qr` do site **não aceita uma sessão inteira**. Ele recebe uma leitura isolada:

```json
{
  "equipe": "Equipe 1",
  "codigoBinario": "0000"
}
```

Depois o backend resolve esse código contra a atividade ativa e grava em `leituras`.

A tabela `leituras` não pode receber diretamente o JSON da ESP porque exige:

- `atividade_id`;
- `equipe_id`;
- `frase_id`;
- `ordem`;
- `codigo_binario`;
- `fragmento`.

A ESP não conhece os IDs relacionais acima.

## Incompatibilidades encontradas

1. A ESP enviava `{sessao_id, rodadas}` para `/api/qr`, mas `/api/qr` exige `{equipe, codigoBinario}`.
2. O firmware ativo enviava para um IP local, não diretamente ao Supabase.
3. O site usa a convenção A=`0000`, B=`0001`, ..., H=`0111`, enquanto o firmware aceitava cartas apenas como JSON `{"t":"carta","id":...}`.
4. Não existe nos arquivos recebidos uma relação definida entre `sessao_id` da ESP e `atividades.id` do banco. Por isso não é seguro transformar automaticamente uma sessão ESP em registros de `leituras`.
5. A ESP podia sobrescrever uma sessão pendente no LittleFS: se um envio falhasse, uma nova sessão poderia usar o mesmo `/sessao.json` antes do reenvio.
6. O arquivo `.env` do ZIP do site e o firmware original continham credenciais em texto puro. A versão revisada entregue não redistribui esses valores.
7. `API_SECRET_KEY` aparece na configuração original, mas o backend recebido não valida `x-api-key` em `/api/qr`.
8. `backend/supabase.js` existe, mas o servidor principal recebido usa Prisma + `DATABASE_URL`; esse módulo não participa do fluxo atual.

## Solução aplicada nesta revisão

### 1. Nova tabela `sessoes_esp`

Foi criada uma caixa de entrada bruta no Supabase:

- `id`;
- `sessao_id`;
- `rodadas` (`jsonb`);
- `created_at`.

Arquivo: `site/supabase/integracao_esp.sql`.

A chave `anon` recebe apenas permissão de `INSERT` nessa tabela. O backend lê usando a conexão PostgreSQL/Prisma já existente.

### 2. ESP envia diretamente ao Supabase

O firmware revisado usa:

```text
https://SEU-PROJETO.supabase.co/rest/v1/sessoes_esp
```

com os headers `apikey`, `Authorization: Bearer ...`, `Content-Type: application/json` e `Prefer: return=minimal`.

A chave usada na placa deve ser a chave pública/anon, nunca a `service_role`.

### 3. Cartas binárias compatíveis com o site

A ESP passa a aceitar diretamente os QR Codes:

```text
0000
0001
0010
0011
0100
0101
0110
0111
```

Os QRs de controle continuam em JSON:

```json
{"t":"inicio","sid":"AULA01"}
{"t":"equipe","eq":1}
{"t":"fim"}
```

O formato antigo `{"t":"carta","id":0}` continua aceito para compatibilidade.

### 4. Sequência enviada como binário

A sessão passa a chegar no banco assim:

```json
{
  "sessao_id": "AULA01",
  "rodadas": [
    {
      "equipe": 1,
      "sequencia": ["0000", "0010", "0001"]
    }
  ]
}
```

Isso elimina a ambiguidade entre “ID numérico da carta” e `codigo_binario` usado pelo site.

### 5. Backend consegue quebrar o JSON sem alterar a interface

Foi adicionado:

```text
GET /api/esp/sessoes/latest
```

Ele lê a sessão mais recente e devolve as rodadas já normalizadas, por exemplo:

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

Nenhuma tela foi alterada para usar esse endpoint.

## O que ainda não deve ser inventado

A integração ainda não deve inserir automaticamente essas sequências em `leituras` enquanto não houver uma definição de como `sessao_id` identifica a `atividade` correta.

Isso é especialmente importante porque a ESP possui modo offline. Uma sessão antiga pode ser reenviada depois; associá-la simplesmente à “atividade ativa no momento do reenvio” pode colocar os dados na atividade errada.

Uma integração posterior precisa definir explicitamente uma destas relações, por exemplo:

- `sid` do QR de início corresponde ao ID da atividade; ou
- existe uma coluna/chave própria ligando sessão física e atividade.

Nenhuma dessas regras estava definida nos arquivos recebidos, então esta revisão não escolheu uma por conta própria.

## Tempo real

O firmware recebido foi projetado para enviar a sessão no QR `fim`. Portanto o Supabase recebe o conjunto das rodadas ao final da sessão.

O painel atual mostra o simulador “em tempo real” porque o simulador chama `/api/qr` a cada leitura. Fazer a ESP física aparecer carta a carta no mesmo fluxo exigiria mudar o protocolo para enviar cada carta no momento da leitura (ou criar outra tabela/evento), o que seria uma decisão de comportamento nova e não foi presumida nesta revisão.

## Segurança

Os ZIPs originais contêm credenciais reais em texto puro (`.env` e constantes do firmware). Se esses ZIPs ou o repositório tiverem sido compartilhados fora da equipe, é recomendável trocar as credenciais correspondentes. A entrega revisada usa placeholders e não inclui o `.env` original.
