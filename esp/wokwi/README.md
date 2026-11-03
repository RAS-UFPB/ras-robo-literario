# Testar virtualmente no Wokwi — sem botão CONFIG

`sketch.ino` é gerado do firmware físico com `python esp/wokwi/gerar_sketch.py`. Não há botão CONFIG no diagrama e nem comando `SIM:CONFIG`. A câmera é simulada via Monitor Serial (`SIM:QR:<payload>`); a NVS e o LittleFS usam as APIs da ESP. O POST **nunca** acessa Supabase, apenas simula aceitação/falha.

## Abrir projeto limpo

1. Em https://wokwi.com/projects/new/esp32, crie um **novo projeto** para começar com NVS sem perfil anterior.
2. Copie `sketch.ino`, `diagram.json`, `libraries.txt` e `partitions.csv` para o editor; use ArduinoJson 6.21.5 e partições que incluam LittleFS.
3. Clique em Start Simulation, abra o Monitor Serial, envie **uma linha por vez** e pressione Enter.
4. Use **somente** `Wokwi-GUEST` (aberta) e PIN **fictício** `87654321`.

## Primeiro Wi-Fi e reinicialização

```text
SIM:QR:{"t":"wifi","s":"Wokwi-GUEST","p":"","k":"87654321"}
SIM:ESTADO
SIM:REINICIAR
SIM:ESTADO
```

Espere `CONectado: nova rede testada e salva` (maiúsculas podem variar), `PIN provisionado: SIM` e depois `Tentando conexão com a rede salva`. O reset não deve apagar a NVS.

## Autorização, PIN errado e troca

A ESP está ociosa após a primeira configuração. Um QR de Wi-Fi direto **sem autorização** deve ser ignorado:

```text
SIM:QR:{"t":"wifi","s":"Wokwi-GUEST","p":""}
SIM:QR:{"t":"wifi-auth","k":"00000000"}
SIM:QR:{"t":"wifi-auth","k":"87654321"}
```

O correto abre 3 minutos de configuração. Agora faça o teste de rede inválida e confirme que o perfil antigo não é perdido:

```text
SIM:QR:{"t":"wifi","s":"REDE-INEXISTENTE","p":"senhaerrada"}
```

Espere aproximadamente 15 segundos e consulte `SIM:ESTADO`; volte a mostrar a rede fictícia (se a janela ainda estiver aberta):

```text
SIM:QR:{"t":"wifi","s":"Wokwi-GUEST","p":""}
SIM:ESTADO
```

Para testar as 5 tentativas erradas/bloqueio, reinicie após a troca concluída e envie cinco `wifi-auth` com PINs errados diferentes.

## Cenário A: leitura, queda, reset, sessão pendente

```text
SIM:HTTP:FALHA
SIM:QR:{"t":"inicio","sid":"ATV-23"}
SIM:QR:{"t":"equipe","eq":1}
SIM:QR:0000
SIM:WIFI:OFF
SIM:QR:0001
SIM:QR:0010
SIM:ESTADO
SIM:REINICIAR
SIM:ESTADO
```

Confirme que recuperou o JSON com as três cartas. Uma tentativa de `wifi-auth` **durante essa atividade** deve ser ignorada. Depois finalize a sessão offline:

```text
SIM:WIFI:OFF
SIM:QR:{"t":"fim"}
SIM:ESTADO
```

Com `pendente: SIM`, a autorização agora **pode** ser usada para trocar de rede. Ou restaure a antiga para reenviar:

```text
SIM:WIFI:ON
SIM:HTTP:OK
SIM:ESTADO
```

Aguarde o retry (~10 s), confirme `POST fictício ACEITO`, `pendente: NÃO` e JSON completo. Os dados NÃO chegam à tabela real `sessoes_esp`.

**Observação:** no Wokwi a entrada do Monitor Serial pode exibir o comando digitado, com PIN. Nunca use credenciais verdadeiras. Se reutilizar o projeto virtual anterior à adição do PIN, a NVS terá um perfil antigo: ele conecta, mas a troca por QR é bloqueada. Use um projeto novo ou limpe apenas o perfil NVS de maneira consciente.

## Limitações

A simulação não inclui câmera real, roteador de escola, autenticação WPA2 real, acesso ao banco, placa AI-Thinker física nem avaliação de sua alimentação/PSRAM. A compilação do firmware e as respostas reais de NVS/Wi-Fi ainda precisam ser testadas no Wokwi pela pessoa que abrir o projeto.
