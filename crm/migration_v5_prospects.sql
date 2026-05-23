-- ============================================================================
-- Migration v5: Cold-Lead-Engine (prospects)
-- Erweitert das CRM um eine separate Cold-Lead-Pipeline neben den warmen Leads.
-- Idempotent: kann mehrfach ausgeführt werden.
-- ============================================================================

-- ---------- 1. PROSPECTS-TABELLE -------------------------------------------

create table if not exists prospects (
  id                  uuid primary key default gen_random_uuid(),
  -- Identität
  firma               text not null,
  branche             text default 'restaurant',
  stadt               text,
  adresse             text,
  -- Kontakt
  telefon             text,
  email               text,                       -- aus Impressum-Scrape
  website             text,
  instagram           text,
  google_place_id     text unique,                -- Dedup-Schlüssel
  -- Enrichment (JSONB für Flexibilität: tech_stack, lighthouse, has_pdf_menu, has_booking_widget, ...)
  enrichment          jsonb not null default '{}',
  screenshot_desktop  text,
  screenshot_mobile   text,
  -- Scoring
  rule_score          int,
  llm_score           int,
  pain_points         text[],
  scoring_summary     text,
  sales_pitch_hook    text,
  -- Workflow
  prospect_status     text not null default 'new'
                      check (prospect_status in (
                        'new','enriched','scored',
                        'kontaktiert','interessiert','nicht_interessiert',
                        'promoted','disqualifiziert'
                      )),
  owner               text check (owner is null or owner in ('Markus', 'Robin')),
  promoted_lead_id    uuid references leads(id) on delete set null,
  -- Audit
  enriched_at         timestamptz,
  scored_at           timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists prospects_set_updated_at on prospects;
create trigger prospects_set_updated_at
  before update on prospects
  for each row execute function set_updated_at();

create index if not exists prospects_status_idx
  on prospects (prospect_status) where deleted_at is null;
create index if not exists prospects_rule_score_idx
  on prospects (rule_score desc nulls last) where deleted_at is null;
create index if not exists prospects_llm_score_idx
  on prospects (llm_score desc nulls last) where deleted_at is null;
create index if not exists prospects_stadt_idx
  on prospects (stadt) where deleted_at is null;
create index if not exists prospects_owner_idx
  on prospects (owner) where owner is not null and deleted_at is null;

alter table prospects enable row level security;
drop policy if exists "auth_all_prospects" on prospects;
create policy "auth_all_prospects" on prospects
  for all to authenticated
  using (true) with check (true);

-- ---------- 2. ACTIVITIES ERWEITERN ----------------------------------------
-- Activity gehört entweder zu einem lead ODER zu einem prospect (XOR-Constraint).

alter table activities add column if not exists prospect_id uuid references prospects(id) on delete cascade;
alter table activities alter column lead_id drop not null;

alter table activities drop constraint if exists activities_parent_check;
alter table activities add constraint activities_parent_check
  check (
    (lead_id is not null and prospect_id is null) or
    (lead_id is null and prospect_id is not null)
  );

create index if not exists activities_prospect_idx
  on activities (prospect_id) where prospect_id is not null;
create index if not exists activities_prospect_scheduled_idx
  on activities (prospect_id, scheduled_at desc) where prospect_id is not null;

-- ---------- 3. NOTES ERWEITERN ---------------------------------------------

alter table notes add column if not exists prospect_id uuid references prospects(id) on delete cascade;
alter table notes alter column lead_id drop not null;

alter table notes drop constraint if exists notes_parent_check;
alter table notes add constraint notes_parent_check
  check (
    (lead_id is not null and prospect_id is null) or
    (lead_id is null and prospect_id is not null)
  );

create index if not exists notes_prospect_created_idx
  on notes (prospect_id, created_at desc) where prospect_id is not null;

-- ---------- 4. PROMOTE-FUNCTION (ATOMAR) -----------------------------------
-- Verschiebt einen Prospect inkl. aller Activities + Notes zu einem echten Lead.
-- Komplette Historie bleibt erhalten (Activities/Notes werden umgehängt, nicht kopiert).

create or replace function promote_prospect_to_lead(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_lead_id uuid;
  v_prospect prospects;
  v_note_content text;
  v_score_label text;
begin
  -- Prospect laden + Validierung
  select * into v_prospect from prospects where id = p_prospect_id and deleted_at is null;
  if not found then
    raise exception 'Prospect % nicht gefunden oder gelöscht', p_prospect_id;
  end if;
  if v_prospect.prospect_status = 'promoted' then
    raise exception 'Prospect % wurde bereits promotet (Lead: %)', p_prospect_id, v_prospect.promoted_lead_id;
  end if;

  -- Neuen Lead anlegen
  insert into leads (firma, branche, telefon, email, website_url, alte_website, status)
  values (
    v_prospect.firma,
    v_prospect.branche,
    v_prospect.telefon,
    v_prospect.email,
    v_prospect.website,
    v_prospect.website,
    'in_arbeit'
  )
  returning id into v_lead_id;

  -- Activities umhängen
  update activities
     set lead_id = v_lead_id, prospect_id = null
   where prospect_id = p_prospect_id;

  -- Notes umhängen
  update notes
     set lead_id = v_lead_id, prospect_id = null
   where prospect_id = p_prospect_id;

  -- Übernahme-Notiz mit Scoring-Daten anlegen
  v_score_label := coalesce(
    'LLM-Score: ' || v_prospect.llm_score,
    'Regel-Score: ' || v_prospect.rule_score,
    'ohne Score'
  );
  v_note_content := '📥 Aus Cold-Engine übernommen — ' || v_score_label ||
    coalesce(E'\n\n' || v_prospect.sales_pitch_hook, '') ||
    coalesce(E'\n\n' || v_prospect.scoring_summary, '') ||
    case
      when v_prospect.pain_points is not null and array_length(v_prospect.pain_points, 1) > 0
        then E'\n\nPain Points:\n• ' || array_to_string(v_prospect.pain_points, E'\n• ')
      else ''
    end;
  insert into notes (lead_id, content) values (v_lead_id, v_note_content);

  -- Prospect als promoted markieren
  update prospects
     set prospect_status = 'promoted',
         promoted_lead_id = v_lead_id
   where id = p_prospect_id;

  return v_lead_id;
end;
$$;

grant execute on function promote_prospect_to_lead(uuid) to authenticated;

-- ---------- 5. REALTIME (idempotent) ---------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'prospects'
  ) then
    alter publication supabase_realtime add table prospects;
  end if;
end $$;

-- ---------- 6. STORAGE-BUCKET FÜR SCREENSHOTS ------------------------------

insert into storage.buckets (id, name, public)
  values ('prospect-screenshots', 'prospect-screenshots', true)
  on conflict (id) do nothing;

drop policy if exists "auth_screenshots_all" on storage.objects;
create policy "auth_screenshots_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'prospect-screenshots')
  with check (bucket_id = 'prospect-screenshots');

-- Public-Read für Screenshots (damit <img src> ohne Auth lädt)
drop policy if exists "public_read_screenshots" on storage.objects;
create policy "public_read_screenshots" on storage.objects
  for select to anon
  using (bucket_id = 'prospect-screenshots');
