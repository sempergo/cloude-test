// HTML-Analyse: Tech-Stack, PDF-Speisekarte, Buchungs-Widget, Impressum/Email, Heuristiken.
// Arbeitet auf bereits gefetchtem HTML (von Playwright oder Fetch).

import { withRetry } from './log.mjs';

const FETCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/**
 * Plain HTML-Fetch mit User-Agent. Returnt { html, headers, finalUrl, ok }.
 * Bei Cloudflare-Challenge oder zu kurzer Response signalisiert das der Caller
 * und greift auf Playwright-Rendering zurück.
 */
export async function plainFetch(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await withRetry(async () => {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': FETCH_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });
      return r;
    }, { label: `plainFetch ${url}`, retries: 2, baseMs: 1000 });
    const html = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      finalUrl: res.url,
      html,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Erkennt Cloudflare/Bot-Protection-Challenges anhand der HTML-Signatur.
 */
export function isChallengeResponse({ html = '', status = 0, headers = {} } = {}) {
  if (!html || html.length < 1500) return true; // verdächtig kurz
  if (status === 403 || status === 503) return true;
  const lower = html.toLowerCase();
  if (lower.includes('cf-challenge') ||
      lower.includes('__cf_chl_jschl_tk__') ||
      lower.includes('checking your browser') ||
      lower.includes('cloudflare ray id') ||
      headers.server?.toLowerCase()?.startsWith('cloudflare') && status >= 400) {
    return true;
  }
  return false;
}

/**
 * Multi-Signal Tech-Stack-Detection.
 * Gibt Array von erkannten Plattformen zurück (z.B. ['wordpress', 'elementor']).
 * Mindestens 2 Signale pro Plattform müssen matchen, um false positives zu vermeiden.
 */
export function detectTechStack({ html, headers = {} }) {
  const stack = [];
  const lower = html.toLowerCase();
  const metaGenMatch = lower.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i);
  const metaGen = metaGenMatch?.[1] || '';

  const checks = [
    {
      name: 'wordpress',
      signals: [
        lower.includes('/wp-content/'),
        lower.includes('/wp-includes/'),
        /wordpress/i.test(metaGen),
        headers['x-powered-by']?.toLowerCase()?.includes('wp'),
      ],
    },
    {
      name: 'elementor',
      signals: [
        lower.includes('elementor-element'),
        lower.includes('/elementor/'),
        /elementor/i.test(metaGen),
      ],
    },
    {
      name: 'wix',
      signals: [
        Object.entries(headers).some(([k]) => k.toLowerCase().startsWith('x-wix')),
        lower.includes('static.wixstatic.com'),
        lower.includes('wix-warmup-data'),
      ],
    },
    {
      name: 'squarespace',
      signals: [
        lower.includes('static.squarespace.com'),
        lower.includes('squarespace-cdn'),
        /squarespace/i.test(metaGen),
      ],
    },
    {
      name: 'jimdo',
      signals: [
        lower.includes('jimdo-cloud.com'),
        lower.includes('cdn.jimdo'),
        /jimdo/i.test(metaGen),
      ],
    },
    {
      name: 'webflow',
      signals: [
        lower.includes('uploads-ssl.webflow.com'),
        lower.includes('cdn.prod.website-files.com'),
        /webflow/i.test(metaGen),
        headers['x-wf-domain'] !== undefined,
      ],
    },
    {
      name: 'shopify',
      signals: [
        lower.includes('cdn.shopify.com'),
        lower.includes('shopify-section'),
        /shopify/i.test(metaGen),
      ],
    },
    {
      name: 'next',
      signals: [
        lower.includes('/_next/'),
        lower.includes('__next_data__'),
      ],
    },
  ];

  for (const { name, signals } of checks) {
    const hits = signals.filter(Boolean).length;
    if (hits >= 2 || (name === 'next' && hits >= 1)) {
      stack.push(name);
    }
  }

  // "veraltet" = WordPress, Wix, Jimdo (typische Selfbau-Plattformen)
  const veraltet = stack.some(s => ['wordpress', 'wix', 'jimdo'].includes(s));
  return { stack, veraltet, metaGenerator: metaGen };
}

/**
 * Findet alle <a> Links im HTML mit text + href.
 */
function extractLinks(html) {
  const links = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const innerHtml = m[2];
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    links.push({ href: hrefMatch[1], text });
  }
  return links;
}

/**
 * Sucht eine PDF-Speisekarte: Link mit Text "Speisekarte|Menu|Karte" und href endet auf .pdf
 */
export function detectPdfMenu(html) {
  const links = extractLinks(html);
  const menuRe = /(speisekarte|men[üu]e?|karte|food.?menu|drinks?.?menu)/i;
  return links.some(l =>
    menuRe.test(l.text) && /\.pdf(\?|#|$)/i.test(l.href)
  );
}

/**
 * Erkennt eingebettete Buchungs-Widgets (Quandoo, OpenTable, ResMio, ...).
 */
export function detectBookingWidget(html) {
  const lower = html.toLowerCase();
  const patterns = ['quandoo', 'opentable', 'resmio', 'bookatable', 'thefork', 'lafourchette', 'resy.com'];
  const hits = patterns.filter(p => lower.includes(p));
  return { found: hits.length > 0, providers: hits };
}

/**
 * Findet Viewport-Meta-Tag.
 */
export function hasViewportMeta(html) {
  return /<meta\s+name=["']viewport["']/i.test(html);
}

/**
 * Extrahiert Copyright-Jahr aus Footer-Bereich (oder ganzem HTML als Fallback).
 */
export function extractCopyrightYear(html) {
  const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
  const haystack = footerMatch ? footerMatch[0] : html;
  // © 2021 oder Copyright 2021 oder &copy; 2021
  const yearRe = /(?:©|&copy;|copyright)\s*(\d{4})/gi;
  let latestYear = null;
  let m;
  while ((m = yearRe.exec(haystack)) !== null) {
    const y = parseInt(m[1], 10);
    if (y >= 2000 && y <= new Date().getFullYear() && (!latestYear || y > latestYear)) {
      latestYear = y;
    }
  }
  return latestYear;
}

/**
 * Findet Social-Media-Handles.
 */
export function extractSocial(html) {
  const out = { instagram: null, facebook: null, tiktok: null };
  const igMatch = html.match(/instagram\.com\/([\w._-]+)/i);
  if (igMatch && !['p', 'reel', 'reels', 'stories', 'tv'].includes(igMatch[1].toLowerCase())) {
    out.instagram = igMatch[1];
  }
  const fbMatch = html.match(/facebook\.com\/([\w.-]+)/i);
  if (fbMatch && !['sharer', 'plugins', 'tr'].includes(fbMatch[1].toLowerCase())) {
    out.facebook = fbMatch[1];
  }
  const ttMatch = html.match(/tiktok\.com\/@([\w._-]+)/i);
  if (ttMatch) out.tiktok = ttMatch[1];
  return out;
}

/**
 * Sucht im HTML nach Impressum/Kontakt-Link.
 */
export function findImpressumLink(html, baseUrl) {
  const links = extractLinks(html);
  const re = /(impressum|imprint|legal\s*notice|kontakt|contact)/i;
  for (const l of links) {
    if (re.test(l.text)) {
      try { return new URL(l.href, baseUrl).toString(); }
      catch { /* ignore */ }
    }
  }
  return null;
}

/**
 * Extrahiert Email-Adressen aus HTML (mailto + Plain-Text).
 * Filtert offensichtliche Junk-Adressen.
 */
export function extractEmails(html) {
  const emails = new Set();
  // mailto: links
  const mailtoRe = /mailto:([\w.+-]+@[\w.-]+\.\w+)/gi;
  let m;
  while ((m = mailtoRe.exec(html)) !== null) {
    emails.add(m[1].toLowerCase());
  }
  // Plain text emails
  const plainRe = /\b([\w.+-]+@[\w.-]+\.\w{2,})\b/g;
  while ((m = plainRe.exec(html)) !== null) {
    emails.add(m[1].toLowerCase());
  }
  // Filter junk
  return [...emails].filter(e => {
    if (/example\.com|test@|@test\./i.test(e)) return false;
    if (/sentry|wixpress|wordpress\.com|placeholder/i.test(e)) return false;
    return true;
  });
}

/**
 * Wählt aus mehreren Emails die wahrscheinlich primäre Kontakt-Email.
 */
export function pickPrimaryEmail(emails) {
  if (emails.length === 0) return null;
  // Bevorzuge info@, kontakt@, hello@, reservierung@
  const preferred = ['info@', 'kontakt@', 'contact@', 'hello@', 'reservierung@', 'reservation@', 'mail@'];
  for (const prefix of preferred) {
    const found = emails.find(e => e.startsWith(prefix));
    if (found) return found;
  }
  return emails[0];
}
