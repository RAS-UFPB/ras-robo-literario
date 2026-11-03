# Corrigir erro de autenticação no Supabase (cenário A)

O ZIP **não contém** `.env` com credenciais reais. O arquivo `.env.example` é somente um exemplo.

1. No terminal em `site/`, pressione `Ctrl + C` para parar todas as tentativas.
2. No Supabase Dashboard, clique em **Connect** e copie a connection string **Session pooler** (porta 5432), adequada para backend persistente em redes IPv4. Não confunda a connection string com Project URL ou Publishable key.
3. Em `site/.env`, defina `DATABASE_URL="postgresql://..."` com a senha **Database password** atual do projeto. Se a senha contiver `@`, `#`, `%`, `/`, `?`, `&` ou `:`, faça percent-encoding desses caracteres na parte da senha. Não exponha o valor em prints, mensagens ou no Git.
4. Se não souber a senha, redefina-a no dashboard do Supabase e atualize as configurações de todos os clientes do PostgreSQL.
5. Com clientes que usam credenciais antigas desligados, aguarde o bloqueio temporário do Supavisor terminar.
6. Execute `npm run verificar:banco` uma vez. Se retornar `[OK]`, execute `npm start`.
7. O importador agora pausa após erro de autenticação, exigindo **reiniciar o site** depois de corrigir `.env`. Não substitua o conteúdo real de `.env` pelo exemplo.

**O que não fazer:** não apagar tabelas, não executar novamente migrations nem SQL de criação, não colocar `sb_publishable_...` em `DATABASE_URL`. Essa chave é usada somente na ESP, para a API REST.

Opcional para abrir o painel enquanto ajusta a conexão, adicione `ESP_IMPORTACAO_AUTOMATICA=false` ao `.env`; isso desativa apenas o importador, e não torna o banco do site funcional se a senha estiver errada. Remova essa linha ao terminar.

## Arquivos alterados

- `backend/importador-sessoes-esp.js`: interrompe repetição de tentativas depois de falha de autenticação; evita repetir logs idênticos de erros transitórios.
- `backend/server.js`: aceita desativação temporária do importador via `.env`.
- `backend/diagnosticar-banco.js`: novo teste de conexão, sem imprimir a URL ou senha.
- `package.json`: script `npm run verificar:banco`.
- `tests/importador-sessoes-esp.test.js`: teste novo para o bloqueio de repetição.

O firmware da ESP, o painel e as tabelas **não foram alterados**.
