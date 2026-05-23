#!/usr/bin/env node
// Engine-Watcher: lauscht auf neue Jobs in der engine_jobs-Tabelle
// und führt sie aus. Lokaler Daemon, gesteuert per CRM-Buttons.
//
// Usage:
//   node watch.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import { log, elapsed, sleep } from './lib/log.mjs';
import { sb } from './lib/supabase.mjs';
import { startRun, reportProgress, endRun, setTotal } from './lib/progress.mjs';
import {
  searchRestaurants, getPlaceDetails, isPremiumCandidate, extractCity,
} from './lib/google_places.mjs';
import {
  plainFetch, isChallengeResponse, detectTechStack, detectPdfMenu,
  detectBookingWidget, hasViewportMeta, extractCopyrightYear,
  extractSocial, findImpressumLink, extractEmails, pickPrimaryEmail,
} from './lib/website_analyzer.mjs';
import { captureSite, closeBrowser } from './lib/playwright_browser.mjs';
import { auditWebsite } from './lib/claude.mjs';
import { uploadScreenshot, updateProspect, getProspect } from './lib/supabase.mjs';

const POLL_INTERVAL_MS = 3000;
let _running = false;

// ============================================================================
// JOB-HANDLER
// ============================================================================

async function handleScrapeJob(job) {
  const { stadt, radius = 3000 } = job.payload || {};
  if (!stadt) throw new Error('payload.stadt fehlt');
  await startRun('scrape', 0, `Suche Restaurants in ${stadt}…`);

  const places = await searchRestaurants(stadt, { radius });
  const candidates = places.filter(isPremiumCandidate);
  await setTotal(candidates.length);
  log.ok(`Grid-Suche fertig: ${candidates.length} Premium-Restaurants`);

  let inserted = 0, skippedWarm = 0, skippedExisting = 0, failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const place = candidates[i];
    await reportProgress({ processed: i, current_label: place.name, message: `Scraping ${i+1}/${candidates.length}` });
    try {
      // Check ob disqualifiziert
      const { data: existing } = await sb
        .from('prospects')
        .select('id, prospect_status')
        .eq('google_place_id', place.place_id)
        .maybeSingle();
      if (existing?.prospect_status === 'disqualifiziert') continue;

      const details = await getPlaceDetails(place.place_id);

      // Lead-Cross-Check
      const firmaNorm = (details.name || place.name).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      if (firmaNorm) {
        const { data: leadMatch } = await sb
          .from('leads')
          .select('id, firma')
          .ilike('firma', `%${firmaNorm.split(' ')[0]}%`)
          .is('deleted_at', null);
        const isAlreadyLead = (leadMatch || []).some(l => l.firma.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim() === firmaNorm);
        if (isAlreadyLead) { skippedWarm++; continue; }
      }

      const reviewSnippets = (details.reviews || []).slice(0, 2).map(r => ({
        rating: r.rating, text: (r.text || '').slice(0, 240), author: r.author_name,
      }));
      const row = {
        firma: details.name || place.name,
        branche: 'restaurant',
        stadt: extractCity(details) || stadt,
        adresse: details.formatted_address || null,
        telefon: details.formatted_phone_number || null,
        website: details.website || null,
        google_place_id: place.place_id,
        enrichment: {
          google_rating: details.rating ?? null,
          google_review_count: details.user_ratings_total ?? null,
          google_price_level: details.price_level ?? null,
          google_types: details.types || [],
          google_url: details.url || null,
          review_snippets: reviewSnippets,
          location: details.geometry?.location || null,
          opening_hours: details.opening_hours?.weekday_text || null,
          no_website: !details.website,
        },
        prospect_status: 'new',
      };
      const { error } = await sb.from('prospects').upsert(row, { onConflict: 'google_place_id' });
      if (error) throw error;
      if (existing) skippedExisting++; else inserted++;
      await sleep(200);
    } catch (err) {
      failed++;
      log.error(`scrape ${place.name}: ${err.message}`);
    }
  }
  return { inserted, skippedExisting, skippedWarm, failed, total: candidates.length };
}

async function enrichOneProspect(prospect) {
  const enrichment = { ...(prospect.enrichment || {}) };
  enrichment.errors = enrichment.errors || [];

  // Status nicht downgrade — wenn schon 'scored'/'kontaktiert'/etc., bleibt das
  const finalStatus = prospect.prospect_status === 'new' ? 'enriched' : prospect.prospect_status;

  if (!prospect.website) {
    enrichment.no_website = true;
    await updateProspect(prospect.id, {
      enrichment, prospect_status: finalStatus,
      enriched_at: new Date().toISOString(),
    });
    return;
  }
  const url = prospect.website;

  // HTML + Screenshots
  let html = null, headers = {}, finalUrl = url;
  try {
    const plain = await plainFetch(url);
    if (plain.ok && !isChallengeResponse(plain)) {
      html = plain.html; headers = plain.headers; finalUrl = plain.finalUrl;
    }
  } catch (e) { enrichment.errors.push({ step: 'plainFetch', error: e.message }); }

  let desktopUrl = null, mobileUrl = null;
  try {
    const [desktop, mobile] = await Promise.all([
      captureSite(url, { mobile: false }),
      captureSite(url, { mobile: true }),
    ]);
    if (desktop.ok) {
      desktopUrl = await uploadScreenshot(prospect.id, 'desktop', desktop.screenshot);
      if (!html && desktop.html) html = desktop.html;
    } else enrichment.errors.push({ step: 'screenshot.desktop', error: desktop.error });
    if (mobile.ok) mobileUrl = await uploadScreenshot(prospect.id, 'mobile', mobile.screenshot);
    else enrichment.errors.push({ step: 'screenshot.mobile', error: mobile.error });
  } catch (e) { enrichment.errors.push({ step: 'screenshots', error: e.message }); }

  if (html) {
    try {
      const tech = detectTechStack({ html, headers });
      enrichment.tech_stack = tech.stack;
      enrichment.tech_veraltet = tech.veraltet;
      enrichment.has_pdf_menu = detectPdfMenu(html);
      const booking = detectBookingWidget(html);
      enrichment.has_booking_widget = booking.found;
      enrichment.booking_providers = booking.providers;
      enrichment.has_viewport_meta = hasViewportMeta(html);
      enrichment.copyright_year = extractCopyrightYear(html);
      const social = extractSocial(html);
      enrichment.instagram_handle = social.instagram;
      enrichment.facebook_handle = social.facebook;

      // Email via Impressum
      let email = null;
      const impressumUrl = findImpressumLink(html, finalUrl);
      if (impressumUrl) {
        const r = await plainFetch(impressumUrl);
        if (r.ok && !isChallengeResponse(r)) email = pickPrimaryEmail(extractEmails(r.html));
      }
      if (!email) email = pickPrimaryEmail(extractEmails(html));
      if (email && !prospect.email) await updateProspect(prospect.id, { email });
      enrichment.impressum_found = !!email;
    } catch (e) { enrichment.errors.push({ step: 'htmlAnalysis', error: e.message }); }
  }

  await updateProspect(prospect.id, {
    enrichment, screenshot_desktop: desktopUrl, screenshot_mobile: mobileUrl,
    prospect_status: finalStatus, enriched_at: new Date().toISOString(),
  });
}

async function handleEnrichJob(job) {
  // payload.force = true → enrichet ALLE (außer promoted/disqualifiziert)
  // sonst nur Prospects mit Status 'new'
  const force = !!job.payload?.force;
  let q = sb.from('prospects').select('*').is('deleted_at', null);
  if (force) {
    q = q.not('prospect_status', 'in', '(promoted,disqualifiziert)');
  } else {
    q = q.eq('prospect_status', 'new');
  }
  const { data: prospects } = await q;
  const list = prospects || [];
  const label = force ? `Re-Enriche ${list.length} Prospects (force)…` : `Enriche ${list.length} neue Prospects…`;
  await startRun('enrich', list.length, label);

  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    await reportProgress({ processed: i, current_label: p.firma, message: `${i+1}/${list.length}` });
    try { await enrichOneProspect(p); ok++; }
    catch (e) { fail++; log.error(`enrich ${p.firma}: ${e.message}`); }
  }
  await reportProgress({ processed: list.length });
  return { total: list.length, ok, failed: fail, force };
}

function ruleScore(prospect) {
  const e = prospect.enrichment || {};
  let score = 0;
  if (e.no_website) score += 30;
  else {
    if (e.tech_veraltet) score += 20;
    if (e.lighthouse?.performance != null && e.lighthouse.performance < 50) score += 20;
    if (e.has_pdf_menu) score += 15;
    if (!e.has_booking_widget && (e.google_review_count || 0) >= 50) score += 15;
    if (e.copyright_year != null && e.copyright_year <= 2022) score += 10;
    if (e.has_viewport_meta === false) score += 10;
  }
  if ((e.google_rating ?? 0) > 4.3 && (e.google_review_count ?? 0) > 100) score += 10;
  return Math.min(score, 100);
}

async function fetchAsBase64(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    let buf = Buffer.from(await r.arrayBuffer());
    // Claude Vision API erlaubt max 8000px je Dimension → resize wenn nötig
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buf).metadata();
      const MAX = 7500;
      if ((meta.height || 0) > MAX || (meta.width || 0) > MAX) {
        log.info(`  resize screenshot ${meta.width}×${meta.height} → max ${MAX}px`);
        buf = await sharp(buf)
          .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toBuffer();
      }
    } catch (e) {
      log.warn('sharp resize failed (sending original)', { error: e.message });
    }
    return buf.toString('base64');
  } catch { return null; }
}

async function handleAuditJob(job) {
  if (!job.prospect_id) throw new Error('prospect_id fehlt');
  const p = await getProspect(job.prospect_id);
  if (!p) throw new Error('Prospect nicht gefunden');

  await startRun('audit', 3, `AI-Audit: ${p.firma}`);

  // Phase A: Rule-Score (immer aktualisieren)
  await reportProgress({ processed: 0, current_label: p.firma, message: 'Phase A: Regeln' });
  const rs = ruleScore(p);
  await updateProspect(p.id, {
    rule_score: rs,
    scored_at: new Date().toISOString(),
    prospect_status: p.prospect_status === 'enriched' ? 'scored' : p.prospect_status,
  });

  if (p.enrichment?.no_website) {
    await reportProgress({ processed: 3, message: 'Keine Website — kein LLM-Audit möglich' });
    return { rule_score: rs, llm_score: null };
  }

  // Phase A.5: Frische Screenshots (mit Cookie-Banner-Fix) — überschreibt alte
  await reportProgress({ processed: 1, current_label: p.firma, message: 'Frische Screenshots (Cookies ausblenden)…' });
  try {
    const [desktop, mobile] = await Promise.all([
      captureSite(p.website, { mobile: false }),
      captureSite(p.website, { mobile: true }),
    ]);
    if (desktop.ok && desktop.screenshot) {
      p.screenshot_desktop = await uploadScreenshot(p.id, 'desktop', desktop.screenshot);
    }
    if (mobile.ok && mobile.screenshot) {
      p.screenshot_mobile = await uploadScreenshot(p.id, 'mobile', mobile.screenshot);
    }
    await updateProspect(p.id, {
      screenshot_desktop: p.screenshot_desktop,
      screenshot_mobile: p.screenshot_mobile,
      enriched_at: new Date().toISOString(),
    });
  } catch (e) {
    log.warn(`screenshot refresh failed (audit nutzt alte): ${e.message}`);
  }

  // Phase B: Vision-LLM
  await reportProgress({ processed: 2, current_label: p.firma, message: 'Phase B: Vision-LLM (Claude)' });
  const [desktopB64, mobileB64] = await Promise.all([
    fetchAsBase64(p.screenshot_desktop),
    fetchAsBase64(p.screenshot_mobile),
  ]);
  if (!desktopB64 && !mobileB64) {
    throw new Error('Keine Screenshots — bitte erst enrichen');
  }
  const result = await auditWebsite({
    prospect: { ...p, rule_score: rs },
    desktopBase64: desktopB64,
    mobileBase64: mobileB64,
  });
  if (result.error) throw new Error(result.error);

  await updateProspect(p.id, {
    llm_score: result.llm_score,
    pain_points: result.pain_points,
    scoring_summary: result.scoring_summary,
    sales_pitch_hook: result.sales_pitch_hook,
    scored_at: new Date().toISOString(),
  });
  await reportProgress({ processed: 3, message: `Audit fertig — Score ${result.llm_score}` });
  return { rule_score: rs, llm_score: result.llm_score, cost_usd: result._meta?.cost_usd };
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function processJob(job) {
  log.step(`▶ Job ${job.id.slice(0,8)} | kind=${job.kind}`);
  await sb.from('engine_jobs').update({
    status: 'running', started_at: new Date().toISOString(),
  }).eq('id', job.id);

  const startedAt = Date.now();
  try {
    let result;
    if (job.kind === 'scrape') result = await handleScrapeJob(job);
    else if (job.kind === 'enrich') result = await handleEnrichJob(job);
    else if (job.kind === 'audit') result = await handleAuditJob(job);
    else throw new Error(`Unbekannter kind: ${job.kind}`);

    await sb.from('engine_jobs').update({
      status: 'done',
      result,
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await endRun({ ok: true, message: `${job.kind} fertig` });
    log.ok(`✓ Job ${job.id.slice(0,8)} fertig in ${elapsed(startedAt)}`);
  } catch (err) {
    log.error(`✗ Job ${job.id.slice(0,8)} failed`, { error: err.message });
    await sb.from('engine_jobs').update({
      status: 'failed',
      error: err.message,
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);
    await endRun({ ok: false, message: `${job.kind} failed: ${err.message}` });
  }
}

async function pickNextJob() {
  const { data, error } = await sb
    .from('engine_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    log.error('pickNextJob error', { error: error.message });
    return null;
  }
  return data;
}

async function mainLoop() {
  log.step('🔄 Engine-Watcher läuft. Polling alle ' + (POLL_INTERVAL_MS/1000) + 's...');
  log.info('   Triggert Jobs aus dem CRM. Stoppen mit Ctrl+C.');
  while (true) {
    if (!_running) {
      const job = await pickNextJob();
      if (job) {
        _running = true;
        try { await processJob(job); } finally { _running = false; }
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

process.on('SIGINT', async () => {
  log.warn('SIGINT — closing browser + exit');
  try { await closeBrowser(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', async () => {
  log.warn('SIGTERM — closing browser + exit');
  try { await closeBrowser(); } catch {}
  process.exit(0);
});

mainLoop().catch(err => {
  log.error('Watcher crashed', { error: err.message });
  process.exit(1);
});
