/**
 * Devfolio source adapter for the hackathon aggregation worker.
 *
 * Devfolio is a React/Next.js-rendered hackathon platform popular for
 * India-based and global student hackathons. This adapter uses a
 * multi-approach strategy:
 *   1. Primary: Try the Devfolio REST API (api.devfolio.co)
 *   2. Fallback: Extract __NEXT_DATA__ JSON embedded in the HTML page
 *   3. Graceful degradation: Return empty array if both fail
 */

import type { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Devfolio listing page URL. */
const DEVFOLIO_PAGE_URL = 'https://devfolio.co/hackathons';

/** Devfolio public API base URL. */
const DEVFOLIO_API_BASE = 'https://api.devfolio.co/api';

/** Maximum pages to fetch from the API. */
const MAX_PAGES = 5;

/** Items per page for API requests. */
const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

/** Shape of a single hackathon from the Devfolio API response. */
interface DevfolioHackathon {
  id?: string | number;
  name?: string;
  slug?: string;
  tagline?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  // Some API versions use unix timestamps
  starts_at_ts?: number;
  ends_at_ts?: number;
  location?: string;
  is_online?: boolean;
  themes?: string[] | { name: string }[];
  tracks?: string[] | { name: string }[];
  // Prize can appear in multiple shapes
  prize_pool?: string | number;
  total_prizes?: string | number;
  prizes?: string;
  organizer?: string;
  team?: { name?: string };
  organization?: { name?: string };
  org_name?: string;
  // URL can be a full URL or just a slug
  url?: string;
  hackathon_url?: string;
  website?: string;
  status?: string;
  open_for_applications?: boolean;
}

/** Shape of the Devfolio API list response. */
interface DevfolioApiResponse {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: DevfolioHackathon[];
  // Some endpoints wrap in data
  data?: {
    hackathons?: DevfolioHackathon[];
    results?: DevfolioHackathon[];
    total?: number;
  };
  hackathons?: DevfolioHackathon[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Perform a fetch with an AbortController timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'HackathonDiscoveryPlatform/1.0 (aggregator)',
        Accept: 'application/json, text/html',
        ...headers,
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Coerce a date value (ISO string, unix timestamp in seconds or ms, or
 * any date-ish string) to an ISO 8601 string. Returns null on failure.
 */
function toIsoDate(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    // Unix timestamps: if less than ~2e10 it's seconds, otherwise ms
    const ms = value < 2_000_000_000_000 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // String — try direct parse first
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }

  return null;
}

/**
 * Derive a canonical Devfolio event URL from a hackathon object.
 * Prefers explicit url fields, then constructs from slug.
 */
function buildEventUrl(hackathon: DevfolioHackathon): string | null {
  // Explicit URL fields
  if (hackathon.url && hackathon.url.startsWith('http')) {
    return hackathon.url.trim();
  }
  if (hackathon.hackathon_url && hackathon.hackathon_url.startsWith('http')) {
    return hackathon.hackathon_url.trim();
  }
  if (hackathon.website && hackathon.website.startsWith('http')) {
    return hackathon.website.trim();
  }

  // Construct from slug
  const slug = hackathon.slug?.trim();
  if (slug) {
    return `https://devfolio.co/${slug}`;
  }

  return null;
}

/**
 * Extract a human-readable prize string from a hackathon object.
 */
function extractPrize(hackathon: DevfolioHackathon): string | undefined {
  if (typeof hackathon.prizes === 'string' && hackathon.prizes.trim()) {
    return hackathon.prizes.trim();
  }
  if (hackathon.prize_pool) {
    return String(hackathon.prize_pool).trim();
  }
  if (hackathon.total_prizes) {
    return String(hackathon.total_prizes).trim();
  }
  return undefined;
}

/**
 * Extract a flat list of tag strings from themes/tracks.
 */
function extractTags(hackathon: DevfolioHackathon): string[] {
  const rawSources = [hackathon.themes, hackathon.tracks];
  const tags: string[] = [];

  for (const src of rawSources) {
    if (!src || !Array.isArray(src)) continue;
    for (const item of src) {
      if (typeof item === 'string' && item.trim()) {
        tags.push(item.trim());
      } else if (item && typeof item === 'object' && typeof (item as { name?: string }).name === 'string') {
        const name = (item as { name: string }).name.trim();
        if (name) tags.push(name);
      }
    }
  }

  return tags;
}

/**
 * Determine the organizer name from a hackathon object.
 */
function extractOrganizer(hackathon: DevfolioHackathon): string | undefined {
  if (typeof hackathon.organizer === 'string' && hackathon.organizer.trim()) {
    return hackathon.organizer.trim();
  }
  if (hackathon.org_name) {
    return String(hackathon.org_name).trim();
  }
  if (hackathon.organization?.name) {
    return hackathon.organization.name.trim();
  }
  if (hackathon.team?.name) {
    return hackathon.team.name.trim();
  }
  return undefined;
}

/**
 * Determine location string. Devfolio is primarily online; fall back to
 * "Online" unless an explicit non-empty location is present.
 */
function extractLocation(hackathon: DevfolioHackathon): string {
  if (hackathon.is_online === true) {
    return 'Online';
  }
  if (typeof hackathon.location === 'string' && hackathon.location.trim()) {
    return hackathon.location.trim();
  }
  // Default to Online for Devfolio events
  return 'Online';
}

/**
 * Map a single Devfolio hackathon object to a RawHackathonEvent.
 * Returns null if required fields (title, url, startDate) are missing.
 */
function mapToRawEvent(hackathon: DevfolioHackathon): RawHackathonEvent | null {
  const title = hackathon.name?.trim();
  if (!title) return null;

  const url = buildEventUrl(hackathon);
  if (!url) return null;

  // Try both ISO string fields and timestamp fields for dates
  const startDate =
    toIsoDate(hackathon.starts_at) ??
    toIsoDate(hackathon.starts_at_ts);
  if (!startDate) return null;

  const endDate =
    toIsoDate(hackathon.ends_at) ??
    toIsoDate(hackathon.ends_at_ts) ??
    undefined;

  const description =
    hackathon.tagline?.trim() || hackathon.description?.trim() || undefined;

  return {
    title,
    description,
    startDate,
    endDate,
    location: extractLocation(hackathon),
    organizer: extractOrganizer(hackathon),
    prizes: extractPrize(hackathon),
    tags: extractTags(hackathon),
    url,
    source: 'devfolio',
  };
}

// ---------------------------------------------------------------------------
// Fetch strategies
// ---------------------------------------------------------------------------

/**
 * Strategy 1: Try the Devfolio public REST API.
 *
 * Known endpoints:
 *  - GET /api/hackathons/?is_open=true — open hackathons
 *  - GET /api/hackathons/            — all hackathons (paginated)
 *
 * The API may not be officially documented; we try both paths with a
 * graceful fallback.
 */
async function fetchFromApi(): Promise<RawHackathonEvent[] | null> {
  const candidates = [
    `${DEVFOLIO_API_BASE}/hackathons/?is_open=true&count=${PAGE_SIZE}`,
    `${DEVFOLIO_API_BASE}/hackathons/?count=${PAGE_SIZE}`,
    `${DEVFOLIO_API_BASE}/hackathons/`,
  ];

  for (const baseUrl of candidates) {
    try {
      const allEvents: RawHackathonEvent[] = [];

      let page = 0; // Devfolio uses offset-based pagination
      let hasMore = true;

      for (let pageNum = 0; pageNum < MAX_PAGES && hasMore; pageNum++) {
        const url = baseUrl.includes('?')
          ? `${baseUrl}&offset=${pageNum * PAGE_SIZE}`
          : `${baseUrl}?count=${PAGE_SIZE}&offset=${pageNum * PAGE_SIZE}`;

        const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, {
          Accept: 'application/json',
        });

        if (!response.ok) {
          if (pageNum === 0) {
            // This endpoint isn't working — try next candidate
            break;
          }
          // Subsequent page failed — stop pagination but keep what we have
          hasMore = false;
          break;
        }

        let data: DevfolioApiResponse;
        try {
          data = (await response.json()) as DevfolioApiResponse;
        } catch {
          if (pageNum === 0) break;
          hasMore = false;
          break;
        }

        // Normalise different response shapes
        const hackathons: DevfolioHackathon[] =
          data.results ??
          data.hackathons ??
          data.data?.hackathons ??
          data.data?.results ??
          [];

        if (!hackathons.length) {
          hasMore = false;
          break;
        }

        for (const h of hackathons) {
          try {
            const event = mapToRawEvent(h);
            if (event) allEvents.push(event);
          } catch {
            // Skip malformed entries
          }
        }

        // Stop if we got fewer than a full page (last page)
        if (hackathons.length < PAGE_SIZE) {
          hasMore = false;
        }

        // Stop if there's no "next" link
        if (data.next === null || data.next === undefined && pageNum > 0) {
          hasMore = false;
        }
      }

      if (allEvents.length > 0) {
        return allEvents;
      }
    } catch {
      // This candidate failed entirely — try next
      continue;
    }
  }

  return null;
}

/**
 * Strategy 2: Extract __NEXT_DATA__ from the server-rendered HTML page.
 *
 * Next.js embeds the full page props as a JSON blob in a script tag:
 *   <script id="__NEXT_DATA__" type="application/json">{ ... }</script>
 *
 * We parse this blob and attempt to locate hackathon arrays under various
 * known paths such as pageProps.hackathons or pageProps.data.hackathons.
 */
async function fetchFromNextData(): Promise<RawHackathonEvent[] | null> {
  let html: string;

  try {
    const response = await fetchWithTimeout(DEVFOLIO_PAGE_URL, REQUEST_TIMEOUT_MS, {
      Accept: 'text/html,application/xhtml+xml',
    });

    if (!response.ok) {
      return null;
    }

    html = await response.text();
  } catch {
    return null;
  }

  // Extract the __NEXT_DATA__ JSON blob
  const nextDataMatch = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
  ) || html.match(
    /<script[^>]*type="application\/json"[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  );

  if (!nextDataMatch || !nextDataMatch[1]) {
    // Also try without the id attribute (some Next.js versions omit it)
    const fallbackMatch = html.match(
      /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
    );
    if (!fallbackMatch || !fallbackMatch[1]) {
      return null;
    }
  }

  const jsonText = (nextDataMatch?.[1] ?? '').trim();
  if (!jsonText) return null;

  let nextData: Record<string, unknown>;
  try {
    nextData = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Walk common paths to find hackathon arrays
  const hackathons = extractHackathonsFromNextData(nextData);
  if (!hackathons || hackathons.length === 0) {
    return null;
  }

  const events: RawHackathonEvent[] = [];
  for (const h of hackathons) {
    try {
      const event = mapToRawEvent(h as DevfolioHackathon);
      if (event) events.push(event);
    } catch {
      // Skip
    }
  }

  return events.length > 0 ? events : null;
}

/**
 * Walk known paths inside the __NEXT_DATA__ blob to find hackathon arrays.
 */
function extractHackathonsFromNextData(data: Record<string, unknown>): unknown[] | null {
  // Common path: props.pageProps.hackathons
  const pageProps = (data as { props?: { pageProps?: Record<string, unknown> } })
    ?.props?.pageProps;

  if (pageProps) {
    const candidates = [
      (pageProps as { hackathons?: unknown[] }).hackathons,
      (pageProps as { data?: { hackathons?: unknown[] } }).data?.hackathons,
      (pageProps as { data?: { results?: unknown[] } }).data?.results,
      (pageProps as { results?: unknown[] }).results,
      (pageProps as { items?: unknown[] }).items,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate;
      }
    }
  }

  // Fallback: search recursively for any array called "hackathons"
  return findArrayByKey(data, 'hackathons');
}

/**
 * Recursively search an object for the first array value under a given key.
 * Depth-limited to avoid huge traversals.
 */
function findArrayByKey(obj: unknown, key: string, depth = 0): unknown[] | null {
  if (depth > 6 || obj === null || typeof obj !== 'object') {
    return null;
  }

  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === key && Array.isArray(v) && v.length > 0) {
      return v;
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const found = findArrayByKey(v, key, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Strategy 3: Regex-based HTML parsing as a last resort.
 *
 * Looks for JSON-LD script tags or Open Graph meta tags that may contain
 * individual hackathon metadata, and for card-like HTML structures.
 */
function parseEventsFromHtml(html: string): RawHackathonEvent[] {
  const events: RawHackathonEvent[] = [];
  const processedUrls = new Set<string>();

  // Try JSON-LD structured data blocks
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;

  while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const ldData = JSON.parse(ldMatch[1]) as Record<string, unknown>;

      // JSON-LD can be a single object or an array
      const items = Array.isArray(ldData) ? ldData : [ldData];

      for (const item of items) {
        const typed = item as {
          '@type'?: string;
          name?: string;
          url?: string;
          description?: string;
          startDate?: string;
          endDate?: string;
          location?: { name?: string } | string;
          organizer?: { name?: string } | string;
        };

        // Only process Event-type items
        if (!typed['@type'] || !String(typed['@type']).toLowerCase().includes('event')) {
          continue;
        }

        const title = typed.name?.trim();
        const url = typed.url?.trim();
        const startDate = toIsoDate(typed.startDate);

        if (!title || !url || !startDate) continue;
        if (processedUrls.has(url)) continue;

        processedUrls.add(url);

        const locationRaw = typed.location;
        let location: string | undefined;
        if (typeof locationRaw === 'string') {
          location = locationRaw.trim() || undefined;
        } else if (locationRaw && typeof locationRaw === 'object') {
          location = locationRaw.name?.trim() || undefined;
        }

        const organizerRaw = typed.organizer;
        let organizer: string | undefined;
        if (typeof organizerRaw === 'string') {
          organizer = organizerRaw.trim() || undefined;
        } else if (organizerRaw && typeof organizerRaw === 'object') {
          organizer = organizerRaw.name?.trim() || undefined;
        }

        events.push({
          title,
          description: typed.description?.trim() || undefined,
          startDate,
          endDate: toIsoDate(typed.endDate) || undefined,
          location: location ?? 'Online',
          organizer,
          tags: [],
          url,
          source: 'devfolio',
        });
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }

  if (events.length > 0) return events;

  // Regex heuristic: find hackathon card anchors with slug-like hrefs
  // Devfolio card links look like: href="/hackathon-slug" or href="https://devfolio.co/slug"
  const cardLinkRegex = /<a[^>]*href="([^"]*devfolio\.co\/[a-z0-9-]+|\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let cardMatch: RegExpExecArray | null;

  while ((cardMatch = cardLinkRegex.exec(html)) !== null) {
    const rawHref = cardMatch[1].trim();
    const content = cardMatch[2];

    if (!content) continue;

    // Must contain a heading-like element to be a card
    const titleMatch =
      content.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
      content.match(/class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\//i) ||
      content.match(/class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\//i);

    if (!titleMatch) continue;

    const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
    if (!title) continue;

    // Build full URL
    let eventUrl: string;
    if (rawHref.startsWith('http')) {
      eventUrl = rawHref;
    } else if (rawHref.startsWith('/')) {
      // Skip generic paths like /about, /contact etc. — only take short slugs
      if (rawHref.split('/').length > 2) continue;
      eventUrl = `https://devfolio.co${rawHref}`;
    } else {
      continue;
    }

    if (processedUrls.has(eventUrl)) continue;
    processedUrls.add(eventUrl);

    // Try to extract a date from the card content
    const dateMatch =
      content.match(/(\d{4}-\d{2}-\d{2})/i) ||
      content.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);

    const startDate = dateMatch ? toIsoDate(dateMatch[0]) : null;
    if (!startDate) continue;

    events.push({
      title,
      startDate,
      location: 'Online',
      tags: [],
      url: eventUrl,
      source: 'devfolio',
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

/**
 * Devfolio source adapter.
 *
 * Attempts to fetch hackathon listings using three strategies in order:
 *  1. Devfolio REST API (api.devfolio.co)
 *  2. __NEXT_DATA__ JSON from the HTML page
 *  3. Regex-based HTML parsing (JSON-LD and card heuristics)
 *
 * If all strategies fail, returns an empty array (graceful degradation).
 */
export class DevfolioAdapter implements EventSourceAdapter {
  readonly name = 'Devfolio';
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon events from Devfolio.
   * Tries multiple strategies and returns results from the first that succeeds.
   * Returns an empty array if all strategies fail (graceful degradation).
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    // Strategy 1: REST API
    try {
      const apiEvents = await fetchFromApi();
      if (apiEvents && apiEvents.length > 0) {
        return deduplicateByUrl(apiEvents);
      }
    } catch {
      // Fall through to next strategy
    }

    // Strategy 2: __NEXT_DATA__ from HTML
    try {
      const nextDataEvents = await fetchFromNextData();
      if (nextDataEvents && nextDataEvents.length > 0) {
        return deduplicateByUrl(nextDataEvents);
      }
    } catch {
      // Fall through to next strategy
    }

    // Strategy 3: Regex HTML parsing — fetch the page if not already fetched
    try {
      const response = await fetchWithTimeout(DEVFOLIO_PAGE_URL, REQUEST_TIMEOUT_MS, {
        Accept: 'text/html,application/xhtml+xml',
      });

      if (response.ok) {
        const html = await response.text();
        const htmlEvents = parseEventsFromHtml(html);
        if (htmlEvents.length > 0) {
          return deduplicateByUrl(htmlEvents);
        }
      }
    } catch {
      // All strategies exhausted
    }

    // Graceful degradation: return empty array rather than throwing
    return [];
  }

  /**
   * Check whether Devfolio's page is reachable and responding.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(DEVFOLIO_PAGE_URL, REQUEST_TIMEOUT_MS);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Remove duplicate events that share the same URL.
 */
function deduplicateByUrl(events: RawHackathonEvent[]): RawHackathonEvent[] {
  const seen = new Set<string>();
  const result: RawHackathonEvent[] = [];
  for (const event of events) {
    if (!seen.has(event.url)) {
      seen.add(event.url);
      result.push(event);
    }
  }
  return result;
}
