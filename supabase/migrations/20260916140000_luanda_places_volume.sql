-- ═══════════════════════════════════════════════════════════════════════════
-- luanda_places — preparar para a base completa de Luanda + Icolo e Bengo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA que isto resolve:
--   A versão inicial tinha UNIQUE(nome_normalizado). Serve para 68 locais,
--   mas NÃO para uma importação em massa: em Luanda há dezenas de "Rua 1",
--   "Escola nº 1", "Igreja", "Mercado". Com UNIQUE por nome, a importação
--   perdia quase tudo (ON CONFLICT engolia as repetidas).
--
--   Passa a ser único por `osm_id` (a identidade real do elemento no OSM),
--   e a resolução de nomes passa a desempatar pela DISTÂNCIA a um ponto de
--   referência — que é o que faz sentido: quem escreve "Rua 1" a partir do
--   Kilamba quer a "Rua 1" do Kilamba, não a da Samba.
--
-- Idempotente.

BEGIN;

-- ── 1. Colunas novas ──────────────────────────────────────────────────────
ALTER TABLE public.luanda_places
  ADD COLUMN IF NOT EXISTS osm_id    text,
  ADD COLUMN IF NOT EXISTS categoria text;

COMMENT ON COLUMN public.luanda_places.osm_id    IS 'Identificador do elemento no OpenStreetMap (node/way/relation + id). Garante importações idempotentes.';
COMMENT ON COLUMN public.luanda_places.categoria IS 'Tipo legível: bairro, rua, hospital, escola, hotel, salao, mercado, farmacia, ...';

-- ── 2. Trocar o único: nome_normalizado -> osm_id ─────────────────────────
ALTER TABLE public.luanda_places
  DROP CONSTRAINT IF EXISTS luanda_places_nome_uniq;

-- osm_id pode ser NULL (locais aprendidos); o único só se aplica quando existe
DROP INDEX IF EXISTS luanda_places_osm_id_uniq;
CREATE UNIQUE INDEX luanda_places_osm_id_uniq
  ON public.luanda_places (osm_id)
  WHERE osm_id IS NOT NULL;

-- Pesquisa por nome continua a precisar de índice: já existe o GiST trigram.
-- Acrescenta-se um B-tree para igualdade/prefixo, que é o caminho mais comum.
CREATE INDEX IF NOT EXISTS idx_luanda_places_norm
  ON public.luanda_places (nome_normalizado text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_luanda_places_categoria
  ON public.luanda_places (categoria);

-- ── 3. resolver_local com desempate por proximidade ───────────────────────
-- Assinatura muda (ganha p_lat/p_lng) -> é obrigatório dropar a antiga,
-- senão ficam duas sobrecarregadas e o PostgREST devolve PGRST203 (HTTP 300).
DROP FUNCTION IF EXISTS public.resolver_local(text);

CREATE OR REPLACE FUNCTION public.resolver_local(
  p_texto text,
  p_lat   double precision DEFAULT NULL,
  p_lng   double precision DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  nome              text,
  lat               double precision,
  lng               double precision,
  raio_m            integer,
  zona              text,
  categoria         text,
  origem            text,
  confianca         integer,
  endereco_completo text,
  similaridade      real,
  correspondencia   text,
  distancia_ref_m   double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH alvo AS (
    SELECT public.zr_normaliza_local(p_texto) AS q
  ),
  ref AS (
    SELECT CASE
             WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND NOT (p_lat = 0 AND p_lng = 0)
             THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
             ELSE NULL
           END AS g
  )
  SELECT
    l.id, l.nome, l.lat, l.lng, l.raio_m, l.zona, l.categoria,
    l.origem, l.confianca, l.endereco_completo,
    extensions.similarity(l.nome_normalizado, a.q)::real,
    CASE
      WHEN l.nome_normalizado = a.q           THEN 'exato'
      WHEN l.nome_normalizado LIKE a.q || '%' THEN 'prefixo'
      WHEN a.q LIKE l.nome_normalizado || '%' THEN 'contido'
      ELSE 'aproximado'
    END,
    CASE WHEN r.g IS NOT NULL AND l.geog IS NOT NULL
         THEN ST_Distance(l.geog, r.g)::double precision
         ELSE NULL
    END
  FROM public.luanda_places l
  CROSS JOIN alvo a
  CROSS JOIN ref r
  WHERE a.q <> ''
    AND char_length(a.q) >= 3
    AND (
      l.nome_normalizado = a.q
      OR l.nome_normalizado LIKE a.q || '%'
      OR a.q LIKE l.nome_normalizado || '%'
      OR l.nome_normalizado % a.q
    )
  ORDER BY
    -- 1. qualidade da correspondência de nome
    (l.nome_normalizado = a.q) DESC,
    (l.nome_normalizado LIKE a.q || '%') DESC,
    extensions.similarity(l.nome_normalizado, a.q) DESC,
    -- 2. proximidade ao ponto de referência (quando o bot já sabe onde está)
    CASE WHEN r.g IS NOT NULL AND l.geog IS NOT NULL
         THEN ST_Distance(l.geog, r.g) END ASC NULLS LAST,
    -- 3. desempate por fiabilidade
    l.confianca DESC,
    l.hit_count DESC,
    l.nome ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolver_local(text, double precision, double precision) IS
  'Resolve um nome escrito para as coordenadas reais do local. Com p_lat/p_lng, desempata nomes repetidos pela distância ao ponto de referência.';

-- ── 4. registar_local sem depender do nome único ──────────────────────────
-- Regra: se já existir um local com o mesmo nome normalizado a menos de 200 m,
-- actualiza-se esse; senão insere-se um novo. Sem isto, ensinar "Mercado"
-- duas vezes em sítios diferentes apagava o primeiro.
DROP FUNCTION IF EXISTS public.registar_local(text, double precision, double precision, integer, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.registar_local(
  p_nome         text,
  p_lat          double precision,
  p_lng          double precision,
  p_raio_m       integer DEFAULT 1000,
  p_zona         text    DEFAULT NULL,
  p_origem       text    DEFAULT 'aprendido',
  p_aprendido_de text    DEFAULT NULL,
  p_endereco     text    DEFAULT NULL,
  p_osm_tipo     text    DEFAULT NULL,
  p_categoria    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_norm  text;
  v_id    uuid;
  v_conf  integer;
  v_ponto geography;
BEGIN
  IF p_nome IS NULL OR btrim(p_nome) = '' THEN
    RAISE EXCEPTION 'nome do local e obrigatorio';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'coordenadas do local sao obrigatorias';
  END IF;
  IF p_lat = 0 AND p_lng = 0 THEN
    RAISE EXCEPTION 'coordenadas invalidas (0,0)';
  END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'coordenadas fora de intervalo';
  END IF;

  v_norm := public.zr_normaliza_local(p_nome);
  IF char_length(v_norm) < 3 THEN
    RAISE EXCEPTION 'nome demasiado curto para ser util';
  END IF;

  v_conf  := CASE COALESCE(p_origem, 'aprendido')
               WHEN 'osm'    THEN 90
               WHEN 'manual' THEN 95
               ELSE 60
             END;
  v_ponto := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- Já existe um local com este nome, praticamente no mesmo sítio?
  SELECT id INTO v_id
  FROM public.luanda_places
  WHERE nome_normalizado = v_norm
    AND geog IS NOT NULL
    AND ST_DWithin(geog, v_ponto, 200)
  ORDER BY ST_Distance(geog, v_ponto) ASC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.luanda_places SET
      lat               = p_lat,
      lng               = p_lng,
      raio_m            = GREATEST(LEAST(COALESCE(p_raio_m, 1000), 20000), 100),
      zona              = COALESCE(p_zona, zona),
      endereco_completo = COALESCE(p_endereco, endereco_completo),
      osm_tipo          = COALESCE(p_osm_tipo, osm_tipo),
      categoria         = COALESCE(p_categoria, categoria),
      confianca         = GREATEST(confianca, v_conf),
      origem            = CASE WHEN origem = 'manual' THEN 'manual'
                               WHEN origem = 'osm'    THEN 'osm'
                               ELSE COALESCE(p_origem, 'aprendido') END,
      updated_at        = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.luanda_places (
    nome, nome_normalizado, lat, lng, raio_m, zona,
    origem, confianca, aprendido_de, endereco_completo, osm_tipo, categoria
  ) VALUES (
    btrim(p_nome), v_norm, p_lat, p_lng,
    GREATEST(LEAST(COALESCE(p_raio_m, 1000), 20000), 100),
    p_zona, COALESCE(p_origem, 'aprendido'), v_conf,
    p_aprendido_de, p_endereco, p_osm_tipo, p_categoria
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.registar_local(text, double precision, double precision, integer, text, text, text, text, text, text) IS
  'Guarda/actualiza um local. Mesmo nome a menos de 200 m actualiza; caso contrário insere.';

-- ── 5. Permissões ─────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.resolver_local(text, double precision, double precision) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolver_local(text, double precision, double precision) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registar_local(text, double precision, double precision, integer, text, text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registar_local(text, double precision, double precision, integer, text, text, text, text, text, text) TO authenticated, service_role;

-- ── 6. Preencher a zona dos locais importados a partir do vizinho mais próximo
-- que já tenha zona definida (máx. 3 km). Corre depois de cada importação.
CREATE OR REPLACE FUNCTION public.preencher_zonas(p_raio_m integer DEFAULT 3000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH candidatos AS (
    SELECT l.id,
           (SELECT z.zona
              FROM public.luanda_places z
             WHERE z.zona IS NOT NULL
               AND z.id <> l.id
               AND ST_DWithin(z.geog, l.geog, COALESCE(p_raio_m, 3000))
             ORDER BY ST_Distance(z.geog, l.geog) ASC
             LIMIT 1) AS zona_nova
      FROM public.luanda_places l
     WHERE l.zona IS NULL AND l.geog IS NOT NULL
  )
  UPDATE public.luanda_places l
     SET zona = c.zona_nova, updated_at = now()
    FROM candidatos c
   WHERE l.id = c.id AND c.zona_nova IS NOT NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.preencher_zonas(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preencher_zonas(integer) TO authenticated, service_role;

COMMIT;
