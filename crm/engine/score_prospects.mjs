#!/usr/bin/env node
// Scoring: Phase A (Regeln) für alle enriched + Phase B (Vision-LLM) für Top 20%.
//
// Usage:
//   node score_prospects.mjs
//   node score_prospects.mjs --id <uuid>      # nur einen bestimmten Prospect re-scoren
//   node score_prospects.mjs --skip-llm       # nur Regel-Scoring, kein LLM
//   node score_prospects.mjs --top-n 50       # max N Prospects via LLM auditieren

import 'dotenv/config';
import { log, elapsed } from './lib/log.mjs';
import { sb, updateProspect, getProspect } from './lib/supabase.mjs';
import { auditWebsite, getSpent } from './lib/claude.mjs';

const MAX_BUDGET_USD = parseFloat(process.env.MAX_LLM_BUDGET_USD || '10');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { id: null, skipLlm: false, topN: 50 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id') out.id = args[++i];
    else if (args[i] === '--skip-llm') out.skipLlm = true;
    else if (args[i] === '--top-n') out.topN = parseInt(args[++i], 10);
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node score_prospects.mjs [--id <uuid>] [--skip-llm] [--top-n 50]');
      process.exit(0);
    }
  }
  return out;
}

/**
 * Regelbasiertes Scoring: 0-100, additiv.
 */
function ruleScore(prospect) {
  const e = prospect.enrichment || {};
  let score = 0;
  const reasons = [];

  if (e.no_website) {
    score += 30;
    reasons.push('keine Website (+30)');
  } else {
    if (e.tech_veraltet) { score += 20; reasons.push('Tech veraltet (+20)'); }
    if (e.lighthouse?.performance != null && e.lighthouse.performance < 50) {
      score += 20; reasons.push(`Mobile-Perf ${e.lighthouse.performance} (+20)`);
    }
    if (e.has_pdf_menu) { score += 15; reasons.push('PDF-Menu (+15)'); }
    const reviews = e.google_review_count || 0;
    if (!e.has_booking_widget && reviews >= 50) {
      score += 15; reasons.push(`kein Buchungs-Widget bei ${reviews} Reviews (+15)`);
    }
    if (e.copyright_year != null && e.copyright_year <= 2022) {
      score += 10; reasons.push(`Copyright ${e.copyright_year} (+10)`);
    }
    if (e.has_viewport_meta === false) {
      score += 10; reasons.push('kein Viewport-Meta (+10)');
    }
  }

  // Zahlungskraft (gilt unabhängig)
  if ((e.google_rating ?? 0) > 4.3 && (e.google_review_count ?? 0) > 100) {
    score += 10; reasons.push('zahlungskräftig (+10)');
  }

  return { score: Math.min(score, 100), reasons };
}

/**
 * Lädt einen Screenshot von URL und konvertiert zu base64.
 */
async function fetchAsBase64(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString('base64');
  } catch (err) {
    log.warn(`Failed to fetch screenshot ${url}`, { error: err.message });
    return null;
  }
}

async function scorePhaseA(opts) {
  const query = sb
    .from('prospects')
    .select('*')
    .is('deleted_at', null);
  if (opts.id) {
    query.eq('id', opts.id);
  } else {
    query.in('prospect_status', ['enriched', 'scored']);
  }
  const { data, error } = await query;
  if (error) throw error;

  log.step(`Phase A (Regeln): ${data.length} Prospects`);
  for (const p of data) {
    const { score, reasons } = ruleScore(p);
    await updateProspect(p.id, {
      rule_score: score,
      scored_at: new Date().toISOString(),
      prospect_status: p.prospect_status === 'enriched' ? 'scored' : p.prospect_status,
    });
    log.info(`  ${p.firma} → ${score}  [${reasons.join(', ') || '-'}]`);
  }
  return data.length;
}

async function scorePhaseB({ id, topN }) {
  // Auswahl: scored Prospects, sortiert nach rule_score desc, limit topN
  let query = sb
    .from('prospects')
    .select('*')
    .is('deleted_at', null);
  if (id) {
    query = query.eq('id', id);
  } else {
    query = query
      .eq('prospect_status', 'scored')
      .gte('rule_score', 40)               // mindestens etwas Bedarf
      .is('llm_score', null)               // noch nicht LLM-gescored
      .order('rule_score', { ascending: false })
      .limit(topN);
  }
  const { data, error } = await query;
  if (error) throw error;
  if (data.length === 0) {
    log.info('Phase B: keine Kandidaten');
    return 0;
  }

  log.step(`Phase B (Vision-LLM): ${data.length} Top-Prospects, Budget $${MAX_BUDGET_USD}`);

  let ok = 0, fail = 0;
  for (const p of data) {
    if (getSpent() >= MAX_BUDGET_USD) {
      log.warn(`Budget erreicht ($${getSpent().toFixed(2)}), stoppe LLM-Audit`);
      break;
    }
    log.info(`  Audit: ${p.firma} (rule=${p.rule_score})`);

    // Screenshots laden
    const [desktopB64, mobileB64] = await Promise.all([
      fetchAsBase64(p.screenshot_desktop),
      fetchAsBase64(p.screenshot_mobile),
    ]);

    if (!desktopB64 && !mobileB64 && !p.enrichment?.no_website) {
      log.warn(`  ↷ ${p.firma} hat keine Screenshots — skip`);
      continue;
    }

    const result = await auditWebsite({
      prospect: p,
      desktopBase64: desktopB64,
      mobileBase64: mobileB64,
    });

    if (result.error) {
      fail++;
      log.error(`  ✗ ${p.firma}`, { error: result.error });
      continue;
    }

    await updateProspect(p.id, {
      llm_score: result.llm_score,
      pain_points: result.pain_points,
      scoring_summary: result.scoring_summary,
      sales_pitch_hook: result.sales_pitch_hook,
      scored_at: new Date().toISOString(),
    });
    ok++;
    log.ok(`  ✓ ${p.firma}  llm=${result.llm_score}  cost=$${result._meta.cost_usd.toFixed(4)}  total=$${getSpent().toFixed(2)}`);
    log.info(`      "${result.sales_pitch_hook}"`);
  }

  return ok;
}

async function main() {
  const opts = parseArgs();
  const startedAt = Date.now();

  const aCount = await scorePhaseA(opts);
  log.ok(`Phase A fertig: ${aCount} Prospects regelbasiert gescored`);

  if (opts.skipLlm) {
    log.info('LLM-Phase übersprungen (--skip-llm)');
  } else {
    const bCount = await scorePhaseB(opts);
    log.ok(`Phase B fertig: ${bCount} Prospects via Vision-LLM auditiert  total cost: $${getSpent().toFixed(2)}`);
  }

  log.ok(`Scoring komplett in ${elapsed(startedAt)}`);
}

main().catch(err => {
  log.error('Scoring crashed', { error: err.message, stack: err.stack });
  process.exit(1);
});
