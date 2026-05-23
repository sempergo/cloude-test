// Google Places API: Grid-Search + Place Details + Retry.
// Wir nutzen die "Nearby Search" mit Grid-Pattern, weil ein einzelner Search nur max 60 Treffer liefert.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import { log, withRetry, sleep } from './log.mjs';

const PLACES_KEY = process.env.GOOGLE_PLACES_KEY;
const NEARBY_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

if (!PLACES_KEY) {
  throw new Error('GOOGLE_PLACES_KEY muss in .env gesetzt sein');
}

/**
 * Konvertiert "Frankfurt" → { lat, lng }.
 */
export async function geocodeCity(stadt) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(stadt + ', Deutschland')}&key=${PLACES_KEY}`;
  const res = await withRetry(async () => {
    const r = await fetch(url);
    const j = await r.json();
    if (j.status !== 'OK') throw new Error(`Geocode failed: ${j.status} ${j.error_message || ''}`);
    return j;
  }, { label: 'geocode' });
  const loc = res.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

/**
 * Erzeugt ein 3×3-Grid (Center + 8 Offset-Punkte) um die Stadt.
 * Jede Zelle wird separat gesearcht → max ~540 Treffer (9 × 60), nach Dedup ~150-300 unique.
 */
function gridPoints({ lat, lng }, radiusMeters) {
  // Grobe Lat/Lng-Verschiebung in Meter (gilt für Deutschland-Latitude ~50°)
  const dLat = (radiusMeters / 2) / 111000;          // 1 lat-Grad ≈ 111km
  const dLng = (radiusMeters / 2) / (111000 * Math.cos(lat * Math.PI / 180));
  return [
    { lat, lng },
    { lat: lat + dLat, lng },
    { lat: lat - dLat, lng },
    { lat, lng: lng + dLng },
    { lat, lng: lng - dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat - dLat, lng: lng - dLng },
  ];
}

/**
 * Sucht Restaurants in einem Punkt mit Pagination (bis zu 60 Treffer).
 */
async function searchPoint({ lat, lng }, radius) {
  const results = [];
  let pageToken = null;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: String(radius),
      type: 'restaurant',
      language: 'de',
      key: PLACES_KEY,
    });
    if (pageToken) params.set('pagetoken', pageToken);
    const url = `${NEARBY_URL}?${params}`;

    const json = await withRetry(async () => {
      const r = await fetch(url);
      const j = await r.json();
      // INVALID_REQUEST kommt manchmal wenn pagetoken noch nicht aktiv ist
      if (j.status === 'INVALID_REQUEST' && pageToken) {
        throw Object.assign(new Error('pagetoken not ready'), { status: 429 });
      }
      if (j.status !== 'OK' && j.status !== 'ZERO_RESULTS') {
        throw new Error(`Places search failed: ${j.status} ${j.error_message || ''}`);
      }
      return j;
    }, { label: 'placesSearch', retries: 3, baseMs: 2000 });

    if (json.status === 'ZERO_RESULTS') break;
    results.push(...(json.results || []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
    // Pagetoken braucht ~2s bis aktiv
    await sleep(2000);
  }
  return results;
}

/**
 * Grid-Suche über die ganze Stadt.
 * radius = halbe Kantenlänge einer Grid-Zelle, in Metern.
 */
export async function searchRestaurants(stadt, { radius = 3000 } = {}) {
  log.step(`Geocoding Stadt: ${stadt}`);
  const center = await geocodeCity(stadt);
  log.info(`Center: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);

  const points = gridPoints(center, radius * 2); // grid spannt radius*2 in alle Richtungen
  log.step(`Grid-Suche mit ${points.length} Punkten (radius ${radius}m je Zelle)`);

  const seen = new Set();
  const all = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    log.info(`Grid ${i + 1}/${points.length}: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`);
    const found = await searchPoint(p, radius);
    let newCount = 0;
    for (const place of found) {
      if (place.place_id && !seen.has(place.place_id)) {
        seen.add(place.place_id);
        all.push(place);
        newCount++;
      }
    }
    log.info(`  → ${found.length} found, ${newCount} new (total: ${all.length})`);
    await sleep(200);
  }
  return all;
}

/**
 * Place Details für eine einzelne place_id (Telefon, Website, Reviews etc.).
 */
export async function getPlaceDetails(placeId) {
  const fields = [
    'place_id', 'name', 'formatted_address', 'formatted_phone_number',
    'international_phone_number', 'website', 'url',
    'rating', 'user_ratings_total', 'price_level',
    'opening_hours', 'reviews', 'types', 'business_status',
    'geometry/location', 'address_components',
  ].join(',');
  const url = `${DETAILS_URL}?place_id=${placeId}&fields=${fields}&language=de&key=${PLACES_KEY}`;
  return withRetry(async () => {
    const r = await fetch(url);
    const j = await r.json();
    if (j.status !== 'OK') {
      throw new Error(`Place Details failed: ${j.status} ${j.error_message || ''}`);
    }
    return j.result;
  }, { label: 'placeDetails', retries: 3, baseMs: 1000 });
}

/**
 * Filter: nur Premium-fähige Restaurants.
 */
export function isPremiumCandidate(place) {
  const rating = place.rating || 0;
  const reviews = place.user_ratings_total || 0;
  const status = place.business_status || 'OPERATIONAL';
  if (status !== 'OPERATIONAL') return false;
  if (rating < 4.0) return false;
  if (reviews < 20) return false;
  return true;
}

/**
 * Extrahiert die Stadt aus address_components.
 */
export function extractCity(place) {
  const comps = place.address_components || [];
  const city = comps.find(c => c.types.includes('locality')) ||
               comps.find(c => c.types.includes('administrative_area_level_2')) ||
               comps.find(c => c.types.includes('postal_town'));
  return city?.long_name || null;
}
