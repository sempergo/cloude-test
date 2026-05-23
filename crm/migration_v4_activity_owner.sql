-- ============================================================================
-- Migration v4: Owner pro Aktivität (Markus / Robin)
-- Einmalig im Supabase SQL Editor laufen lassen.
-- ============================================================================

alter table activities add column if not exists owner text;

-- Constraint: nur Markus, Robin oder NULL erlaubt
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'activities_owner_check'
  ) then
    alter table activities add constraint activities_owner_check
      check (owner is null or owner in ('Markus', 'Robin'));
  end if;
end $$;

create index if not exists activities_owner_idx
  on activities (owner) where owner is not null and done_at is null;
