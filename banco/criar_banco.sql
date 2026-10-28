-- =====================================================================
-- criar_banco.sql — Banco do protótipo de monitoramento de enchentes (TCC)
-- MySQL 8.4 LTS · InnoDB · utf8mb4
--
-- Script único: cria o banco com a estrutura final, os três locais, as calibrações
-- e os limiares usados nos ensaios e o usuário do programa.
--
-- ANTES DE RODAR: troque TROQUE_ESTA_SENHA (no fim do arquivo) por uma senha sua e
-- use a mesma senha no DB_PASSWORD do arquivo servidor/.env.
--
-- ATENÇÃO: APAGA E RECRIA o banco tcc_enchentes (as leituras gravadas são perdidas).
--
-- Rodar como root, no "MySQL 8.4 Command Line Client":
--   source C:/caminho/do/repositorio/banco/criar_banco.sql
--
-- Fluxo dos dados:
--   ESP32 → Node (grava `reading` bruta + converte com a `calibration` ativa)
--         → Python (classifica com o `threshold_set` ativo → `classification`)
--
-- Separação de responsabilidades:
--   * `calibration`   = MEDIÇÃO: transforma mV em grandeza física (por nó). Usada pelo Node.
--   * `threshold_set` = DECISÃO DE RISCO: limiares da árvore (globais). Usada só pelo Python.
--   Ambas são versionadas: cada leitura e cada classificação apontam para a versão usada,
--   então qualquer resultado pode ser reproduzido e reprocessado.
-- =====================================================================

SET NAMES utf8mb4;

DROP DATABASE IF EXISTS tcc_enchentes;
CREATE DATABASE tcc_enchentes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE tcc_enchentes;

-- =====================================================================
-- 1. ESTRUTURA
-- =====================================================================

-- ---------------------------------------------------------------------
-- node: cada área de monitoramento (caixa da maquete) com seu ESP32.
-- O id NÃO é automático: é o NODE_ID gravado no config.h do firmware.
-- ---------------------------------------------------------------------
CREATE TABLE node (
  id           TINYINT UNSIGNED NOT NULL,
  name         VARCHAR(50)      NOT NULL,
  description  VARCHAR(255)     NULL,
  -- Zona da maquete e posição ao longo do rio, de 0 (início, à esquerda) a 100 (fim, à direita),
  -- usadas no mapa do painel.
  zone            ENUM('RURAL', 'PERIURBANA', 'URBANA') NULL,
  river_position  DECIMAL(5,2)     NULL,
  created_at   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT pk_node       PRIMARY KEY (id),
  CONSTRAINT uq_node_name  UNIQUE (name),
  CONSTRAINT ck_node_id    CHECK (id >= 1),
  CONSTRAINT ck_node_river_position
    CHECK (river_position IS NULL OR (river_position >= 0 AND river_position <= 100))
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- calibration: resultado do protocolo de calibração, por nó e versionado.
-- Só uma calibração ativa por nó (garantido por uq_calibration_active).
-- ---------------------------------------------------------------------
CREATE TABLE calibration (
  id                       INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  node_id                  TINYINT UNSIGNED NOT NULL,
  created_at               TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  is_active                BOOLEAN          NOT NULL DEFAULT FALSE,
  -- vale node_id quando ativa e NULL quando não: o UNIQUE abaixo permite uma única ativa por nó
  active_node_id           TINYINT UNSIGNED
                           GENERATED ALWAYS AS (IF(is_active, node_id, NULL)) STORED,

  -- Geometria medida no Ensaio 1 (mm)
  sensor_tip_above_bed_mm  DECIMAL(5,1)     NOT NULL,  -- zero da curva acima do leito (capacitivo: 0)
  bankfull_depth_mm        DECIMAL(5,1)     NOT NULL,  -- D: leito → ponto mais baixo da crista (nominal 30)
  level_range_mm           DECIMAL(5,1)     NOT NULL,  -- faixa útil do sensor de nível

  -- Curva do sensor de nível: pontos [mV, mm]. Pode subir ou descer com a água (capacitivo desce).
  -- O Node converte por interpolação linear entre os pontos.
  level_curve              JSON             NOT NULL,

  -- Umidade do solo: extremos do índice S = (seco - mV) / (seco - saturado)
  soil_dry_mv              SMALLINT UNSIGNED NOT NULL,
  soil_saturated_mv        SMALLINT UNSIGNED NOT NULL,

  -- Chuva: a tensão CAI quando a placa molha.
  rain_wet_below_mv        SMALLINT UNSIGNED NOT NULL,  -- abaixo disto: CHUVA
  rain_heavy_below_mv      SMALLINT UNSIGNED NULL,      -- abaixo disto: CHUVA_INTENSA (NULL = só seco/chuva)

  notes                    VARCHAR(255)     NULL,

  CONSTRAINT pk_calibration         PRIMARY KEY (id),
  CONSTRAINT uq_calibration_active  UNIQUE (active_node_id),
  CONSTRAINT fk_calibration_node    FOREIGN KEY (node_id) REFERENCES node (id),
  CONSTRAINT ck_calibration_geometry
    CHECK (sensor_tip_above_bed_mm >= 0 AND bankfull_depth_mm > 0 AND level_range_mm > 0),
  CONSTRAINT ck_calibration_curve
    CHECK (JSON_TYPE(level_curve) = 'ARRAY' AND JSON_LENGTH(level_curve) >= 2),
  CONSTRAINT ck_calibration_soil    CHECK (soil_dry_mv <> soil_saturated_mv),
  CONSTRAINT ck_calibration_rain
    CHECK (rain_heavy_below_mv IS NULL OR rain_heavy_below_mv < rain_wet_below_mv)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- reading: uma linha por envio do ESP32 (a cada 15 s por nó).
-- Colunas *_mv / *_raw = dado BRUTO, nunca alterado (base para recalibrar).
-- Colunas convertidas = preenchidas pelo Node com a calibração ativa; NULL enquanto
-- o nó não tiver calibração.
-- ---------------------------------------------------------------------
CREATE TABLE reading (
  id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  node_id          TINYINT UNSIGNED  NOT NULL,
  seq              INT UNSIGNED      NOT NULL,  -- contador do ESP32 (recomeça quando ele reinicia)
  uptime_ms        INT UNSIGNED      NOT NULL,  -- millis() do ESP32 no momento da leitura
  recorded_at      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- chegada no servidor

  -- Bruto: mV (calibração de fábrica do chip) e contagem do ADC (0–4095)
  level_mv         SMALLINT UNSIGNED NOT NULL,
  level_raw        SMALLINT UNSIGNED NOT NULL,
  rain_mv          SMALLINT UNSIGNED NOT NULL,
  rain_raw         SMALLINT UNSIGNED NOT NULL,
  soil_mv          SMALLINT UNSIGNED NOT NULL,
  soil_raw         SMALLINT UNSIGNED NOT NULL,

  -- Convertido (Node)
  calibration_id   INT UNSIGNED      NULL,
  level_range      ENUM('ABAIXO', 'DENTRO', 'ACIMA') NULL,  -- leitura censurada do sensor de nível
  level_depth_mm   DECIMAL(5,1)      NULL,  -- lâmina acima do leito; só existe quando DENTRO da faixa
  rain_class       ENUM('SECO', 'CHUVA', 'CHUVA_INTENSA') NULL,
  soil_index       DECIMAL(4,3)      NULL,  -- S: 0 = estado inicial, 1 = encharcado

  CONSTRAINT pk_reading PRIMARY KEY (id),
  -- Impede gravar a mesma leitura duas vezes (ex.: reenvio após falha de rede)
  CONSTRAINT uq_reading_dedupe UNIQUE (node_id, uptime_ms, seq),
  CONSTRAINT fk_reading_node        FOREIGN KEY (node_id)        REFERENCES node (id),
  CONSTRAINT fk_reading_calibration FOREIGN KEY (calibration_id) REFERENCES calibration (id),
  CONSTRAINT ck_reading_adc
    CHECK (level_raw <= 4095 AND rain_raw <= 4095 AND soil_raw <= 4095),
  -- Sem calibração, nenhum valor convertido
  CONSTRAINT ck_reading_converted CHECK (
    calibration_id IS NOT NULL
    OR (level_range IS NULL AND level_depth_mm IS NULL AND rain_class IS NULL AND soil_index IS NULL)
  ),
  -- Lâmina só é conhecida quando a água está DENTRO da faixa do sensor de nível
  CONSTRAINT ck_reading_level CHECK (
    level_range IS NULL OR ((level_range = 'DENTRO') = (level_depth_mm IS NOT NULL))
  ),

  INDEX ix_reading_recorded_at (recorded_at),
  INDEX ix_reading_node_time   (node_id, recorded_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- threshold_set: limiares da árvore de decisão, versionados.
-- Só uma versão ativa (uq_threshold_set_active). As variações da análise de
-- sensibilidade (±10% e ±20%) entram como versões inativas.
-- ---------------------------------------------------------------------
CREATE TABLE threshold_set (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name                  VARCHAR(50)   NOT NULL,
  created_at            TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  is_active             BOOLEAN       NOT NULL DEFAULT FALSE,
  active_marker         TINYINT UNSIGNED
                        GENERATED ALWAYS AS (IF(is_active, 1, NULL)) STORED,

  attention_fraction    DECIMAL(4,3)  NOT NULL,  -- ATENÇÃO: lâmina >= fração × D
  risk_fraction         DECIMAL(4,3)  NOT NULL,  -- RISCO:   lâmina >= fração × D
  soil_saturated_index  DECIMAL(4,3)  NOT NULL,  -- solo saturado: S >= valor
  level_hysteresis_mm   DECIMAL(4,1)  NOT NULL,  -- quanto o nível precisa baixar para a classe descer
  dry_depth_mm          DECIMAL(4,1)  NOT NULL DEFAULT 1.0,  -- rio seco: lâmina abaixo disto (aviso, classe NORMAL)
  rationale             VARCHAR(500)  NOT NULL,  -- de onde vieram os valores (rastreabilidade)

  CONSTRAINT pk_threshold_set        PRIMARY KEY (id),
  CONSTRAINT uq_threshold_set_name   UNIQUE (name),
  CONSTRAINT uq_threshold_set_active UNIQUE (active_marker),
  CONSTRAINT ck_threshold_set_level
    CHECK (attention_fraction > 0 AND attention_fraction < risk_fraction),
  CONSTRAINT ck_threshold_set_soil
    CHECK (soil_saturated_index > 0 AND soil_saturated_index <= 1),
  CONSTRAINT ck_threshold_set_hysteresis CHECK (level_hysteresis_mm >= 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- classification: resultado da árvore (Python). Relação 1:1 OPCIONAL com reading:
-- leitura sem linha aqui = ainda não classificada (Python fora do ar → reprocessa depois).
-- `rule` guarda QUAL regra da árvore decidiu: é o que torna o sistema especialista explicável.
-- ---------------------------------------------------------------------
CREATE TABLE classification (
  reading_id        BIGINT UNSIGNED NOT NULL,
  threshold_set_id  INT UNSIGNED    NOT NULL,
  status            ENUM('NORMAL', 'ATENCAO', 'RISCO') NOT NULL,
  rule              VARCHAR(40)     NOT NULL,
  classified_at     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT pk_classification PRIMARY KEY (reading_id),
  CONSTRAINT fk_classification_reading
    FOREIGN KEY (reading_id) REFERENCES reading (id) ON DELETE CASCADE,
  CONSTRAINT fk_classification_threshold_set
    FOREIGN KEY (threshold_set_id) REFERENCES threshold_set (id),

  INDEX ix_classification_status (status, classified_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- annotation: anotações no gráfico do painel ("coloquei água", "borrifei a placa"...).
-- O painel nunca apaga linhas: quando alguém remove, ele só preenche removed_at.
-- ---------------------------------------------------------------------
CREATE TABLE annotation (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  node_id     TINYINT UNSIGNED  NULL,           -- NULL = vale para todos os locais
  noted_at    TIMESTAMP(3)      NOT NULL,       -- quando aconteceu
  text        VARCHAR(140)      NOT NULL,
  created_at  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at  TIMESTAMP(3)      NULL,
  CONSTRAINT pk_annotation      PRIMARY KEY (id),
  CONSTRAINT fk_annotation_node FOREIGN KEY (node_id) REFERENCES node (id),
  CONSTRAINT ck_annotation_text CHECK (CHAR_LENGTH(TRIM(text)) >= 1),
  INDEX ix_annotation_time (noted_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- ruler_check: medidas da régua comparadas com o sensor de nível (erro do sensor).
-- ---------------------------------------------------------------------
CREATE TABLE ruler_check (
  id               INT UNSIGNED       NOT NULL AUTO_INCREMENT,
  node_id          TINYINT UNSIGNED   NOT NULL,
  measured_at      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ruler_cm         DECIMAL(4,2)       NOT NULL,  -- o que a régua marcou (do fundo da caixa)
  ruler_depth_mm   DECIMAL(5,1)       NOT NULL,  -- água sobre o leito pela régua
  sensor_mv        SMALLINT UNSIGNED  NOT NULL,  -- mediana do sensor no último minuto
  sensor_range     ENUM('ABAIXO', 'DENTRO', 'ACIMA') NOT NULL,
  sensor_depth_mm  DECIMAL(5,1)       NULL,      -- água sobre o leito pelo sensor (só quando DENTRO)
  calibration_id   INT UNSIGNED       NOT NULL,  -- calibração que o sensor usava na hora
  adjusted         BOOLEAN            NOT NULL DEFAULT FALSE,  -- a medida foi usada para ajustar o sensor
  removed_at       TIMESTAMP(3)       NULL,
  CONSTRAINT pk_ruler_check             PRIMARY KEY (id),
  CONSTRAINT fk_ruler_check_node        FOREIGN KEY (node_id) REFERENCES node (id),
  CONSTRAINT fk_ruler_check_calibration FOREIGN KEY (calibration_id) REFERENCES calibration (id),
  CONSTRAINT ck_ruler_check_depth CHECK (
    (sensor_range = 'DENTRO') = (sensor_depth_mm IS NOT NULL)
  ),
  INDEX ix_ruler_check_node_time (node_id, measured_at)
) ENGINE = InnoDB;

-- =====================================================================
-- 2. DADOS INICIAIS
-- =====================================================================

-- Locais da maquete, da esquerda para a direita: caixa 3 (rural) → caixa 2 (periurbana)
-- → caixa 1 (urbana). O id é o NODE_ID gravado no config.h de cada ESP32.
INSERT INTO node (id, name, description, zone, river_position) VALUES
  (1, 'Caixa 1', 'Trecho do rio na zona urbana da maquete',     'URBANA',     80),
  (2, 'Caixa 2', 'Trecho do rio na zona periurbana da maquete', 'PERIURBANA', 50),
  (3, 'Caixa 3', 'Trecho do rio na zona rural da maquete',      'RURAL',      20);

-- ---------------------------------------------------------------------
-- Calibração de cada caixa (a última usada nos ensaios).
--
-- Nível (sensor capacitivo: mais água = menos mV). Lâmina em mm acima do leito
-- (régua a partir do fundo da caixa; leito = 1,0 cm; margem ~3,55 cm → D = 25,5 mm).
-- Curva comum, medida em cenários com as três caixas em 25/10:
--   caixa 3 seca ............. 2747 mV =  0 mm
--   caixa 2, régua 2,2 cm .... 1359 mV = 12 mm
--   caixa 1, régua 3,6 cm .... 1163 mV = 26 mm
-- Depois, a curva de duas caixas foi deslocada em tensão para coincidir com a régua:
--   caixa 1 (26/10): -73 mV (régua 3,4 cm = 1118 mV)
--   caixa 2 (27/10): -79 mV (régua 2,0 cm = 1308 mV)
--
-- Solo (FD10 em um copo com terra: mais água = mais mV): seco = 142 mV; saturado = 683 mV,
-- escolhido para que o limite do alerta (S >= 0,8) fique em 575 mV, entre a terra só
-- borrifada (~240 mV) e o copo alagado (~910 mV).
--
-- Chuva (placa FC-37): só molhou ou não. Seca ~3130-3150 mV; molhada ~1600 mV.
-- Molhou = abaixo de 2900 mV; sem limite de chuva forte (NULL).
-- ---------------------------------------------------------------------
INSERT INTO calibration
  (node_id, is_active, sensor_tip_above_bed_mm, bankfull_depth_mm, level_range_mm, level_curve,
   soil_dry_mv, soil_saturated_mv, rain_wet_below_mv, rain_heavy_below_mv, notes)
VALUES
  (1, TRUE, 0.0, 25.5, 26.0, '[[2674, 0], [1286, 12], [1090, 26]]', 142, 683, 2900, NULL,
   'Curva comum -73 mV (regua 3,4 cm = 1118 mV, 26/10). Solo saturado 683 mV. Chuva: molhou < 2900 mV.'),
  (2, TRUE, 0.0, 25.5, 26.0, '[[2668, 0], [1280, 12], [1084, 26]]', 142, 683, 2900, NULL,
   'Curva comum -79 mV (regua 2,0 cm = 1308 mV, 27/10). Solo saturado 683 mV. Chuva: molhou < 2900 mV.'),
  (3, TRUE, 0.0, 25.5, 26.0, '[[2747, 0], [1359, 12], [1163, 26]]', 142, 683, 2900, NULL,
   'Curva comum dos cenarios de 25/10. Solo saturado 683 mV. Chuva: molhou < 2900 mV.');

-- ---------------------------------------------------------------------
-- Limiares da árvore de decisão.
-- v1 (inativa): primeira versão, com o RISCO só no transbordamento. Fica gravada para
-- comparação com a v2 (reprocessamento das leituras).
-- v2 (ativa): o intervalo entre a lâmina normal e a margem é dividido em três partes:
--   lâmina normal ... hN = 2,2 cm - 1,0 cm = 12,0 mm
--   margem .......... D  = 3,55 cm - 1,0 cm = 25,5 mm
--   intervalo ....... F  = D - hN = 13,5 mm
--   ATENÇÃO = hN + F/3  = 16,5 mm (régua ~2,65 cm) -> fração 16,5 / 25,5 = 0,647
--   RISCO   = hN + 2F/3 = 21,0 mm (régua ~3,10 cm) -> fração 21,0 / 25,5 = 0,824
--   TRANSBORDOU = D     = 25,5 mm (régua ~3,55 cm), classe RISCO
-- Mesma ideia das cotas de atenção, alerta e inundação do Serviço Geológico do Brasil.
-- Histerese de 2,0 mm: sai de RISCO abaixo de 19,0 mm e de ATENÇÃO abaixo de 14,5 mm.
-- ---------------------------------------------------------------------
INSERT INTO threshold_set
  (name, is_active, attention_fraction, risk_fraction, soil_saturated_index, level_hysteresis_mm, dry_depth_mm, rationale)
VALUES
  ('v1-inicial', FALSE, 0.667, 1.000, 0.800, 2.0, 1.0,
   'RISCO na crista do barranco (NWS bankfull stage; SGB cota de inundação). ATENÇÃO a 2/3 de D: escolha de projeto, validar antecedência >= 30 s (Peters 1993; NWS action stage). Solo saturado S >= 0,8: escolha de projeto inspirada na condição III do NRCS. Histerese provisória até a calibração. Rio seco: lamina abaixo de 1,0 mm (aviso, classe NORMAL; 25/10). Chuva binaria: escalada com qualquer chuva (26/10).'),
  ('v2-folga-em-tercos', TRUE, 0.647, 0.824, 0.800, 2.0, 1.0,
   CONCAT('26/10: transbordar (3,55 cm) ja e enchente, entao o RISCO vem antes. ',
          'Folga F = D - lamina normal = 25,5 - 12,0 = 13,5 mm, dividida em 3: ',
          'ATENCAO = 12 + F/3 = 16,5 mm; RISCO = 12 + 2F/3 = 21,0 mm; D = TRANSBORDOU (classe RISCO). ',
          'Analogo as cotas de atencao, alerta e inundacao do SGB (sem serie historica na maquete). ',
          'Chuva binaria + solo S >= 0,8: aviso com rio normal, escalada ATENCAO -> RISCO. ',
          'Rio seco < 1,0 mm. Histerese 2,0 mm.'));

-- =====================================================================
-- 3. USUÁRIO DO PROGRAMA
-- O Node e o Python acessam o banco com este usuário, não com o root: se a senha do
-- programa vazar, ele não consegue apagar tabelas nem dados. Sem DELETE: leitura
-- gravada nunca é apagada.
-- TROQUE_ESTA_SENHA por uma senha sua (a mesma do DB_PASSWORD no servidor/.env).
-- =====================================================================
CREATE USER IF NOT EXISTS 'tcc_app'@'localhost' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
GRANT SELECT, INSERT, UPDATE ON tcc_enchentes.* TO 'tcc_app'@'localhost';

SELECT 'ok: banco criado' AS resultado;
