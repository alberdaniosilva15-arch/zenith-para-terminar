-- =============================================================================
-- ZENITH RIDE v3.4 — MIGRAÇÃO CONSOLIDADA DE CORRECÇÕES CRÍTICAS
-- Data: 2026-09-24
--
-- Fases cobertas:
--   • Fase 0: Canais Realtime privados e RLS em realtime.messages
--   • Fase 1: Estado da corrida (auditoria, versão monotónica, constraint, RPC atómica e trigger de broadcast)
--   • Fase 2: Chat idempotente (coluna client_id e índice único em ride_messages)
--   • Fase 4: Contratos com recolha e destino (coordenadas e backfill)
--   • Fase 6: WhatsApp Outbox (tabela e fila assíncrona para notificações resilientes)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 0 — SEGURANÇA DOS CANAIS REALTIME
-- ─────────────────────────────────────────────────────────────────────────────

-- Políticas de segurança em realtime.messages para restringir tópicos de corridas
-- apenas aos participantes reais (passageiro e motorista da corrida).
do $$
begin
  if exists (
    select 1 from pg_tables where schemaname = 'realtime' and tablename = 'messages'
  ) then
    execute 'alter table realtime.messages enable row level security';

    -- Remover políticas antigas se existirem
    drop policy if exists "ride participants can receive" on realtime.messages;
    drop policy if exists "ride participants can send" on realtime.messages;

    -- Só participantes da corrida podem ler mensagens do tópico
    create policy "ride participants can receive"
    on realtime.messages for select to authenticated
    using (
      exists (
        select 1 from public.rides r
        where (realtime.topic() in ('ride:' || r.id::text, 'ride_chat:' || r.id::text, 'call:' || r.id::text, 'call-signal:' || r.id::text))
          and (r.passenger_id = auth.uid() or r.driver_id = auth.uid())
      )
    );

    -- Só participantes podem enviar mensagens para tópicos de chat ou chamada
    create policy "ride participants can send"
    on realtime.messages for insert to authenticated
    with check (
      exists (
        select 1 from public.rides r
        where (realtime.topic() in ('ride_chat:' || r.id::text, 'call:' || r.id::text, 'call-signal:' || r.id::text))
          and (r.passenger_id = auth.uid() or r.driver_id = auth.uid())
      )
    );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 1 — ESTADO DA CORRIDA ("À PROCURA" APÓS ACEITAR)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabela de auditoria para rastrear quem altera status ou driver_id em rides
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

create or replace function public.audit_rides_status() returns trigger
language plpgsql security definer as $$
begin
  if new.status is distinct from old.status or new.driver_id is distinct from old.driver_id then
    insert into public.rides_status_audit(ride_id, old_status, new_status, old_driver, new_driver)
    values (new.id, old.status, new.status, old.driver_id, new.driver_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_rides_status on public.rides;
create trigger trg_audit_rides_status after update on public.rides
for each row execute function public.audit_rides_status();

-- 2. Limpar dados inconsistentes existentes antes de aplicar a constraint
update public.rides
set status = 'accepted'
where status = 'searching' and driver_id is not null;

-- 3. Constraint de integridade: estado searching NUNCA pode ter driver_id preenchido
alter table public.rides drop constraint if exists rides_searching_has_no_driver;
alter table public.rides
add constraint rides_searching_has_no_driver
check (not (status = 'searching' and driver_id is not null));

-- 4. Versão monotónica e timestamp de actualização para ordenar eventos
alter table public.rides add column if not exists version bigint not null default 0;
alter table public.rides add column if not exists updated_at timestamptz not null default now();

create or replace function public.bump_ride_version() returns trigger
language plpgsql as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_bump_ride_version on public.rides;
create trigger trg_bump_ride_version before update on public.rides
for each row execute function public.bump_ride_version();

-- 5. RPC Atómica accept_ride_atomic
create or replace function public.accept_ride_atomic(p_ride_id uuid)
returns public.rides language plpgsql security definer set search_path = public as $$
declare
  r public.rides;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- Actualização atómica em linha única: só ganha se a corrida estiver 'searching' e sem condutor
  update public.rides
  set status = 'accepted',
      driver_id = v_caller,
      accepted_at = now()
  where id = p_ride_id
    and status = 'searching'
    and driver_id is null
  returning * into r;

  if r.id is null then
    raise exception 'RIDE_ALREADY_TAKEN' using errcode = 'P0001';
  end if;

  return r;
end $$;

grant execute on function public.accept_ride_atomic(uuid) to authenticated;

-- 6. Trigger de Broadcast na BD (a própria base de dados emite o evento RIDE_UPDATED)
create or replace function public.broadcast_ride_change() returns trigger
language plpgsql security definer as $$
begin
  -- Envia via realtime.send para o tópico da corrida
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'status', new.status,
      'driver_id', new.driver_id,
      'driver_confirmed', new.driver_confirmed,
      'version', new.version,
      'updated_at', new.updated_at
    ),
    'RIDE_UPDATED',
    'ride:' || new.id::text,
    false
  );
  return new;
exception when others then
  -- Em caso de erro do módulo realtime, não abortar a transacção da corrida
  return new;
end $$;

drop trigger if exists trg_broadcast_ride_change on public.rides;
create trigger trg_broadcast_ride_change after update on public.rides
for each row execute function public.broadcast_ride_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2 — CHAT FIÁVEL E IDEMPOTENTE
-- ─────────────────────────────────────────────────────────────────────────────

-- Coluna client_id para deduplicação idempotente no envio e recepção
alter table public.ride_messages add column if not exists client_id uuid;
create unique index if not exists ride_messages_client_id_uq on public.ride_messages(client_id);
create index if not exists idx_ride_messages_ride_created on public.ride_messages(ride_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 4 — CONTRATOS COM RECOLHA E DESTINO (COORDENADAS COMPLETAS)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.contracts
add column if not exists origin_address text,
add column if not exists origin_lat double precision,
add column if not exists origin_lng double precision,
add column if not exists dest_address text,
add column if not exists dest_lat double precision,
add column if not exists dest_lng double precision;

-- Backfill: o campo 'address' legado representava o destino
update public.contracts
set dest_address = address
where dest_address is null and address is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 6 — WHATSAPP OUTBOX (DISPARO RESILIENTE A PARTIR DO SERVIDOR)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.rides(id) on delete cascade,
  kind text not null, -- 'ride_accepted_passenger', 'ride_assigned_driver', etc.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending', -- 'pending', 'processing', 'sent', 'failed'
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

-- Trigger para enfileirar notificação quando a corrida é aceite
create or replace function public.enqueue_ride_accepted_notification() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') and new.driver_id is not null then
    insert into public.notifications_outbox (ride_id, kind, payload)
    values (
      new.id,
      'ride_accepted_passenger',
      jsonb_build_object(
        'ride_id', new.id,
        'driver_id', new.driver_id,
        'passenger_id', new.passenger_id,
        'accepted_at', new.accepted_at
      )
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_enqueue_ride_accepted on public.rides;
create trigger trg_enqueue_ride_accepted after update on public.rides
for each row execute function public.enqueue_ride_accepted_notification();
