-- =============================================================================
-- ZENITH RIDE — canais Realtime privados: o canal da corrida (`ride:`)
-- Escrita: 2026-09-25
--
-- ── Porquê ───────────────────────────────────────────────────────────────────
--
-- As políticas de `realtime.messages` que autorizam os tópicos das corridas já
-- existiam e estão correctas:
--
--   • `ride participants can receive` (SELECT) — deixa ver `ride:`,
--     `ride_chat_`, `ride_chat:`, `call:` e `call-signal:` a quem for
--     passageiro ou motorista daquela corrida;
--   • `ride participants can send` (INSERT, `WITH CHECK`) — deixa enviar
--     `ride_chat_`, `ride_chat:`, `call:` e `call-signal:` nas mesmas
--     condições. Repare-se que `ride:` NÃO está nesta lista: ninguém deve
--     poder forjar uma actualização de corrida a partir do cliente.
--
-- O problema é que **num canal público estas políticas são inertes**. Com a
-- anon key — que é pública por desenho e vai no bundle do browser — quem
-- soubesse o id de uma corrida podia subscrever `ride:<id>` e acompanhar
-- estado, motorista e preço. O `broadcast_ride_change` marcava a mensagem como
-- pública (`false`), logo era entregue a qualquer subscritor.
--
-- Esta migração marca-a como **privada**. A partir daqui só a recebe quem a
-- política de SELECT autorizar.
--
-- ── O que muda, exactamente ─────────────────────────────────────────────────
--
-- Só o último argumento de `realtime.send`: `false` → `true`. O payload, o
-- evento, o tópico, o `security definer`, o `search_path` e o bloco
-- `exception when others` que deixa `WARNING` no log ficam **iguais** — a
-- função viva foi lida antes de a substituir (ver `REFERENCIA-tecnica.md`).
--
-- ── ⚠️ Ordem de aplicação ────────────────────────────────────────────────────
--
-- O cliente tem de passar a subscrever com `{ config: { private: true } }`
-- (`rideService.ts`). Enquanto o deploy do cliente não chegar, o cliente antigo
-- (subscrição pública) **deixa de receber** este broadcast.
--
-- Isso é aceitável — e só é aceitável porque existe caminho alternativo: o
-- `rideService` subscreve também `postgres_changes` sobre `rides` com
-- `id=eq.<rideId>`, e essa tabela está protegida por RLS. Durante a janela, a
-- actualização da corrida chega por aí, apenas menos instantânea.
-- =============================================================================

create or replace function public.broadcast_ride_change() returns trigger
language plpgsql security definer set search_path = public as $function$
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
    true
  );
  return new;
exception when others then
  -- Não abortar a transacção da corrida por causa do broadcast — mas TAMBÉM não
  -- falhar em silêncio: o aviso fica no log para se perceber que o evento não saiu.
  raise warning '[v3.4/Fase1] broadcast_ride_change falhou para ride %: % (sqlstate %)',
    new.id, sqlerrm, sqlstate;
  return new;
end
$function$;
