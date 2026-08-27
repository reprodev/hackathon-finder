/**
 * DoraHacks source adapter for the hackathon aggregation worker.
 *
 * DoraHacks is a Web3/crypto hackathon platform. Their frontend is
 * client-rendered (React/Next.js), so this adapter uses a multi-approach
 * strategy:
 *   1. Primary: Try the internal REST API endpoint
 *   2. Fallback: Try extracting __NEXT_DATA__ from the HTML page
 *   3. Graceful degradation: Return empty array if both fail
 */

import type { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Shape of a single hackathon entry from DoraHacks API response. */
interface DoraHacksHackathon {
  hackathon_id?: number | string;
  hackathon_name?: string;
  name?: string;
  title?: string;
  description?: string;
  tagline?: string;
  start_time?: string | number;
  end_time?: string | number;
  startTime?: string | number;
  endTime?: string | number;
  prize_pool?: string | number;
  total_prize?: string | number;
  prize?: string;
  tags?: string[];
  tracks?: string[] | { name: string }[];
  location?: string;
  mode?: string;
  status?: string;
  organizer?: string;
  org_name?: string;
  organization?: { name?: string };
  url?: string;
  link?: string;
}

/** Shape of the DoraHacks API list response. */
interface DoraHacksApiResponse {
  data?: {
    list?: DoraHacksHackathon[];
    hackathons?: DoraHacksHackathon[];
    items?: DoraHacksHackathon[];
    total?: number;
    page?: number;
    page_size?: number;
  };
  list?: DoraHacksHackathon[];
  hackathons?: DoraHacksHackathon[];
  results?: DoraHacksHackathon[];
  code?: number;
  status?: string;
  message?: string;
}

/** Shape of Next.js embedded data payload. */
interface NextDataPayload {
  props?: {
    pageProps?: {
      hackathons?: DoraHacksHackathon[];
      list?: DoraHacksHackathon[];
      data?: DoraHacksHackathon[];
      initialData?: {
        list?: DoraHacksHackathon[];
        hackathons?: DoraHacksHackathon[];
      };
    };
  };
}

/** Primary API endpoint candidates. */
const API_ENDPOINTS = [
  'https://dorahacks.io/api/hackathon/list?status=active&page=1&limit=50',
  'https://dorahacks.io/api/hackathon/list?page=1&limit=50',
  'https://api.dorahacks.io/hackathon/list?status=active&page=1&limit=50',
];

/** Fallback HTML page for __NEXT_DATA__ extraction. */
const HACKATHON_PAGE_URL = 'https://dorahacks.io/hackathon';

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Parse a DoraHacks timestamp into an ISO 8601 date string.
 * Handles Unix timestamps (seconds or milliseconds) and ISO date strings.
 * Returns null for unparseable values.
 */
function parseTimestamp(value: string | number | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  // If it's a number, treat as Unix timestamp
  if (typeof value === 'number') {
    if (value <= 0) return null;
    // If the value looks like seconds (< year 2100 in seconds), convert to ms
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // If it's a string, try parsing directly
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Try as numeric string (timestamp)
    const numericValue = Number(trimmed);
    if (!isNaN(numericValue) && numericValue > 0) {
      const ms = numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
      const date = new Date(ms);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }

    // Try as date string
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

/**
 * Extract the prize information from various possible fields.
 */
function extractPrize(hackathon: DoraHacksHackathon): string | undefined {
  if (hackathon.prize && typeof hackathon.prize === 'string' && hackathon.prize.trim()) {
    return hackathon.prize.trim();
  }

  const pool = hackathon.prize_pool ?? hackathon.total_prize;
  if (pool !== undefined && pool !== null) {
    const value = typeof pool === 'number' ? `$${pool.toLocaleString()}` : String(pool).trim();
    return value || undefined;
  }

  return undefined;
}

/**
 * Extract tags from DoraHacks track/tag fields.
 */
function extractTags(hackathon: DoraHacksHackathon): string[] {
  const tags: string[] = [];

  if (hackathon.tags && Array.isArray(hackathon.tags)) {
    for (const tag of hackathon.tags) {
      if (typeof tag === 'string' && tag.trim()) {
        tags.push(tag.trim());
      }
    }
  }

  if (hackathon.tracks && Array.isArray(hackathon.tracks)) {
    for (const track of hackathon.tracks) {
      if (typeof track === 'string' && track.trim()) {
        tags.push(track.trim());
      } else if (track && typeof track === 'object' && 'name' in track && track.name?.trim()) {
        tags.push(track.name.trim());
      }
    }
  }

  // Deduplicate
  return [...new Set(tags)];
}

/**
 * Extract the organizer name from various possible fields.
 */
function extractOrganizer(hackathon: DoraHacksHackathon): string | undefined {
  if (hackathon.organizer && typeof hackathon.organizer === 'string' && hackathon.organizer.trim()) {
    return hackathon.organizer.trim();
  }
  if (hackathon.org_name && typeof hackathon.org_name === 'string' && hackathon.org_name.trim()) {
    return hackathon.org_name.trim();
  }
  if (hackathon.organization?.name?.trim()) {
    return hackathon.organization.name.trim();
  }
  return undefined;
}

/**
 * Extract the event URL from various possible fields.
 */
function extractUrl(hackathon: DoraHacksHackathon): string | null {
  if (hackathon.url && typeof hackathon.url === 'string' && hackathon.url.trim()) {
    return hackathon.url.trim();
  }
  if (hackathon.link && typeof hackathon.link === 'string' && hackathon.link.trim()) {
    return hackathon.link.trim();
  }
  // Construct URL from hackathon ID
  const id = hackathon.hackathon_id;
  if (id !== undefined && id !== null) {
    return `https://dorahacks.io/hackathon/${id}/detail`;
  }
  return null;
}

/**
 * Extract the title from various possible fields.
 */
function extractTitle(hackathon: DoraHacksHackathon): string | null {
  const title = hackathon.hackathon_name ?? hackathon.name ?? hackathon.title;
  if (title && typeof title === 'string' && title.trim()) {
    return title.trim();
  }
  return null;
}

/**
 * Extract location, defaulting to "Online" for DoraHacks events
 * since the platform is primarily virtual.
 */
function extractLocation(hackathon: DoraHacksHackathon): string | undefined {
  if (hackathon.location && typeof hackathon.location === 'string' && hackathon.location.trim()) {
    return hackathon.location.trim();
  }
  if (hackathon.mode && typeof hackathon.mode === 'string') {
    const mode = hackathon.mode.toLowerCase().trim();
    if (mode === 'online' || mode === 'virtual') return 'Online';
    if (mode === 'offline' || mode === 'in_person') return undefined;
  }
  // Default to Online since DoraHacks is predominantly virtual
  return 'Online';
}

/**
 * Maps a single DoraHacks hackathon entry to a RawHackathonEvent.
 * Returns null if required fields are missing.
 */
function mapToRawEvent(hackathon: DoraHacksHackathon): RawHackathonEvent | null {
  const title = extractTitle(hackathon);
  if (!title) {
    return null;
  }

  const url = extractUrl(hackathon);
  if (!url) {
    return null;
  }

  const startDate = parseTimestamp(
    hackathon.start_time ?? hackathon.startTime
  );
  if (!startDate) {
    return null;
  }

  const endDate = parseTimestamp(hackathon.end_time ?? hackathon.endTime);

  return {
    title,
    description: hackathon.description?.trim() || hackathon.tagline?.trim() || undefined,
    startDate,
    endDate: endDate || undefined,
    location: extractLocation(hackathon),
    organizer: extractOrganizer(hackathon),
    prizes: extractPrize(hackathon),
    tags: extractTags(hackathon),
    url,
    source: 'dorahacks',
  };
}

/**
 * Extract hackathon list from the potentially nested API response shape.
 */
function extractHackathonsFromApiResponse(
  data: DoraHacksApiResponse
): DoraHacksHackathon[] {
  // Try nested data.list / data.hackathons / data.items
  if (data.data) {
    if (Array.isArray(data.data.list) && data.data.list.length > 0) {
      return data.data.list;
    }
    if (Array.isArray(data.data.hackathons) && data.data.hackathons.length > 0) {
      return data.data.hackathons;
    }
    if (Array.isArray(data.data.items) && data.data.items.length > 0) {
      return data.data.items;
    }
  }

  // Try top-level list / hackathons / results
  if (Array.isArray(data.list) && data.list.length > 0) {
    return data.list;
  }
  if (Array.isArray(data.hackathons) && data.hackathons.length > 0) {
    return data.hackathons;
  }
  if (Array.isArray(data.results) && data.results.length > 0) {
    return data.results;
  }

  return [];
}

/**
 * Extract hackathon list from a __NEXT_DATA__ JSON payload.
 */
function extractHackathonsFromNextData(
  payload: NextDataPayload
): DoraHacksHackathon[] {
  const pageProps = payload.props?.pageProps;
  if (!pageProps) return [];

  if (Array.isArray(pageProps.hackathons) && pageProps.hackathons.length > 0) {
    return pageProps.hackathons;
  }
  if (Array.isArray(pageProps.list) && pageProps.list.length > 0) {
    return pageProps.list;
  }
  if (Array.isArray(pageProps.data) && pageProps.data.length > 0) {
    return pageProps.data;
  }
  if (pageProps.initialData) {
    if (Array.isArray(pageProps.initialData.list) && pageProps.initialData.list.length > 0) {
      return pageProps.initialData.list;
    }
    if (Array.isArray(pageProps.initialData.hackathons) && pageProps.initialData.hackathons.length > 0) {
      return pageProps.initialData.hackathons;
    }
  }

  return [];
}

/**
 * DoraHacks source adapter.
 *
 * Fetches hackathon listings from DoraHacks, a Web3/crypto hackathon platform.
 * Uses a multi-approach strategy for resilience:
 *   1. Try known REST API endpoints
 *   2. Fall back to __NEXT_DATA__ extraction from the HTML page
 *   3. Return empty array if both approaches fail (graceful degradation)
 */
export class DoraHacksAdapter implements EventSourceAdapter {
  readonly name = 'DoraHacks';
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon events from DoraHacks.
   * Tries API endpoints first, then falls back to HTML scraping.
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    // Approach 1: Try REST API endpoints
    const apiEvents = await this.tryApiEndpoints();
    if (apiEvents.length > 0) {
      return apiEvents;
    }

    // Approach 2: Try extracting __NEXT_DATA__ from HTML
    const htmlEvents = await this.tryHtmlExtraction();
    if (htmlEvents.length > 0) {
      return htmlEvents;
    }

    // Graceful degradation: return empty array
    return [];
  }

  /**
   * Simple connectivity check — verifies that DoraHacks is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(HACKATHON_PAGE_URL);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Try fetching from known API endpoint candidates.
   * Returns mapped events from the first successful endpoint.
   */
  private async tryApiEndpoints(): Promise<RawHackathonEvent[]> {
    for (const endpoint of API_ENDPOINTS) {
      try {
        const response = await this.fetchWithTimeout(endpoint);

        if (!response.ok) {
          continue;
        }

        let data: DoraHacksApiResponse;
        try {
          data = (await response.json()) as DoraHacksApiResponse;
        } catch {
          continue;
        }

        const hackathons = extractHackathonsFromApiResponse(data);
        if (hackathons.length === 0) {
          continue;
        }

        // Map to RawHackathonEvent, skipping malformed entries
        const events: RawHackathonEvent[] = [];
        for (const hackathon of hackathons) {
          try {
            const event = mapToRawEvent(hackathon);
            if (event) {
              events.push(event);
            }
          } catch {
            // Skip malformed entries
            continue;
          }
        }

        if (events.length > 0) {
          return events;
        }
      } catch {
        // Try next endpoint
        continue;
      }
    }

    return [];
  }

  /**
   * Try extracting hackathon data from the HTML page's __NEXT_DATA__ script tag.
   * This works if DoraHacks uses Next.js with SSR and embeds initial data.
   */
  private async tryHtmlExtraction(): Promise<RawHackathonEvent[]> {
    try {
      const response = await this.fetchWithTimeout(HACKATHON_PAGE_URL);

      if (!response.ok) {
        return [];
      }

      const html = await response.text();

      // Look for __NEXT_DATA__ script tag
      const nextDataMatch = html.match(
        /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
      );

      if (!nextDataMatch || !nextDataMatch[1]) {
        return [];
      }

      let payload: NextDataPayload;
      try {
        payload = JSON.parse(nextDataMatch[1]) as NextDataPayload;
      } catch {
        return [];
      }

      const hackathons = extractHackathonsFromNextData(payload);
      if (hackathons.length === 0) {
        return [];
      }

      // Map to RawHackathonEvent, skipping malformed entries
      const events: RawHackathonEvent[] = [];
      for (const hackathon of hackathons) {
        try {
          const event = mapToRawEvent(hackathon);
          if (event) {
            events.push(event);
          }
        } catch {
          // Skip malformed entries
          continue;
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  /**
   * Perform a fetch with an AbortController timeout.
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/html',
          'User-Agent': 'HackathonDiscoveryPlatform/1.0',
        },
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
