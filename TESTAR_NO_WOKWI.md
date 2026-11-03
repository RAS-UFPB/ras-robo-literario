# Testar o modo Wi-Fi sem botão no Wokwi

Abra `esp/wokwi/README.md` para o passo a passo completo. **Não existe mais botão CONFIG ou comando SIM:CONFIG**.

No primeiro uso com flash vazia:

```text
SIM:QR:{"t":"wifi","s":"Wokwi-GUEST","p":"","k":"87654321"}
```

Depois de configurar e reiniciar, com o robô ocioso:

```text
SIM:QR:{"t":"wifi-auth","k":"87654321"}
SIM:QR:{"t":"wifi","s":"Wokwi-GUEST","p":""}
```

O site pode copiar esses dois tipos de comando, **somente** com a rede e PIN fictícios. O envio de sessões ao Supabase é simulado; para testar o envio real, use a ESP física.
