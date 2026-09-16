-- =============================================================================
-- Preparação do MOTORISTA DE TESTE para o fluxo de corrida por WhatsApp
--
-- Motorista: alberdaniosilva16@gmail.com  (perfil "dánio")
--   user_id = 5f8099e3-0271-4851-ac3e-7655f9e05197
--
-- Antes deste script:
--   profiles.phone            = NULL      -> nenhuma notificação podia ser enviada
--   driver_locations.status   = 'offline' -> não aparecia em get_cascade_drivers
--
-- ⚠️ O telefone usado é o que já está no perfil de administrador
-- (alberdaniosilva15@gmail.com, +244938776308). Se estiver errado, muda-se
-- aqui e volta a correr — é idempotente.
--
-- Só faz UPDATE/INSERT. Não apaga nada.
-- =============================================================================

-- 1. Telefone do motorista de teste
update public.profiles
set phone = '+244938776308'
where user_id = '5f8099e3-0271-4851-ac3e-7655f9e05197'
  and (phone is null or btrim(phone) = '');

-- 2. Pôr o motorista online, na zona de Belas (onde estão quase todas as
--    corridas do histórico), e refrescar updated_at para o surge D/O o contar.
--
--    As células H3 também têm de ser reescritas: estavam a apontar para Camama,
--    a posição antiga, e é por elas que `find_drivers_h3` encontra o motorista.
--    Valores calculados com h3-js 3.7.2 e conferidos contra as células já
--    existentes na tabela:
--      geoToH3(-8.9333, 13.1833, 9) === '89831e313b7ffff'
--      geoToH3(-8.9333, 13.1833, 7) === '87831e311ffffff'
insert into public.driver_locations (
  driver_id, location, status, h3_index_res9, h3_index_res7, updated_at
)
values (
  '5f8099e3-0271-4851-ac3e-7655f9e05197',
  ST_SetSRID(ST_MakePoint(13.1833, -8.9333), 4326)::geography,
  'available',
  '89831e313b7ffff',
  '87831e311ffffff',
  now()
)
on conflict (driver_id) do update
set location      = excluded.location,
    status        = excluded.status,
    h3_index_res9 = excluded.h3_index_res9,
    h3_index_res7 = excluded.h3_index_res7,
    updated_at    = now();

-- 3. Confirmação
select
  p.name                                            as motorista,
  p.phone                                           as telefone,
  dl.status::text                                   as estado,
  dl.h3_index_res9                                  as celula_h3,
  round(st_y(dl.location::geometry)::numeric, 4)    as lat,
  round(st_x(dl.location::geometry)::numeric, 4)    as lng,
  dl.updated_at                                     as actualizado
from public.profiles p
join public.driver_locations dl on dl.driver_id = p.user_id
where p.user_id = '5f8099e3-0271-4851-ac3e-7655f9e05197';
