# ESP32-CAM — firmware físico, cenário A e Wi-Fi por QR sem botão

O `robo_literario_codigo.ino` lê QR início → equipe → cartas → fim, grava o progresso no LittleFS e só envia **a sessão completa** ao Supabase no QR de fim. A integração automática e a pontuação do site não foram alteradas.

## Instalação

1. Copie `secrets.example.h` para `secrets.h`, preencha URL da tabela `sessoes_esp` e chave **pública/anon**, nunca `service_role`. O arquivo real fica fora do Git. SSID, senha e PIN **não** devem ficar no `.ino` ou no `secrets.h`.
2. Use placa **AI Thinker ESP32-CAM**, core ESP32 compatível, ArduinoJson v6, quirc local e as bibliotecas originais.
3. Grave o firmware uma vez. **Não é necessário instalar botão, fio ou componente adicional para trocar de rede.** A câmera já existente lê os QRs de configuração.
4. O primeiro cadastro cria um PIN numérico de 8–12 dígitos e cadastra SSID/senha; os dados são salvos na NVS (PIN apenas como hash + salt). Na mudança de escola, leia primeiro o QR de autorização com PIN e depois o QR da rede nova.

Guia detalhado em `../CONFIGURACAO_WIFI_ESP32_CAM.md`, guia virtual em `wokwi/README.md`.

## QRs pedagógicos inalterados

```text
{"t":"inicio","sid":"ATV-23"}
{"t":"equipe","eq":1}
0000
0001
0010
{"t":"fim"}
```

O payload final continua `{"sessao_id":"ATV-23","rodadas":[{"equipe":1,"sequencia":["0000","0001","0010"]}]}`.

Não grave PINs/credenciais em repositórios públicos. A chave pública na ESP não substitui permissões RLS corretas no Supabase.
