-- CENÁRIO A: somente backend insere nesta tabela.
-- Confirma atomicamente que uma sessão já virou leituras; previne duplicação
-- por polling, reinício do site ou reenvio do POST da ESP.
-- Não altera nem apaga sessoes_esp, atividades, leituras ou pontuacoes.
CREATE TABLE IF NOT EXISTS public.importacoes_sessoes_esp (
  sessao_esp_id bigint PRIMARY KEY REFERENCES public.sessoes_esp(id) ON DELETE RESTRICT,
  sessao_id text NOT NULL UNIQUE,
  atividade_id integer NOT NULL,
  quantidade_leituras integer NOT NULL CHECK (quantidade_leituras > 0),
  importada_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS importacoes_esp_atividade_idx
  ON public.importacoes_sessoes_esp (atividade_id);

-- O navegador e a ESP NÃO precisam ler/escrever nesta tabela.
ALTER TABLE public.importacoes_sessoes_esp ENABLE ROW LEVEL SECURITY;
