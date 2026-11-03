-- Executar UMA vez no SQL Editor do mesmo projeto Supabase do Robô Literário.
-- Acrescenta apenas comandos de encerramento. Não altera tabelas existentes.
-- O backend (service_role) escreve, a ESP (anon) SOMENTE lê pedidos válidos.
CREATE TABLE IF NOT EXISTS public.comandos_esp (
  sessao_id text PRIMARY KEY CHECK (sessao_id ~ '^ATV-[1-9][0-9]*$'),
  comando text NOT NULL DEFAULT 'fim' CHECK (comando = 'fim'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.comandos_esp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comandos_esp FROM anon, authenticated;
GRANT SELECT ON public.comandos_esp TO anon;
GRANT SELECT, INSERT, UPDATE ON public.comandos_esp TO service_role;
DROP POLICY IF EXISTS esp_consulta_finalizacao ON public.comandos_esp;
CREATE POLICY esp_consulta_finalizacao ON public.comandos_esp
  FOR SELECT TO anon USING (comando = 'fim' AND expira_em > now());
-- Não existe política de INSERT/UPDATE/DELETE para anon.
-- A escrita é feita apenas pelo backend autenticado, com a service_role.
