-- =============================================================================
-- ZENITH RIDE v3.4 — MIGRAÇÃO CONSOLIDADA DE CORRECÇÕES CRÍTICAS
-- Escrita: 2026-09-24   ·   Corrigida: 2026-09-25
--
-- ⚠️ ESTA MIGRAÇÃO NUNCA TINHA CORRIDO.
--
-- Foi escrita e commitada em 24/09 (commit 6d3f071), mas falhava no primeiro
-- statement e a transacção revertia por inteiro. Nada ficou aplicado — mas o
-- cliente foi publicado na mesma a depender destas colunas. Resultado: o chat e
-- a criação de contratos estavam PARTIDOS em produção.
-- Diagnóstico completo: VERIFICACAO-plano-v3.4-20260925.md
--
-- ── As três correcções em relação à versão original ──────────────────────────
--
--  1. REMOVIDO `alter table realtime.messages enable row level security`.
--     O RLS já está activo nessa tabela, e ela pertence a
--     `supabase_realtime_admin` — não temos a posse, pelo que o ALTER falhava
--     com `42501: must be owner of table messages` e matava a migração inteira.
--     As políticas (essas funcionam — testado) ficam.
--
--  2. NÃO se substitui `accept_ride_atomic`.
--     A função viva na base de dados é MELHOR do que a versão que aqui estava:
--     devolve jsonb {success, reason}, verifica is_driver(), exige
--     driver_locations.status='available', usa FOR UPDATE NOWAIT, grava
--     driver_confirmed = TRUE e marca o motorista como busy.
--     A versão antiga desta migração substituía-a por uma pior — e ainda por
--     cima rebentava com `42P13: cannot change return type of existing function`
--     (a viva devolve jsonb, a nova devolvia public.rides). Removida.
--
--  3. Tópico do chat alinhado com o cliente: `ride_chat_` (underscore).
--     A versão antiga testava `ride_chat:` (dois pontos), mas o cliente
--     subscreve `ride_chat_${rideId}` — a política nunca bateria. Aceitam-se
--     as duas formas, para não partir builds antigos.
--
-- ── Fases cobertas ───────────────────────────────────────────────────────────
--   • Fase 0: políticas dos canais Realtime (bloco defensivo)
--   • Fase 1: auditoria, versão monotónica, constraint, broadcast na BD
--   • Fase 2: chat idempotente (client_id)
--   • Fase 4: contratos com recolha e destino
--   • Fase 6: outbox de notificações (ESQUEMA — ver nota no fim)
--
-- Todas as operações são aditivas. Nada é apagado.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 0 — SEGURANÇA DOS CANAIS REALTIME
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Bloco defensivo: se as políticas falharem, o resto da migração (que é o que
-- desbloqueia o chat e os contratos) continua. Uma falha aqui fica como WARNING
-- no log, não em silêncio.

do $fase0$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'realtime' and tablename = 'messages'
  ) then
    raise warning '[v3.4/Fase0] realtime.messages nao existe — politicas saltadas.';
    return;
  end if;

  execute 'drop policy if exists "ride participants can receive" on realtime.messages';
  execute 'drop policy if exists "ride participants can send" on realtime.messages';

  -- Só o passageiro ou o motorista da corrida podem ler os tópicos dela.
  execute $pol$
    create policy "ride participants can receive"
    on realtime.messages for select to authenticated
    using (
      exists (
        select 1 from public.rides r
        where realtime.topic() in (
                'ride:'         || r.id::text,
                'ride_chat_'    || r.id::text,
                'ride_chat:'    || r.id::text,
                'call:'         || r.id::text,
                'call-signal:'  || r.id::text
              )
          and (r.passenger_id = auth.uid() or r.driver_id = auth.uid())
      )
    )
  $pol$;

  -- Só eles podem escrever, e apenas nos tópicos de chat/chamada.
  -- O tópico 'ride:' fica SÓ para leitura pelo cliente — quem escreve é a BD.
  execute $pol$
    create policy "ride participants can send"
    on realtime.messages for insert to authenticated
    with check (
      exists (
        select 1 from public.rides r
        where realtime.topic() in (
                'ride_chat_'    || r.id::text,
                'ride_chat:'    || r.id::text,
                'call:'         || r.id::text,
                'call-signal:'  || r.id::text
              )
          and (r.passenger_id = auth.uid() or r.driver_id = auth.uid())
      )
    )
  $pol$;

  raise notice '[v3.4/Fase0] Politicas de realtime.messages criadas.';
exception when others then
  raise warning '[v3.4/Fase0] Politicas de realtime.messages FALHARAM: % (sqlstate %)', sqlerrm, sqlstate;
end
$fase0$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 1 — ESTADO DA CORRIDA ("À PROCURA" APÓS ACEITAR)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabela de auditoria: quem altera status ou driver_id em rides
create table if not exists public.rides_status_audit (
  id bigserial primary key,
  ride_id uuid not null,
  old_status text,
  new_status text,
  old_driver uuid,
  new_driver uuid,
  actor uuid default auth.uid(),
  app_name text default current_setting('application_name', true),
  at timestamptz default now()
);

create index if not exists idx_rides_status_audit_ride_id on public.rides_status_audit(ride_id);
create index if not exists idx_rides_status_audit_at on public.rides_status_audit(at desc);

-- Sem políticas: só o service_role e funções SECURITY DEFINER lhe tocam.
alter table public.rides_status_audit enable row level security;

create or replace function public.audit_rides_status() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status is distinct from old.status or new.driver_id is distinct from old.driver_id then
    insert into public.rides_status_audit(ride_id, old_status, new_status, old_driver, new_driver)
    values (new.id, old.status, new.status, old.driver_id, new.driver_id);
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_audit_rides_status on public.rides;
create trigger trg_audit_rides_status after update on public.rides
for each row execute function public.audit_rides_status();

-- 2. Corrigir registos inconsistentes ANTES de aplicar a constraint.
--    Verificado em 25/09: 0 linhas neste estado. O UPDATE é um no-op hoje, mas
--    fica como rede para outros ambientes.
update public.rides
set status      = 'accepted',
    accepted_at = coalesce(accepted_at, now())
where status = 'searching' and driver_id is not null;

-- 3. Constraint de integridade: 'searching' NUNCA pode ter driver_id preenchido.
alter table public.rides drop constraint if exists rides_searching_has_no_driver;
alter table public.rides
add constraint rides_searching_has_no_driver
check (not (status = 'searching' and driver_id is not null));

-- 4. Versão monotónica, para o cliente poder descartar eventos fora de ordem.
alter table public.rides add column if not exists version bigint not null default 0;
alter table public.rides add column if not exists updated_at timestamptz not null default now();

create or replace function public.bump_ride_version() returns trigger
language plpgsql as $fn$
begin
  new.version := coalesce(old.version, 0) + 1;
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists trg_bump_ride_version on public.rides;
create trigger trg_bump_ride_version before update on public.rides
for each row execute function public.bump_ride_version();

-- 5. accept_ride_atomic — NÃO MEXER.
--    A função viva já é atómica e é mais completa do que a que aqui estava.
--    (Ver o cabeçalho, correcção n.º 2.)

-- 6. Broadcast emitido pela própria base de dados, em vez de depender do
--    telemóvel do motorista ter rede no momento certo.
--
--    `private => false` de propósito: o cliente actual subscreve `ride:${id}`
--    como canal PÚBLICO. Passar a privado agora obrigaria a mudar o cliente e a
--    fazer rollout em conjunto — fica para a Fase 0 completa.
create or replace function public.broadcast_ride_change() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform realtime.send(
    jsonb_build_object(
      'id',               new.id,
      'status',           new.status,
      'driver_id',        new.driver_id,
      'driver_confirmed', new.driver_confirmed,
      'version',          new.version,
      'updated_at',       new.updated_at
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

drop trigger if exists trg_broadcast_ride_change on public.rides;
create trigger trg_broadcast_ride_change after update on public.rides
for each row execute function public.broadcast_ride_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2 — CHAT FIÁVEL E IDEMPOTENTE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- É esta a coluna que faltava e que estava a matar o chat em produção: o cliente
-- faz `insert({ ride_id, sender_id, text, client_id })` e o PostgREST rejeitava
-- com 400 por a coluna não existir.

alter table public.ride_messages add column if not exists client_id uuid;

-- O índice único é o que torna o reenvio idempotente: reenviar com o mesmo
-- client_id não duplica a mensagem.
create unique index if not exists ride_messages_client_id_uq on public.ride_messages(client_id);
create index if not exists idx_ride_messages_ride_created on public.ride_messages(ride_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 4 — CONTRATOS COM RECOLHA E DESTINO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Também em falta em produção: o formulário grava origin_address/origin_lat/
-- origin_lng/dest_address e o insert falhava todo.

alter table public.contracts
  add column if not exists origin_address text,
  add column if not exists origin_lat double precision,
  add column if not exists origin_lng double precision,
  add column if not exists dest_address text,
  add column if not exists dest_lat double precision,
  add column if not exists dest_lng double precision;

-- Backfill: o antigo 'address' representava o destino.
update public.contracts
set dest_address = address
where dest_address is null and address is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 6 — WHATSAPP OUTBOX (DISPARO RESILIENTE A PARTIR DO SERVIDOR)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ NOTA HONESTA: isto cria o ESQUEMA, não a funcionalidade.
--    Não existe ainda nenhum worker que consuma esta fila, e os templates da
--    Meta (ride_accepted_passenger / ride_assigned_driver) não estão submetidos.
--    Até existirem as duas coisas, as linhas aqui acumulam-se sem serem
--    processadas — a notificação continua a sair pelo caminho antigo
--    (notifyPassengerRideAccepted, do telemóvel do motorista).
--    A tabela é aditiva e inofensiva; fica pronta para quando o worker existir.

create table if not exists public.notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.rides(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  next_retry_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_notifications_outbox_queue
on public.notifications_outbox(status, next_retry_at)
where status in ('pending', 'processing');

-- Sem políticas: só o service_role e o trigger SECURITY DEFINER lhe tocam.
-- Sem isto, a anon key (que é pública) podia ler e forjar notificações.
alter table public.notifications_outbox enable row level security;

create or replace function public.enqueue_ride_accepted_notification() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status = 'accepted'
     and (old.status is distinct from 'accepted')
     and new.driver_id is not null then
    insert into public.notifications_outbox (ride_id, kind, payload)
    values (
      new.id,
      'ride_accepted_passenger',
      jsonb_build_object(
        'ride_id',      new.id,
        'driver_id',    new.driver_id,
        'passenger_id', new.passenger_id,
        'accepted_at',  new.accepted_at
      )
    );
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_enqueue_ride_accepted on public.rides;
create trigger trg_enqueue_ride_accepted after update on public.rides
for each row execute function public.enqueue_ride_accepted_notification();

-- ─────────────────────────────────────────────────────────────────────────────
-- FIM — recarregar a cache de schema do PostgREST
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sem isto, as colunas novas podem demorar a aparecer para a API REST e o
-- cliente continuaria a levar 400.

notify pgrst, 'reload schema';
