-- ============================================================================
-- Migration v2: Activities (Termine/Aufgaben mit eigener Notiz + Historie)
-- Einmalig im Supabase SQL Editor laufen lassen.
-- Bestehende next_followup-Daten werden automatisch in activities migriert.
-- ============================================================================

-- ---------- TABLE ----------------------------------------------------------

create table if not exists activities (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  titel        text not null,
  scheduled_at timestamptz,
  note         text,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- TRIGGER --------------------------------------------------------

drop trigger if exists activities_set_updated_at on activities;
create trigger activities_set_updated_at
  before update on activities
  for each row execute function set_updated_at();

-- ---------- INDICES --------------------------------------------------------

create index if not exists activities_lead_idx          on activities (lead_id);
create index if not exists activities_lead_scheduled_idx on activities (lead_id, scheduled_at desc);
create index if not exists activities_open_scheduled_idx on activities (scheduled_at) where done_at is null;

-- ---------- RLS ------------------------------------------------------------

alter table activities enable row level security;
drop policy if exists "auth_all_activities" on activities;
create policy "auth_all_activities" on activities
  for all to authenticated
  using (true) with check (true);

-- ---------- REALTIME -------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'activities'
  ) then
    alter publication supabase_realtime add table activities;
  end if;
end $$;

-- ---------- DATA MIGRATION -------------------------------------------------
-- Bestehende next_followup_at-Einträge in activities übertragen
-- (Spalten existieren ggf. nicht mehr beim zweiten Lauf — daher dynamisch)

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'next_followup_at'
  ) then
    insert into activities (lead_id, titel, scheduled_at, note)
    select id,
           coalesce(nullif(trim(next_followup_note), ''), 'Follow-up'),
           next_followup_at,
           null
    from leads
    where next_followup_at is not null;
  end if;
end $$;

-- ---------- DROP DEPRECATED COLUMNS ----------------------------------------

alter table leads drop column if exists next_followup_at;
alter table leads drop column if exists next_followup_note;
