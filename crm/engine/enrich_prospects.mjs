#!/usr/bin/env node
// Enrichment-Pipeline: Website-Analyse, Screenshots, Lighthouse, Impressum-Email.
//
// Usage:
//   node enrich_prospects.mjs               # alle Prospects mit Status 'new'
//   node enrich_prospects.mjs --id <uuid>   # nur einen einzelnen Prospect
//   node enrich_prospects.mjs --force       # auch bereits enriched re-laufen
//
// Flow pro Prospect:
//   1. Wenn keine Website: skip enrichment, status='enriched', enrichment.no_website=true
//   2. Plain HTML-Fetch
//   3. Wenn Cloudflare-Challenge: Playwright-Rendering als Fallback
//   4. HTML-Analyse: Tech-Stack, PDF-Menu, Buchungs-Widget, Viewport, Copyright, Social
//   5. Impressum-Link finden → Email extrahieren
//   6. Screenshots (Desktop + Mobile) via Playwright
//   7. Lighthouse via PSI API (parallel zu Screenshots, mit p-limit(1))
//   8. Status auf 'enriched', alle Daten in DB

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import pLimit from 'p-limit';
import { log, elapsed, sleep } from './lib/log.mjs';
import { sb, updateProspect, uploadScreenshot, getProspect } from './lib/supabase.mjs';
import {
  plainFetch, isChallengeResponse, detectTechStack, detectPdfMenu,
  detectBookingWidget, hasViewportMeta, extractCopyrightYear,
  extractSocial, findImpressumLink, extractEmails, pickPrimaryEmail,
} from './lib/website_analyzer.mjs';
import { captureSite, closeBrowser } from './lib/playwright_browser.mjs';
import { lighthouseMobile } from './lib/lighthouse.mjs';
import { startRun, reportProgress, endRun } from './lib/progress.mjs';

const CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY || '3', 10);
const LIGHTHOUSE_LIMIT = pLimit(parseInt(process.env.LIGHTHOUSE_CONCURRENCY || '1', 10));

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { id: null, force: false, limit: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id') out.id = args[++i];
    else if (args[i] === '--force') out.force = true;
    else if (args[i] === '--limit') out.limit = parseInt(args[++i], 10);
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node enrich_prospects.mjs [--id <uuid>] [--force] [--limit N]');
      process.exit(0);
    }
  }
  return out;
}

async function loadCandidates({ id, force, limit }) {
  if (id) {
    const p = await getProspect(id);
    return p ? [p] : [];
  }
  const statuses = force ? ['new', 'enriched', 'scored'] : ['new'];
  let query = sb
    .from('prospects')
    .select('*')
    .in('prospect_status', statuses)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (limit && limit > 0) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Holt sauberes HTML. Falls plain fetch challenged ist, nutzt Playwright als Fallback.
 */
async function fetchHtml(url) {
  const plain = await plainFetch(url);
  if (plain.ok && !isChallengeResponse(plain)) {
    return { html: plain.html, headers: plain.headers, finalUrl: plain.finalUrl, source: 'plain' };
  }
  // Fallback: Playwright (das wird sowieso für Screenshot gebraucht, aber wir nehmen das HTML hier vorab)
  log.debug(`plain fetch challenged/failed for ${url}, will use playwright html`);
  return null;
}

async function tryFetchImpressumEmail(impressumUrl) {
  const r = await plainFetch(impressumUrl);
  if (!r.ok || isChallengeResponse(r)) return null;
  const emails = extractEmails(r.html);
  return pickPrimaryEmail(emails);
}

async function enrichOne(prospect) {
  const startedAt = Date.now();
  const enrichment = { ...(prospect.enrichment || {}) };
  enrichment.errors = enrichment.errors || [];

  // Branch: No Website
  if (!prospect.website) {
    enrichment.no_website = true;
    enrichment.enriched_at = new Date().toISOString();
    await updateProspect(prospect.id, {
      enrichment,
      prospect_status: 'enriched',
      enriched_at: new Date().toISOString(),
    });
    log.warn(`[${prospect.firma}] keine Website — skipped`);
    return { ok: true, skipped: true };
  }

  const url = prospect.website;
  log.step(`[${prospect.firma}] enriching ${url}`);

  // 1. HTML fetchen
  let html = null;
  let headers = {};
  let finalUrl = url;
  try {
    const plain = await fetchHtml(url);
    if (plain) {
      html = plain.html;
      headers = plain.headers;
      finalUrl = plain.finalUrl;
    }
  } catch (e) {
    enrichment.errors.push({ step: 'plainFetch', error: e.message });
  }

  // 2. Screenshots (gleichzeitig: Desktop, Mobile)
  let desktopUrl = null;
  let mobileUrl = null;
  let renderedHtml = null;
  try {
    const [desktop, mobile] = await Promise.all([
      captureSite(url, { mobile: false }),
      captureSite(url, { mobile: true }),
    ]);
    if (desktop.ok) {
      desktopUrl = await uploadScreenshot(prospect.id, 'desktop', desktop.screenshot);
      // Falls plain fetch fehlschlug, nutze HTML vom Desktop-Render
      if (!html && desktop.html) renderedHtml = desktop.html;
    } else {
      enrichment.errors.push({ step: 'screenshot.desktop', error: desktop.error });
    }
    if (mobile.ok) {
      mobileUrl = await uploadScreenshot(prospect.id, 'mobile', mobile.screenshot);
      if (!html && !renderedHtml && mobile.html) renderedHtml = mobile.html;
    } else {
      enrichment.errors.push({ step: 'screenshot.mobile', error: mobile.error });
    }
  } catch (e) {
    enrichment.errors.push({ step: 'screenshots', error: e.message });
  }

  if (!html && renderedHtml) {
    html = renderedHtml;
    enrichment.fetch_source = 'playwright';
  } else if (html) {
    enrichment.fetch_source = 'plain';
  }

  // 3. HTML-Analyse
  if (html) {
    try {
      const tech = detectTechStack({ html, headers });
      enrichment.tech_stack = tech.stack;
      enrichment.tech_veraltet = tech.veraltet;
      enrichment.meta_generator = tech.metaGenerator || null;
      enrichment.has_pdf_menu = detectPdfMenu(html);
      const booking = detectBookingWidget(html);
      enrichment.has_booking_widget = booking.found;
      enrichment.booking_providers = booking.providers;
      enrichment.has_viewport_meta = hasViewportMeta(html);
      enrichment.copyright_year = extractCopyrightYear(html);
      const social = extractSocial(html);
      enrichment.instagram_handle = social.instagram;
      enrichment.facebook_handle = social.facebook;
      enrichment.tiktok_handle = social.tiktok;
    } catch (e) {
      enrichment.errors.push({ step: 'htmlAnalysis', error: e.message });
    }

    // Impressum/Email
    try {
      let email = null;
      const impressumUrl = findImpressumLink(html, finalUrl);
      if (impressumUrl) {
        enrichment.impressum_url = impressumUrl;
        email = await tryFetchImpressumEmail(impressumUrl);
      }
      if (!email) {
        // Fallback: Emails aus Startseite
        const homeEmails = extractEmails(html);
        email = pickPrimaryEmail(homeEmails);
      }
      if (email && !prospect.email) {
        await updateProspect(prospect.id, { email });
        log.info(`[${prospect.firma}]   → email gefunden: ${email}`);
      }
      enrichment.impressum_found = !!email;
    } catch (e) {
      enrichment.errors.push({ step: 'impressum', error: e.message });
    }
  } else {
    enrichment.errors.push({ step: 'html', error: 'no html available' });
  }

  // 4. Lighthouse (kann via SKIP_LIGHTHOUSE=1 ausgeschaltet werden)
  if (process.env.SKIP_LIGHTHOUSE !== '1') {
    try {
      const lh = await LIGHTHOUSE_LIMIT(() => lighthouseMobile(url));
      enrichment.lighthouse = lh;
    } catch (e) {
      enrichment.errors.push({ step: 'lighthouse', error: e.message });
    }
  }

  enrichment.enriched_in_ms = Date.now() - startedAt;

  await updateProspect(prospect.id, {
    enrichment,
    screenshot_desktop: desktopUrl,
    screenshot_mobile: mobileUrl,
    prospect_status: 'enriched',
    enriched_at: new Date().toISOString(),
  });

  log.ok(`[${prospect.firma}] enriched in ${elapsed(startedAt)}  tech=${(enrichment.tech_stack || []).join(',') || '-'}  lh=${enrichment.lighthouse?.performance ?? '?'}`);
  return { ok: true };
}

async function main() {
  const opts = parseArgs();
  const startedAt = Date.now();

  const candidates = await loadCandidates(opts);
  if (candidates.length === 0) {
    log.info('Keine Prospects zum Enrichment.');
    await closeBrowser();
    return;
  }
  log.step(`Enriching ${candidates.length} Prospects (concurrency=${CONCURRENCY})`);
  await startRun('enrich', candidates.length, `Enrich ${candidates.length} Prospects…`);

  const limit = pLimit(CONCURRENCY);
  let ok = 0, fail = 0;
  let processed = 0;

  await Promise.all(candidates.map(p => limit(async () => {
    try {
      await reportProgress({ current_label: p.firma, message: `Enriching: ${p.firma}` });
      await enrichOne(p);
      ok++;
    } catch (err) {
      fail++;
      log.error(`[${p.firma}] enrichment crashed`, { error: err.message });
      try {
        await updateProspect(p.id, {
          enrichment: { ...(p.enrichment || {}), errors: [...(p.enrichment?.errors || []), { step: 'top-level', error: err.message }] },
        });
      } catch {}
    } finally {
      processed++;
      await reportProgress({ processed, message: `${processed}/${candidates.length} fertig` });
    }
  })));

  log.ok(`Fertig in ${elapsed(startedAt)}: ${ok} ok, ${fail} failed`);
  await endRun({ ok: fail === 0, message: `Enrich fertig: ${ok} ok, ${fail} failed` });
  await closeBrowser();
}

main().catch(async (err) => {
  log.error('Enrichment crashed', { error: err.message, stack: err.stack });
  try { await endRun({ ok: false, message: 'Enrichment crashed: ' + err.message }); } catch {}
  closeBrowser().finally(() => process.exit(1));
});
