// Google PageSpeed Insights API (gibt uns Lighthouse-Scores).
// Kostenlos, Rate-Limit ~1 req/sec.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import { log, withRetry } from './log.mjs';

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const PSI_KEY = process.env.PAGESPEED_KEY || process.env.GOOGLE_PLACES_KEY;

/**
 * Lädt Mobile-Lighthouse-Scores für eine URL.
 * Returnt { performance, accessibility, seo, best_practices, lcp_ms, cls } oder { error }.
 */
export async function lighthouseMobile(url, { timeoutMs = 60000 } = {}) {
  const params = new URLSearchParams({
    url,
    strategy: 'mobile',
    category: 'performance',
  });
  // 'accessibility', 'seo', 'best-practices' bräuchten extra params — wir konzentrieren uns auf performance fürs MVP
  params.append('category', 'accessibility');
  params.append('category', 'seo');
  params.append('category', 'best-practices');
  if (PSI_KEY) params.set('key', PSI_KEY);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const json = await withRetry(async () => {
      const r = await fetch(`${PSI_URL}?${params}`, { signal: controller.signal });
      if (!r.ok) {
        const err = new Error(`PSI HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return r.json();
    }, { label: `psi ${url}`, retries: 2, baseMs: 2000 });

    const cats = json.lighthouseResult?.categories || {};
    const audits = json.lighthouseResult?.audits || {};
    return {
      performance:     Math.round((cats.performance?.score ?? 0) * 100),
      accessibility:   Math.round((cats.accessibility?.score ?? 0) * 100),
      seo:             Math.round((cats.seo?.score ?? 0) * 100),
      best_practices:  Math.round((cats['best-practices']?.score ?? 0) * 100),
      lcp_ms:          audits['largest-contentful-paint']?.numericValue ?? null,
      cls:             audits['cumulative-layout-shift']?.numericValue ?? null,
      tbt_ms:          audits['total-blocking-time']?.numericValue ?? null,
    };
  } catch (err) {
    log.warn(`Lighthouse failed for ${url}`, { error: err.message });
    return { error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
