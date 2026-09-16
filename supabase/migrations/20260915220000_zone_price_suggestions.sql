-- ═════════════════════════════════════════════════════════════════════════════
-- zone_price_suggestions()
--
-- Devolve cada linha de `zone_prices` acompanhada do preço que o MOTOR DE PREÇO
-- calcularia para essa mesma viagem. Serve para o painel de admin poder ver se
-- uma tarifa fixa ainda faz sentido face à fórmula, e alinhá-la com um clique.
--
-- Como é calculado:
--   * distância  → a `distance_km` já guardada na própria linha (é a referência
--                  que o admin definiu; não inventamos distâncias);
--   * duração    → distância × 2 minutos, que é 30 km/h — a mesma velocidade de
--                  recurso que o `routeService` do app usa;
--   * coordenadas→ centroide de cada zona, calculado a partir de
--                  `src/data/angolaLocations.ts` (1421 locais reais do app,
--                  média por `parent`). Só servem para o motor escolher o
--                  multiplicador de zona;
--   * procura/oferta 5/5 e factor de trânsito 1.2 — os mesmos valores que o app
--                  e o bot do WhatsApp enviam.
--
-- NÃO altera nada. É só leitura.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.zone_price_suggestions()
returns table (
  id               uuid,
  origin_zone      text,
  dest_zone        text,
  price_kz         numeric,
  distance_km      numeric,
  active           boolean,
  formula_price_kz numeric,
  zone_multiplier  numeric,
  badges           text[]
)
language sql
stable
set search_path to 'public'
as $$
  with centros(zona, lat, lng) as (
    values
      ('Benfica',      -8.91916::double precision, 13.19187::double precision),
      ('Cazenga',      -8.81707::double precision, 13.27309::double precision),
      ('Centro',       -8.81394::double precision, 13.23420::double precision),
      ('Kilamba',      -8.98561::double precision, 13.22499::double precision),
      ('Luanda Norte', -8.86083::double precision, 13.35700::double precision),
      ('Maianga',      -8.83129::double precision, 13.22162::double precision),
      ('Miramar',      -8.81000::double precision, 13.24200::double precision),
      ('Rangel',       -8.82221::double precision, 13.25383::double precision),
      ('Samba',        -8.87011::double precision, 13.21884::double precision),
      ('Talatona',     -8.93245::double precision, 13.18391::double precision),
      ('Viana',        -8.90553::double precision, 13.33030::double precision)
  ),
  calc as (
    select
      z.id,
      z.origin_zone,
      z.dest_zone,
      z.price_kz,
      z.distance_km,
      z.active,
      coalesce(z.distance_km, 0)::numeric as km,
      public.calculate_fare_engine_pro(
        coalesce(z.distance_km, 0)::numeric,
        ceil(coalesce(z.distance_km, 0)::numeric * 2),
        coalesce(o.lat, -8.8383::double precision),
        coalesce(o.lng, 13.2344::double precision),
        coalesce(d.lat, -8.8383::double precision),
        coalesce(d.lng, 13.2344::double precision),
        'standard', 5, 5, false, false, 1.2
      ) as r
    from public.zone_prices z
    left join centros o on o.zona = z.origin_zone
    left join centros d on d.zona = z.dest_zone
  )
  select
    c.id,
    c.origin_zone,
    c.dest_zone,
    c.price_kz,
    c.distance_km,
    c.active,
    (c.r ->> 'fare_kz')::numeric,
    (c.r ->> 'zone_multiplier')::numeric,
    array(select jsonb_array_elements_text(c.r -> 'badges'))
  from calc c
  order by c.origin_zone, c.dest_zone;
$$;

comment on function public.zone_price_suggestions() is
  'Preço fixo de cada par de zonas ao lado do preço que o motor calcularia para a mesma viagem. Só leitura.';

-- É uma ferramenta do painel de admin: não precisa de estar exposta a `anon`.
revoke all on function public.zone_price_suggestions() from public, anon;
grant execute on function public.zone_price_suggestions() to authenticated, service_role;
