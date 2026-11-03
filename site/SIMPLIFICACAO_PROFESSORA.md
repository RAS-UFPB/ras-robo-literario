# Painel simplificado para a professora — 01/11/2026

## O que mudou

- O Dashboard concentra o início da atividade, os QRs, a mesa de montagem, a simulação e o placar.
- No Dashboard, a professora pode digitar blocos separados por `|` **ou** escolher um conto com trechos e clicar em **Iniciar com este conto**. As duas ações criam uma atividade real no banco. O botão de conto usa a mesma rota de criação anterior.
- O bloco extenso que reaparecia após reiniciar o site é agora um resumo curto. Os textos/códigos continuam acessíveis em **Consultar blocos e códigos da atividade** (recolhido por padrão).
- **Encerrar atividade** desmarca o registro ativo; não apaga histórico, leituras nem pontuação. Uma atividade deixada ativa ainda será carregada após reiniciar, porque o backend precisa preservá-la durante a aula.
- Removemos da aba **Contos e atividades** o cartão redundante de QR/mesa. Essa aba mantém perguntas, respostas, dicas, desafios e a apresentação.
- O Acervo lista somente atividades com correspondência exata dos trechos. Atividades antigas sem associação não desaparecem do banco.
- Removemos o botão e a explicação do Wokwi **apenas da interface da professora**. A simulação técnica continua disponível na pasta `esp/wokwi/`.
- Nenhuma mudança no firmware ESP, no cenário A, no Prisma, nas migrations ou no mecanismo de importação de sessões.
- A configuração Wi-Fi **do ZIP mais recente**, sem botão físico e com PIN de proteção, permanece intacta. Apenas o atalho de Wokwi deixou de aparecer na tela da professora.
- O Acervo e a narração integrada à apresentação foram recuperados da implementação anterior, pois não estavam presentes no ZIP novo; nenhum serviço de voz é executado no backend.

## Seed de Os Sete Corvos

Os PDFs fornecidos foram usados para conferir o arquivo `backend/data/sete-corvos.json` já existente: são 8 perguntas e respostas, 5 desafios, 5 dicas e 8 trechos A–H. O conto completo está no PDF original, mas **não é inserido como trecho de carta**: o arquivo pedagógico de cartas contém resumos curtos. Não foi criada uma nova tabela nem pasta paralela de PDF.

Com a conexão do Supabase configurada em `.env`, na pasta `site`:

```bash
npm install
npx prisma generate
npm run seed:conteudo
```

A seed **não é executada automaticamente** ao iniciar o site. Ela cria só registros pedagógicos faltantes, sem sobrescrever as edições da professora. Se ainda não existir uma atividade que corresponda aos oito trechos do conto, cria **uma atividade modelo inativa**, sem leituras ou pontuação. Rodar novamente não duplica a atividade modelo se ela continuar compatível.

## Histórico / poluição de testes

Atividades antigas não foram apagadas automaticamente porque o ZIP não possui um backup nem credenciais de leitura do banco ao qual você está conectada. Apagar uma atividade também pode apagar `frases`, `leituras` e `pontuacoes` por cascata e deixar sessões ESP sem atividade correspondente. **Não use `/api/admin/reset-supabase` para remover poucos testes**: esse reset é amplo.

Para listar e verificar com segurança:

```bash
npm run limpar-testes:previa
```

O script mostra IDs, blocos, amostra do texto e se há atividade ativa, leituras, pontuação, sessões ou importação. Para remover **somente** registros de testes inativos e sem nenhum desses dados, informe IDs deliberadamente escolhidos e execute, após salvar backup e parar o backend:

```bash
node backend/limpar-atividades-teste.js --apagar=3,4
# Mostra a prévia, sem apagar
node backend/limpar-atividades-teste.js --apagar=3,4 --confirmar
# Só apaga se todos os IDs forem elegíveis; caso contrário cancela
```

Substitua `3,4` pelos IDs que você decidiu excluir. O script **não** apaga `contos`, `perguntas`, `dicas`, `desafios`, `trechos_embaralhar`, sessões e importações. Não tente apagar o histórico de uma atividade que tenha sido usada com a ESP; guarde o histórico ou faça uma política de arquivamento separada.

## Testes

```bash
npm test
python tests/acervo-browser-e2e.py
python tests/wifi-browser-e2e.py
```

Os testes em navegador usam dados falsos; não representam uma conexão real ao Supabase nem som audível. Verifique em dispositivo físico a ESP, a rede Wi-Fi e a voz do navegador.
