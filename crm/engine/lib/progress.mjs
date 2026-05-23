// Progress-Reporter: schreibt Live-Status in die engine_status-Tabelle.
// Damit kann das CRM-Frontend per Realtime sehen, was gerade läuft.

import { sb } from './supabase.mjs';
import { log } from './log.mjs';

let _currentKind = null;
let _silentlyDegraded = false;

async function safeUpdate(patch) {
  try {
    const { error } = await sb
      .from('engine_status')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error && !_silentlyDegraded) {
      log.warn('progress update failed, weitere Updates werden still gemacht', { error: error.message });
      _silentlyDegraded = true;
    }
  } catch (e) {
    if (!_silentlyDegraded) {
      log.warn('progress update threw, weitere Updates werden still gemacht', { error: e.message });
      _silentlyDegraded = true;
    }
  }
}

/**
 * Startet einen neuen Run. Setzt active=true, kind, total.
 */
export async function startRun(kind, total = 0, message = null) {
  _currentKind = kind;
  _silentlyDegraded = false;
  await safeUpdate({
    active: true,
    kind,
    total,
    processed: 0,
    current_label: null,
    message: message || `${kind} gestartet`,
    started_at: new Date().toISOString(),
  });
}

/**
 * Update während des Runs. label = was gerade verarbeitet wird.
 */
export async function reportProgress({ processed, current_label, message } = {}) {
  const patch = {};
  if (processed != null) patch.processed = processed;
  if (current_label !== undefined) patch.current_label = current_label;
  if (message !== undefined) patch.message = message;
  if (Object.keys(patch).length === 0) return;
  await safeUpdate(patch);
}

/**
 * Aktualisiert nur die Gesamtzahl (falls erst nach Start bekannt).
 */
export async function setTotal(total) {
  await safeUpdate({ total });
}

/**
 * Beendet einen Run. Setzt active=false, finales message.
 */
export async function endRun({ ok = true, message = null } = {}) {
  await safeUpdate({
    active: false,
    current_label: null,
    message: message || (ok ? `${_currentKind} fertig` : `${_currentKind} fehlgeschlagen`),
  });
  _currentKind = null;
}

// Auto-cleanup bei SIGINT/SIGTERM: setze active=false, damit UI nicht hängen bleibt
function registerCleanup() {
  const onSignal = async (sig) => {
    try {
      await safeUpdate({ active: false, message: `abgebrochen (${sig})` });
    } catch {}
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
}
registerCleanup();
