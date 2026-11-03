# Robô Literário — nova configuração de Wi-Fi sem botão

**Base:** projeto completo `robo_literario_cenario_A_secrets_e_wokwi.zip`.

**Implementado:** câmera lê QR para primeiro cadastro e QR de autorização com PIN para troca, sem novo hardware. O QR da rede, após autorização, salva as credenciais na NVS apenas se conectar. PIN de 8 a 12 dígitos armazenado como hash SHA-256 com salt aleatório; limitação de tentativas; duração do modo 3 minutos. Site gera e apaga QR sem guardar PIN no backend.

**Cenário A:** sem alteração de estrutura do JSON, QR pedagógico, tempo de reenvio, importador, banco, pontuação ou mesa de montagem. A sessão pendente continua em LittleFS se o Wi-Fi falhar.

## Principais arquivos alterados

- `esp/robo_literario_codigo.ino` — fluxo QR com PIN; remove GPIO15/CONFIG.
- `esp/wokwi/sketch.ino` — versão virtual gerada a partir do firmware físico.
- `esp/wokwi/diagram.json` — botão externo removido.
- `site/painel/index.html` — escolha primeiro uso/trocar rede, PIN e QR de autorização.
- `site/painel/wifi-config.js` — lógica local QR e PIN, sem API.
- `site/painel/style.css` — estilos mínimos dos controles.
- `site/tests/wifi-config.test.js`, `site/tests/wokwi-virtual.test.js`, `site/tests/wifi-browser-e2e.py` — testes atualizados.
- Documentação `CONFIGURACAO_WIFI_ESP32_CAM.md`, `TESTAR_NO_WOKWI.md`, `esp/README.md`, `esp/wokwi/README.md` e referências auxiliares.

**Não alterados:** `site/backend/`, `site/prisma/`, `site/painel/app.js`, estrutura de banco, QRs pedagógicos e importador do cenário A.

## Atenção para projetos anteriores

Se você estiver reaproveitando a NVS do firmware que usava GPIO15, o perfil anterior **não tem PIN**. O novo código conecta à rede antiga, mas não permite alteração sem uma migração segura. Para teste no Wokwi, o mais simples é usar **um projeto novo**. Para hardware, leia `CONFIGURACAO_WIFI_ESP32_CAM.md` e proteja as sessões pendentes antes de fazer manutenção na NVS.

## Testes

- `cd site && npm test` — testes estáticos/lógicos do Node, inclusive importador (16 casos passaram no ambiente de elaboração).
- `cd site && python tests/wifi-browser-e2e.py` — Chromium com QR visual decodificado pelo OpenCV (passou).
- **Ainda não testados nesta entrega:** compilação Arduino ESP32 no Wokwi, execução dos QRs no firmware virtual, conexão a rede real, leitura óptica da ESP32-CAM e POST HTTPS real ao Supabase.

Para validar no Wokwi, abra `esp/wokwi/README.md` e cole os comandos de uma linha por vez. Nunca use PIN/SSID reais no simulador compartilhado.
