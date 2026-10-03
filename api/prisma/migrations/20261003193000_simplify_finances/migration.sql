-- Remoção definitiva autorizada: categorias e reservas históricas são descartadas.
ALTER TABLE "lancamentos_financeiros" DROP COLUMN "categoria";
DROP TABLE "reservas_financeiras";
