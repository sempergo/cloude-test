-- ============================================================================
-- Migration v6: Engine-Status-Tabelle für Live-Progress im CRM
-- Single-Row Tabelle, die von den Engine-Scripts aktualisiert wird.
-- ============================================================================

create table if not exists engine_status (
  id            int primary key default 1,
  active        boolean not null default false,
  kind          text,                          -- 'scrape' | 'enrich' | 'score'
  total         int,                           -- Gesamt-Items im aktuellen Run
  processed     int default 0,                 -- Bereits verarbeitet
  current_label text,                          -- z.B. "Savanna Restaurant Frankfurt"
  message       text,                          -- Freitext: "Starting...", "Done", "Failed: ..."
  started_at    timestamptz,
  updated_at    timestamptz not null default now(),
  -- Sanity: id darf nur 1 sein (Single-Row-Pattern)
  constraint engine_status_singleton check (id = 1)
);

-- Initialer Row anlegen
insert into engine_status (id, active, message)
  values (1, false, 'idle')
  on conflict (id) do nothing;

-- RLS
alter table engine_status enable row level security;
drop policy if exists "auth_read_engine_status" on engine_status;
create policy "auth_read_engine_status" on engine_status
  for select to authenticated using (true);
drop policy if exists "auth_write_engine_status" on engine_status;
create policy "auth_write_engine_status" on engine_status
  for all to authenticated using (true) with check (true);

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'engine_status'
  ) then
    alter publication supabase_realtime add table engine_status;
  end if;
end $$;
