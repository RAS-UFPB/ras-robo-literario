# Atualização mais recente — Wi-Fi sem botão, protegido por PIN

**Esta seção substitui as instruções antigas de botão CONFIG/GPIO15 citadas em versões anteriores.**

- `esp/robo_literario_codigo.ino`: removido GPIO15/CONFIG; primeiro QR inclui PIN; mudança usa QR `wifi-auth` (PIN hash + salt na NVS, limite de tentativas) e depois QR da rede. Aceita autorização somente sem atividade aberta, inclusive quando há sessão finalizada aguardando reenvio. Mantém cenário A, LittleFS, reconexão e POST completo.
- `esp/wokwi/`: sketch regenerado do firmware real e botão removido do `diagram.json`; somente SIM:QR para entrada fictícia da câmera, POST fictício sem Supabase.
- `site/painel/index.html`, `style.css`, `wifi-config.js`: dois fluxos no cartão Wi-Fi, QR de autorização e QR de rede, sem alterar outras seções ou enviar dados à API.
- `site/tests/`: testes de QR, proteção, Wokwi e preservação do importador. Veja `CONFIGURACAO_WIFI_ESP32_CAM.md` e `TESTAR_NO_WOKWI.md`.

## Compatibilidade com versão anterior

Se a NVS já possui Wi-Fi salvo **sem PIN** (versão com botão), o perfil continua conectando, mas a troca por QR fica bloqueada até reprovisionamento seguro. Não apague a flash completa nem o LittleFS enquanto houver sessões pendentes. No Wokwi, crie um projeto limpo para testar o primeiro uso com PIN.
