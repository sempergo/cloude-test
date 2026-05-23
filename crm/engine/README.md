# SEMP CRM — Lead-Engine

Cold-Lead-Pipeline für SEMP Studios. Scraped Restaurants über Google Places, analysiert Websites visuell (Screenshots + Lighthouse + Tech-Stack), bewertet sie mit Claude Vision, und füttert das bestehende CRM mit qualifizierten Prospects.

## Architektur

```
Google Places API ──┐
                    ├──> prospects (Supabase) ──> CRM Engine-Tab
Playwright + PSI ───┤
                    │
Claude Vision ──────┘
```

Drei Scripts, in dieser Reihenfolge:

1. **`scrape_google_places.mjs`** — Pull Restaurants nach Stadt (Grid-Suche)
2. **`enrich_prospects.mjs`** — Screenshots + Lighthouse + Tech-Detection + Impressum
3. **`score_prospects.mjs`** — Regelbasiertes Scoring + Vision-LLM-Audit für Top 20%

## Setup

```bash
npm install
npx playwright install chromium  # einmalig, ~300MB
cp .env.example .env             # API-Keys eintragen
```

## Migration

Vor dem ersten Run muss `../migration_v5_prospects.sql` einmalig im Supabase SQL Editor ausgeführt werden.

## Nutzung

```bash
# 1. Eine Stadt scrapen (Grid-Suche, ~150-200 Restaurants)
node scrape_google_places.mjs --stadt "Frankfurt" --radius 3000

# 2. Alle neuen Prospects enrichen (Screenshots etc.)
node enrich_prospects.mjs

# Oder: nur einen einzelnen Prospect re-enrichen
node enrich_prospects.mjs --id <prospect-uuid>

# 3. Scoring (Regeln für alle, LLM-Vision für Top 20%)
node score_prospects.mjs
```

## Kostenrahmen pro Run (200 Prospects)

| Service | Cost |
|---|---|
| Google Places (Search + Details) | ~$3-5 |
| PageSpeed Insights API | gratis |
| Playwright (lokal) | gratis |
| Claude Vision (Top 50 Leads, gecached) | ~$0.50-1.00 |
| **Total** | **~$4-6** |

Google bietet $200 Gratis-Credit/Monat → ein Run kostet effektiv nur Claude (~$1).

## Cost-Cap

`MAX_LLM_BUDGET_USD` in `.env` halt die Pipeline wenn überschritten.
