-- ═══════════════════════════════════════════════════════════════════════════
-- luanda_places — base de locais REAL de Luanda + aprendizagem automática
-- ═══════════════════════════════════════════════════════════════════════════
--
-- MOTIVO (medido contra as APIs, não inferido):
--   O geocoding do Mapbox desta conta NÃO tem bairros de Luanda. Prova:
--     "Zango"           -> Zangon Kataf, Kaduna, NIGÉRIA
--     "Rocha Pinto"     -> Pintos, Rocha, URUGUAI
--     "Golfe Cidade Alta" -> Alto Kauale, Província do UÍGE (300 km de Luanda)
--   Só resolve a nível de município ("Talatona", "Cacuaco") e, nesse caso,
--   devolve o CENTRO do município — nunca o ponto exacto do passageiro.
--   Resultado no bot: zonas que o utilizador diz e o bot "não conhece", e
--   quando conhece, o pino fica a quilómetros do sítio real.
--
--   O OpenStreetMap (Nominatim) TEM os bairros. Todos os locais abaixo foram
--   resolvidos a partir do OSM e trazem a coordenada real do mapa.
--
-- Esta tabela é também o mecanismo de APRENDIZAGEM: quando o bot não conhece
-- um sítio, pergunta ao utilizador, guarda o nome + coordenada + um raio de
-- ~1 km, e nas corridas seguintes já não fica em dúvida.
--
-- Idempotente: pode ser aplicada mais de uma vez sem efeitos colaterais.

BEGIN;

-- ── Extensões (só para a pesquisa por semelhança de nomes) ─────────────────
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;

-- ── Normalizador de nomes ─────────────────────────────────────────────────
-- "Zango 3" / "zango3" / "ZÁNGO  3" -> "zango 3"
-- A separação letra<->dígito importa: em Angola escreve-se "zango3", "km30",
-- "golf2". Sem ela, "zango3" casava com "Zango" (a zona errada).
-- STABLE (e não IMMUTABLE) porque unaccent não é immutable — não pode ser
-- usado em índice funcional, mas é usado apenas em WHERE/ORDER BY.
CREATE OR REPLACE FUNCTION public.zr_normaliza_local(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               lower(extensions.unaccent(coalesce(p_texto, ''))),
               '([a-z])([0-9])', '\1 \2', 'g'),
             '([0-9])([a-z])', '\1 \2', 'g'),
           '\s+', ' ', 'g'));
$$;

COMMENT ON FUNCTION public.zr_normaliza_local(text) IS
  'Normaliza um nome de local: minúsculas, sem acentos, espaços colapsados.';

-- ── Tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.luanda_places (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              text NOT NULL,
  nome_normalizado  text NOT NULL,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  -- ponto geográfico derivado, para buscas por raio com índice GiST
  geog              geography(Point, 4326)
                      GENERATED ALWAYS AS (
                        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
                      ) STORED,
  -- cobertura do local: um ponto a menos de `raio_m` deste centro é "neste sítio"
  raio_m            integer NOT NULL DEFAULT 1000,
  -- zona comercial canónica (as 11 de zone_prices) ou NULL
  zona              text,
  -- osm = resolvido no OpenStreetMap; aprendido = ensinado por um utilizador;
  -- mapbox = veio do geocoder antigo; manual = editado à mão no painel
  origem            text NOT NULL DEFAULT 'aprendido',
  confianca         integer NOT NULL DEFAULT 50,
  -- tipo OSM original (neighbourhood, suburb, village...) — ajuda a auditar
  osm_tipo          text,
  -- telefone de quem ensinou (só para origem='aprendido')
  aprendido_de      text,
  endereco_completo text,
  hit_count         integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT luanda_places_nome_uniq        UNIQUE (nome_normalizado),
  CONSTRAINT luanda_places_raio_ck          CHECK (raio_m BETWEEN 100 AND 20000),
  CONSTRAINT luanda_places_confianca_ck     CHECK (confianca BETWEEN 0 AND 100),
  CONSTRAINT luanda_places_origem_ck        CHECK (origem IN ('osm','aprendido','mapbox','manual')),
  CONSTRAINT luanda_places_coords_ck        CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180),
  -- 0,0 é o "null island" — sinal de coordenada por preencher
  CONSTRAINT luanda_places_nao_nulo_ck      CHECK (NOT (lat = 0 AND lng = 0))
);

COMMENT ON TABLE public.luanda_places IS
  'Locais reais de Luanda (coordenadas do OpenStreetMap) + locais aprendidos dos utilizadores. Alimenta o geocoding do bot WhatsApp.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_luanda_places_geog
  ON public.luanda_places USING gist (geog);
CREATE INDEX IF NOT EXISTS idx_luanda_places_norm_trgm
  ON public.luanda_places USING gist (nome_normalizado extensions.gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_luanda_places_zona
  ON public.luanda_places (zona) WHERE zona IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_luanda_places_origem
  ON public.luanda_places (origem, confianca DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.luanda_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS luanda_places_select_auth ON public.luanda_places;
CREATE POLICY luanda_places_select_auth ON public.luanda_places
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS luanda_places_service_all ON public.luanda_places;
CREATE POLICY luanda_places_service_all ON public.luanda_places
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── RPC: resolver_local — nome escrito -> coordenada ──────────────────────
-- Ordem: igualdade exacta -> prefixo -> semelhança trigram.
-- Devolve no máximo 1 linha; `correspondencia` diz como casou.
CREATE OR REPLACE FUNCTION public.resolver_local(p_texto text)
RETURNS TABLE (
  id                uuid,
  nome              text,
  lat               double precision,
  lng               double precision,
  raio_m            integer,
  zona              text,
  origem            text,
  confianca         integer,
  endereco_completo text,
  similaridade      real,
  correspondencia   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH alvo AS (
    SELECT public.zr_normaliza_local(p_texto) AS q
  )
  SELECT
    l.id, l.nome, l.lat, l.lng, l.raio_m, l.zona, l.origem, l.confianca,
    l.endereco_completo,
    extensions.similarity(l.nome_normalizado, a.q)::real AS similaridade,
    CASE
      WHEN l.nome_normalizado = a.q                    THEN 'exato'
      WHEN l.nome_normalizado LIKE a.q || '%'          THEN 'prefixo'
      WHEN a.q LIKE l.nome_normalizado || '%'          THEN 'contido'
      ELSE 'aproximado'
    END AS correspondencia
  FROM public.luanda_places l
  CROSS JOIN alvo a
  WHERE a.q <> ''
    AND char_length(a.q) >= 3
    AND (
      l.nome_normalizado = a.q
      OR l.nome_normalizado LIKE a.q || '%'
      OR a.q LIKE l.nome_normalizado || '%'
      OR l.nome_normalizado % a.q          -- operador trigram (índice GiST)
    )
  ORDER BY
    (l.nome_normalizado = a.q) DESC,
    (l.nome_normalizado LIKE a.q || '%') DESC,
    -- semelhança ANTES de "contido": sem isto "zango3" casava com "Zango"
    -- (a zona genérica) em vez de "Zango 3".
    extensions.similarity(l.nome_normalizado, a.q) DESC,
    l.confianca DESC,
    l.hit_count DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolver_local(text) IS
  'Resolve um nome escrito para as coordenadas reais do local (luanda_places). Devolve 1 linha ou nenhuma.';

-- ── RPC: locais_perto — coordenada -> local conhecido num raio ────────────
-- É isto que faz o bot "não ficar em dúvida": quando chega um pin, se houver
-- um local aprendido/conhecido a menos do raio dele, usamos esse nome.
CREATE OR REPLACE FUNCTION public.locais_perto(
  p_lat      double precision,
  p_lng      double precision,
  p_raio_m   integer DEFAULT 1000,
  p_max      integer DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  nome        text,
  zona        text,
  origem      text,
  distancia_m double precision,
  raio_m      integer,
  confianca   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ponto AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS g
  )
  SELECT
    l.id, l.nome, l.zona, l.origem,
    ST_Distance(l.geog, p.g)::double precision AS distancia_m,
    l.raio_m, l.confianca
  FROM public.luanda_places l
  CROSS JOIN ponto p
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND NOT (p_lat = 0 AND p_lng = 0)
    -- o local cobre até ao seu próprio raio; o chamador pode apertar o limite
    AND ST_DWithin(l.geog, p.g, LEAST(COALESCE(p_raio_m, 1000), l.raio_m))
  ORDER BY distancia_m ASC, l.confianca DESC
  LIMIT GREATEST(COALESCE(p_max, 5), 1);
$$;

COMMENT ON FUNCTION public.locais_perto(double precision, double precision, integer, integer) IS
  'Locais conhecidos/aprendidos dentro do raio de um ponto. Usado para nomear um pin de localização.';

-- ── RPC: registar_local — ensinar um local novo ───────────────────────────
CREATE OR REPLACE FUNCTION public.registar_local(
  p_nome         text,
  p_lat          double precision,
  p_lng          double precision,
  p_raio_m       integer DEFAULT 1000,
  p_zona         text    DEFAULT NULL,
  p_origem       text    DEFAULT 'aprendido',
  p_aprendido_de text    DEFAULT NULL,
  p_endereco     text    DEFAULT NULL,
  p_osm_tipo     text    DEFAULT NULL
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

  -- um local ensinado por um utilizador começa em 60; vindo do OSM em 90
  v_conf := CASE COALESCE(p_origem, 'aprendido')
              WHEN 'osm'    THEN 90
              WHEN 'manual' THEN 95
              ELSE 60
            END;

  INSERT INTO public.luanda_places (
    nome, nome_normalizado, lat, lng, raio_m, zona,
    origem, confianca, aprendido_de, endereco_completo, osm_tipo
  ) VALUES (
    btrim(p_nome), v_norm, p_lat, p_lng,
    GREATEST(LEAST(COALESCE(p_raio_m, 1000), 20000), 100),
    p_zona, COALESCE(p_origem, 'aprendido'), v_conf,
    p_aprendido_de, p_endereco, p_osm_tipo
  )
  ON CONFLICT (nome_normalizado) DO UPDATE SET
    lat               = EXCLUDED.lat,
    lng               = EXCLUDED.lng,
    raio_m            = EXCLUDED.raio_m,
    zona              = COALESCE(EXCLUDED.zona, public.luanda_places.zona),
    endereco_completo = COALESCE(EXCLUDED.endereco_completo, public.luanda_places.endereco_completo),
    osm_tipo          = COALESCE(EXCLUDED.osm_tipo, public.luanda_places.osm_tipo),
    -- a confiança nunca desce; um local confirmado pelo OSM mantém-se OSM
    confianca         = GREATEST(public.luanda_places.confianca, EXCLUDED.confianca),
    origem            = CASE
                          WHEN public.luanda_places.origem = 'manual' THEN 'manual'
                          WHEN public.luanda_places.origem = 'osm'    THEN 'osm'
                          ELSE EXCLUDED.origem
                        END,
    updated_at        = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.registar_local(text, double precision, double precision, integer, text, text, text, text, text) IS
  'Guarda/actualiza um local. Usado pelo fluxo de aprendizagem do bot quando o utilizador ensina uma zona desconhecida.';

-- ── RPC: reforcar_local — contar uso ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reforcar_local(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.luanda_places
     SET hit_count = hit_count + 1, updated_at = now()
   WHERE id = p_id;
$$;

-- ── RPC: locais_a_verificar — auditoria para o painel ────────────────────
CREATE OR REPLACE FUNCTION public.locais_a_verificar(p_limite integer DEFAULT 50)
RETURNS TABLE (
  id uuid, nome text, zona text, origem text,
  confianca integer, osm_tipo text, aprendido_de text,
  endereco_completo text, hit_count integer, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, nome, zona, origem, confianca, osm_tipo, aprendido_de,
         endereco_completo, hit_count, created_at
  FROM public.luanda_places
  WHERE confianca < 70 OR origem = 'aprendido'
  ORDER BY confianca ASC, created_at DESC
  LIMIT GREATEST(COALESCE(p_limite, 50), 1);
$$;

-- ── Permissões ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.resolver_local(text)                                    FROM public, anon;
REVOKE ALL ON FUNCTION public.locais_perto(double precision, double precision, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.registar_local(text, double precision, double precision, integer, text, text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reforcar_local(uuid)                                    FROM public, anon;
REVOKE ALL ON FUNCTION public.locais_a_verificar(integer)                             FROM public, anon;

GRANT EXECUTE ON FUNCTION public.resolver_local(text)                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.locais_perto(double precision, double precision, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registar_local(text, double precision, double precision, integer, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reforcar_local(uuid)                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.locais_a_verificar(integer)                          TO authenticated, service_role;

-- ── Seed: locais reais de Luanda (OpenStreetMap / Nominatim) ──────────────
-- `confianca` >= 82 -> tipo OSM inequívoco (bairro, subúrbio, vila, município)
-- `confianca` 60-70 -> landmark ou rua/POI usado como referência (a verificar)
INSERT INTO public.luanda_places
  (nome, nome_normalizado, lat, lng, raio_m, zona, origem, confianca, osm_tipo, endereco_completo)
VALUES
  -- Viana
  ('Viana',                    'viana',                    -8.905350, 13.371090, 1000, 'Viana',        'osm', 85, 'administrative', 'Município de Viana, Luanda, Angola'),
  ('Estalagem',                'estalagem',                -8.881180, 13.335500, 1000, 'Viana',        'osm', 92, 'suburb',         'Estalagem, Município de Viana, Luanda, Angola'),
  ('Sapu',                     'sapu',                     -8.897390, 13.331510, 1000, 'Viana',        'osm', 92, 'neighbourhood',  'Sapu, Município de Viana, Luanda, Angola'),
  ('Cacuaco',                  'cacuaco',                  -8.777110, 13.370170, 1000, 'Viana',        'osm', 88, 'town',           'Cacuaco, Município do Cacuaco, Luanda, Angola'),
  ('Km 30',                    'km 30',                    -8.909280, 13.381000, 1000, 'Viana',        'osm', 60, 'trunk',          'Estrada de Catete, PIV, Kapalanga, Município de Viana (aproximado)'),
  -- Kilamba
  ('Kilamba',                  'kilamba',                  -8.901360, 13.236600, 1000, 'Kilamba',      'osm', 85, 'administrative', 'Município do Kilamba Kiaxi, Luanda, Angola'),
  ('Kilamba Kiaxi',            'kilamba kiaxi',            -8.901360, 13.236600, 1000, 'Kilamba',      'osm', 85, 'administrative', 'Município do Kilamba Kiaxi, Luanda, Angola'),
  ('Centralidade do Kilamba',  'centralidade do kilamba',  -8.998150, 13.265160, 1000, 'Kilamba',      'osm', 82, 'residential',    'Nova Cidade de Kilamba, Município do Belas, Luanda, Angola'),
  ('Zango',                    'zango',                    -9.019500, 13.407460, 1500, 'Kilamba',      'osm', 80, 'village',        'Zango II, Município de Viana, Província de Icolo e Bengo'),
  ('Zango 0',                  'zango 0',                  -8.983480, 13.400990, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango 0, Município de Viana, Província de Icolo e Bengo'),
  ('Zango 1',                  'zango 1',                  -9.009860, 13.405210, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango I, Município de Viana, Província de Icolo e Bengo'),
  ('Zango I',                  'zango i',                  -9.009860, 13.405210, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango I, Município de Viana, Província de Icolo e Bengo'),
  ('Zango 2',                  'zango 2',                  -9.019500, 13.407460, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango II, Município de Viana, Província de Icolo e Bengo'),
  ('Zango II',                 'zango ii',                 -9.019500, 13.407460, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango II, Município de Viana, Província de Icolo e Bengo'),
  ('Zango 3',                  'zango 3',                  -9.048100, 13.411880, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango III, Município de Viana, Província de Icolo e Bengo'),
  ('Zango III',                'zango iii',                -9.048100, 13.411880, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango III, Município de Viana, Província de Icolo e Bengo'),
  ('Zango 4',                  'zango 4',                  -9.062430, 13.415640, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango IV, Município de Viana, Província de Icolo e Bengo'),
  ('Zango IV',                 'zango iv',                 -9.062430, 13.415640, 1000, 'Kilamba',      'osm', 88, 'village',        'Zango IV, Município de Viana, Província de Icolo e Bengo'),
  -- Talatona / Belas
  ('Talatona',                 'talatona',                 -8.935250, 13.233250, 1000, 'Talatona',     'osm', 85, 'administrative', 'Município do Talatona, Luanda, Angola'),
  ('Camama',                   'camama',                   -8.940240, 13.264730, 1000, 'Talatona',     'osm', 92, 'suburb',         'Camama, Município do Talatona, Luanda, Angola'),
  ('Belas',                    'belas',                    -9.103340, 13.174550, 1500, 'Talatona',     'osm', 85, 'administrative', 'Município do Belas, Luanda, Angola'),
  ('Futungo',                  'futungo',                  -8.912150, 13.167320, 1000, 'Talatona',     'osm', 92, 'neighbourhood',  'Futungo I, Município do Talatona, Luanda, Angola'),
  ('Benfica Sul',              'benfica sul',              -8.944330, 13.163990, 1000, 'Talatona',     'osm', 92, 'suburb',         'Benfica, Kifica, Município do Talatona, Luanda, Angola'),
  ('Kifica',                   'kifica',                   -8.958990, 13.162150, 1000, 'Talatona',     'osm', 92, 'neighbourhood',  'Quifica, Benfica, Kifica, Município do Talatona, Luanda'),
  ('Kikuxi',                   'kikuxi',                   -8.978860, 13.366910, 1000, 'Talatona',     'osm', 70, 'commercial',     'Kikuxi, Município de Viana, Luanda, Angola'),
  ('Belas Shopping',           'belas shopping',           -8.924450, 13.186210,  500, 'Talatona',     'osm', 70, 'retail',         'Belas Shopping, Talatona, Município do Talatona, Luanda'),
  ('Cidade Universitaria',     'cidade universitaria',     -8.942660, 13.282060, 1000, 'Talatona',     'osm', 60, 'service',        'Estrada da Cidade Universitária, Camama, Luanda (aproximado)'),
  ('Lar do Patriota',          'lar do patriota',          -8.938820, 13.173640, 1000, 'Talatona',     'osm', 65, 'secondary',      'Avenida O Lar do Patriota, Benfica, Kifica, Luanda'),
  -- Centro / Ilha / Ingombota
  ('Centro',                   'centro',                   -8.813540, 13.226900, 1000, 'Centro',       'osm', 92, 'neighbourhood',  'Coqueiros, Luanda, Município de Luanda, Angola'),
  ('Ilha de Luanda',           'ilha de luanda',           -8.792240, 13.228450, 1500, 'Centro',       'osm', 90, 'island',         'Ilha do Cabo, Lelo, Luanda, Município de Luanda, Angola'),
  ('Ilha do Cabo',             'ilha do cabo',             -8.792240, 13.228450, 1500, 'Centro',       'osm', 90, 'island',         'Ilha do Cabo, Lelo, Luanda, Município de Luanda, Angola'),
  ('Ilha',                     'ilha',                     -8.792240, 13.228450, 1500, 'Centro',       'osm', 80, 'island',         'Ilha do Cabo, Lelo, Luanda, Município de Luanda, Angola'),
  ('Ingombota',                'ingombota',                -8.799890, 13.255440, 1000, 'Centro',       'osm', 85, 'administrative', 'Distrito Urbano da Ingombota, Município de Luanda, Angola'),
  ('Cidade Alta',              'cidade alta',              -8.799890, 13.255440, 1000, 'Centro',       'osm', 60, 'administrative', 'Área da Cidade Alta / Ingombota, Luanda (aproximado)'),
  ('Mutamba',                  'mutamba',                  -8.815060, 13.232370,  700, 'Centro',       'osm', 92, 'neighbourhood',  'Mutamba, Kinanga, Luanda, Município de Luanda, Angola'),
  ('Kinaxixi',                 'kinaxixi',                 -8.816850, 13.242800,  700, 'Centro',       'osm', 60, 'bank',           'Avenida Comandante Valódia, Kinaxixi, Vila Alice, Luanda'),
  ('Praia do Bispo',           'praia do bispo',           -8.819490, 13.220560, 1000, 'Centro',       'osm', 92, 'suburb',         'Praia do Bispo, Luanda, Município de Luanda, Angola'),
  ('Maculusso',                'maculusso',                -8.822780, 13.242040,  800, 'Centro',       'osm', 92, 'neighbourhood',  'Maculusso, Calemba, Vila Alice, Luanda, Angola'),
  ('Bairro Operario',          'bairro operario',          -8.813800, 13.247850,  800, 'Centro',       'osm', 92, 'neighbourhood',  'Bairro Operario, São Paulo, Luanda, Angola'),
  ('Porto de Luanda',          'porto de luanda',          -8.791300, 13.271960,  500, NULL,           'osm', 90, 'harbour',        'Porto de Luanda, Distrito Urbano da Ingombota, Luanda'),
  -- Miramar
  ('Miramar',                  'miramar',                  -8.809330, 13.249040, 1000, 'Miramar',      'osm', 92, 'neighbourhood',  'Miramar, São Paulo, Luanda, Distrito Urbano do Sambizanga'),
  ('Alvalade',                 'alvalade',                 -8.830770, 13.235760, 1000, 'Miramar',      'osm', 92, 'neighbourhood',  'Alvalade, Martires de Kifangondo, Distrito Urbano da Maianga'),
  -- Maianga
  ('Maianga',                  'maianga',                  -8.826780, 13.230390, 1000, 'Maianga',      'osm', 85, 'administrative', 'Distrito Urbano da Maianga, Luanda, Município de Luanda'),
  ('Prenda',                   'prenda',                   -8.838550, 13.222420, 1000, 'Maianga',      'osm', 92, 'neighbourhood',  'Prenda, Distrito Urbano da Maianga, Luanda, Angola'),
  ('Cassenda',                 'cassenda',                 -8.844960, 13.229190, 1000, 'Maianga',      'osm', 92, 'neighbourhood',  'Cassenda, Distrito Urbano da Maianga, Luanda, Angola'),
  ('Neves Bendinha',           'neves bendinha',           -8.843740, 13.260870, 1000, 'Maianga',      'osm', 92, 'neighbourhood',  'Bairro Neves Bendinha, Distrito Urbano da Maianga, Luanda'),
  -- Cazenga
  ('Cazenga',                  'cazenga',                  -8.822930, 13.307960, 1000, 'Cazenga',      'osm', 85, 'administrative', 'Município do Cazenga, Luanda, Angola'),
  ('Palanca',                  'palanca',                  -8.860700, 13.266070, 1000, 'Cazenga',      'osm', 92, 'suburb',         'Palanca, Luanda, Município de Luanda, Angola'),
  ('Vila Alice',               'vila alice',               -8.826890, 13.249100,  800, 'Cazenga',      'osm', 92, 'neighbourhood',  'Vila Alice, Calemba, Luanda, Município de Luanda, Angola'),
  ('Rocha Pinto',              'rocha pinto',              -8.857920, 13.213190, 1000, 'Cazenga',      'osm', 92, 'suburb',         'Rocha Pinto, Distrito Urbano da Samba, Luanda, Angola'),
  ('Tala Hady',                'tala hady',                -8.838360, 13.279530, 1000, 'Cazenga',      'osm', 92, 'suburb',         'Tala-Hady, Luanda, Município de Luanda, Angola'),
  ('Hoji ya Henda',            'hoji ya henda',            -8.808180, 13.290720, 1000, 'Cazenga',      'osm', 88, 'village',        'Hoji-Ya-Henda, Município do Cazenga, Luanda, Angola'),
  ('Hoji-Ya-Henda',            'hoji-ya-henda',            -8.808180, 13.290720, 1000, 'Cazenga',      'osm', 88, 'village',        'Hoji-Ya-Henda, Município do Cazenga, Luanda, Angola'),
  -- Rangel / Sambizanga
  ('Rangel',                   'rangel',                   -8.831380, 13.272380, 1000, 'Rangel',       'osm', 92, 'neighbourhood',  'Comissão do Rangel, Triangulo, Luanda, Município de Luanda'),
  ('Golf',                     'golf',                     -8.862050, 13.256790, 1000, 'Rangel',       'osm', 92, 'suburb',         'Golf, Luanda, Município de Luanda, Angola'),
  ('Golf 2',                   'golf 2',                   -8.862050, 13.256790, 1000, 'Rangel',       'osm', 80, 'suburb',         'Golf, Luanda, Município de Luanda, Angola'),
  ('Sambizanga',               'sambizanga',               -8.804360, 13.271510, 1000, 'Rangel',       'osm', 92, 'suburb',         'Sambizanga, Luanda, Distrito Urbano do Sambizanga'),
  -- Samba
  ('Samba',                    'samba',                    -8.838790, 13.212130, 1000, 'Samba',        'osm', 85, 'administrative', 'Distrito Urbano da Samba, Luanda, Município de Luanda'),
  ('Sao Paulo',                'sao paulo',                -8.813520, 13.255920, 1000, 'Samba',        'osm', 92, 'suburb',         'São Paulo, Luanda, Distrito Urbano do Sambizanga, Angola'),
  ('Morro Bento',              'morro bento',              -8.896390, 13.201050, 1000, 'Samba',        'osm', 90, 'quarter',        'Morro Bento, Distrito Urbano da Samba, Luanda, Angola'),
  ('Vila Estoril',             'vila estoril',             -8.885630, 13.251340,  800, 'Kilamba',      'osm', 82, 'residential',    'Vila Estoril, Luanda, Município do Kilamba Kiaxi, Angola'),
  -- Benfica
  ('Benfica',                  'benfica',                  -8.967610, 13.189820, 1000, 'Benfica',      'osm', 92, 'neighbourhood',  'Benfica, Patriota, Kifica, Município do Talatona, Luanda'),
  -- Luanda Norte / Sequele
  ('Luanda Norte',             'luanda norte',             -8.822930, 13.307960, 1500, 'Luanda Norte', 'osm', 60, 'administrative', 'Área do Cazenga / Luanda Norte (aproximado)'),
  ('Viana Norte',              'viana norte',              -8.905350, 13.371090, 1500, 'Luanda Norte', 'osm', 60, 'administrative', 'Área de Viana Norte (aproximado)'),
  ('Sequele',                  'sequele',                  -8.888240, 13.487750, 1500, 'Luanda Norte', 'osm', 60, 'marketplace',    'Mercado do Sequele, Centralidade de Cacuaco, Luanda'),
  -- Infra relevante
  ('Aeroporto',                'aeroporto',                -8.861410, 13.228760,  700, NULL,           'osm', 95, 'aerodrome',      'Aeroporto Internacional 4 de Fevereiro, Luanda, Angola'),
  ('Aeroporto Internacional',  'aeroporto internacional',  -8.861410, 13.228760,  700, NULL,           'osm', 95, 'aerodrome',      'Aeroporto Internacional 4 de Fevereiro, Luanda, Angola'),
  ('Aeroporto 4 de Fevereiro', 'aeroporto 4 de fevereiro', -8.861410, 13.228760,  700, NULL,           'osm', 95, 'aerodrome',      'Aeroporto Internacional 4 de Fevereiro, Luanda, Angola')
ON CONFLICT (nome_normalizado) DO UPDATE SET
  lat               = EXCLUDED.lat,
  lng               = EXCLUDED.lng,
  raio_m            = EXCLUDED.raio_m,
  zona              = COALESCE(EXCLUDED.zona, public.luanda_places.zona),
  osm_tipo          = EXCLUDED.osm_tipo,
  endereco_completo = EXCLUDED.endereco_completo,
  -- nunca rebaixar um local que um utilizador já confirmou a 100
  confianca         = GREATEST(public.luanda_places.confianca, EXCLUDED.confianca),
  origem            = CASE WHEN public.luanda_places.origem = 'manual' THEN 'manual' ELSE 'osm' END,
  updated_at        = now();

COMMIT;
