# Acervo de contos e narração por voz

Este documento descreve a implementação sobre o ZIP `robo_literario_cenario_A_secrets_e_wokwi(1).zip`.
A identidade visual e o cenário A da ESP foram mantidos. Não há mudança no schema Prisma, SQL, firmware, configuração Wi-Fi ou importação de sessões.

## Como executar

1. Entre na pasta `site/`.
2. Configure as variáveis de ambiente usando `.env.example` (não coloque segredos nos arquivos do painel).
3. Execute `npm install`, `npx prisma generate` e `npm start`.
4. Acesse `http://localhost:3000`.

## Como usar o Acervo

1. Abra **Acervo** no menu superior.
2. Selecione o conto e, se necessário, uma atividade.
3. Consulte os trechos completos em ordem correta, as perguntas e respostas esperadas, as dicas (incluindo seus vínculos por `trecho_id`, quando existem) e desafios/momentos.
4. Selecione uma atividade para ver seus blocos e binários sem misturá-los com os trechos permanentes do conto.
5. Clique em **Apresentar trechos**. O botão é desativado quando uma atividade selecionada não corresponde ao conto, evitando confusão em sala. Desmarque a atividade para apresentar apenas o conto.

**Vínculo atividade/conto:** o banco fornecido NÃO tem uma coluna `atividade.conto_id` ou tabela de associação. A rota de consulta compara os blocos e ordens, exigindo correspondência integral com os trechos do conto. Por isso a interface usa **trechos correspondentes** em vez de afirmar a existência de um relacionamento formal. Atividades sem correspondência não aparecem no seletor do Acervo; continuam existindo no banco e podem ser usadas no Dashboard.

**PDF original:** neste ZIP, `prisma/schema.prisma`, o servidor e os arquivos estáticos não oferecem campo, rota ou armazenamento de PDF. Não foi criada tabela, campo, migração nem pasta paralela. O Acervo indica indisponibilidade. Para adicionar abertura de PDFs, será preciso fornecer a versão que contém o mecanismo existente ou informar como esse arquivo foi armazenado no Supabase. A visualização de PDFs reais não está implementada nesta entrega.

## Como usar a narração

1. Em **Contos e atividades**, clique em **Apresentar pergunta no quadro**, depois no ícone **Trechos**. Ou entre pelo botão **Apresentar trechos** do Acervo.
2. Escolha um trecho no seletor. A narração usa somente o `texto` retornado do banco para aquele trecho; não resume nem edita o conteúdo.
3. Escolha uma voz brasileira disponível e a velocidade (0,75×, 1×, 1,25× ou 1,5×).
4. Clique em **▶ Ouvir** para iniciar, **⏸ Pausar / ▶ Continuar** e **■ Parar** para controlar.
5. Selecione outro trecho, volte às perguntas, mude de conto ou saia do modo de apresentação para interromper a fala.

O código utiliza **um único motor** em `painel/narracao.js`, com `speechSynthesis`, `SpeechSynthesisUtterance`, `cancel`, `pause`, `resume` e `voiceschanged`. Não produz arquivos de áudio nem altera a ESP. O texto grande é dividido em partes menores sem descartar caracteres; cada fala é iniciada após a anterior terminar. Fala antiga não pode continuar depois de uma troca de trecho graças ao controle de geração.

### Limitações dos dispositivos

- A Web Speech API é suportada em navegadores modernos, mas as vozes são fornecidas pelo sistema/navegador; alguns dependem de recursos de síntese que exigem rede.
- Se `getVoices()` não tiver voz `pt-BR`, a tela oferece **Automática (tentar pt-BR)**: o site envia `lang = 'pt-BR'` sem escolher uma voz específica. O navegador pode reproduzir com a voz padrão, usar outro sotaque ou não emitir áudio. A interface avisa sobre a incerteza; não há garantia de fala brasileira. Para resultado confiável, instale/habilite uma voz brasileira no sistema ou tente outro navegador.
- As vozes às vezes aparecem depois de `voiceschanged`; uma lista inicialmente vazia não significa que o aparelho nunca terá vozes.
- Em Android, `pause()` pode terminar a fala corrente. Se o navegador emitir o evento de fim enquanto pausado, o motor reinicia aquela parte ao continuar; pode repetir algumas palavras. Em outros dispositivos, `pause()` costuma prosseguir do ponto em que parou.
- Trocar a velocidade durante uma leitura não modifica a fala em andamento: o novo valor é aplicado à próxima reprodução/parte.
- Teste com o navegador e os alto-falantes **reais da escola**. O som sai no dispositivo que executa o site, não no robô.

## Alterações de arquivos

- `backend/acervo.js` (novo) — compara blocos e trechos completos; regras testáveis separadamente.
- `backend/server.js` — adiciona apenas `GET /api/acervo/atividades`, consulta de leitura das tabelas existentes.
- `painel/index.html` — adiciona a aba Acervo, seletor de trechos e controles de voz dentro da apresentação existente.
- `painel/style.css` — estilos complementares na mesma paleta, sem gradientes, com responsividade.
- `painel/app.js` — integra navegação, modo de trechos e desligamento de fala nos eventos de saída/troca.
- `painel/acervo.js` (novo) — renderização segura de contos e atividades, reutilizando `/api/contos`.
- `painel/narracao.js` (novo) — motor único de fala com seleção de voz, velocidade, pausa, continuação, cancelamento e tratamento de erro.
- `tests/acervo.test.js` (novo) — testes para associações verificáveis.
- `tests/narracao.test.js` (novo) — testes de API simulada para voz, fala longa, alternância e ausência de pt-BR.
- `tests/acervo-browser-e2e.py` (novo) — teste de interface via Chromium, usando dados de teste e mecanismo de fala simulado.
- `ACERVO_E_NARRACAO.md` (novo) — estas instruções.
- `README.md` — referência às funcionalidades.

## Testes

Com Node.js, dentro de `site/`:

```sh
npm test
```

Com Playwright Python + Chromium:

```sh
python tests/acervo-browser-e2e.py
```

O teste de navegador carrega os arquivos HTML/CSS/JS reais numa página em memória, pois no ambiente de teste o Chromium bloqueia navegação HTTP e `file://`. Mocka respostas da API e métodos do sintetizador. Isso **não comprova conexão com o Supabase nem áudio audível**. Verificações manuais necessárias: listagem real de contos/atividades/PDFs do banco da escola, voz pt-BR real no Windows/Android, emissão sonora, pausa real nos aparelhos, integração da ESP física e operação com atividades reais.
