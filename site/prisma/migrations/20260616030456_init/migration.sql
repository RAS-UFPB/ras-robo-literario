-- CreateTable
CREATE TABLE "atividades" (
    "id" SERIAL NOT NULL,
    "texto_alvo" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atividades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frases" (
    "id" SERIAL NOT NULL,
    "atividade_id" INTEGER NOT NULL,
    "indice" INTEGER NOT NULL,
    "codigo_binario" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "frases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipes" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leituras" (
    "id" SERIAL NOT NULL,
    "atividade_id" INTEGER NOT NULL,
    "equipe_id" INTEGER NOT NULL,
    "frase_id" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigo_binario" TEXT NOT NULL,
    "fragmento" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leituras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pontuacoes" (
    "id" SERIAL NOT NULL,
    "atividade_id" INTEGER NOT NULL,
    "equipe_id" INTEGER NOT NULL,
    "pontuacao" INTEGER NOT NULL DEFAULT 0,
    "corretas" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "ultima_pontuacao_rodada" INTEGER NOT NULL DEFAULT 0,
    "ultima_assinatura" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pontuacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "frases_atividade_id_indice_key" ON "frases"("atividade_id", "indice");

-- CreateIndex
CREATE UNIQUE INDEX "frases_atividade_id_codigo_binario_key" ON "frases"("atividade_id", "codigo_binario");

-- CreateIndex
CREATE UNIQUE INDEX "equipes_nome_key" ON "equipes"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "pontuacoes_atividade_id_equipe_id_key" ON "pontuacoes"("atividade_id", "equipe_id");

-- AddForeignKey
ALTER TABLE "frases" ADD CONSTRAINT "frases_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "atividades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "atividades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_equipe_id_fkey" FOREIGN KEY ("equipe_id") REFERENCES "equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_frase_id_fkey" FOREIGN KEY ("frase_id") REFERENCES "frases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontuacoes" ADD CONSTRAINT "pontuacoes_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "atividades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontuacoes" ADD CONSTRAINT "pontuacoes_equipe_id_fkey" FOREIGN KEY ("equipe_id") REFERENCES "equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
