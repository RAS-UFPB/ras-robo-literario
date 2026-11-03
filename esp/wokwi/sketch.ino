// ARQUIVO GERADO: edite esp/robo_literario_codigo.ino, nunca este.
// Para atualizar: python esp/wokwi/gerar_sketch.py
#define ROBO_SIMULADOR_WOKWI 1

// O modo virtual usa o mesmo motor de sessões, NVS e Wi-Fi, mas substitui SOMENTE
// a entrada da câmera pelo Monitor Serial. Não habilitar esta macro na placa física.
#ifndef ROBO_SIMULADOR_WOKWI
#include "esp_camera.h"   // Driver de câmera real da ESP32-CAM
#include "quirc.h"        // Decodificador QR real (arquivos quirc do projeto)
#endif
#include <WiFi.h>         // Conexão Wi-Fi
#include <HTTPClient.h>   // Envio de requisição HTTP
#include <WiFiClientSecure.h> // HTTPS para a API REST do Supabase
#include <ArduinoJson.h>  // Parse e serialização de JSON
#include <LittleFS.h>     // Sistema de arquivos em flash
#include <Preferences.h>  // Credenciais persistentes na NVS
#include <mbedtls/md.h>     // SHA-256 (API md compatível entre versões do ESP32)
#include <esp_system.h>    // esp_random para salt do PIN

// Integração Supabase separada do firmware.
// Na ESP física: copie secrets.example.h para secrets.h e preencha SOMENTE com
// a URL da tabela e a chave pública/anon (nunca service_role/secret key).
// A rede Wi-Fi NÃO fica em secrets.h: ela vem do QR e é persistida na NVS.
#ifdef ROBO_SIMULADOR_WOKWI
// A simulação usa POST fictício e não necessita de credenciais reais.
#define SUPABASE_REST_URL "https://example.invalid/rest/v1/sessoes_esp"
#define SUPABASE_ANON_KEY "WOKWI_SEM_ACESSO_SUPABASE"
#else
#include "secrets.h"
#endif
// Pinos de feedback audiovisual
#define PIN_LED_OK    13   // LED — confirma leitura ao aluno
#define PIN_LED_ERR   2   // LED — pisca em loop em falha crítica de boot
#define PIN_BUZZER    14   // Buzzer passivo

/*
DEBOUNCE_MS — janela de tempo (ms) em que o mesmo QR é ignorado após uma leitura válida.
Evita que a câmera registre o mesmo código múltiplas vezes enquanto o aluno mantém o QR na frente da lente.
*/
#define DEBOUNCE_MS   2000
#define RETRY_HTTP_MS 10000  // intervalo para reenviar uma sessão pendente

// Caminho do arquivo de persistência no LittleFS
#define FLASH_FILE    "/sessao.json"
#define FLASH_TMP     "/sessao.tmp"
#define ATIVIDADE_FILE "/atividade.json"  // Progresso antes do QR de fim
#define ATIVIDADE_BAK  "/atividade.bak"
#define ATIVIDADE_TMP  "/atividade.tmp"
#define CONFIG_TIMEOUT_MS 180000UL
#define WIFI_RETRY_MS 15000UL
#define WIFI_TEST_TIMEOUT_MS 15000UL

// Pinout da câmera (AI-Thinker ESP32-CAM)
// Mapeamento fixo do módulo
#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1   // sem pino de reset físico neste módulo
#define CAM_PIN_XCLK     0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27
#define CAM_PIN_D7      35
#define CAM_PIN_D6      34
#define CAM_PIN_D5      39
#define CAM_PIN_D4      36
#define CAM_PIN_D3      21
#define CAM_PIN_D2      19
#define CAM_PIN_D1      18
#define CAM_PIN_D0       5
#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22

// Limites de capacidade
#define MAX_EQUIPES  10   // número máximo de equipes por sessão
#define MAX_CARTAS   16   // número máximo de cartas por rodada

//Estruturas de dados

/**
 * Rodada — representa a participação de uma equipe.
 *
 * @param equipe    número da equipe (lido do QR de equipe)
 * @param cartas    sequência de IDs de cartas escaneadas,
 *                  na ordem em que foram apresentadas
 * @param numCartas quantidade de cartas registradas até agora
 */
struct Rodada {
  uint8_t equipe;
  uint8_t cartas[MAX_CARTAS];
  uint8_t numCartas;
};

/**
 * Sessao — agrupa todas as rodadas de uma aula.
 *
 * @param id         identificador da sessão (campo "sid" do QR
 *                   de início, ex: "AULA01")
 * @param rodadas    vetor de rodadas registradas
 * @param numRodadas quantidade de rodadas concluídas/abertas
 */
struct Sessao {
  char    id[32];
  Rodada  rodadas[MAX_EQUIPES];
  uint8_t numRodadas;
};

// Enumeração de estados da máquina
enum Estado {
  AGUARD_INICIO,   // aguarda QR de início para criar a sessão
  AGUARD_EQUIPE,   // sessão aberta; aguarda QR de equipe
  LENDO_CARTAS,    // equipe ativa; aguarda QRs de carta ou troca de equipe
  ENVIANDO         // encerramento recebido; realizando o POST HTTP
};

// Variáveis globais
Sessao        sessao;                  // dados da sessão em memória
Estado        estado = AGUARD_INICIO;  // estado atual da máquina

uint32_t      ultimoQRHash = 0;     // debounce sem guardar credenciais na RAM
unsigned long ultimaLeitura = 0;       // timestamp (ms) da última leitura válida
unsigned long ultimaTentativaEnvio = 0;
bool          envioPendente = false;   // impede sobrescrever uma sessão ainda não enviada
#ifndef ROBO_SIMULADOR_WOKWI
struct quirc* qr = NULL;
#else
// Exclusivamente no Wokwi. Não existe interpretação de comandos por Serial na versão física.
String qrVirtual;
bool qrVirtualPendente = false;
String linhaSerialVirtual;
bool wifiForcadoOfflineVirtual = false;
bool postSimuladoLiberado = false; // padrão: POST fictício FALHA para preservar sessões
#endif
// O Wi-Fi é apenas transporte; a câmera e os QRs continuam operando offline.
String wifiSSID, wifiSenha;
String wifiNovoSSID, wifiNovaSenha;
bool modoConfiguracao = false;
bool wifiEmTeste = false;
unsigned long inicioModoConfiguracao = 0;
unsigned long inicioTesteWiFi = 0;
unsigned long ultimaConexaoWiFi = 0;
// O PIN fica na NVS apenas como SHA-256(salt + PIN); nunca aparece no log.
String wifiPinHash, wifiPinSalt, wifiPinPrimeiroUso;
uint8_t falhasPin = 0;
unsigned long bloqueioPinAte = 0;
const uint8_t MAX_FALHAS_PIN = 5;
const unsigned long BLOQUEIO_PIN_MS = 300000UL;
bool wifiOnlineAnterior = false;

// Protótipos
void   iniciarCamera();
#ifdef ROBO_SIMULADOR_WOKWI
void   gerenciarSerialVirtual();
void   executarComandoVirtual(const String& comando);
void   imprimirAjudaVirtual();
void   iniciarConexaoVirtual(const String& ssid, const String& senha);
#endif
void   iniciarWiFi();
void   gerenciarWiFi();
void   feedbackWifi(bool sucesso);
void   entrarModoConfiguracao();
void   sairModoConfiguracao();
bool   processarQRWifi(const String& payload);
bool   salvarCredenciais(const String& ssid, const String& senha, const String& pinInicial = "");
bool   pinValido(const String& pin);
String calcularHashPIN(const String& salt, const String& pin);
bool   processarAutorizacaoWiFi(const String& payload);
void   registrarProgresso();
bool   restaurarProgresso();
uint32_t hashQRCode(const String& texto);
bool   lerQRCode(String& resultado);
bool   processarQR(const String& payload);
bool   salvarEmFlash();
bool   carregarDoFlash();
bool   enviarHTTP();
void   resetarSessao();
void   feedbackOK();
void   feedbackERRO();
void   feedbackIgnorado();
void   beep(int freq, int durMs);
String serialisarSessaoJSON();
bool   ehCodigoBinarioCarta(const String& payload);
uint8_t codigoBinarioParaId(const String& codigo);
String idCartaParaCodigoBinario(uint8_t id);

//SETUP
//Serial → GPIO → Flash → Câmera → Wi-Fi → reenvio pendente → reset de sessão.

void setup() {
  Serial.begin(115200);

  // Configura pinos de feedback como saída e garante nível LOW
  pinMode(PIN_LED_OK,  OUTPUT);
  pinMode(PIN_LED_ERR, OUTPUT);
  pinMode(PIN_BUZZER,  OUTPUT);
  digitalWrite(PIN_LED_OK,  LOW);
  digitalWrite(PIN_LED_ERR, LOW);

  // Monta o sistema de arquivos; "true" formata se necessário
  if (!LittleFS.begin(true)) {
    Serial.println("[FLASH] Falha ao montar LittleFS");
  }

#ifndef ROBO_SIMULADOR_WOKWI
  qr = quirc_new();
  if(!qr){
    Serial.println("Erro ao alocar memória para o quirc no setup!");
  } else {
    quirc_resize(qr, 320, 240);
  }
  iniciarCamera();
#else
  Serial.println("[SIM] Wokwi: câmera substituída por SIM:QR:<texto>. Nenhum QR real é lido.");
  imprimirAjudaVirtual();
#endif
  iniciarWiFi();

  /*
  Reenvio de sessão pendente
  Se o envio anterior falhou (ex: Wi-Fi caiu), o arquivo /sessao.json estará presente.
  Tenta reenviá-lo antes de iniciar uma nova sessão. Se ainda falhar, o arquivo permanece para a próxima inicialização.
  */
  if (carregarDoFlash()) {
    envioPendente = true;
    estado = ENVIANDO;
    ultimaTentativaEnvio = millis();
    Serial.println("[FLASH] Sessão finalizada pendente; será reenviada quando houver Wi-Fi.");
  } else if (LittleFS.exists(FLASH_FILE)) {
    // Arquivo existente e inválido: nunca permitir que outra sessão o sobrescreva.
    envioPendente = true;
    estado = ENVIANDO;
    Serial.println("[FLASH] Arquivo de sessão finalizada inválido. Recupere antes de continuar.");
  } else if (restaurarProgresso()) {
    Serial.println("[FLASH] Atividade em andamento recuperada; continue lendo os QRs.");
  } else {
    resetarSessao();
    Serial.println("[SISTEMA] Pronto. Aguardando QR de início de sessão.");
  }
}

//  LOOP
//  Tenta ler um QR code a cada iteração via lerQRCode().
//  Ao obter um payload válido, aplica debounce e delega para processarQR().

void loop() {
#ifdef ROBO_SIMULADOR_WOKWI
  gerenciarSerialVirtual();
#endif
  gerenciarWiFi();

  String payload;
  if (modoConfiguracao) {
    if (!wifiEmTeste && lerQRCode(payload)) {
      // Nunca exibir o conteúdo bruto: QR de Wi-Fi contém uma senha.
      if (!processarQRWifi(payload)) Serial.println("[WIFI] QR não reconhecido ou inválido no modo de configuração.");
    }
    delay(20);
    return;
  }

  // Mantém o contrato do cenário A: sessão finalizada bloqueia novas sessões.
  if (envioPendente) {
    // Uma sessão já finalizada pode aguardar outro Wi-Fi para reenviar.
    // Apenas QR de autorização é admitido; cartas e novos inícios continuam bloqueados.
    if (lerQRCode(payload)) processarAutorizacaoWiFi(payload);
    unsigned long agora = millis();
    if (agora - ultimaTentativaEnvio >= RETRY_HTTP_MS) {
      ultimaTentativaEnvio = agora;
      if (WiFi.status() == WL_CONNECTED && carregarDoFlash() && enviarHTTP()) {
        LittleFS.remove(FLASH_FILE);
        LittleFS.remove(ATIVIDADE_FILE);
        LittleFS.remove(ATIVIDADE_BAK);
        envioPendente = false;
        feedbackOK();
        Serial.println("[HTTP] Sessão pendente reenviada com sucesso.");
        resetarSessao();
      }
    }
    delay(50);
    return;
  }

  if (lerQRCode(payload)) {
    // QRs de autorização só são avaliados entre atividades, jamais durante a leitura.
    // O PIN nunca é exibido no Serial e a falha não altera a sessão atual.
    if (processarAutorizacaoWiFi(payload)) {
      ultimoQRHash = hashQRCode(payload);
      ultimaLeitura = millis();
      delay(20);
      return;
    }
    unsigned long agora = millis();
    uint32_t hash = hashQRCode(payload);
    if (hash == ultimoQRHash && (agora - ultimaLeitura) < DEBOUNCE_MS) {
      feedbackIgnorado();
      return;
    }
    ultimoQRHash = hash;
    ultimaLeitura = agora;
    processarQR(payload);
  }
  delay(20);
}

/*
→ lerQRCode

Captura um frame da câmera e tenta decodificar um QR code usando a biblioteca quirc (embutida no esp32 core).
  Fluxo:
    1. Captura frame em GRAYSCALE via esp_camera_fb_get()
    2. Aloca contexto quirc e redimensiona para o tamanho do frame
    3. Copia buffer do frame para o quirc e finaliza a análise
    4. Se encontrar ao menos 1 QR, decodifica o primeiro
    5. Libera frame e contexto quirc

  @param resultado  String onde o payload decodificado é escrito
  @return true se um QR válido foi encontrado e decodificado
*/

bool lerQRCode(String& resultado) {
#ifdef ROBO_SIMULADOR_WOKWI
  // Simula APENAS a câmera. O retorno percorre os mesmos handlers físicos.
  if (!qrVirtualPendente) return false;
  resultado = qrVirtual;
  qrVirtual = "";
  qrVirtualPendente = false;
  return true;
#else
  // 1. Captura frame
if(!qr) return false;

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Falha ao capturar frame.");
    return false;
  }

  // 2. Copia buffer do frame para o quirc e processa
  uint8_t* buf = quirc_begin(qr, nullptr, nullptr);
  
  if (buf != nullptr) {
    // Evita estourar o buffer do quirc se a câmera mandar uma imagem maior do que o esperado
    size_t tamanho_esperado = fb->width * fb->height;

    Serial.println("2. Iniciando processamento pesado (quirc_end)...");

    memcpy(buf, fb->buf, tamanho_esperado);
    quirc_end(qr);
  } else {
    Serial.println("[CAM] Erro interno: Buffer do quirc está nulo.");
    esp_camera_fb_return(fb);
    return false;
  }


  // 3. Decodifica o primeiro QR encontrado (se houver)
  Serial.println("3. Verificando quantos QRs foram encontrados...");
  bool encontrado = false;
  int  numCodigos = quirc_count(qr);

  if (numCodigos > 0) {
    Serial.printf("4. Encontrados %d codigos. Extraindo o primeiro...\n", numCodigos);
    struct quirc_code code;
    struct quirc_data data;

    quirc_extract(qr, 0, &code);

    if (quirc_decode(&code, &data) == QUIRC_SUCCESS) {
      resultado  = String((char*)data.payload, data.payload_len);
      encontrado = true;
    } else {
      Serial.println("[QR] Frame com QR detectado mas decodificação falhou.");
    }
  }

  // 4. Libera recursos
  esp_camera_fb_return(fb);

  return encontrado;
#endif
}

/*
→ processarQR

Recebe o payload bruto, faz parse JSON e despacha para o tratamento correto conforme o campo "t" e o estado atual.
Retorna true se o QR foi processado com sucesso, false em caso de erro de parse, campo ausente ou QR incompatível com o estado atual.
*/
// Verifica só a rodada em andamento: outra equipe/rodada pode reutilizar a carta.
// Também funciona após recuperar as cartas já registradas no LittleFS.
bool cartaJaRegistrada(const Rodada& rodada, uint8_t idCarta) {
  for (uint8_t i = 0; i < rodada.numCartas; i++) {
    if (rodada.cartas[i] == idCarta) return true;
  }
  return false;
}

bool processarQR(const String& payload) {
  // As cartas do site usam a convenção binária 0000..1111.
  // Quando uma carta chega como binário puro, tratamos como leitura de carta.
  if (ehCodigoBinarioCarta(payload)) {
    if (estado != LENDO_CARTAS) {
      Serial.println("[ESTADO] Carta binária ignorada (nenhuma equipe ativa).");
      feedbackIgnorado();
      return false;
    }

    Rodada& rodadaAtual = sessao.rodadas[sessao.numRodadas - 1];
    uint8_t idCarta = codigoBinarioParaId(payload);
    if (cartaJaRegistrada(rodadaAtual, idCarta)) {
      Serial.printf("[CARTA] Código %s já utilizado nesta rodada; leitura ignorada.\n", payload.c_str());
      feedbackIgnorado();
      return false;
    }
    if (rodadaAtual.numCartas >= MAX_CARTAS) {
      Serial.println("[RODADA] Limite de cartas atingido.");
      feedbackERRO();
      return false;
    }

    rodadaAtual.cartas[rodadaAtual.numCartas++] = idCarta;
    registrarProgresso();

    feedbackOK();
    Serial.printf("[CARTA] Código %s adicionado (equipe %d, posição %d).\n",
                  payload.c_str(), rodadaAtual.equipe, rodadaAtual.numCartas);
    return true;
  }

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.println("[QR] JSON inválido.");
    feedbackERRO();
    return false;
  }

  const char* tipo = doc["t"];
  if (!tipo) {
    Serial.println("[QR] Campo 't' ausente.");
    feedbackERRO();
    return false;
  }

  // TIPO: "inicio"
  // Cria uma nova sessão com o ID fornecido em "sid".
  // Só é aceito no estado AGUARD_INICIO; caso contrário, é ignorado silenciosamente (sessão já em curso).
  if (strcmp(tipo, "inicio") == 0) {
    if (estado != AGUARD_INICIO) {
      Serial.println("[ESTADO] QR de início ignorado (sessão já em curso).");
      feedbackIgnorado();
      return false;
    }
    const char* sid = doc["sid"];
    if (!sid) {
      Serial.println("[QR] 'sid' ausente no QR de início.");
      feedbackERRO();
      return false;
    }
    strlcpy(sessao.id, sid, sizeof(sessao.id));
    estado = AGUARD_EQUIPE;
    registrarProgresso();
    feedbackOK();
    Serial.printf("[SESSAO] Iniciada: %s\n", sessao.id);
    return true;
  }

  // TIPO: "equipe"
  // Abre uma nova rodada para a equipe indicada em "eq".
  // Se uma rodada estava em curso (LENDO_CARTAS), ela é encerrada implicitamente antes de abrir a nova.
  if (strcmp(tipo, "equipe") == 0) {
    if (estado != AGUARD_EQUIPE && estado != LENDO_CARTAS) {
      feedbackIgnorado();
      return false;
    }

    // Loga o fechamento da rodada anterior, se houver
    if (estado == LENDO_CARTAS) {
      if (sessao.numRodadas >= MAX_EQUIPES) {
        Serial.println("[SESSAO] Número máximo de equipes atingido.");
        feedbackERRO();
        return false;
      }
      Serial.printf("[RODADA] Equipe %d encerrada com %d carta(s).\n",
                    sessao.rodadas[sessao.numRodadas - 1].equipe,
                    sessao.rodadas[sessao.numRodadas - 1].numCartas);
    }

    // Abre slot para a nova rodada
    if (!doc.containsKey("eq")) {
      Serial.println("[QR] 'eq' ausente no QR de equipe.");
      feedbackERRO();
      return false;
    }

    int eqLida = doc["eq"].as<int>();
    if (eqLida < 1 || eqLida > 255) {
      Serial.println("[QR] Número de equipe inválido.");
      feedbackERRO();
      return false;
    }

    uint8_t eq = (uint8_t)eqLida;
    sessao.rodadas[sessao.numRodadas].equipe    = eq;
    sessao.rodadas[sessao.numRodadas].numCartas = 0;
    sessao.numRodadas++;

    estado = LENDO_CARTAS;
    registrarProgresso();
    feedbackOK();
    Serial.printf("[EQUIPE] Equipe %d iniciou sua rodada.\n", eq);
    return true;
  }

  // TIPO: "carta"
  // Registra o ID da carta (campo "id") na sequência da rodada ativa. Só é aceito em LENDO_CARTAS.
  // A ordem de escaneamento é a ordem de apresentação da equipe — não necessariamente a ordem correta do texto.
  if (strcmp(tipo, "carta") == 0) {
    if (estado != LENDO_CARTAS) {
      Serial.println("[ESTADO] Carta ignorada (nenhuma equipe ativa).");
      feedbackIgnorado();
      return false;
    }

    Rodada& rodadaAtual = sessao.rodadas[sessao.numRodadas - 1];
    if (!doc.containsKey("id")) {
      Serial.println("[QR] 'id' ausente no QR de carta.");
      feedbackERRO();
      return false;
    }

    int idLido = doc["id"].as<int>();
    if (idLido < 0 || idLido > 15) {
      Serial.println("[QR] ID de carta inválido. Use 0 a 15 ou QR binário de 4 bits.");
      feedbackERRO();
      return false;
    }

    uint8_t idCarta = (uint8_t)idLido;
    if (cartaJaRegistrada(rodadaAtual, idCarta)) {
      Serial.printf("[CARTA] Código %s já utilizado nesta rodada; leitura ignorada.\n",
                    idCartaParaCodigoBinario(idCarta).c_str());
      feedbackIgnorado();
      return false;
    }
    if (rodadaAtual.numCartas >= MAX_CARTAS) {
      Serial.println("[RODADA] Limite de cartas atingido.");
      feedbackERRO();
      return false;
    }
    rodadaAtual.cartas[rodadaAtual.numCartas++] = idCarta;
    registrarProgresso();

    feedbackOK();
    Serial.printf("[CARTA] Carta %d (%s) adicionada (equipe %d, posição %d).\n",
                  idCarta, idCartaParaCodigoBinario(idCarta).c_str(),
                  rodadaAtual.equipe, rodadaAtual.numCartas);
    return true;
  }

  //TIPO: "fim"
  // Sinaliza o encerramento da atividade. O firmware:
  //   1. Transita para ENVIANDO
  //   2. Salva a sessão em flash (proteção contra falha)
  //   3. Tenta o POST HTTP
  //   4. Remove o arquivo se o envio tiver êxito
  //   5. Reseta para aguardar uma nova sessão
  if (strcmp(tipo, "fim") == 0) {
    if (estado != LENDO_CARTAS && estado != AGUARD_EQUIPE) {
      feedbackIgnorado();
      return false;
    }

    Serial.println("[SESSAO] QR de encerramento recebido. Preparando envio...");
    Estado estadoAnterior = estado;
    estado = ENVIANDO;
    if (!salvarEmFlash()) {
      // Nunca transmitir nem liberar o estado se não houver cópia permanente.
      estado = estadoAnterior;
      feedbackERRO();
      Serial.println("[FLASH] Falha ao finalizar. Mantenha o robô ligado e leia FIM novamente.");
      return false;
    }
    LittleFS.remove(ATIVIDADE_FILE);
    LittleFS.remove(ATIVIDADE_BAK);

    if (enviarHTTP()) {
      LittleFS.remove(FLASH_FILE);
      LittleFS.remove(ATIVIDADE_FILE);
      LittleFS.remove(ATIVIDADE_BAK);
      feedbackOK();
      Serial.println("[HTTP] Envio bem-sucedido.");
      resetarSessao();
    } else {
      // Mantém a sessão em memória e no LittleFS até conseguir reenviar.
      // Assim uma nova atividade não sobrescreve a sessão pendente.
      envioPendente = true;
      ultimaTentativaEnvio = millis();
      estado = ENVIANDO;
      feedbackERRO();
      Serial.println("[HTTP] Envio falhou. Leituras bloqueadas até o reenvio da sessão pendente.");
    }

    return true;
  }

  // QR de configuração não altera o Wi-Fi nem o estado pedagógico fora do modo.
  if (strcmp(tipo, "wifi") == 0 || strcmp(tipo, "wifi-auth") == 0) {
    Serial.println("[QR] QR de Wi-Fi ignorado: autorização necessária e nenhuma atividade pode estar aberta.");
    return false;
  }

  // QR com campo "t" desconhecido
  Serial.println("[QR] Tipo desconhecido (conteúdo omitido).");
  feedbackERRO();
  return false;
}

bool ehCodigoBinarioCarta(const String& payload) {
  if (payload.length() != 4) return false;

  for (size_t i = 0; i < payload.length(); i++) {
    if (payload[i] != '0' && payload[i] != '1') return false;
  }
  return true;
}

uint8_t codigoBinarioParaId(const String& codigo) {
  uint8_t valor = 0;
  for (size_t i = 0; i < codigo.length(); i++) {
    valor = (valor << 1) | (codigo[i] == '1' ? 1 : 0);
  }
  return valor;
}

String idCartaParaCodigoBinario(uint8_t id) {
  String codigo = "";
  for (int bit = 3; bit >= 0; bit--) {
    codigo += ((id >> bit) & 1) ? '1' : '0';
  }
  return codigo;
}

/*
→ serialisarSessaoJSON

Converte a struct Sessao em uma string JSON pronta para ser enviada via HTTP ou gravada em flash.

  Exemplo de saída:
  {
    "sessao_id": "AULA01",
    "rodadas": [
      { "equipe": 1, "sequencia": ["0011", "0001", "0100", "0010"] },
      { "equipe": 2, "sequencia": ["0001", "0010", "0011", "0100"] }
    ]
  }
*/
String serialisarSessaoJSON() {
  // 2048 bytes comportam até 10 rodadas × 16 cartas com folga
  DynamicJsonDocument doc(2048);

  doc["sessao_id"] = sessao.id;
  JsonArray rodadas = doc.createNestedArray("rodadas");

  for (uint8_t r = 0; r < sessao.numRodadas; r++) {
    JsonObject obj = rodadas.createNestedObject();
    obj["equipe"] = sessao.rodadas[r].equipe;
    JsonArray seq = obj.createNestedArray("sequencia");
    for (uint8_t c = 0; c < sessao.rodadas[r].numCartas; c++) {
      seq.add(idCartaParaCodigoBinario(sessao.rodadas[r].cartas[c]));
    }
  }

  String out;
  serializeJson(doc, out);
  return out;
}


/*
→ salvarEmFlash

Grava a sessão serializada em /sessao.tmp e renomeia para /sessao.json.
Somente confirma o encerramento quando a gravação foi concluída.
*/
bool salvarEmFlash() {
  File arquivo = LittleFS.open(FLASH_TMP, "w");
  if (!arquivo) {
    Serial.println("[FLASH] Não foi possível abrir arquivo final temporário.");
    return false;
  }
  String json = serialisarSessaoJSON();
  size_t escrito = arquivo.print(json);
  arquivo.close();
  if (escrito != json.length() || !LittleFS.rename(FLASH_TMP, FLASH_FILE)) {
    Serial.println("[FLASH] Falha ao finalizar a escrita da sessão.");
    LittleFS.remove(FLASH_TMP);
    return false;
  }
  Serial.println("[FLASH] Sessão finalizada salva no LittleFS.");
  return true;
}

/*
→ carregarDoFlash

Tenta carregar /sessao.json e reconstruir a struct Sessao.
Retorna true se encontrou e parseou dados válidos, false se o arquivo não existe ou o JSON está corrompido.
*/
bool carregarDoFlash() {
  if (!LittleFS.exists(FLASH_FILE)) return false;

  File f = LittleFS.open(FLASH_FILE, "r");
  if (!f) return false;

  String json = f.readString();
  f.close();

  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, json) != DeserializationError::Ok) return false;

  strlcpy(sessao.id, doc["sessao_id"] | "", sizeof(sessao.id));
  sessao.numRodadas = 0;

  for (JsonObject obj : doc["rodadas"].as<JsonArray>()) {
    if (sessao.numRodadas >= MAX_EQUIPES) break;
    Rodada& r   = sessao.rodadas[sessao.numRodadas];
    r.equipe    = (uint8_t)obj["equipe"].as<int>();
    r.numCartas = 0;
    for (JsonVariant valor : obj["sequencia"].as<JsonArray>()) {
      if (r.numCartas >= MAX_CARTAS) break;

      // Compatibilidade: versões antigas salvaram inteiros; a integração atual salva 4 bits.
      if (valor.is<const char*>()) {
        String codigo = valor.as<const char*>();
        if (ehCodigoBinarioCarta(codigo)) {
          r.cartas[r.numCartas++] = codigoBinarioParaId(codigo);
        }
      } else if (valor.is<int>()) {
        int id = valor.as<int>();
        if (id >= 0 && id <= 15) r.cartas[r.numCartas++] = (uint8_t)id;
      }
    }
    sessao.numRodadas++;
  }
  return sessao.numRodadas > 0;
}

/*
→ enviarHTTP

Serializa a sessão e faz um HTTP POST direto na API REST do Supabase.
Retorna true para respostas 2xx, false em qualquer outro caso (sem Wi-Fi, timeout, erro do Supabase etc.).
*/
bool enviarHTTP() {
#ifdef ROBO_SIMULADOR_WOKWI
  // NÃO chama a API nem salva dados remotos durante a simulação.
  // Exercita o mesmo fluxo: sucesso remove /sessao.json; falha preserva.
  if (wifiForcadoOfflineVirtual || WiFi.status() != WL_CONNECTED) {
    Serial.println("[SIM][HTTP] Sem Wi-Fi: sessão continua pendente no LittleFS.");
    return false;
  }
  if (!postSimuladoLiberado) {
    Serial.println("[SIM][HTTP] POST fictício recusado; use SIM:HTTP:OK para liberar.");
    return false;
  }
  Serial.println("[SIM][HTTP] POST fictício ACEITO (nenhuma requisição ao Supabase).");
  Serial.println("[SIM][SESSAO] " + serialisarSessaoJSON());
  return true;
#else
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Sem Wi-Fi.");
    return false;
  }

  WiFiClientSecure client;
  // Para o protótipo, evita falha por cadeia de certificado não configurada no ESP32.
  // Em implantação definitiva, prefira configurar o certificado raiz do servidor.
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, SUPABASE_REST_URL)) {
    Serial.println("[HTTP] Não foi possível iniciar a conexão HTTPS com o Supabase.");
    return false;
  }
  http.setConnectTimeout(4000);
  http.setTimeout(8000);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_ANON_KEY));
  http.addHeader("Prefer", "return=minimal");

  String body = serialisarSessaoJSON();
  Serial.println("[HTTP] Enviando sessão completa ao Supabase.");

  int code = http.POST(body);
  String resposta = code > 0 ? http.getString() : "";
  http.end();

  if (code >= 200 && code < 300) {
    Serial.printf("[HTTP] Supabase respondeu: %d\n", code);
    return true;
  }

  Serial.printf("[HTTP] Falha no Supabase. Código: %d\n", code);
  if (resposta.length() > 0) {
    Serial.println("[HTTP] Corpo da resposta: " + resposta);
  }
  return false;
#endif
}

/*
 * Wi-Fi por QR sem componentes adicionais:
 * - Primeira instalação (NVS sem perfil): QR wifi {t,s,p,k} define PIN (8-12 dígitos).
 * - Depois: QR wifi-auth {t,k} autorizado somente com sessão ociosa; abre 3 minutos.
 * - Segundo QR wifi {t,s,p} testa a nova rede, só então grava na NVS.
 * - Perfil pré-existente sem PIN: bloqueado para reconfiguração até migração segura.
 *   Não criar PIN via QR público nessa condição.
 * - PIN não é gravado em texto puro e nunca é enviado ao servidor.
 */
bool pinValido(const String& pin) {
  if (pin.length() < 8 || pin.length() > 12) return false;
  for (size_t i = 0; i < pin.length(); ++i) {
    if (pin[i] < '0' || pin[i] > '9') return false;
  }
  return true;
}

String calcularHashPIN(const String& salt, const String& pin) {
  String material = salt + ":" + pin;
  unsigned char hash[32] = {0};
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!mdInfo || mbedtls_md(mdInfo, (const unsigned char*)material.c_str(),
                             material.length(), hash) != 0) return "";
  static const char hexa[] = "0123456789abcdef";
  char resultado[65];
  for (int i = 0; i < 32; ++i) {
    resultado[i * 2] = hexa[hash[i] >> 4];
    resultado[i * 2 + 1] = hexa[hash[i] & 15];
  }
  resultado[64] = 0;
  material = "";
  return String(resultado);
}

bool salvarCredenciais(const String& ssid, const String& senha, const String& pinInicial) {
  String salt = wifiPinSalt;
  String hash = wifiPinHash;
  if (hash.length() == 0) {
    if (!pinValido(pinInicial)) return false;
    char novoSalt[17];
    snprintf(novoSalt, sizeof(novoSalt), "%08lx%08lx",
             (unsigned long)esp_random(), (unsigned long)esp_random());
    salt = String(novoSalt);
    hash = calcularHashPIN(salt, pinInicial);
    if (hash.length() == 0) return false;
  }
  StaticJsonDocument<384> doc;
  doc["s"] = ssid;
  doc["p"] = senha;
  doc["salt"] = salt;
  doc["hash"] = hash;
  String perfil;
  serializeJson(doc, perfil);
  Preferences prefs;
  if (!prefs.begin("wifi-robo", false)) return false;
  bool ok = prefs.putString("profile", perfil) == perfil.length();
  prefs.end();
  perfil = "";
  if (ok) {
    wifiPinSalt = salt;
    wifiPinHash = hash;
  }
  return ok;
}

bool processarAutorizacaoWiFi(const String& payload) {
  bool semAtividade = (estado == AGUARD_INICIO && !envioPendente) ||
                      (estado == ENVIANDO && envioPendente);
  if (modoConfiguracao || wifiEmTeste || !semAtividade ||
      payload.length() > 120 || wifiPinHash.length() != 64) return false;
  // Evita analisar textos comuns como PINs e evita vazamento via logs.
  if (!payload.startsWith("{\"t\":\"wifi-auth\"")) return false;
  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok ||
      strcmp(doc["t"] | "", "wifi-auth") != 0) return false;
  String recebido = doc["k"].is<const char*>() ? doc["k"].as<String>() : "";
  if (!pinValido(recebido)) return true; // tratado sem detalhar PIN ou conteúdo
  unsigned long agora = millis();
  if (bloqueioPinAte && (long)(agora - bloqueioPinAte) < 0) {
    Serial.println("[WIFI] Autorização bloqueada temporariamente.");
    return true;
  }
  String tentativa = calcularHashPIN(wifiPinSalt, recebido);
  recebido = "";
  uint8_t diferenca = 0;
  if (tentativa.length() != wifiPinHash.length()) diferenca = 1;
  else for (size_t i = 0; i < tentativa.length(); ++i) diferenca |= tentativa[i] ^ wifiPinHash[i];
  tentativa = "";
  if (diferenca == 0) {
    falhasPin = 0;
    bloqueioPinAte = 0;
    entrarModoConfiguracao();
    Serial.println("[WIFI] Autorização aceita. Mostre o QR da nova rede.");
  } else {
    if (++falhasPin >= MAX_FALHAS_PIN) {
      bloqueioPinAte = agora + BLOQUEIO_PIN_MS;
      falhasPin = 0;
      Serial.println("[WIFI] Muitas tentativas incorretas. Aguarde 5 minutos.");
    } else {
      Serial.println("[WIFI] Autorização recusada.");
    }
  }
  return true;
}

void iniciarWiFi() {
  WiFi.persistent(false); // antes de iniciar rádio: credenciais apenas no perfil NVS
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false); // tentativas controladas; sem loop bloqueante
  Preferences prefs;
  if (prefs.begin("wifi-robo", true)) {
    String perfil = prefs.getString("profile", "");
    prefs.end();
    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, perfil) == DeserializationError::Ok) {
      wifiSSID = String(doc["s"] | "");
      wifiSenha = String(doc["p"] | "");
      wifiPinHash = String(doc["hash"] | "");
      wifiPinSalt = String(doc["salt"] | "");
    }
    perfil = "";
  }
  if (wifiSSID.length() > 0 && wifiSSID.length() <= 32) {
#ifdef ROBO_SIMULADOR_WOKWI
    iniciarConexaoVirtual(wifiSSID, wifiSenha);
#else
    WiFi.begin(wifiSSID.c_str(), wifiSenha.length() ? wifiSenha.c_str() : nullptr);
#endif
    ultimaConexaoWiFi = millis();
    Serial.println("[WIFI] Tentando conexão com a rede salva.");
    if (wifiPinHash.length() != 64 || wifiPinSalt.length() != 16) {
      wifiPinHash = "";
      wifiPinSalt = "";
      Serial.println("[WIFI] Perfil antigo sem PIN: conexão permitida, troca de rede BLOQUEADA. Consulte guia de migração.");
    }
  } else {
    wifiSSID = "";
    wifiSenha = "";
    entrarModoConfiguracao();
    Serial.println("[WIFI] Primeiro uso: QR com rede e PIN de 8 a 12 dígitos, em até 3 minutos.");
  }
}

void entrarModoConfiguracao() {
  modoConfiguracao = true;
  inicioModoConfiguracao = millis();
  Serial.println("[WIFI] MODO CONFIGURAÇÃO ativo por 3 minutos (QRs de atividade pausados).");
}

void sairModoConfiguracao() {
  modoConfiguracao = false;
  Serial.println("[WIFI] Modo configuração encerrado; QRs pedagógicos liberados.");
}

bool processarQRWifi(const String& payload) {
  if (!modoConfiguracao || wifiEmTeste || payload.length() > 240) return false;
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok) return false;
  if (strcmp(doc["t"] | "", "wifi") != 0) return false;
  if (!doc["s"].is<const char*>() || !doc["p"].is<const char*>()) return false;
  // O PIN só vem junto ao primeiro QR, quando não existe rede salva.
  if (wifiSSID.length() == 0) {
    wifiPinPrimeiroUso = doc["k"].is<const char*>() ? doc["k"].as<String>() : "";
    if (!pinValido(wifiPinPrimeiroUso)) {
      wifiPinPrimeiroUso = "";
      Serial.println("[WIFI] Primeiro uso exige PIN numérico de 8 a 12 dígitos.");
      return false;
    }
  } else {
    wifiPinPrimeiroUso = "";
    if (wifiPinHash.length() == 0) return false;
  }
  String ssid = doc["s"].as<String>();
  String senha = doc["p"].as<String>();
  // Wi-Fi 2.4 GHz WPA/WPA2 Personal: 8-63 caracteres ou chave de 64 hex.
  bool senhaValida = senha.length() == 0 ||
      (senha.length() >= 8 && senha.length() <= 63) ||
      (senha.length() == 64);
  if (senha.length() == 64) {
    for (size_t i = 0; i < senha.length(); ++i) {
      if (!isxdigit((unsigned char)senha[i])) { senhaValida = false; break; }
    }
  }
  if (ssid.length() == 0 || ssid.length() > 32 || !senhaValida) {
    Serial.println("[WIFI] SSID/senha fora dos limites aceitos.");
    return false;
  }
  wifiNovoSSID = ssid;
  wifiNovaSenha = senha;
  wifiEmTeste = true;
  inicioTesteWiFi = millis();
  WiFi.disconnect(false, false);
#ifdef ROBO_SIMULADOR_WOKWI
  iniciarConexaoVirtual(wifiNovoSSID, wifiNovaSenha);
#else
  WiFi.begin(wifiNovoSSID.c_str(), wifiNovaSenha.length() ? wifiNovaSenha.c_str() : nullptr);
#endif
  Serial.println("[WIFI] QR recebido. Validando conexão antes de salvar...");
  return true;
}

void gerenciarWiFi() {
  unsigned long agora = millis();
  bool conectado = WiFi.status() == WL_CONNECTED;
#ifdef ROBO_SIMULADOR_WOKWI
  if (wifiForcadoOfflineVirtual) conectado = false;
#endif
  if (wifiEmTeste) {
    if (conectado && WiFi.SSID() == wifiNovoSSID) {
      if (salvarCredenciais(wifiNovoSSID, wifiNovaSenha, wifiPinPrimeiroUso)) {
        wifiSSID = wifiNovoSSID;
        wifiSenha = wifiNovaSenha;
        ultimaConexaoWiFi = agora;
        wifiOnlineAnterior = true;
        Serial.println("[WIFI] CONECTADO: nova rede testada e salva na memória NVS.");
        sairModoConfiguracao();
        feedbackWifi(true);
      } else {
        Serial.println("[WIFI] Falha na NVS. Rede anterior mantida, não confirmado.");
        feedbackWifi(false);
        WiFi.disconnect(false, false);
        if (wifiSSID.length()) {
#ifdef ROBO_SIMULADOR_WOKWI
          iniciarConexaoVirtual(wifiSSID, wifiSenha);
#else
          WiFi.begin(wifiSSID.c_str(), wifiSenha.length() ? wifiSenha.c_str() : nullptr);
#endif
        }
      }
      wifiNovoSSID = "";
      wifiNovaSenha = "";
      wifiPinPrimeiroUso = "";
      wifiEmTeste = false;
      return;
    }
    if (agora - inicioTesteWiFi >= WIFI_TEST_TIMEOUT_MS) {
      wifiEmTeste = false;
      wifiNovoSSID = "";
      wifiNovaSenha = "";
      wifiPinPrimeiroUso = "";
      WiFi.disconnect(false, false);
      if (wifiSSID.length()) {
#ifdef ROBO_SIMULADOR_WOKWI
        iniciarConexaoVirtual(wifiSSID, wifiSenha);
#else
        WiFi.begin(wifiSSID.c_str(), wifiSenha.length() ? wifiSenha.c_str() : nullptr);
#endif
      }
      ultimaConexaoWiFi = agora;
      Serial.println("[WIFI] TESTE FALHOU: rede anterior preservada. Gere outro QR.");
      feedbackWifi(false);
    }
    return;
  }
  if (conectado != wifiOnlineAnterior) {
    wifiOnlineAnterior = conectado;
    Serial.println(conectado ? "[WIFI] CONECTADO à rede salva." : "[WIFI] DESCONECTADO; leitura offline continua.");
  }
  if (modoConfiguracao && agora - inicioModoConfiguracao > CONFIG_TIMEOUT_MS) {
    sairModoConfiguracao();
  }
  if (!conectado && wifiSSID.length() && agora - ultimaConexaoWiFi >= WIFI_RETRY_MS) {
    ultimaConexaoWiFi = agora;
#ifdef ROBO_SIMULADOR_WOKWI
    if (wifiForcadoOfflineVirtual) return; // queda deliberada no teste
#endif
    WiFi.disconnect(false, false);
#ifdef ROBO_SIMULADOR_WOKWI
    iniciarConexaoVirtual(wifiSSID, wifiSenha);
#else
    WiFi.begin(wifiSSID.c_str(), wifiSenha.length() ? wifiSenha.c_str() : nullptr);
#endif
    Serial.println("[WIFI] Tentando reconexão sem bloquear a câmera.");
  }
}

// Sinais só no modo de configuração: 2 piscadas/bipes = salvo;
// 3 piscadas/bipes = falhou. Atividade usa feedback original e neutro.
void feedbackWifi(bool sucesso) {
  const int quantidade = sucesso ? 2 : 3;
  for (int i = 0; i < quantidade; i++) {
    digitalWrite(PIN_LED_OK, HIGH);
    tone(PIN_BUZZER, sucesso ? 1400 : 650, 110);
    delay(130);
    noTone(PIN_BUZZER);
    digitalWrite(PIN_LED_OK, LOW);
    delay(120);
  }
}

#ifdef ROBO_SIMULADOR_WOKWI
void iniciarConexaoVirtual(const String& ssid, const String& senha) {
  if (wifiForcadoOfflineVirtual) {
    Serial.println("[SIM][WIFI] Rede virtual desligada; tentativa suspensa.");
    return;
  }
  // A rede pública de teste do Wokwi fica no canal 6 e não pede senha.
  if (ssid == "Wokwi-GUEST" && senha.length() == 0) {
    WiFi.begin("Wokwi-GUEST", "", 6);
  } else {
    WiFi.begin(ssid.c_str(), senha.length() ? senha.c_str() : nullptr);
  }
}

void imprimirAjudaVirtual() {
  Serial.println("[SIM] Comandos (uma linha, Enter):");
  Serial.println("[SIM] Primeiro uso: SIM:QR:{\"t\":\"wifi\",\"s\":\"Wokwi-GUEST\",\"p\":\"\",\"k\":\"87654321\"}");
  Serial.println("[SIM] Troca: SIM:QR:{\"t\":\"wifi-auth\",\"k\":\"87654321\"} (somente fora de atividade)");
  Serial.println("[SIM] Depois da autorização: SIM:QR:{\"t\":\"wifi\",\"s\":\"Wokwi-GUEST\",\"p\":\"\"}");
  Serial.println("[SIM] SIM:QR:{\"t\":\"inicio\",\"sid\":\"ATV-23\"}");
  Serial.println("[SIM] SIM:QR:{\"t\":\"equipe\",\"eq\":1}");
  Serial.println("[SIM] SIM:QR:0000   SIM:QR:0001   SIM:QR:0010");
  Serial.println("[SIM] SIM:QR:{\"t\":\"fim\"}");
  Serial.println("[SIM] SIM:ESTADO | SIM:REINICIAR (sem botão ou atalho de configuração)");
  Serial.println("[SIM] SIM:WIFI:OFF | SIM:WIFI:ON");
  Serial.println("[SIM] SIM:HTTP:FALHA | SIM:HTTP:OK (POST fictício apenas)");
  Serial.println("[SIM] SIM:AJUDA");
}

void executarComandoVirtual(const String& comando) {
  if (comando.startsWith("SIM:QR:")) {
    String textoQR = comando.substring(7);
    if (textoQR.length() == 0 || textoQR.length() > 240 || qrVirtualPendente) {
      Serial.println("[SIM] QR vazio, longo demais ou leitura anterior ainda pendente.");
      return;
    }
    qrVirtual = textoQR;
    qrVirtualPendente = true;
    Serial.println("[SIM] QR entregue ao leitor virtual (conteúdo ocultado).");
  } else if (comando == "SIM:ESTADO") {
    Serial.printf("[SIM] Estado atividade: %d | rodadas: %d | pendente: %s | config: %s\n",
                  (int)estado, sessao.numRodadas, envioPendente ? "SIM" : "NÃO", modoConfiguracao ? "SIM" : "NÃO");
    Serial.printf("[SIM] Wi-Fi: %s | NVS com perfil: %s | POST fictício: %s\n",
                  wifiForcadoOfflineVirtual ? "OFF por comando" : (WiFi.status() == WL_CONNECTED ? "conectado" : "desconectado"),
                  wifiSSID.length() ? "SIM" : "NÃO", postSimuladoLiberado ? "permitido" : "recusado");
    Serial.printf("[SIM] PIN provisionado: %s | falhas consecutivas: %u\n",
                  wifiPinHash.length() == 64 ? "SIM" : "NÃO", (unsigned)falhasPin);
    Serial.printf("[SIM] LittleFS: atividade=%s, backup=%s, sessão final=%s\n",
                  LittleFS.exists(ATIVIDADE_FILE) ? "SIM" : "NÃO",
                  LittleFS.exists(ATIVIDADE_BAK) ? "SIM" : "NÃO",
                  LittleFS.exists(FLASH_FILE) ? "SIM" : "NÃO");
    if (sessao.id[0]) Serial.println("[SIM] Sessão de teste: " + serialisarSessaoJSON());
  } else if (comando == "SIM:WIFI:OFF") {
    wifiForcadoOfflineVirtual = true;
    WiFi.disconnect(false, false);
    WiFi.mode(WIFI_OFF);
    Serial.println("[SIM] Wi-Fi desligado para testar leitura offline e sessão pendente.");
  } else if (comando == "SIM:WIFI:ON") {
    wifiForcadoOfflineVirtual = false;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(false);
    if (wifiEmTeste) iniciarConexaoVirtual(wifiNovoSSID, wifiNovaSenha);
    else if (wifiSSID.length()) iniciarConexaoVirtual(wifiSSID, wifiSenha);
    ultimaConexaoWiFi = millis();
    Serial.println("[SIM] Rádio reativado, tentando rede salva (ou rede em teste).");
  } else if (comando == "SIM:HTTP:FALHA") {
    postSimuladoLiberado = false;
    Serial.println("[SIM] POST fictício vai falhar (padrão seguro).");
  } else if (comando == "SIM:HTTP:OK") {
    postSimuladoLiberado = true;
    Serial.println("[SIM] Próximos POSTs fictícios serão aceitos; NÃO enviam dados ao Supabase.");
  } else if (comando == "SIM:REINICIAR") {
    Serial.println("[SIM] Reiniciando chip. A NVS e o LittleFS devem ser relidos no boot.");
    Serial.flush();
    ESP.restart();
  } else if (comando == "SIM:AJUDA") {
    imprimirAjudaVirtual();
  } else {
    Serial.println("[SIM] Comando desconhecido. Digite SIM:AJUDA.");
  }
}

void gerenciarSerialVirtual() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      String comando = linhaSerialVirtual;
      linhaSerialVirtual = "";
      comando.trim();
      if (comando.length()) executarComandoVirtual(comando);
    } else if (linhaSerialVirtual.length() < 260) {
      linhaSerialVirtual += c;
    } else {
      linhaSerialVirtual = "";
      Serial.println("[SIM] Linha longa demais. Comando descartado.");
    }
  }
}
#endif // ROBO_SIMULADOR_WOKWI

uint32_t hashQRCode(const String& texto) {
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < texto.length(); i++) {
    hash ^= (uint8_t)texto[i];
    hash *= 16777619UL;
  }
  return hash;
}

// Snapshot da sessão em andamento: não confundir com /sessao.json finalizado.
// Arquivo anterior fica de reserva durante a troca para tolerar resets na escrita.
void registrarProgresso() {
  File arquivo = LittleFS.open(ATIVIDADE_TMP, "w");
  if (!arquivo) {
    Serial.println("[FLASH] Falha ao abrir snapshot de atividade.");
    return;
  }
  String json = serialisarSessaoJSON();
  size_t gravado = arquivo.print(json);
  arquivo.close();
  if (gravado != json.length()) {
    LittleFS.remove(ATIVIDADE_TMP);
    Serial.println("[FLASH] Falha ao salvar todas as cartas.");
    return;
  }
  LittleFS.remove(ATIVIDADE_BAK);
  if (LittleFS.exists(ATIVIDADE_FILE)) LittleFS.rename(ATIVIDADE_FILE, ATIVIDADE_BAK);
  if (LittleFS.rename(ATIVIDADE_TMP, ATIVIDADE_FILE)) {
    LittleFS.remove(ATIVIDADE_BAK);
  } else {
    Serial.println("[FLASH] Snapshot anterior preservado como backup.");
  }
}

bool restaurarProgresso() {
  const char* arquivos[] = { ATIVIDADE_FILE, ATIVIDADE_BAK };
  for (const char* caminho : arquivos) {
    if (!LittleFS.exists(caminho)) continue;
    File arquivo = LittleFS.open(caminho, "r");
    if (!arquivo) continue;
    DynamicJsonDocument doc(2048);
    DeserializationError erro = deserializeJson(doc, arquivo);
    arquivo.close();
    if (erro || !doc["sessao_id"].is<const char*>()) continue;
    String sid = doc["sessao_id"].as<String>();
    if (sid.length() == 0 || sid.length() >= sizeof(sessao.id)) continue;
    memset(&sessao, 0, sizeof(sessao));
    strlcpy(sessao.id, sid.c_str(), sizeof(sessao.id));
    for (JsonObject rj : doc["rodadas"].as<JsonArray>()) {
      if (sessao.numRodadas >= MAX_EQUIPES) break;
      int equipe = rj["equipe"] | 0;
      if (equipe < 1 || equipe > 255) break;
      Rodada& r = sessao.rodadas[sessao.numRodadas++];
      r.equipe = (uint8_t)equipe;
      for (JsonVariant valor : rj["sequencia"].as<JsonArray>()) {
        if (r.numCartas >= MAX_CARTAS) break;
        String codigo = valor.as<String>();
        if (ehCodigoBinarioCarta(codigo)) {
          r.cartas[r.numCartas++] = codigoBinarioParaId(codigo);
        }
      }
    }
    estado = sessao.numRodadas ? LENDO_CARTAS : AGUARD_EQUIPE;
    return true;
  }
  return false;
}

/*
→ iniciarCamera

Configura e inicializa o driver de câmera do ESP32.
Usa PIXFORMAT_GRAYSCALE (melhor contraste para QR codes) e FRAMESIZE_QVGA (320×240 px — suficiente para leitura).
Em caso de falha, o LED de erro pisca em loop indefinido pois sem câmera o sistema não pode operar.
*/
#ifndef ROBO_SIMULADOR_WOKWI
void iniciarCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = CAM_PIN_D0;
  config.pin_d1       = CAM_PIN_D1;
  config.pin_d2       = CAM_PIN_D2;
  config.pin_d3       = CAM_PIN_D3;
  config.pin_d4       = CAM_PIN_D4;
  config.pin_d5       = CAM_PIN_D5;
  config.pin_d6       = CAM_PIN_D6;
  config.pin_d7       = CAM_PIN_D7;
  config.pin_xclk     = CAM_PIN_XCLK;
  config.pin_pclk     = CAM_PIN_PCLK;
  config.pin_vsync    = CAM_PIN_VSYNC;
  config.pin_href     = CAM_PIN_HREF;
  config.pin_sscb_sda = CAM_PIN_SIOD;
  config.pin_sscb_scl = CAM_PIN_SIOC;
  config.pin_pwdn     = CAM_PIN_PWDN;
  config.pin_reset    = CAM_PIN_RESET;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_GRAYSCALE; // escala de cinza: melhor para QR
  config.frame_size   = FRAMESIZE_QVGA;      // 320×240 px
  config.jpeg_quality = 12;
  config.fb_count     = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Falha crítica ao iniciar câmera: 0x%x\n", err);
    // Pisca LED de erro indefinidamente — falha não recuperável
    while (true) {
      digitalWrite(PIN_LED_ERR, HIGH); delay(300);
      digitalWrite(PIN_LED_ERR, LOW);  delay(300);
    }
  }
  
    Serial.println("[CAM] Câmera iniciada com sucesso.");

    sensor_t * s = esp_camera_sensor_get();
    if (s != nullptr) {
      s->set_contrast(s, 1);       // Aumenta o contraste (ajuda a diferenciar preto do branco)
      s->set_brightness(s, 0);     // Brilho normal
      s->set_saturation(s, -2);    // Tira a saturação (já estamos usando grayscale, mas ajuda)
      s->set_whitebal(s, 1);       // Habilita balanço de branco automático
      s->set_awb_gain(s, 1);       // Ganho automático de branco
      s->set_exposure_ctrl(s, 1);  // Controle automático de exposição

      s->set_bpc(s, 1);            // Ativa correção de pixels pretos (reduz ruído)
      s->set_wpc(s, 1);            // Ativa correção de pixels brancos (reduz ruído)
      s->set_sharpness(s, 2);    // Força a nitidez no máximo (escala de -2 a 2)
      s->set_denoise(s, 1);      // Ativa a redução de ruído espacial
      s->set_gainceiling(s, (gainceiling_t)2); // Limita a granulação (escala vai até 6)

      s->set_lenc(s, 1);       // Correção de lente (clareia as bordas)
      s->set_dcw(s, 1);        // Correção avançada de escala
      s->set_aec2(s, 1);       // Processamento avançado de Exposição Automática
      s->set_ae_level(s, 0);   // Ajuste fino de luz alvo (-2 a 2). Mude para 1 ou 2 se a sala for muito escura.
    }


}

#endif // ROBO_SIMULADOR_WOKWI (câmera física)

/*
→ resetarSessao

Limpa toda a estrutura Sessao em memória, redefine o estado para AGUARD_INICIO e limpa o histórico de debounce.
Chamada ao final de cada sessão (após envio ou falha).
*/
void resetarSessao() {
  memset(&sessao, 0, sizeof(sessao));
  estado      = AGUARD_INICIO;
  ultimoQRHash = 0;
  Serial.println("[SESSAO] Sessão resetada. Aguardando QR de início.");
}

/*
→ FUNÇÕES DE FEEDBACK

feedbackOK       — leitura válida aceita pelo sistema
feedbackERRO     — erro interno (parse, limite, Wi-Fi etc.)
feedbackIgnorado — QR duplicado ou fora de contexto (silêncio)

IMPORTANTE: feedbackOK e feedbackERRO emitem o MESMO sinal audiovisual (1 bipe curto + LED). O aluno não consegue distinguir entre os dois casos — requisito intencional para não revelar acertos/erros durante a atividade. Somente o Serial Monitor diferencia os casos.
*/

// Sinal de leitura aceita — neutro para o aluno.
void feedbackOK() {
  digitalWrite(PIN_LED_OK, HIGH);
  beep(1000, 100);
  delay(150);
  digitalWrite(PIN_LED_OK, LOW);
}

// Sinal de erro interno — idêntico ao feedbackOK para o aluno.
void feedbackERRO() {
  digitalWrite(PIN_LED_OK, HIGH);
  beep(1000, 100);
  delay(150);
  digitalWrite(PIN_LED_OK, LOW);
}

// Leitura descartada (debounce ou estado incorreto) — sem sinal.
void feedbackIgnorado() {
  // Silêncio intencional
}

//beep
void beep(int freq, int durMs) {
  tone(PIN_BUZZER, freq, durMs);
  delay(durMs);
  noTone(PIN_BUZZER);
}
