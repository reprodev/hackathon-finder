/**
 * HackerEarth source adapter for the hackathon aggregation worker.
 *
 * Fetches challenge/hackathon listings by scraping HackerEarth's challenges page.
 * Since this runs in a Cloudflare Worker, we use regex-based parsing
 * (no DOM/cheerio available without bundling).
 */

import type { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Timeout for HTTP requests in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Base URL for HackerEarth challenges. */
const HACKEREARTH_BASE_URL = 'https://www.hackerearth.com';

/** Challenge listing paths to scrape. */
const CHALLENGE_PATHS = [
  '/challenges/hackathon/',
  '/challenges/competitive/',
];

/**
 * Parse a HackerEarth date string into ISO 8601 format.
 *
 * HackerEarth uses various date formats including:
 *  - "15 Jun 2024"
 *  - "Jun 15, 2024"
 *  - "15 Jun, 2024 12:00 AM IST"
 *  - "2024-06-15T00:00:00+05:30"
 *  - "Jun 2024"
 *
 * Returns null if the date cannot be parsed.
 */
function parseHackerEarthDate(dateStr: string | undefined): string | null {
  if (!dateStr || !dateStr.trim()) {
    return null;
  }

  const cleaned = dateStr.trim();

  // Try ISO 8601 directly
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  // Pattern: "DD Mon YYYY" or "DD Mon, YYYY" (e.g., "15 Jun 2024")
  const dmy = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const monthStr = dmy[2].toLowerCase();
    const year = parseInt(dmy[3], 10);
    const monthIdx = months[monthStr] ?? months[monthStr.slice(0, 3)];
    if (monthIdx !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, day));
      return date.toISOString();
    }
  }

  // Pattern: "Mon DD, YYYY" (e.g., "Jun 15, 2024")
  const mdy = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/);
  if (mdy) {
    const monthStr = mdy[1].toLowerCase();
    const day = parseInt(mdy[2], 10);
    const year = parseInt(mdy[3], 10);
    const monthIdx = months[monthStr] ?? months[monthStr.slice(0, 3)];
    if (monthIdx !== undefined && day >= 1 && day <= 31 && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, day));
      return date.toISOString();
    }
  }

  // Pattern: "Mon YYYY" (month + year only, default to 1st)
  const my = cleaned.match(/([A-Za-z]+)\s+(\d{4})/);
  if (my) {
    const monthStr = my[1].toLowerCase();
    const year = parseInt(my[2], 10);
    const monthIdx = months[monthStr] ?? months[monthStr.slice(0, 3)];
    if (monthIdx !== undefined && year >= 2000) {
      const date = new Date(Date.UTC(year, monthIdx, 1));
      return date.toISOString();
    }
  }

  return null;
}

/**
 * Extract tags from a challenge card's category or theme text.
 * HackerEarth labels challenges with categories like "Machine Learning",
 * "Data Structures", "Algorithms", etc.
 */
function extractTags(tagText: string | undefined): string[] {
  if (!tagText || !tagText.trim()) {
    return [];
  }

  // Tags may be comma-separated or found in individual spans/elements
  return tagText
    .split(/[,|]/)
    .map((t) => t.replace(/<[^>]*>/g, '').trim())
    .filter((t) => t.length > 0 && t.length <= 50);
}

/**
 * Extract challenge events from HackerEarth HTML using regex-based parsing.
 *
 * HackerEarth challenge cards typically follow a structure like:
 * <div class="challenge-card" or "upcoming" or "ongoing">
 *   <a href="/challenges/...">
 *     <div class="challenge-name">Title</div>
 *     <div class="date">Starts: Jun 15, 2024</div>
 *     <div class="company">Organizer Name</div>
 *   </a>
 * </div>
 *
 * We use multiple regex strategies to handle HTML variations.
 */
function parseEventsFromHtml(html: string): RawHackathonEvent[] {
  const events: RawHackathonEvent[] = [];
  const processedUrls = new Set<string>();

  // Strategy 1: Match challenge card blocks
  // HackerEarth uses class names like "challenge-card", "challenge-list-item", "upcoming", "ongoing"
  const cardPattern = /<div[^>]*class="[^"]*(?:challenge-card|challenge-list-item|upcoming|ongoing)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>\s*)*?(?=<div[^>]*class="[^"]*(?:challenge-card|challenge-list-item|upcoming|ongoing)|$)/gi;

  let match: RegExpExecArray | null;

  while ((match = cardPattern.exec(html)) !== null) {
    try {
      const cardContent = match[1] || match[0];
      const event = parseCardContent(cardContent, processedUrls);
      if (event) {
        events.push(event);
      }
    } catch {
      // Skip malformed card entries
      continue;
    }
  }

  // Strategy 2: If strategy 1 yielded no results, try a broader link-based approach
  if (events.length === 0) {
    const linkPattern = /<a[^>]*href="(\/challenges\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    while ((match = linkPattern.exec(html)) !== null) {
      try {
        const href = match[1];
        const content = match[2];

        if (!href || !content || processedUrls.has(href)) continue;

        // Must have some textual content that looks like an event
        const textContent = content.replace(/<[^>]*>/g, ' ').trim();
        if (textContent.length < 5) continue;

        // Skip navigation/category links (typically short with no date info)
        const hasDate = /\d{4}/.test(content) ||
                        /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(content) ||
                        /(?:start|end|deadline)/i.test(content);

        if (!hasDate) continue;

        const event = parseLinkContent(href, content, processedUrls);
        if (event) {
          events.push(event);
        }
      } catch {
        continue;
      }
    }
  }

  // Strategy 3: Try JSON-LD structured data if available
  if (events.length === 0) {
    const jsonLdEvents = parseJsonLd(html, processedUrls);
    events.push(...jsonLdEvents);
  }

  return events;
}

/**
 * Parse a single challenge card's content into a RawHackathonEvent.
 */
function parseCardContent(
  content: string,
  processedUrls: Set<string>
): RawHackathonEvent | null {
  // Extract title
  let title: string | null = null;
  const titleMatch =
    content.match(/class="[^"]*(?:challenge-name|challenge-title|event-name|title)[^"]*"[^>]*>([\s\S]*?)<\//i) ||
    content.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i) ||
    content.match(/<a[^>]*title="([^"]*)"[^>]*>/i);

  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
  }

  if (!title || title.length < 2) {
    return null;
  }

  // Extract URL
  let eventUrl: string | null = null;
  const urlMatch = content.match(/<a[^>]*href="([^"]*\/challenges\/[^"]*)"[^>]*>/i) ||
                   content.match(/<a[^>]*href="(\/challenge[^"]*)"[^>]*>/i) ||
                   content.match(/<a[^>]*href="([^"]*hackerearth[^"]*)"[^>]*>/i);

  if (urlMatch) {
    eventUrl = urlMatch[1].trim();
  }

  if (!eventUrl) {
    return null;
  }

  // Normalize URL
  if (eventUrl.startsWith('/')) {
    eventUrl = `${HACKEREARTH_BASE_URL}${eventUrl}`;
  } else if (!eventUrl.startsWith('http')) {
    eventUrl = `${HACKEREARTH_BASE_URL}/${eventUrl}`;
  }

  // Skip duplicates
  if (processedUrls.has(eventUrl)) {
    return null;
  }
  processedUrls.add(eventUrl);

  // Extract dates
  let startDateStr: string | null = null;
  let endDateStr: string | null = null;

  const startDateMatch =
    content.match(/(?:start|begins?)[^<]*?[:\s]+([\s\S]*?)(?:<|$)/i) ||
    content.match(/class="[^"]*(?:start|date)[^"]*"[^>]*>([\s\S]*?)<\//i) ||
    content.match(/(\d{1,2}\s+[A-Za-z]+\s*,?\s*\d{4})/);

  if (startDateMatch) {
    startDateStr = startDateMatch[1].replace(/<[^>]*>/g, '').trim();
  }

  const endDateMatch =
    content.match(/(?:end|deadline|closes?)[^<]*?[:\s]+([\s\S]*?)(?:<|$)/i) ||
    content.match(/class="[^"]*(?:end|deadline)[^"]*"[^>]*>([\s\S]*?)<\//i);

  if (endDateMatch) {
    endDateStr = endDateMatch[1].replace(/<[^>]*>/g, '').trim();
  }

  // If no explicit start date, try any date-like pattern in the content
  if (!startDateStr) {
    const anyDateMatch = content.match(
      /([A-Za-z]+\s+\d{1,2}\s*,?\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s*,?\s*\d{4}|\d{4}-\d{2}-\d{2})/
    );
    if (anyDateMatch) {
      startDateStr = anyDateMatch[1].trim();
    }
  }

  const startDate = parseHackerEarthDate(startDateStr || undefined);
  if (!startDate) {
    return null;
  }

  const endDate = parseHackerEarthDate(endDateStr || undefined);

  // Extract organizer/company
  let organizer: string | undefined;
  const orgMatch =
    content.match(/class="[^"]*(?:company|organizer|host|sponsor)[^"]*"[^>]*>([\s\S]*?)<\//i) ||
    content.match(/(?:hosted by|organized by|by)\s+([^<,]+)/i);

  if (orgMatch) {
    const org = orgMatch[1].replace(/<[^>]*>/g, '').trim();
    if (org.length > 0 && org.length <= 200) {
      organizer = org;
    }
  }

  // Extract tags/categories
  let tags: string[] = ['hackerearth'];
  const tagsMatch =
    content.match(/class="[^"]*(?:tag|category|theme|skill)[^"]*"[^>]*>([\s\S]*?)<\//gi);

  if (tagsMatch) {
    const extractedTags = tagsMatch
      .map((m) => m.replace(/<[^>]*>/g, '').trim())
      .filter((t) => t.length > 0 && t.length <= 50);
    tags = ['hackerearth', ...extractedTags];
  }

  // Extract description/tagline
  let description: string | undefined;
  const descMatch =
    content.match(/class="[^"]*(?:description|tagline|subtitle|summary)[^"]*"[^>]*>([\s\S]*?)<\//i) ||
    content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

  if (descMatch) {
    const desc = descMatch[1].replace(/<[^>]*>/g, '').trim();
    if (desc.length > 5 && desc.length <= 5000) {
      description = desc;
    }
  }

  return {
    title,
    description,
    startDate,
    endDate: endDate || undefined,
    location: 'Online', // HackerEarth challenges are typically online
    organizer,
    tags,
    url: eventUrl,
    source: 'hackerearth',
  };
}

/**
 * Parse event data from an anchor element's content.
 */
function parseLinkContent(
  href: string,
  content: string,
  processedUrls: Set<string>
): RawHackathonEvent | null {
  // Normalize URL
  let eventUrl = href.trim();
  if (eventUrl.startsWith('/')) {
    eventUrl = `${HACKEREARTH_BASE_URL}${eventUrl}`;
  } else if (!eventUrl.startsWith('http')) {
    eventUrl = `${HACKEREARTH_BASE_URL}/${eventUrl}`;
  }

  if (processedUrls.has(eventUrl)) {
    return null;
  }

  // Extract title - first heading or strong text in the link
  let title: string | null = null;
  const titleMatch =
    content.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
    content.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i) ||
    content.match(/<span[^>]*class="[^"]*(?:name|title)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
  }

  // Fallback: use the text content of the link itself
  if (!title) {
    const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    // Take the first meaningful chunk as the title
    const firstLine = textContent.split(/[.\n]/).find((s) => s.trim().length > 3);
    if (firstLine) {
      title = firstLine.trim().slice(0, 200);
    }
  }

  if (!title || title.length < 2) {
    return null;
  }

  // Extract date
  let startDateStr: string | null = null;
  const dateMatch = content.match(
    /([A-Za-z]+\s+\d{1,2}\s*,?\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s*,?\s*\d{4}|\d{4}-\d{2}-\d{2})/
  );
  if (dateMatch) {
    startDateStr = dateMatch[1].trim();
  }

  const startDate = parseHackerEarthDate(startDateStr || undefined);
  if (!startDate) {
    return null;
  }

  processedUrls.add(eventUrl);

  return {
    title,
    startDate,
    location: 'Online',
    organizer: undefined,
    tags: ['hackerearth'],
    url: eventUrl,
    source: 'hackerearth',
  };
}

/**
 * Try to extract event data from JSON-LD structured data blocks.
 * Some pages include <script type="application/ld+json"> with event details.
 */
function parseJsonLd(html: string, processedUrls: Set<string>): RawHackathonEvent[] {
  const events: RawHackathonEvent[] = [];
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim();
      const data = JSON.parse(jsonContent);

      // Handle single object or array
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;

        // Look for Event type or similar
        const type = item['@type'];
        if (type && !['Event', 'Hackathon', 'CompetitiveEvent'].includes(type)) {
          continue;
        }

        const title = item.name?.trim();
        const url = item.url?.trim();
        const startDateRaw = item.startDate;
        const endDateRaw = item.endDate;
        const description = item.description?.trim();
        const organizer = item.organizer?.name?.trim() || item.organizer?.trim();

        if (!title || !url) continue;

        let eventUrl = url;
        if (eventUrl.startsWith('/')) {
          eventUrl = `${HACKEREARTH_BASE_URL}${eventUrl}`;
        }

        if (processedUrls.has(eventUrl)) continue;

        const startDate = parseHackerEarthDate(startDateRaw);
        if (!startDate) continue;

        const endDate = parseHackerEarthDate(endDateRaw);

        processedUrls.add(eventUrl);

        events.push({
          title,
          description: description || undefined,
          startDate,
          endDate: endDate || undefined,
          location: 'Online',
          organizer: organizer || undefined,
          tags: ['hackerearth'],
          url: eventUrl,
          source: 'hackerearth',
        });
      }
    } catch {
      // Invalid JSON-LD block; skip
      continue;
    }
  }

  return events;
}

/**
 * Perform a fetch with an AbortController timeout.
 */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'HackathonDiscoveryPlatform/1.0 (aggregator)',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * HackerEarth source adapter.
 *
 * Scrapes hackathon/challenge listings from HackerEarth's challenges pages.
 * HackerEarth challenges are typically online coding events, hackathons, and
 * competitive programming contests.
 */
export class HackerEarthAdapter implements EventSourceAdapter {
  readonly name = 'HackerEarth';
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon/challenge events from HackerEarth's challenge pages.
   * Iterates through multiple challenge category paths to gather events.
   * Skips individual entries that cannot be parsed.
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    const allEvents: RawHackathonEvent[] = [];
    const errors: Error[] = [];

    for (const path of CHALLENGE_PATHS) {
      try {
        const url = `${HACKEREARTH_BASE_URL}${path}`;
        const response = await fetchWithTimeout(url);

        if (!response.ok) {
          errors.push(
            new Error(`HackerEarth ${path} returned HTTP ${response.status}`)
          );
          continue;
        }

        const html = await response.text();
        const events = parseEventsFromHtml(html);
        allEvents.push(...events);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(new Error(`Failed to fetch HackerEarth ${path}: ${message}`));
      }
    }

    // If no events from any path and there were errors, throw
    if (allEvents.length === 0 && errors.length > 0) {
      throw new Error(
        `HackerEarth adapter failed: ${errors.map((e) => e.message).join('; ')}`
      );
    }

    // Deduplicate events by URL
    const uniqueEvents = new Map<string, RawHackathonEvent>();
    for (const event of allEvents) {
      if (!uniqueEvents.has(event.url)) {
        uniqueEvents.set(event.url, event);
      }
    }

    return Array.from(uniqueEvents.values());
  }

  /**
   * Simple connectivity check — verifies that HackerEarth's challenges page
   * is reachable and responding with a successful status.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${HACKEREARTH_BASE_URL}${CHALLENGE_PATHS[0]}`;
      const response = await fetchWithTimeout(url);
      return response.ok;
    } catch {
      return false;
    }
  }
}
