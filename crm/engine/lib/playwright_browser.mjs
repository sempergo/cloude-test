// Persistent Playwright-Browser mit Cleanup-Handlern.
// Eine Chromium-Instance, wiederverwendete Contexts pro Aufruf.

import { chromium } from 'playwright';
import { log } from './log.mjs';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ============================================================================
// COOKIE-BANNER DISMISSAL
// ============================================================================

// Selektoren für die verbreitetsten Consent-Manager (Cookiebot, OneTrust, Usercentrics, Borlabs, etc.)
const COOKIE_ACCEPT_SELECTORS = [
  // Cookiebot
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '#CybotCookiebotDialogBodyLevelButtonAccept',
  // OneTrust
  '#onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',
  // Usercentrics
  '#usercentrics-root button[data-testid="uc-accept-all-button"]',
  '[data-testid="uc-accept-all-button"]',
  'button[data-action="onAcceptAllConsents"]',
  // Borlabs Cookie (sehr verbreitet bei WordPress in DE)
  'a._brlbs-btn-accept-all',
  '._brlbs-accept-all',
  '#BorlabsCookieBox a[data-cookie-accept-all]',
  // Cookiefirst
  'button#cf-accept-all',
  // Iubenda
  '.iubenda-cs-accept-btn',
  // Quantcast
  'button.qc-cmp-button[mode="primary"]',
  // Termly
  '#truste-consent-button',
  // WordPress Cookie Notice (Hu-Manity)
  'button.hu-cookies-accept',
  '#cn-accept-cookie',
  // Generic data-attrs
  'button[data-cy="cookiebar-accept"]',
  'button[data-cookie-accept]',
  'button[aria-label*="akzeptieren" i]',
  'button[aria-label*="accept all" i]',
];

// Text-basierter Fallback (auf Deutsch + Englisch)
const COOKIE_ACCEPT_TEXTS = [
  'Alle akzeptieren', 'Alles akzeptieren', 'Alle Cookies akzeptieren',
  'Akzeptieren', 'Zustimmen', 'Einverstanden', 'OK',
  'Accept all', 'Accept All', 'Accept Cookies', 'Accept', 'Agree', 'I agree',
  'Allow all', 'Got it',
];

// CSS um restliche Banner zu verstecken (für Sites die unsere Klicks nicht akzeptiert haben)
const COOKIE_HIDE_CSS = `
  /* Bekannte Container */
  #CybotCookiebotDialog, #cookiebot-dialog,
  #onetrust-banner-sdk, #onetrust-consent-sdk,
  #usercentrics-root, #usercentrics-cmp-ui,
  #BorlabsCookieBox, ._brlbs-bar-wrap, ._brlbs-box-wrap,
  #cookiefirst-root, .cookiefirst-banner,
  .iubenda-cs-container, #iubenda-cs-banner,
  #qc-cmp2-container, #qcCmpUi, .qc-cmp-ui-container,
  #truste-consent-track, .truste_box_overlay,
  #cookie-notice, #cn-notice-text,
  .hu-cookies-modal, #hu-cookies-bar,
  /* Generic Patterns */
  [id*="cookie-consent" i],
  [id*="cookie-banner" i],
  [id*="cookie-notice" i],
  [id*="consent-banner" i],
  [id*="consent-popup" i],
  [class*="cookie-banner" i]:not([class*="acceptedcookies" i]),
  [class*="cookie-notice" i],
  [class*="cookie-modal" i],
  [class*="cookie-consent" i],
  [class*="consent-banner" i],
  [class*="gdpr-banner" i],
  [class*="cc-window" i],
  .cc-banner, .cc-window,
  /* Generic Overlays mit hohem z-index */
  div[style*="z-index: 99999"],
  div[style*="z-index: 999999"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html, body { overflow: auto !important; }
`;

async function dismissCookieBanners(page) {
  // 1. Selector-basierte Klicks (schnell)
  for (const sel of COOKIE_ACCEPT_SELECTORS) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(150);
      }
    } catch { /* ignore */ }
  }
  // 2. Text-basierter Fallback — finde Buttons mit passendem Text
  try {
    await page.evaluate((texts) => {
      const lowerTexts = texts.map(t => t.toLowerCase());
      const buttons = [...document.querySelectorAll('button, a, [role="button"]')];
      for (const el of buttons) {
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (!t || t.length > 40) continue;
        if (lowerTexts.some(lt => t === lt || t.startsWith(lt))) {
          try { el.click(); } catch {}
          return; // nur den ersten Match klicken
        }
      }
    }, COOKIE_ACCEPT_TEXTS);
    await page.waitForTimeout(200);
  } catch { /* ignore */ }
  // 3. iframes (manche Banner sind in iframes)
  try {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      for (const sel of COOKIE_ACCEPT_SELECTORS.slice(0, 8)) {
        try {
          const btn = await frame.$(sel);
          if (btn) { await btn.click({ timeout: 1000 }).catch(() => {}); }
        } catch {}
      }
    }
  } catch {}
}

let _browser = null;
let _shuttingDown = false;

export async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  log.info('Starting Chromium...');
  _browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  registerShutdown();
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (e) { /* ignore */ }
    _browser = null;
  }
}

function registerShutdown() {
  if (_shuttingDown) return;
  const onSignal = async (sig) => {
    if (_shuttingDown) return;
    _shuttingDown = true;
    log.warn(`Caught ${sig}, closing browser...`);
    await closeBrowser();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
}

/**
 * Erstellt einen frischen Browser-Context mit definiertem Viewport.
 * Caller muss context.close() im finally-Block aufrufen.
 */
export async function newContext({ mobile = false } = {}) {
  const browser = await getBrowser();
  const viewport = mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  const ctxOpts = {
    viewport,
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
      : USER_AGENT,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    javaScriptEnabled: true,
    bypassCSP: true,
  };
  return browser.newContext(ctxOpts);
}

/**
 * Lädt eine URL und macht einen Screenshot. Returnt Buffer + HTML + Lade-Metadaten.
 * Hart limitiert auf ~45s total — kein Hängen mehr.
 *
 * @param {string} url
 * @param {object} opts
 *   - mobile: boolean
 *   - maxClipHeight: max. Pixelhöhe des Screenshots (default 6000)
 *   - quality: JPEG quality (default 70)
 *   - timeoutMs: Navigation-Timeout (default 30000)
 *   - hardTimeoutMs: Hard-cap für die gesamte Operation (default 45000)
 */
export async function captureSite(url, opts = {}) {
  return Promise.race([
    _captureSiteInner(url, opts),
    new Promise((resolve) => setTimeout(() => resolve({
      ok: false, error: 'hard timeout 45s', html: null, screenshot: null,
    }), opts.hardTimeoutMs || 45000)),
  ]);
}

async function _captureSiteInner(url, opts = {}) {
  const { mobile = false, maxClipHeight = 6000, quality = 70, timeoutMs = 25000 } = opts;
  const context = await newContext({ mobile });
  const page = await context.newPage();
  // Default-Timeouts hart auf 15s
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(timeoutMs);
  const result = { ok: false, error: null, html: null, screenshot: null, viewport: null, finalUrl: null };

  try {
    // Erst versuchen mit networkidle, fallback auf domcontentloaded
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    } catch (e) {
      log.debug(`networkidle timeout, fallback to domcontentloaded for ${url}`);
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    }
    if (!response || !response.ok()) {
      const status = response?.status() || 'no-response';
      result.error = `HTTP ${status}`;
      return result;
    }
    // Kleine Pause für Lazy-Load-Content
    await page.waitForTimeout(800);

    // Cookie-Banner wegklicken (probiert verbreitete Consent-Manager + Fallback per Text)
    await dismissCookieBanners(page);

    // Restliche Banner per CSS verstecken (für die Sites die wir nicht klicken konnten)
    await page.addStyleTag({ content: COOKIE_HIDE_CSS }).catch(() => {});
    await page.waitForTimeout(200);

    // Bis ans Seitenende scrollen (mit hartem Cap, damit Infinite-Scroll-Seiten nicht hängen)
    try {
      await Promise.race([
        page.evaluate(async () => {
          await new Promise((resolve) => {
            const distance = 800;
            let iterations = 0;
            const maxIterations = 25; // max 25 * 800px = 20.000px scroll-distance
            let lastHeight = 0;
            let stuckCount = 0;
            const interval = setInterval(() => {
              const h = document.body.scrollHeight;
              window.scrollBy(0, distance);
              iterations++;
              if (h === lastHeight) stuckCount++; else stuckCount = 0;
              lastHeight = h;
              const reachedBottom = (window.innerHeight + window.scrollY) >= h - 10;
              if (reachedBottom || iterations >= maxIterations || stuckCount >= 3) {
                clearInterval(interval);
                window.scrollTo(0, 0);
                setTimeout(resolve, 300);
              }
            }, 120);
          });
        }),
        new Promise((resolve) => setTimeout(resolve, 8000)), // harter 8s-Cap
      ]);
    } catch (e) { /* ignore */ }

    result.html = await page.content();
    result.finalUrl = page.url();

    const fullHeight = await page.evaluate(() => Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
    ));
    const viewport = page.viewportSize();
    // Claude Vision-API erlaubt max 8000px je Dimension → wir bleiben unter 7500px
    const MAX_SCREENSHOT_HEIGHT = 7500;
    result.viewport = { ...viewport, contentHeight: fullHeight };

    // JPEG quality 70 hält Files klein (200-500KB typisch).
    if (fullHeight <= MAX_SCREENSHOT_HEIGHT) {
      // Kürzere Seiten: echter Full-Page-Screenshot
      result.screenshot = await page.screenshot({
        type: 'jpeg',
        quality,
        fullPage: true,
      });
    } else {
      // Sehr lange Seiten: erweitere Viewport auf MAX_HEIGHT, screenshot vom Viewport
      // (capturet die obersten 7500px des Renderings, inkl. Lazy-Load-Content)
      await page.setViewportSize({ width: viewport.width, height: MAX_SCREENSHOT_HEIGHT });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      result.screenshot = await page.screenshot({
        type: 'jpeg',
        quality,
        fullPage: false,
      });
      result.viewport.clippedTo = MAX_SCREENSHOT_HEIGHT;
    }

    result.ok = true;
    return result;
  } catch (err) {
    result.error = err.message;
    return result;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
