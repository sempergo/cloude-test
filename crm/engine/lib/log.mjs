// Strukturiertes Logging mit Farbe + Timestamps
// Nicht für Production-Telemetrie — nur für CLI-Sichtbarkeit beim Bauen.

const COLORS = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
};

function ts() {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

function fmt(level, color, msg, ctx) {
  const ctxStr = ctx ? ` ${COLORS.dim}${JSON.stringify(ctx)}${COLORS.reset}` : '';
  return `${COLORS.dim}${ts()}${COLORS.reset} ${color}${level}${COLORS.reset} ${msg}${ctxStr}`;
}

export const log = {
  info:  (msg, ctx) => console.log(fmt('INFO ', COLORS.cyan,    msg, ctx)),
  ok:    (msg, ctx) => console.log(fmt('OK   ', COLORS.green,   msg, ctx)),
  warn:  (msg, ctx) => console.warn(fmt('WARN ', COLORS.yellow, msg, ctx)),
  error: (msg, ctx) => console.error(fmt('ERROR', COLORS.red,   msg, ctx)),
  step:  (msg, ctx) => console.log(fmt('STEP ', COLORS.magenta, msg, ctx)),
  debug: (msg, ctx) => {
    if (process.env.DEBUG) console.log(fmt('DEBUG', COLORS.dim, msg, ctx));
  },
};

// Helper: Pretty-print elapsed time
export function elapsed(startMs) {
  const ms = Date.now() - startMs;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// Helper: Sleep
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Retry mit exponential backoff
// fn: async () => result | throws
// opts: { retries=3, baseMs=500, label='op' }
export async function withRetry(fn, opts = {}) {
  const { retries = 3, baseMs = 500, label = 'op' } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      // 4xx (außer 408, 429) sind nicht-retry-fähig
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw err;
      }
      if (attempt === retries) break;
      const wait = baseMs * Math.pow(2, attempt) + Math.random() * 250;
      log.warn(`${label} attempt ${attempt + 1}/${retries + 1} failed, retry in ${Math.round(wait)}ms`, {
        err: err?.message || String(err),
      });
      await sleep(wait);
    }
  }
  throw lastErr;
}
