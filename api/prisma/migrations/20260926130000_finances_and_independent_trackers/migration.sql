-- Preserve todos os acompanhamentos e ocorrências existentes, derivando seu dono.
ALTER TABLE acompanhamentos ADD COLUMN usuario_id INTEGER;
UPDATE acompanhamentos a SET usuario_id = o.usuario_id FROM objetivos o WHERE a.objetivo_id = o.id;
ALTER TABLE acompanhamentos ALTER COLUMN usuario_id SET NOT NULL;
ALTER TABLE acompanhamentos ALTER COLUMN objetivo_id DROP NOT NULL;
ALTER TABLE acompanhamentos DROP CONSTRAINT acompanhamentos_objetivo_id_fkey;
ALTER TABLE acompanhamentos ADD CONSTRAINT acompanhamentos_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE acompanhamentos ADD CONSTRAINT acompanhamentos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(usuario_id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX acompanhamentos_usuario_id_idx ON acompanhamentos(usuario_id);
CREATE TABLE lancamentos_financeiros (
 id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL, titulo VARCHAR(200) NOT NULL,
 tipo VARCHAR(20) NOT NULL, categoria VARCHAR(60) NOT NULL, valor_centavos INTEGER NOT NULL,
 data DATE NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT lancamentos_financeiros_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(usuario_id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT lancamentos_valor_positivo CHECK (valor_centavos > 0),
 CONSTRAINT lancamentos_tipo CHECK (tipo IN ('receita','despesa','ajuste_entrada','ajuste_saida'))
);
CREATE INDEX lancamentos_financeiros_usuario_id_data_id_idx ON lancamentos_financeiros(usuario_id, data, id);
CREATE TABLE reservas_financeiras (
 id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL, objetivo_id INTEGER, titulo VARCHAR(200) NOT NULL,
 valor_centavos INTEGER NOT NULL DEFAULT 0, alvo_centavos INTEGER,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT reservas_financeiras_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(usuario_id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT reservas_financeiras_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT reservas_valores CHECK (valor_centavos >= 0 AND (alvo_centavos IS NULL OR alvo_centavos > 0))
);
CREATE INDEX reservas_financeiras_usuario_id_id_idx ON reservas_financeiras(usuario_id, id);
CREATE INDEX reservas_financeiras_objetivo_id_idx ON reservas_financeiras(objetivo_id);
