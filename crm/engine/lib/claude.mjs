// Anthropic Claude Vision für Website-Audit.
// Nutzt Tool-Use für garantiert valides JSON-Output und Prompt-Caching für Cost-Reduction.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import Anthropic from '@anthropic-ai/sdk';
import { log, withRetry } from './log.mjs';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5';
// Sonnet 4.5 pricing (Stand 2025-11):
const PRICE_INPUT_PER_MTOK         = 3.00;
const PRICE_OUTPUT_PER_MTOK        = 15.00;
const PRICE_CACHE_WRITE_PER_MTOK   = 3.75;
const PRICE_CACHE_READ_PER_MTOK    = 0.30;

let _spentUsd = 0;
export function getSpent() { return _spentUsd; }

const BUDGET_USD = parseFloat(process.env.MAX_LLM_BUDGET_USD || '10');

// Tool-Use-Schema: erzwingt valides JSON
const SCORE_TOOL = {
  name: 'score_website',
  description: 'Speichert das strukturierte Website-Audit-Ergebnis für diesen Restaurant-Lead.',
  input_schema: {
    type: 'object',
    required: ['llm_score', 'pain_points', 'scoring_summary', 'sales_pitch_hook'],
    properties: {
      llm_score: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: '0-100. Wie viel Bedarf hat dieser Restaurant-Betrieb an einer neuen Website? 0 = Site ist bereits exzellent, 100 = massive Schwachstellen.',
      },
      pain_points: {
        type: 'array',
        items: { type: 'string', maxLength: 220 },
        minItems: 3,
        maxItems: 5,
        description: 'Konkrete, messbare Schwachstellen. Keine Floskeln. Jeder Punkt sollte einen spezifischen Defekt beschreiben, idealerweise mit Konsequenz (verlorene Conversions, schlechte Mobile-UX, etc.).',
      },
      scoring_summary: {
        type: 'string',
        maxLength: 240,
        description: '1-2 Sätze auf Deutsch: warum dieser Lead spannend ist (Bedarf + Zahlungskraft-Signal).',
      },
      sales_pitch_hook: {
        type: 'string',
        maxLength: 200,
        description: 'Opening-Line für die Sales-Mail oder den Anruf. Konkret, ein einziger schmerzhafter Insight. Direkt einsetzbar.',
      },
    },
  },
};

// System-Prompt mit Kalibrierungs-Beispielen (gecached, ≥1024 Token)
const SYSTEM_PROMPT = `Du bist ein Senior UX Designer und Conversion-Experte für die Gastronomie-Branche, mit 10 Jahren Erfahrung bei internationalen Top-Agenturen (Instrument, Fantasy, Ueno). Du hast Hunderte Restaurant-Websites für Premium-Kunden gebaut. Du erkennst sofort, wo eine Website Geld liegen lässt.

Deine Aufgabe: Bewerte die vorgelegte Restaurant-Website. Identifiziere die echten Pain-Points — nicht oberflächliche Ästhetik-Kommentare, sondern messbare Conversion- und UX-Defekte. Du sprichst die Sprache eines erfahrenen Branchen-Beraters: präzise, opinionated, kein Marketing-Sprech.

WICHTIGE BEWERTUNGS-PRINZIPIEN:

1. Der "llm_score" misst BEDARF, nicht Qualität. Hoher Score = großer Bedarf an Verbesserung. Eine wunderschöne Site bekommt LOW score, eine kaputte Site HIGH score.

2. Skala-Kalibrierung:
   - 0-25 = exzellente Site, kaum etwas zu verbessern (selten — die meisten Restaurant-Sites haben Verbesserungspotenzial)
   - 26-50 = solide Site, einige punktuelle Schwächen
   - 51-75 = deutliche Schwächen, Conversion wird systematisch verloren
   - 76-100 = massiver Bedarf, die Site versemmelt fundamentale Dinge

3. Pain-Points müssen KONKRET und MESSBAR sein. Nicht "Website wirkt veraltet" — sondern "Speisekarte ist als 8MB-PDF eingebunden, das auf Mobile unleserlich ist und 12s lädt". Jeder Pain-Point soll idealerweise die Konsequenz benennen.

4. Sales-Pitch-Hook ist die EINE Aussage, die einen Restaurant-Inhaber dazu bringt, deine Mail nicht zu löschen. Konkret, schmerzhaft, lösbar. Beispiel: "Eure Speisekarte als PDF kostet euch jeden Abend Reservierungen — fixen wir in 4 Wochen."

5. Berücksichtige Zahlungskraft-Signale: Restaurants mit 4.5★+ und 100+ Reviews sind oft Premium und können sich eine neue Site leisten. Dies erhöht implizit den Score (großer Bedarf bei zahlungskräftiger Klientel = top Lead).

KALIBRIERUNGS-BEISPIELE:

Beispiel A (Score 25): Modernes Boutique-Bistro in Berlin. Site auf Webflow gebaut, Hero zeigt eigene Food-Fotografie, Online-Reservierung via Resy, mobile Speisekarte als HTML, Schema.org-Markup vorhanden, Mobile Lighthouse Performance 88. → Score 25, weil noch kleine Quick Wins möglich (z.B. keine Insta-Integration), aber fundamentale Conversion-Pfade funktionieren.

Beispiel B (Score 88): Italienischer Familienbetrieb in Frankfurt, 287 Reviews mit 4.7★. WordPress mit Elementor, Speisekarte als 6MB-PDF, Reservierung nur via Telefonnummer, Hero ist Stockfoto, Footer Copyright 2019, Lighthouse Mobile Performance 28, Touch-Targets zu klein, kein Buchungs-Widget. → Score 88, weil exzellenter Betrieb mit kaputter Site, systematisches Reservierungs-Leakage.

OUTPUT-FORMAT:
Du gibst dein Audit ZWINGEND als Tool-Call \`score_website\` zurück. Keine Prose-Antwort, kein Markdown, nur der Tool-Call mit den vier Feldern. Alle Texte auf Deutsch.`;

/**
 * Audited eine Website. Returnt { llm_score, pain_points, scoring_summary, sales_pitch_hook }
 * oder { error }.
 *
 * @param {object} input
 *   - prospect: { firma, branche, stadt, website, enrichment }
 *   - desktopBase64: base64 JPEG (kann null sein)
 *   - mobileBase64: base64 JPEG (kann null sein)
 */
export async function auditWebsite({ prospect, desktopBase64, mobileBase64 }) {
  if (_spentUsd >= BUDGET_USD) {
    return { error: `budget exceeded ($${_spentUsd.toFixed(2)} >= $${BUDGET_USD})` };
  }

  // User-Message mit Bildern + Daten
  const content = [];

  if (desktopBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: desktopBase64 },
    });
    content.push({ type: 'text', text: '↑ Screenshot Desktop (1440×900)' });
  }
  if (mobileBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: mobileBase64 },
    });
    content.push({ type: 'text', text: '↑ Screenshot Mobile (iPhone 375×812)' });
  }

  // Enrichment-Zusammenfassung
  const e = prospect.enrichment || {};
  const reviewSnippets = (e.review_snippets || []).map(r =>
    `  - ⭐${r.rating} "${r.text}" — ${r.author}`
  ).join('\n');

  const dataBlock = `RESTAURANT-DATEN

Firma: ${prospect.firma}
Branche: ${prospect.branche || 'restaurant'}
Stadt: ${prospect.stadt || 'unbekannt'}
Website: ${prospect.website || '(keine)'}
${e.no_website ? '⚠️ Keine eigene Website — Restaurant hat nur Google-Profil.' : ''}

Google:
  Rating: ${e.google_rating ?? '?'} ⭐  (${e.google_review_count ?? 0} Reviews)
  Preis-Level: ${e.google_price_level ?? '?'}
  Types: ${(e.google_types || []).join(', ')}

Tech-Stack: ${(e.tech_stack || []).join(', ') || '(unbekannt)'}
${e.tech_veraltet ? '⚠️ Veralteter Self-Bau-Stack erkannt' : ''}

Heuristiken:
  Mobile-Viewport gesetzt:  ${e.has_viewport_meta ? 'ja' : 'NEIN'}
  Speisekarte als PDF:      ${e.has_pdf_menu ? 'JA — Pain Point' : 'nein'}
  Buchungs-Widget:          ${e.has_booking_widget ? `ja (${(e.booking_providers || []).join(', ')})` : 'KEINS'}
  Copyright-Jahr:           ${e.copyright_year ?? '?'}
  Instagram-Handle:         ${e.instagram_handle ?? '-'}

Lighthouse Mobile:
  Performance:     ${e.lighthouse?.performance ?? '?'}
  Accessibility:   ${e.lighthouse?.accessibility ?? '?'}
  SEO:             ${e.lighthouse?.seo ?? '?'}
  Best Practices:  ${e.lighthouse?.best_practices ?? '?'}
  LCP:             ${e.lighthouse?.lcp_ms ? (e.lighthouse.lcp_ms / 1000).toFixed(1) + 's' : '?'}

${reviewSnippets ? `Top Reviews:\n${reviewSnippets}` : ''}

→ Audite diese Website jetzt anhand der Screenshots + Daten. Gib das Ergebnis ZWINGEND als score_website Tool-Call zurück.`;

  content.push({ type: 'text', text: dataBlock });

  try {
    const response = await withRetry(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: [SCORE_TOOL],
        tool_choice: { type: 'tool', name: 'score_website' },
        messages: [{ role: 'user', content }],
      }),
      { label: 'claude.auditWebsite', retries: 2, baseMs: 2000 }
    );

    // Cost-Tracking
    const u = response.usage || {};
    const inputTok = u.input_tokens || 0;
    const outputTok = u.output_tokens || 0;
    const cacheWriteTok = u.cache_creation_input_tokens || 0;
    const cacheReadTok = u.cache_read_input_tokens || 0;
    const cost =
      (inputTok / 1_000_000) * PRICE_INPUT_PER_MTOK +
      (outputTok / 1_000_000) * PRICE_OUTPUT_PER_MTOK +
      (cacheWriteTok / 1_000_000) * PRICE_CACHE_WRITE_PER_MTOK +
      (cacheReadTok / 1_000_000) * PRICE_CACHE_READ_PER_MTOK;
    _spentUsd += cost;

    // Tool-Use-Block finden
    const toolUse = response.content.find(c => c.type === 'tool_use' && c.name === 'score_website');
    if (!toolUse) {
      return { error: 'no tool_use in response', raw: response.content };
    }
    return {
      ...toolUse.input,
      _meta: {
        cost_usd: cost,
        tokens: { input: inputTok, output: outputTok, cacheWrite: cacheWriteTok, cacheRead: cacheReadTok },
      },
    };
  } catch (err) {
    log.error('Claude audit failed', { firma: prospect.firma, error: err.message });
    return { error: err.message };
  }
}
