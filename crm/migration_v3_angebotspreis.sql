-- ============================================================================
-- Migration v3: Angebotspreis pro Lead
-- Einmalig im Supabase SQL Editor laufen lassen.
-- ============================================================================

alter table leads add column if not exists angebotspreis numeric(12,2);

create index if not exists leads_angebotspreis_idx
  on leads (angebotspreis) where deleted_at is null and angebotspreis is not null;
