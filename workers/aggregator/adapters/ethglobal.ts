/**
 * ETHGlobal source adapter for the hackathon aggregation worker.
 *
 * ETHGlobal runs high-profile Ethereum/Web3 hackathons globally.
 * Their events page is at https://ethglobal.com/events.
 *
 * Since this runs in a Cloudflare Worker (no DOM/cheerio available),
 * this adapter uses a three-approach strategy for resilience:
 *   1. Primary:  Extract __NEXT_DATA__ JSON embedded in the page HTML
 *   2. Fallback: Extract JSON-LD structured data blocks
 *   3. Fallback: Regex-based parsing of event card markup
 *   4. Graceful degradation: Return empty array if all three fail
 */

import type { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Timeout for HTTP requests in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Base URL for ETHGlobal. */
const ETHGLOBAL_BASE_URL = 'https://ethglobal.com';

/** Events listing page URL. */
const EVENTS_PAGE_URL = `${ETHGLOBAL_BASE_URL}/events`;

/** Default tags applied to every ETHGlobal event. */
const DEFAULT_TAGS = ['ethereum', 'web3', 'blockchain'];

// ---------------------------------------------------------------------------
// Type shapes for __NEXT_DATA__ extraction
// ---------------------------------------------------------------------------

/** Loose shape of a single event entry that might appear in ETHGlobal's
 *  embedded Next.js payload. ETHGlobal's exact schema may vary so we use
 *  wide optional types and fall through gracefully if fields are absent. */
interface EthGlobalEvent {
  id?: string | number;
  title?: string;
  name?: string;
  slug?: string;
  city?: string;
  location?: string;
  venue?: string;
  online?: boolean;
  virtual?: boolean;
  mode?: string;
  type?: string;
  prizes?: string | number;
  prizePool?: string | number;
  prize_pool?: string | number;
  description?: string;
  summary?: string;
  tags?: string[];
  tracks?: string[] | { name?: string }[];
  url?: string;
  link?: string;
  href?: string;
  /** ISO 8601 or Unix timestamp variants */
  startDate?: string | number;
  endDate?: string | number;
  start_date?: string | number;
  end_date?: string | number;
  startAt?: string | number;
  endAt?: string | number;
  starts_at?: string | number;
  ends_at?: string | number;
  /** Object-form date (some Next.js payloads wrap dates) */
  start?: { date?: string; timestamp?: number } | string | number;
  end?: { date?: string; timestamp?: number } | string | number;
}

/** Next.js __NEXT_DATA__ page-props payload. */
interface NextDataPayload {
  props?: {
    pageProps?: {
      events?: EthGlobalEvent[];
      hackathons?: EthGlobalEvent[];
      data?: EthGlobalEvent[] | { events?: EthGlobalEvent[]; hackathons?: EthGlobalEvent[] };
      initialData?: {
        events?: EthGlobalEvent[];
        hackathons?: EthGlobalEvent[];
      };
    };
  };
  query?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Date parsing helpers
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Parse a wide variety of date representations into an ISO 8601 string.
 * Handles:
 *  - Unix timestamps (seconds or milliseconds)
 *  - ISO 8601 strings
 *  - Human-readable formats like "Jan 17, 2025", "17 Jan 2025"
 *  - Range strings like "Jan 17-19, 2025" or "Nov 15 – Dec 2, 2025"
 *
 * Returns null for unparseable values.
 */
function parseDate(value: string | number | { date?: string; timestamp?: number } | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  // Object form: { date: "...", timestamp: ... }
  if (typeof value === 'object') {
    if (value.date) {
      const fromDate = parseDate(value.date);
      if (fromDate) return fromDate;
    }
    if (value.timestamp) {
      return parseDate(value.timestamp);
    }
    return null;
  }

  // Numeric: Unix timestamp
  if (typeof value === 'number') {
    if (value <= 0) return null;
    // Heuristic: values < year-3000 in seconds
    const ms = value < 32_503_680_000 ? value * 1000 : value;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // String handling
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Numeric string (Unix timestamp)
  const asNum = Number(trimmed);
  if (!isNaN(asNum) && asNum > 0 && /^\d+$/.test(trimmed)) {
    return parseDate(asNum);
  }

  // ISO 8601 (starts with YYYY-MM-DD or YYYY-MM-DDTHH:…)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Remove ordinal suffixes: "17th" → "17"
  const withoutOrdinals = trimmed.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  // "Month Day – Day, Year" (range, extract start day)
  // e.g. "Jan 17 - 19, 2025" or "Nov 15 – Dec 2, 2025"
  const rangeStartMatch = withoutOrdinals.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*(?:[A-Za-z]+\s+)?\d{1,2}\s*,?\s*(\d{4})/
  );
  if (rangeStartMatch) {
    const month = MONTH_MAP[rangeStartMatch[1].toLowerCase()] ?? MONTH_MAP[rangeStartMatch[1].toLowerCase().slice(0, 3)];
    const day = parseInt(rangeStartMatch[2], 10);
    const year = parseInt(rangeStartMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  // "Month Day, Year" e.g. "Jan 17, 2025"
  const mdyMatch = withoutOrdinals.match(/([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/);
  if (mdyMatch) {
    const month = MONTH_MAP[mdyMatch[1].toLowerCase()] ?? MONTH_MAP[mdyMatch[1].toLowerCase().slice(0, 3)];
    const day = parseInt(mdyMatch[2], 10);
    const year = parseInt(mdyMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  // "Day Month Year" e.g. "17 Jan 2025"
  const dmyMatch = withoutOrdinals.match(/(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = MONTH_MAP[dmyMatch[2].toLowerCase()] ?? MONTH_MAP[dmyMatch[2].toLowerCase().slice(0, 3)];
    const year = parseInt(dmyMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  // Last resort: native Date parse
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

/**
 * Parse the end date from a date range string.
 * e.g. "Jan 17 - 19, 2025" → 2025-01-19
 *      "Nov 15 – Dec 2, 2025" → 2025-12-02
 */
function parseEndDate(value: string | number | { date?: string; timestamp?: number } | undefined): string | null {
  if (typeof value !== 'string') {
    // For non-strings, delegate to the general parser as the value IS the end date
    return parseDate(value);
  }

  const trimmed = value.trim();
  const withoutOrdinals = trimmed.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  // "Month Day – Month Day, Year" (cross-month range)
  const crossMonthMatch = withoutOrdinals.match(
    /[A-Za-z]+\s+\d{1,2}\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/
  );
  if (crossMonthMatch) {
    const month = MONTH_MAP[crossMonthMatch[1].toLowerCase()] ?? MONTH_MAP[crossMonthMatch[1].toLowerCase().slice(0, 3)];
    const day = parseInt(crossMonthMatch[2], 10);
    const year = parseInt(crossMonthMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  // "Month Day – Day, Year" (same-month range)
  const sameMonthMatch = withoutOrdinals.match(
    /([A-Za-z]+)\s+\d{1,2}\s*[-–]\s*(\d{1,2})\s*,?\s*(\d{4})/
  );
  if (sameMonthMatch) {
    const month = MONTH_MAP[sameMonthMatch[1].toLowerCase()] ?? MONTH_MAP[sameMonthMatch[1].toLowerCase().slice(0, 3)];
    const endDay = parseInt(sameMonthMatch[2], 10);
    const year = parseInt(sameMonthMatch[3], 10);
    if (month !== undefined && endDay >= 1 && endDay <= 31 && year >= 2000) {
      return new Date(Date.UTC(year, month, endDay)).toISOString();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// ETHGlobal event mapping helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical ETHGlobal event URL from a slug or raw URL.
 */
function buildEventUrl(event: EthGlobalEvent): string | null {
  // Prefer an explicit URL if present
  const rawUrl = event.url ?? event.link ?? event.href;
  if (rawUrl && typeof rawUrl === 'string' && rawUrl.trim()) {
    const u = rawUrl.trim();
    if (u.startsWith('http')) return u;
    if (u.startsWith('/')) return `${ETHGLOBAL_BASE_URL}${u}`;
    return `${ETHGLOBAL_BASE_URL}/${u}`;
  }

  // Construct from slug
  const slug = event.slug;
  if (slug && typeof slug === 'string' && slug.trim()) {
    return `${ETHGLOBAL_BASE_URL}/${slug.trim()}`;
  }

  // Construct from id
  if (event.id !== undefined && event.id !== null) {
    return `${ETHGLOBAL_BASE_URL}/events/${event.id}`;
  }

  return null;
}

/**
 * Derive the location string from an ETHGlobal event entry.
 * ETHGlobal mostly runs in-person events in named cities; "Online" otherwise.
 */
function extractLocation(event: EthGlobalEvent): string | undefined {
  // Explicit online/virtual flags
  if (event.online === true || event.virtual === true) {
    return 'Online';
  }

  const mode = (event.mode ?? event.type ?? '').toLowerCase();
  if (mode === 'online' || mode === 'virtual') {
    return 'Online';
  }

  // Named city
  const city = event.city ?? event.location ?? event.venue;
  if (city && typeof city === 'string' && city.trim()) {
    return city.trim();
  }

  return undefined;
}

/**
 * Derive prize information from various prize-related fields.
 */
function extractPrizes(event: EthGlobalEvent): string | undefined {
  const raw = event.prizes ?? event.prizePool ?? event.prize_pool;
  if (raw === undefined || raw === null) return undefined;

  if (typeof raw === 'number') {
    return raw > 0 ? `$${raw.toLocaleString()}` : undefined;
  }

  const str = raw.toString().trim();
  return str.length > 0 ? str : undefined;
}

/**
 * Extract tags from an ETHGlobal event entry, merged with default tags.
 */
function extractTags(event: EthGlobalEvent): string[] {
  const extra: string[] = [];

  if (event.tags && Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (typeof tag === 'string' && tag.trim()) {
        extra.push(tag.trim());
      }
    }
  }

  if (event.tracks && Array.isArray(event.tracks)) {
    for (const track of event.tracks) {
      if (typeof track === 'string' && track.trim()) {
        extra.push(track.trim());
      } else if (track && typeof track === 'object' && track.name?.trim()) {
        extra.push(track.name.trim());
      }
    }
  }

  // Merge with defaults, deduplicate
  return [...new Set([...DEFAULT_TAGS, ...extra])];
}

/**
 * Map an EthGlobalEvent object to a RawHackathonEvent.
 * Returns null if required fields (title, startDate, url) cannot be resolved.
 */
function mapToRawEvent(event: EthGlobalEvent): RawHackathonEvent | null {
  // Title
  const title = (event.title ?? event.name ?? '').trim();
  if (!title) return null;

  // URL
  const url = buildEventUrl(event);
  if (!url) return null;

  // Start date — try all common field names
  const rawStart =
    event.startDate ?? event.start_date ?? event.startAt ?? event.starts_at ?? event.start;
  const startDate = parseDate(rawStart);
  if (!startDate) return null;

  // End date
  const rawEnd =
    event.endDate ?? event.end_date ?? event.endAt ?? event.ends_at ?? event.end;
  const endDate = parseDate(rawEnd);

  return {
    title,
    description: (event.description ?? event.summary ?? '').trim() || undefined,
    startDate,
    endDate: endDate ?? undefined,
    location: extractLocation(event),
    organizer: 'ETHGlobal',
    prizes: extractPrizes(event),
    tags: extractTags(event),
    url,
    source: 'ethglobal',
  };
}

// ---------------------------------------------------------------------------
// Approach 1: __NEXT_DATA__ extraction
// ---------------------------------------------------------------------------

/**
 * Extract ETHGlobal events from the __NEXT_DATA__ JSON embedded in the page.
 * ETHGlobal uses Next.js, and event listings are typically embedded as
 * initial server-side props accessible via <script id="__NEXT_DATA__">.
 */
function extractFromNextData(html: string): RawHackathonEvent[] {
  const nextDataMatch = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (!nextDataMatch?.[1]) return [];

  let payload: NextDataPayload;
  try {
    payload = JSON.parse(nextDataMatch[1]) as NextDataPayload;
  } catch {
    return [];
  }

  const pageProps = payload.props?.pageProps;
  if (!pageProps) return [];

  // Candidate locations for the event list
  let candidates: EthGlobalEvent[] = [];

  if (Array.isArray(pageProps.events) && pageProps.events.length > 0) {
    candidates = pageProps.events;
  } else if (Array.isArray(pageProps.hackathons) && pageProps.hackathons.length > 0) {
    candidates = pageProps.hackathons;
  } else if (pageProps.data) {
    if (Array.isArray(pageProps.data)) {
      candidates = pageProps.data;
    } else if (typeof pageProps.data === 'object') {
      const d = pageProps.data as { events?: EthGlobalEvent[]; hackathons?: EthGlobalEvent[] };
      candidates = d.events ?? d.hackathons ?? [];
    }
  } else if (pageProps.initialData) {
    candidates =
      pageProps.initialData.events ??
      pageProps.initialData.hackathons ??
      [];
  }

  const events: RawHackathonEvent[] = [];
  for (const item of candidates) {
    try {
      const event = mapToRawEvent(item);
      if (event) events.push(event);
    } catch {
      // Skip malformed entries
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Approach 2: JSON-LD structured data
// ---------------------------------------------------------------------------

/** Minimum fields expected in a JSON-LD Event object. */
interface JsonLdEvent {
  '@type'?: string | string[];
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  location?: {
    name?: string;
    address?: { addressLocality?: string; name?: string };
  } | string;
  organizer?: { name?: string } | string;
  offers?: { price?: string | number; priceCurrency?: string };
}

/**
 * Extract events from JSON-LD <script type="application/ld+json"> blocks.
 */
function extractFromJsonLd(html: string): RawHackathonEvent[] {
  const events: RawHackathonEvent[] = [];
  const processedUrls = new Set<string>();
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim());
      const items: JsonLdEvent[] = Array.isArray(raw) ? raw : [raw];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;

        // Accept @type values of Event, Hackathon, or absent (be permissive)
        const type = item['@type'];
        if (type) {
          const typeArr = Array.isArray(type) ? type : [type];
          const isEvent = typeArr.some((t) =>
            ['Event', 'Hackathon', 'SportsEvent', 'EducationEvent', 'BusinessEvent'].includes(t)
          );
          if (!isEvent) continue;
        }

        const title = item.name?.trim();
        if (!title) continue;

        let eventUrl = item.url?.trim();
        if (!eventUrl) continue;
        if (eventUrl.startsWith('/')) {
          eventUrl = `${ETHGLOBAL_BASE_URL}${eventUrl}`;
        }
        if (processedUrls.has(eventUrl)) continue;

        const startDate = parseDate(item.startDate);
        if (!startDate) continue;

        const endDate = parseDate(item.endDate);

        // Location
        let location: string | undefined;
        if (item.location) {
          if (typeof item.location === 'string') {
            location = item.location.trim() || undefined;
          } else {
            location =
              item.location.name?.trim() ||
              item.location.address?.addressLocality?.trim() ||
              item.location.address?.name?.trim() ||
              undefined;
          }
        }

        // Prizes from offers
        let prizes: string | undefined;
        if (item.offers?.price !== undefined) {
          const currency = item.offers.priceCurrency ?? '';
          prizes = `${currency}${item.offers.price}`.trim();
        }

        processedUrls.add(eventUrl);

        events.push({
          title,
          description: item.description?.trim() || undefined,
          startDate,
          endDate: endDate ?? undefined,
          location,
          organizer: 'ETHGlobal',
          prizes,
          tags: [...DEFAULT_TAGS],
          url: eventUrl,
          source: 'ethglobal',
        });
      }
    } catch {
      // Invalid JSON-LD block; skip
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Approach 3: Regex-based HTML parsing
// ---------------------------------------------------------------------------

/**
 * Parse ETHGlobal event cards from raw HTML using regex patterns.
 *
 * ETHGlobal's events page renders cards for each event, typically structured as:
 *
 *   <a href="/eventname" ...>
 *     <div class="...">
 *       <h2 ...>ETHGlobal New York 2025</h2>
 *       <p ...>Apr 4 – 6, 2025</p>
 *       <p ...>New York</p>
 *     </div>
 *   </a>
 *
 * or with class names like "event-card", "hackathon-card", "EventCard", etc.
 * We use broad patterns and require multiple matching signals per event.
 */
function extractFromHtmlRegex(html: string): RawHackathonEvent[] {
  const events: RawHackathonEvent[] = [];
  const processedUrls = new Set<string>();

  // Strategy A: find anchor tags that link to event slugs containing year info
  // ETHGlobal slugs look like "/bangkok", "/new-york-2025", "/sydney"
  // Their hrefs are relative paths to event pages
  const anchorRegex = /<a[^>]*href="(\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const content = match[2];

    if (!href || !content) continue;

    // Skip clearly non-event links (navigation, footer, social)
    const skipPatterns = /^\/(?:about|blog|docs|faq|privacy|terms|twitter|discord|telegram|github|sponsors?|team|apply|login|signup|events$)/i;
    if (skipPatterns.test(href)) continue;

    // The card content should have a heading (event title)
    const headingMatch = content.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (!headingMatch) continue;

    const title = headingMatch[1].replace(/<[^>]*>/g, '').trim();
    if (!title || title.length < 3) continue;

    // Look for a date-like pattern in the card content
    // ETHGlobal uses formats like "Apr 4 – 6, 2025" or "Nov 15 – 17, 2024"
    const datePatterns = [
      // "Month Day – Day, Year"
      /([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4})/,
      // "Month Day – Month Day, Year"
      /([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*[-–]\s*[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4})/,
      // "Month Day, Year"
      /([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/,
    ];

    let dateStr: string | null = null;
    const textContent = content.replace(/<[^>]*>/g, ' ');
    for (const pattern of datePatterns) {
      const m = textContent.match(pattern);
      if (m) {
        dateStr = m[1].trim();
        break;
      }
    }

    if (!dateStr) continue;

    const startDate = parseDate(dateStr);
    if (!startDate) continue;

    const endDate = parseEndDate(dateStr);

    // Build the full event URL
    const eventUrl = `${ETHGLOBAL_BASE_URL}${href}`;
    if (processedUrls.has(eventUrl)) continue;

    // Extract location: look for text that doesn't match a date pattern
    // ETHGlobal cards typically show the city name as plain text after the date
    let location: string | undefined;
    const plainText = textContent
      .replace(title, '')
      .replace(dateStr, '')
      .replace(/\s+/g, ' ')
      .trim();

    // A city name would be a short text segment (2–50 chars) with no special chars
    const cityMatch = plainText.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\b/);
    if (cityMatch && cityMatch[1].length >= 2 && cityMatch[1].length <= 50) {
      // Exclude known non-city words
      const notCities = /^(?:online|virtual|hybrid|ethglobal|ethereum|web3|blockchain)$/i;
      if (!notCities.test(cityMatch[1])) {
        location = cityMatch[1];
      }
    }

    processedUrls.add(eventUrl);

    events.push({
      title,
      startDate,
      endDate: endDate ?? undefined,
      location,
      organizer: 'ETHGlobal',
      tags: [...DEFAULT_TAGS],
      url: eventUrl,
      source: 'ethglobal',
    });
  }

  // Strategy B: broader class-name-based card detection
  if (events.length === 0) {
    const cardRegex = /<(?:div|article|section|li)[^>]*class="[^"]*(?:event|hackathon|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section|li)>/gi;

    while ((match = cardRegex.exec(html)) !== null) {
      try {
        const cardContent = match[1];

        // Need a heading
        const headingMatch = cardContent.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
        if (!headingMatch) continue;

        const title = headingMatch[1].replace(/<[^>]*>/g, '').trim();
        if (!title || title.length < 3) continue;

        // Need a date
        const textContent = cardContent.replace(/<[^>]*>/g, ' ');
        const dateMatch = textContent.match(
          /([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*[-–]\s*(?:[A-Za-z]+\s+)?\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/
        );
        if (!dateMatch) continue;

        const startDate = parseDate(dateMatch[1]);
        if (!startDate) continue;

        const endDate = parseEndDate(dateMatch[1]);

        // Extract URL from a link inside the card
        const linkMatch = cardContent.match(/href="(\/[^"]+)"/);
        if (!linkMatch) continue;

        const eventUrl = `${ETHGLOBAL_BASE_URL}${linkMatch[1]}`;
        if (processedUrls.has(eventUrl)) continue;
        processedUrls.add(eventUrl);

        events.push({
          title,
          startDate,
          endDate: endDate ?? undefined,
          organizer: 'ETHGlobal',
          tags: [...DEFAULT_TAGS],
          url: eventUrl,
          source: 'ethglobal',
        });
      } catch {
        // Skip malformed cards
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Perform a fetch with an AbortController timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'HackathonDiscoveryPlatform/1.0 (aggregator)',
        Accept: 'text/html,application/xhtml+xml,application/json',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// ETHGlobalAdapter class
// ---------------------------------------------------------------------------

/**
 * ETHGlobal source adapter for the hackathon aggregation worker.
 *
 * Scrapes ETHGlobal's events page and extracts hackathon data using a
 * three-tiered strategy (in order of reliability):
 *   1. __NEXT_DATA__ JSON embedded by Next.js SSR
 *   2. JSON-LD structured event data
 *   3. Regex-based HTML card parsing
 *
 * Implements graceful degradation: each strategy is tried in sequence
 * and the first one that produces results is used. If all three fail,
 * an empty array is returned rather than throwing.
 *
 * @implements {EventSourceAdapter}
 */
export class ETHGlobalAdapter implements EventSourceAdapter {
  readonly name = 'ETHGlobal';
  readonly enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon events from ETHGlobal's events page.
   *
   * Tries three extraction approaches in order:
   *  1. __NEXT_DATA__ JSON embedded in the page HTML
   *  2. JSON-LD structured data
   *  3. Regex-based event card parsing
   *
   * @returns Array of raw hackathon events; empty array on complete failure.
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(EVENTS_PAGE_URL, REQUEST_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ETHGlobal adapter failed to fetch events page: ${message}`);
    }

    if (!response.ok) {
      throw new Error(
        `ETHGlobal events page returned HTTP ${response.status} ${response.statusText}`
      );
    }

    let html: string;
    try {
      html = await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ETHGlobal adapter failed to read response body: ${message}`);
    }

    // Approach 1: __NEXT_DATA__
    const nextDataEvents = extractFromNextData(html);
    if (nextDataEvents.length > 0) {
      return nextDataEvents;
    }

    // Approach 2: JSON-LD
    const jsonLdEvents = extractFromJsonLd(html);
    if (jsonLdEvents.length > 0) {
      return jsonLdEvents;
    }

    // Approach 3: Regex-based parsing
    const regexEvents = extractFromHtmlRegex(html);
    if (regexEvents.length > 0) {
      return regexEvents;
    }

    // Graceful degradation: all approaches failed, return empty array
    return [];
  }

  /**
   * Check if the ETHGlobal events page is reachable and responding.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(EVENTS_PAGE_URL, REQUEST_TIMEOUT_MS);
      return response.ok;
    } catch {
      return false;
    }
  }
}
