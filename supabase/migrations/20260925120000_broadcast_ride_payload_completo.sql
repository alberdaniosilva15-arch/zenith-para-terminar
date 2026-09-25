-- =============================================================================
-- ZENITH RIDE — broadcast_ride_change: payload completo
-- Escrita: 2026-09-25
--
-- ── Porquê ───────────────────────────────────────────────────────────────────
--
-- O trigger `trg_broadcast_ride_change` (migração 20260924220000) emitia um
-- payload com 6 campos: id, status, driver_id, driver_confirmed, version,
-- updated_at.
--
-- O cliente, em `rideService.subscribeToRide`, lê também `accepted_at`,
-- `started_at` e `completed_at` para decidir se o estado mudou. Com o payload
-- estreito, esses campos chegavam `undefined` e o comparador de mudanças
-- disparava um update redundante na mensagem seguinte do `postgres_changes`.
-- Não corrompia nada, mas fazia trabalho a mais e podia piscar valores no ecrã.
--
-- Esta migração passa a emitir todos os campos que o cliente consome. Assim o
-- broadcast da base de dados é um superconjunto do que o caminho antigo (o
-- `broadcastRideUpdated` do cliente, agora removido) enviava — e deixa de haver
-- motivo para o cliente abrir canais próprios só para repetir o evento.
--
-- `private => false` mantém-se: o cliente actual subscreve `ride:${id}` como
-- canal PÚBLICO. Passar a privado obriga a mudar o cliente e a fazer rollout em
-- conjunto — fica para quando os canais privados forem tratados como um todo.
--
-- Aditivo. Substitui só o corpo da função; a assinatura não muda.
-- =============================================================================

create or replace function public.broadcast_ride_change() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform realtime.send(
    jsonb_build_object(
      'id',               new.id,
      'status',           new.status,
      'driver_id',        new.driver_id,
      'passenger_id',     new.passenger_id,
      'driver_confirmed', new.driver_confirmed,
      'price_kz',         new.price_kz,
      'accepted_at',      new.accepted_at,
      'started_at',       new.started_at,
      'completed_at',     new.completed_at,
      'cancelled_at',     new.cancelled_at,
      'updated_at',       new.updated_at,
      'version',          new.version
    ),
    'RIDE_UPDATED',
    'ride:' || new.id::text,
    false
  );
  return new;
exception when others then
  -- Não abortar a transacção da corrida por causa do broadcast — mas TAMBÉM não
  -- falhar em silêncio: o aviso fica no log para se perceber que o evento não saiu.
  raise warning '[v3.4/Fase1] broadcast_ride_change falhou para ride %: % (sqlstate %)',
    new.id, sqlerrm, sqlstate;
  return new;
end
$fn$;
