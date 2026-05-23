// Supabase Service-Role-Client + Storage-Helper.
// Service-Role-Key bypasst RLS — nur für Server-Side-Scripts, niemals im Browser.

import { createClient } from '@supabase/supabase-js';
import { log } from './log.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL und SUPABASE_SERVICE_KEY müssen in .env gesetzt sein');
}

export const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SCREENSHOT_BUCKET = 'prospect-screenshots';

/**
 * Lädt einen Screenshot-Buffer als JPEG in den Storage-Bucket.
 * Pfad: prospect-screenshots/{prospect_id}/{name}.jpg
 * Returnt die Public-URL.
 */
export async function uploadScreenshot(prospectId, name, buffer) {
  const path = `${prospectId}/${name}.jpg`;
  const { error } = await sb.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      cacheControl: '604800', // 7 Tage Browser-Cache
      upsert: true,
    });
  if (error) {
    log.error('uploadScreenshot failed', { prospectId, name, error: error.message });
    throw error;
  }
  const { data } = sb.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Helper: Update eines Prospects mit Patch-Daten.
 */
export async function updateProspect(id, patch) {
  const { data, error } = await sb
    .from('prospects')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    log.error('updateProspect failed', { id, error: error.message });
    throw error;
  }
  return data;
}

/**
 * Helper: Hole alle Prospects mit gegebenem Status (nicht gelöscht).
 */
export async function getProspectsByStatus(status, opts = {}) {
  const { limit = 1000 } = opts;
  const { data, error } = await sb
    .from('prospects')
    .select('*')
    .eq('prospect_status', status)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Helper: Hole einen einzelnen Prospect by ID.
 */
export async function getProspect(id) {
  const { data, error } = await sb
    .from('prospects')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}
