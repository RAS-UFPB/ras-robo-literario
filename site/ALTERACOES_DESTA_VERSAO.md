# Alterações desta versão

## Interface de apresentação

- pergunta centralizada no espaço útil da tela;
- atalhos com ícones para Dica, Desafio e Resposta;
- intervenções sem subtítulos repetidos como “Uma ajudinha para continuar” ou “Atenção, escritores!”;
- contexto discreto: `Conto • Pergunta X de Y`;
- cores consistentes: dica laranja, desafio azul, resposta verde;
- ícones repetidos também nos cartões normais de dica/desafio/resposta;
- ao abrir uma intervenção, as setas não trocam a pergunta até o cartão ser fechado.

## Banco

- `desafios.momento` guarda o momento pedagógico definido no material;
- `dicas.trecho_id` é opcional e referencia `trechos_embaralhar.id`;
- as dicas atuais permanecem gerais (`trecho_id = NULL`), pois os PDFs não definem a associação entre cada dica e cada trecho;
- nenhuma tabela de execução/QR foi recriada.

## Arquivos principais alterados

- `painel/index.html`
- `painel/style.css`
- `painel/app.js`
- `backend/server.js`
- `backend/seed-conteudo.js`
- `backend/data/sete-corvos.json`
- `prisma/schema.prisma`
- `supabase/conteudo_pedagogico.sql`
- `README.md`

## Integração ESP32 / Supabase

- adicionada a tabela de entrada `sessoes_esp` (`supabase/integracao_esp.sql`);
- a ESP física deixa de depender do IP local `/api/qr` e envia a sessão diretamente à API REST do Supabase;
- o formato das sequências da ESP passa a usar os mesmos códigos binários do painel (`0000`, `0001`, ...);
- adicionado `GET /api/esp/sessoes/latest` para o backend ler e normalizar a sessão mais recente;
- não foi criada associação automática com `leituras`, pois não existe no projeto uma relação definida entre `sessao_id` e `atividade_id`;
- nenhuma alteração visual foi necessária no painel.
