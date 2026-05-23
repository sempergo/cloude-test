// Persistent Playwright-Browser mit Cleanup-Handlern.
// Eine Chromium-Instance, wiederverwendete Contexts pro Aufruf.

import { chromium } from 'playwright';
import { log } from './log.mjs';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

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
 *
 * @param {string} url
 * @param {object} opts
 *   - mobile: boolean
 *   - maxClipHeight: max. Pixelhöhe des Screenshots (default 6000)
 *   - quality: JPEG quality (default 70)
 *   - timeoutMs: Navigation-Timeout (default 30000)
 */
export async function captureSite(url, opts = {}) {
  const { mobile = false, maxClipHeight = 6000, quality = 70, timeoutMs = 30000 } = opts;
  const context = await newContext({ mobile });
  const page = await context.newPage();
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

    // Bis ans Seitenende scrollen, damit Lazy-Load-Bilder reinkommen
    try {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          const distance = 600;
          const interval = setInterval(() => {
            window.scrollBy(0, distance);
            if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 10) {
              clearInterval(interval);
              window.scrollTo(0, 0);
              setTimeout(resolve, 400);
            }
          }, 150);
        });
      });
    } catch (e) { /* ignore */ }

    result.html = await page.content();
    result.finalUrl = page.url();

    const fullHeight = await page.evaluate(() => Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
    ));
    const viewport = page.viewportSize();
    result.viewport = { ...viewport, contentHeight: fullHeight };

    // Echter Full-Page-Screenshot. JPEG quality 70 hält Files klein (200-500KB typisch).
    // Bei sehr langen Seiten wird automatisch über Scrolling capturet.
    result.screenshot = await page.screenshot({
      type: 'jpeg',
      quality,
      fullPage: true,
    });

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
