#!/usr/bin/env node
// Scraper: Google Places → prospects (mit Dedup gegen Leads-Tabelle).
//
// Usage:
//   node scrape_google_places.mjs --stadt "Frankfurt" --radius 3000
//
// Flow:
//   1. Stadt geocodieren
//   2. 3×3-Grid um Stadt-Center, Nearby-Search pro Zelle (mit Pagination)
//   3. Filter: rating >= 4.0, reviews >= 20, business_status = OPERATIONAL
//   4. Pro Treffer: Place Details holen (Website, Telefon, Reviews)
//   5. Dedup: gegen prospects (google_place_id) UND gegen leads (firma fuzzy)
//   6. UPSERT in prospects

import 'dotenv/config';
import { log, elapsed, sleep } from './lib/log.mjs';
import { sb } from './lib/supabase.mjs';
import {
  searchRestaurants,
  getPlaceDetails,
  isPremiumCandidate,
  extractCity,
} from './lib/google_places.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { stadt: 'Frankfurt', radius: 3000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stadt') out.stadt = args[++i];
    else if (args[i] === '--radius') out.radius = parseInt(args[++i], 10);
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node scrape_google_places.mjs --stadt "Frankfurt" --radius 3000');
      process.exit(0);
    }
  }
  return out;
}

function normalizeFirma(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

async function isAlreadyWarmLead(firma) {
  const normalized = normalizeFirma(firma);
  if (!normalized) return null;
  // Wir nutzen ilike auf normalisierten Names — vereinfachte Fuzzy-Logik
  const { data, error } = await sb
    .from('leads')
    .select('id, firma')
    .ilike('firma', `%${normalized.split(' ')[0]}%`) // erstes Wort als Suchbegriff
    .is('deleted_at', null);
  if (error) {
    log.warn('Lead-Check failed', { error: error.message });
    return null;
  }
  // Strenger Vergleich: normalisierter Name muss übereinstimmen
  const match = (data || []).find(l => normalizeFirma(l.firma) === normalized);
  return match || null;
}

async function isDisqualifiedProspect(placeId) {
  const { data } = await sb
    .from('prospects')
    .select('id, prospect_status')
    .eq('google_place_id', placeId)
    .maybeSingle();
  return data?.prospect_status === 'disqualifiziert' ? data : null;
}

async function upsertProspect(place, details, stadt) {
  const firma = details.name || place.name;
  const city = extractCity(details) || extractCity(place) || stadt;
  // Top-2 Reviews als Snippets in enrichment speichern (für späteres LLM-Scoring)
  const reviewSnippets = (details.reviews || []).slice(0, 2).map(r => ({
    rating: r.rating,
    text: (r.text || '').slice(0, 240),
    author: r.author_name,
  }));

  const row = {
    firma,
    branche: 'restaurant',
    stadt: city,
    adresse: details.formatted_address || null,
    telefon: details.formatted_phone_number || details.international_phone_number || null,
    website: details.website || null,
    google_place_id: place.place_id,
    enrichment: {
      google_rating: details.rating ?? place.rating ?? null,
      google_review_count: details.user_ratings_total ?? place.user_ratings_total ?? null,
      google_price_level: details.price_level ?? null,
      google_types: details.types || place.types || [],
      google_url: details.url || null,
      review_snippets: reviewSnippets,
      location: details.geometry?.location || place.geometry?.location || null,
      opening_hours: details.opening_hours?.weekday_text || null,
      no_website: !details.website,
    },
    prospect_status: 'new',
  };

  const { error } = await sb
    .from('prospects')
    .upsert(row, { onConflict: 'google_place_id', ignoreDuplicates: false });
  if (error) throw error;
}

async function main() {
  const { stadt, radius } = parseArgs();
  const startedAt = Date.now();
  log.step(`Scraping startet: stadt="${stadt}" radius=${radius}m`);

  // 1. Suche
  const places = await searchRestaurants(stadt, { radius });
  log.ok(`Grid-Suche fertig: ${places.length} unique Restaurants gefunden`);

  // 2. Premium-Filter
  const candidates = places.filter(isPremiumCandidate);
  log.info(`Nach Premium-Filter (rating≥4.0, reviews≥20): ${candidates.length}`);

  // 3. Pro Treffer: Dedup + Details + Upsert
  let inserted = 0;
  let skippedDisqualified = 0;
  let skippedWarmLead = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const place = candidates[i];
    const tag = `[${i + 1}/${candidates.length}]`;
    try {
      // Skip wenn als disqualifiziert markiert
      const disq = await isDisqualifiedProspect(place.place_id);
      if (disq) {
        skippedDisqualified++;
        log.info(`${tag} ↷ disqualifiziert: ${place.name}`);
        continue;
      }

      // Details holen
      const details = await getPlaceDetails(place.place_id);

      // Skip wenn bereits warmer Lead (cross-check)
      const warm = await isAlreadyWarmLead(details.name || place.name);
      if (warm) {
        skippedWarmLead++;
        log.warn(`${tag} ↷ bereits warmer Lead: ${place.name} (Lead-ID: ${warm.id})`);
        continue;
      }

      // Check ob bereits existiert
      const { data: existing } = await sb
        .from('prospects')
        .select('id, prospect_status')
        .eq('google_place_id', place.place_id)
        .maybeSingle();
      const wasExisting = !!existing;

      await upsertProspect(place, details, stadt);
      if (wasExisting) {
        skippedExisting++;
        log.info(`${tag} ⟳ existierte schon (Status: ${existing.prospect_status}): ${place.name}`);
      } else {
        inserted++;
        log.ok(`${tag} + ${place.name}  ⭐${details.rating} (${details.user_ratings_total})`);
      }

      await sleep(200); // Rate-Limit
    } catch (err) {
      failed++;
      log.error(`${tag} ✗ ${place.name}`, { error: err.message });
    }
  }

  log.ok(`Fertig in ${elapsed(startedAt)}`);
  log.info(`  + ${inserted} neu inserted`);
  log.info(`  ⟳ ${skippedExisting} bereits existiert`);
  log.info(`  ↷ ${skippedDisqualified} disqualifiziert (skipped)`);
  log.info(`  ↷ ${skippedWarmLead} bereits warmer Lead (skipped)`);
  if (failed) log.warn(`  ✗ ${failed} fehlgeschlagen`);
}

main().catch(err => {
  log.error('Scraper crashed', { error: err.message, stack: err.stack });
  process.exit(1);
});
