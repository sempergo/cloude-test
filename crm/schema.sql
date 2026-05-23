-- ============================================================================
-- CRM Schema for semp-studios website-sales pipeline
-- Run this once in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- ---------- TABLES ---------------------------------------------------------

create table if not exists leads (
  id                 uuid primary key default gen_random_uuid(),
  firma              text not null,
  branche            text,
  kontaktperson      text,
  telefon            text,
  email              text,
  alte_website       text,
  website_url        text,
  status             text not null default 'in_arbeit',
  angebotspreis      numeric(12,2),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

create table if not exists activities (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  titel        text not null,
  scheduled_at timestamptz,
  note         text,
  done_at      timestamptz,
  owner        text check (owner is null or owner in ('Markus', 'Robin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- TRIGGERS -------------------------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

drop trigger if exists activities_set_updated_at on activities;
create trigger activities_set_updated_at
  before update on activities
  for each row execute function set_updated_at();

-- ---------- INDICES --------------------------------------------------------

create index if not exists leads_status_idx
  on leads (status) where deleted_at is null;
create index if not exists leads_angebotspreis_idx
  on leads (angebotspreis) where deleted_at is null and angebotspreis is not null;
create index if not exists notes_lead_created_idx
  on notes (lead_id, created_at desc);
create index if not exists activities_lead_idx
  on activities (lead_id);
create index if not exists activities_lead_scheduled_idx
  on activities (lead_id, scheduled_at desc);
create index if not exists activities_open_scheduled_idx
  on activities (scheduled_at) where done_at is null;
create index if not exists activities_owner_idx
  on activities (owner) where owner is not null and done_at is null;

-- ---------- ROW LEVEL SECURITY ---------------------------------------------

alter table leads enable row level security;
alter table notes enable row level security;
alter table activities enable row level security;

drop policy if exists "auth_all_leads" on leads;
create policy "auth_all_leads" on leads
  for all to authenticated
  using (true) with check (true);

drop policy if exists "auth_all_notes" on notes;
create policy "auth_all_notes" on notes
  for all to authenticated
  using (true) with check (true);

drop policy if exists "auth_all_activities" on activities;
create policy "auth_all_activities" on activities
  for all to authenticated
  using (true) with check (true);

-- ---------- REALTIME -------------------------------------------------------
-- Updates erscheinen live auf allen Geräten (Laptop + Handy synchron)

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table leads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table notes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'activities'
  ) then
    alter publication supabase_realtime add table activities;
  end if;
end $$;
