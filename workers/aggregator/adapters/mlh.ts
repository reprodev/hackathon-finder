/**
 * MLH (Major League Hacking) source adapter.
 *
 * Fetches hackathon event data by scraping the MLH events page HTML.
 * MLH lists events at URLs like https://mlh.io/seasons/2025/events.
 * Since this runs in a Cloudflare Worker, we use regex-based parsing
 * (no DOM/cheerio available without bundling).
 */

import { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Timeout for HTTP requests in milliseconds */
const REQUEST_TIMEOUT_MS = 10_000;

/** Base URL for MLH events pages */
const MLH_BASE_URL = 'https://mlh.io';

/**
 * Determine the current and next MLH season year.
 * MLH seasons typically run from the fall of one year through the following year,
 * e.g., the "2025" season covers events in the 2024-2025 academic year.
 */
function getSeasonYears(): number[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  // MLH seasons overlap: if we're past August, the next year's season is active
  if (month >= 7) {
    return [currentYear + 1, currentYear];
  }
  return [currentYear, currentYear + 1];
}

/**
 * Build the MLH events page URL for a given season year.
 */
function buildEventsUrl(seasonYear: number): string {
  return `${MLH_BASE_URL}/seasons/${seasonYear}/events`;
}

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
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse a date string from MLH's format into ISO 8601.
 * MLH typically shows dates like "Jan 17th - 19th, 2025" or "Feb 7th, 2025".
 * We attempt to parse the start date from these patterns.
 */
function parseMlhDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) {
    return null;
  }

  const cleaned = dateStr.trim();

  // Remove ordinal suffixes (st, nd, rd, th)
  const withoutOrdinals = cleaned.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  // Pattern: "Mon DD - DD, YYYY" or "Mon DD - Mon DD, YYYY" or "Mon DD, YYYY"
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Try "Month Day, Year" pattern (simple single date)
  const singleDateMatch = withoutOrdinals.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/
  );
  if (singleDateMatch) {
    const monthStr = singleDateMatch[1].toLowerCase().slice(0, 3);
    const day = parseInt(singleDateMatch[2], 10);
    const year = parseInt(singleDateMatch[3], 10);
    const monthIdx = months[monthStr];
    if (monthIdx !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, day));
      return date.toISOString();
    }
  }

  // Try "Month Day - Day, Year" pattern (range within same month)
  const rangeMatch = withoutOrdinals.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*-\s*(?:[A-Za-z]+\s+)?(\d{1,2})\s*,?\s*(\d{4})/
  );
  if (rangeMatch) {
    const monthStr = rangeMatch[1].toLowerCase().slice(0, 3);
    const startDay = parseInt(rangeMatch[2], 10);
    const year = parseInt(rangeMatch[4], 10);
    const monthIdx = months[monthStr];
    if (monthIdx !== undefined && startDay >= 1 && startDay <= 31 && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, startDay));
      return date.toISOString();
    }
  }

  // Try to extract just a month and year with any day
  const monthYearMatch = withoutOrdinals.match(/([A-Za-z]+)\s+.*?(\d{4})/);
  if (monthYearMatch) {
    const monthStr = monthYearMatch[1].toLowerCase().slice(0, 3);
    const year = parseInt(monthYearMatch[2], 10);
    const monthIdx = months[monthStr];
    if (monthIdx !== undefined && year >= 2000) {
      // Try to find a day number
      const dayMatch = withoutOrdinals.match(/(\d{1,2})/);
      const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;
      if (day >= 1 && day <= 31) {
        const date = new Date(Date.UTC(year, monthIdx, day));
        return date.toISOString();
      }
    }
  }

  return null;
}

/**
 * Parse end date from an MLH date range string.
 * Handles patterns like "Jan 17 - 19, 2025" or "Jan 17 - Feb 2, 2025".
 */
function parseMlhEndDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) {
    return null;
  }

  const cleaned = dateStr.trim();
  const withoutOrdinals = cleaned.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Pattern: "Month Day - Month Day, Year" (range across months)
  const crossMonthMatch = withoutOrdinals.match(
    /[A-Za-z]+\s+\d{1,2}\s*-\s*([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/
  );
  if (crossMonthMatch) {
    const endMonthStr = crossMonthMatch[1].toLowerCase().slice(0, 3);
    const endDay = parseInt(crossMonthMatch[2], 10);
    const year = parseInt(crossMonthMatch[3], 10);
    const monthIdx = months[endMonthStr];
    if (monthIdx !== undefined && endDay >= 1 && endDay <= 31 && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, endDay));
      return date.toISOString();
    }
  }

  // Pattern: "Month Day - Day, Year" (range within same month)
  const sameMonthMatch = withoutOrdinals.match(
    /([A-Za-z]+)\s+\d{1,2}\s*-\s*(\d{1,2})\s*,?\s*(\d{4})/
  );
  if (sameMonthMatch) {
    const monthStr = sameMonthMatch[1].toLowerCase().slice(0, 3);
    const endDay = parseInt(sameMonthMatch[2], 10);
    const year = parseInt(sameMonthMatch[3], 10);
    const monthIdx = months[monthStr];
    if (monthIdx !== undefined && endDay >= 1 && endDay <= 31 && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, endDay));
      return date.toISOString();
    }
  }

  return null;
}

/**
 * Extract event data from MLH HTML using regex-based parsing.
 *
 * MLH event cards typically follow this structure:
 * <div class="event-wrapper">
 *   <a href="/event-url">
 *     <div class="event-name"><h3>Title</h3></div>
 *     <div class="event-date">Jan 17th - 19th, 2025</div>
 *     <div class="event-location">City, State</div>
 *   </a>
 * </div>
 *
 * We use regex to capture these patterns from the raw HTML.
 */
function parseEventsFromHtml(html: string): RawHackathonEvent[] {
  const events: RawHackathonEvent[] = [];

  // MLH uses feature_cards or event-wrapper containers for individual events.
  // Match event blocks - look for the event card pattern
  // The primary pattern targets the <div class="event"> or similar wrapper
  const eventBlockRegex = /<div[^>]*class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

  // Alternative: try to find links to event pages with associated data
  // MLH event cards typically wrap content in an anchor to the event page
  const eventLinkRegex = /<a[^>]*href="([^"]*)"[^>]*class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  // Try the link-based approach first (more reliable for MLH's structure)
  let match: RegExpExecArray | null;
  const processedUrls = new Set<string>();

  // Pattern 1: Event cards with links containing class "event-link" or similar
  const cardPattern = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  while ((match = cardPattern.exec(html)) !== null) {
    const href = match[1];
    const content = match[2];

    // Skip non-event links (navigation, footer, etc.)
    if (!href || !content) continue;

    // MLH event links typically point to event detail pages
    // They contain event name, date, and location information
    const hasEventName = /<h3[^>]*>([\s\S]*?)<\/h3>/i.test(content) ||
                          /class="[^"]*event-name[^"]*"/i.test(content);
    const hasDateInfo = /class="[^"]*event-date[^"]*"/i.test(content) ||
                        /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(content);

    if (!hasEventName || !hasDateInfo) continue;

    // Extract title
    let title: string | null = null;
    const titleMatch = content.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
                       content.match(/class="[^"]*event-name[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    if (!title) continue;

    // Extract date
    let dateStr: string | null = null;
    const dateMatch = content.match(/class="[^"]*event-date[^"]*"[^>]*>([\s\S]*?)<\//i) ||
                      content.match(/<p[^>]*>([\s\S]*?\d{4}[\s\S]*?)<\/p>/i) ||
                      content.match(/<span[^>]*>([\s\S]*?\d{4}[\s\S]*?)<\/span>/i);
    if (dateMatch) {
      dateStr = dateMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    const startDate = parseMlhDate(dateStr || '');
    if (!startDate) continue;

    // Extract location
    let location: string | null = null;
    const locationMatch = content.match(/class="[^"]*event-location[^"]*"[^>]*>([\s\S]*?)<\//i) ||
                           content.match(/class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (locationMatch) {
      location = locationMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    // Build the full event URL
    let eventUrl = href.trim();
    if (eventUrl.startsWith('/')) {
      eventUrl = `${MLH_BASE_URL}${eventUrl}`;
    } else if (!eventUrl.startsWith('http')) {
      eventUrl = `${MLH_BASE_URL}/${eventUrl}`;
    }

    // Skip duplicates
    if (processedUrls.has(eventUrl)) continue;
    processedUrls.add(eventUrl);

    // Parse end date from the date range string
    const endDate = parseMlhEndDate(dateStr || '');

    const event: RawHackathonEvent = {
      title,
      startDate,
      endDate: endDate || undefined,
      location: location || undefined,
      organizer: 'Major League Hacking',
      tags: ['mlh', 'hackathon'],
      url: eventUrl,
      source: 'mlh',
    };

    events.push(event);
  }

  // If the anchor-based approach didn't work, try a broader pattern
  // MLH sometimes structures cards differently
  if (events.length === 0) {
    const broadPattern = /class="[^"]*event[^"]*"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?(?:event-date|date)[^>]*>([\s\S]*?)<\/[\s\S]*?(?:event-location|location)[^>]*>([\s\S]*?)<\//gi;

    while ((match = broadPattern.exec(html)) !== null) {
      const title = match[1].replace(/<[^>]*>/g, '').trim();
      const dateStr = match[2].replace(/<[^>]*>/g, '').trim();
      const location = match[3].replace(/<[^>]*>/g, '').trim();

      if (!title) continue;

      const startDate = parseMlhDate(dateStr);
      if (!startDate) continue;

      const endDate = parseMlhEndDate(dateStr);

      // Try to find the event URL near this block
      const surroundingBlock = html.substring(
        Math.max(0, (match.index || 0) - 500),
        (match.index || 0) + match[0].length + 200
      );
      const urlMatch = surroundingBlock.match(/href="([^"]*(?:event|hackathon)[^"]*)"/i);
      let eventUrl = urlMatch ? urlMatch[1] : `${MLH_BASE_URL}/events`;

      if (eventUrl.startsWith('/')) {
        eventUrl = `${MLH_BASE_URL}${eventUrl}`;
      }

      const event: RawHackathonEvent = {
        title,
        startDate,
        endDate: endDate || undefined,
        location: location || undefined,
        organizer: 'Major League Hacking',
        tags: ['mlh', 'hackathon'],
        url: eventUrl,
        source: 'mlh',
      };

      events.push(event);
    }
  }

  return events;
}

/**
 * MLH source adapter for the hackathon aggregation worker.
 *
 * Scrapes hackathon event data from MLH's season events pages.
 * MLH does not provide a public API, so we parse the HTML of their
 * events listing page to extract structured event data.
 */
export class MLHAdapter implements EventSourceAdapter {
  readonly name = 'MLH';
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon events from MLH's events pages.
   * Attempts to fetch from the current season and optionally the next season.
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    const seasonYears = getSeasonYears();
    const allEvents: RawHackathonEvent[] = [];
    const errors: Error[] = [];

    for (const year of seasonYears) {
      try {
        const url = buildEventsUrl(year);
        const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);

        if (!response.ok) {
          // Non-200 response: log and continue to next season
          errors.push(
            new Error(`MLH season ${year} returned HTTP ${response.status}`)
          );
          continue;
        }

        const html = await response.text();
        const events = parseEventsFromHtml(html);
        allEvents.push(...events);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(new Error(`Failed to fetch MLH season ${year}: ${message}`));
      }
    }

    // If we got no events from any season and had errors, throw
    if (allEvents.length === 0 && errors.length > 0) {
      throw new Error(
        `MLH adapter failed to fetch events: ${errors.map((e) => e.message).join('; ')}`
      );
    }

    // Deduplicate events across seasons (same URL = same event)
    const uniqueEvents = new Map<string, RawHackathonEvent>();
    for (const event of allEvents) {
      if (!uniqueEvents.has(event.url)) {
        uniqueEvents.set(event.url, event);
      }
    }

    return Array.from(uniqueEvents.values());
  }

  /**
   * Check if the MLH events page is reachable and responding with valid HTML.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const currentSeason = getSeasonYears()[0];
      const url = buildEventsUrl(currentSeason);
      const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
      return response.ok;
    } catch {
      return false;
    }
  }
}
