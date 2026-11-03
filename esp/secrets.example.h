#pragma once

// Copie para secrets.h (na mesma pasta do robo_literario_codigo.ino).
// Nunca coloque a service_role/secret key do Supabase no firmware.
// A chave "anon" é pública, não substitui políticas RLS no Supabase.
// Confira se a tabela public.sessoes_esp permite somente os acessos necessários.
// O caminho /rest/v1/sessoes_esp faz parte do endpoint atual do cenário A.
#define SUPABASE_REST_URL "https://SEU-PROJETO.supabase.co/rest/v1/sessoes_esp"
#define SUPABASE_ANON_KEY "SUA_CHAVE_PUBLICA_ANON"

// Não adicione WiFi SSID/senha aqui: a professora configura pelo QR.
