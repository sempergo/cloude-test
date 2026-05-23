-- ============================================================================
-- Migration v7: Engine-Jobs-Queue
-- Das CRM schreibt Jobs in diese Tabelle, ein lokaler Watcher pickt sie ab.
-- ============================================================================

create table if not exists engine_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('scrape','enrich','audit')),
  payload       jsonb not null default '{}',           -- z.B. { "stadt": "Frankfurt", "radius": 3000 }
  prospect_id   uuid references prospects(id) on delete cascade, -- für 'audit' Jobs
  status        text not null default 'pending'
                 check (status in ('pending','running','done','failed','cancelled')),
  result        jsonb,                                 -- z.B. { "inserted": 47, "skipped": 3 }
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_by    text                                   -- 'CRM' oder optional User-Email
);

create index if not exists engine_jobs_status_idx
  on engine_jobs (status, created_at) where status in ('pending','running');
create index if not exists engine_jobs_kind_idx
  on engine_jobs (kind, status);
create index if not exists engine_jobs_prospect_idx
  on engine_jobs (prospect_id) where prospect_id is not null;

alter table engine_jobs enable row level security;
drop policy if exists "auth_all_engine_jobs" on engine_jobs;
create policy "auth_all_engine_jobs" on engine_jobs
  for all to authenticated using (true) with check (true);

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'engine_jobs'
  ) then
    alter publication supabase_realtime add table engine_jobs;
  end if;
end $$;
