# Wi-Fi sem botão adicional — ESP32-CAM (cenário A)

## O que mudou

A ESP32-CAM utiliza **a câmera existente** para ler QRs, sem botão CONFIG no GPIO15 e sem novos componentes. O site gera os QRs localmente (não envia PIN ou Wi-Fi à API). O cenário A permanece igual: QR início → equipe → cartas → fim → JSON completo para `sessoes_esp`, com reenvio e arquivos LittleFS.

### 1. Primeira configuração (NVS sem perfil)

1. Instale o firmware **uma vez** e ligue a placa. Sem perfil de Wi-Fi, ela abre automaticamente uma janela de configuração de **3 minutos**.
2. No painel, em **Wi-Fi da ESP32-CAM**, selecione **Configurar pela primeira vez**.
3. Defina um **PIN numérico de 8 a 12 dígitos**; guarde-o em lugar seguro. Ele será necessário para futuras trocas. Escolha números não óbvios.
4. Digite SSID e senha de uma rede **2,4 GHz**. Clique **Gerar QR do Wi-Fi** e aponte à câmera.
5. A ESP testa a nova conexão por até 15 segundos. Se conectar, salva em `Preferences`/NVS **num único perfil**: SSID, senha, salt aleatório e hash SHA-256(salt:PIN). PIN puro não é gravado.
6. **Dois bipes/piscadas** indicam que salvou; **três** indicam falha. Para ver detalhes, consulte Monitor Serial a 115200. Se a janela expirar, reinicie a placa **somente se não estiver lendo uma atividade**.

Exemplo de payload gerado pelo site (dados **fictícios**, não use PIN 87654321 numa escola):

```json
{"t":"wifi","s":"Wokwi-GUEST","p":"","k":"87654321"}
```

### 2. Trocar de escola / de Wi-Fi (sem novo componente)

1. A professora **encerra a atividade**; sessões finalizadas com envio pendente também permitem trocar de rede.
2. No painel, selecione **Trocar de rede / escola**; informe o **PIN que definiu na primeira configuração**.
3. Clique **Gerar QR de autorização** e mostre o QR à câmera (fora de uma atividade).
4. Após `[WIFI] Autorização aceita`, a ESP entra por **3 minutos** no modo de configuração, pausando QRs pedagógicos.
5. Preencha a nova rede e clique em **Gerar QR do Wi-Fi**. Mostre o segundo QR. A ESP só altera as credenciais salvas se a rede nova realmente conectar.
6. Com sucesso, volta a ler QRs pedagógicos. Se uma sessão finalizada estiver pendente, a ESP pode reenviá-la após recuperar a conexão.

Autorização de exemplo:

```json
{"t":"wifi-auth","k":"87654321"}
```

Segundo QR de exemplo:

```json
{"t":"wifi","s":"Wokwi-GUEST","p":""}
```

**Não é uma conexão direta site → ESP**: a câmera lê os QRs. O site não tem como verificar se o dispositivo os recebeu. Confirmar pelos bipes, LEDs e Monitor Serial. O QR fica visível por no máximo 90 segundos, mas qualquer pessoa próxima pode fotografá-lo enquanto aparece.

### 3. Proteção e limitações

- QRs de autorização são ignorados durante uma atividade em andamento. Só funcionam com robô ocioso ou com sessão **já finalizada e pendente de envio**.
- O PIN é comparado por hash com salt da NVS; após 5 tentativas erradas, o firmware aplica bloqueio temporário de 5 minutos. O PIN **pode ser reutilizado** se fotografado: ele é um controle de acesso local, não substitui autenticação criptográfica forte nem protege a tela contra observadores.
- Não grave PIN e senha em logs nem copie QR real para um Wokwi compartilhado. O botão **Copiar comando para Wokwi** só permite a rede fictícia `Wokwi-GUEST` e o PIN fictício `87654321`.
- Se perder o PIN, não existe recuperação pelo site (propositadamente). Um técnico deverá reprovisionar o dispositivo, com cautela para não perder sessões LittleFS.
- **Migrar da versão antiga com botão:** se a NVS já contiver perfil Wi-Fi **sem PIN**, a placa ainda tenta conectar normalmente, mas **não permite troca por QR sem autenticação**. Antes de apagar a NVS, envie/resgate eventuais sessões pendentes; com um procedimento de manutenção apropriado, apague **apenas o perfil NVS** e faça o primeiro cadastro novamente. Não formate o LittleFS nem apague a flash inteira sem backup das atividades. No Wokwi, comece com **um novo projeto/flash vazia** para testar o primeiro cadastro, ou providencie a limpeza do perfil antigo.
- A NVS pode ser extraída de hardware sem proteção de flash; o hash com salt não é proteção equivalente a armazenamento seguro. Não use PINs óbvios nem mostre os QRs a terceiros.
- O firmware original ainda usa `LittleFS.begin(true)`: se a montagem falhar, a formatação automática pode apagar dados. Isso já existia e precisa ser reavaliado antes de uso de produção. Da mesma forma, o HTTPS do firmware físico usa `client.setInsecure()`, que não verifica o certificado do servidor. A alteração de PIN não resolve esses riscos preexistentes.
- `esp/secrets.h` (criado a partir de `secrets.example.h`) continua contendo **somente** a URL REST e a chave pública/anon; nunca `service_role`.

### 4. Cenário A e testes físicos

Os QRs pedagógicos não mudaram:

```text
{"t":"inicio","sid":"ATV-23"}
{"t":"equipe","eq":1}
0000
0001
0010
{"t":"fim"}
```

Conferir na placa física: leitura real de ambos QRs de configuração, reconhecimento de uma rede válida, NVS após reiniciar, rede inválida sem sobrescrever perfil anterior, recusa de PIN incorreto/QR de troca durante atividade, leitura sem internet, recuperação via LittleFS, sessão finalizada pendente, envio HTTPS **real** e importação automática/placar no site. Wokwi **não** cobre leitura ótica da câmera nem envio Supabase real.

Guia de simulação: `esp/wokwi/README.md`.
